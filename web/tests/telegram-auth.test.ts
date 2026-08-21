import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthError,
  bearer,
  issueToken,
  readToken,
  verifyInitData,
} from "@/lib/server/telegram-auth";

/**
 * Проверка подписи — единственное, что отделяет «мои заявки» от «чужих
 * заявок»: id пользователя приходит из данных запуска, и если подпись не
 * сверять, любой подставит чужой. Поэтому тесты идут от подделки, а не от
 * счастливого пути.
 */

const BOT_TOKEN = "123456:test-token";

function signInitData(
  pairs: Record<string, string>,
  token = BOT_TOKEN,
): string {
  const checkString = Object.keys(pairs)
    .sort()
    .map((key) => `${key}=${pairs[key]}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...pairs, hash }).toString();
}

const user = { id: 469526368, first_name: "Дарий", last_name: "Назаров", username: "dariy" };

function freshPairs(): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAA",
    user: JSON.stringify(user),
  };
}

describe("данные запуска Mini App", () => {
  it("подписанные данные дают пользователя", () => {
    const viewer = verifyInitData(signInitData(freshPairs()), BOT_TOKEN);
    expect(viewer).toEqual({ id: 469526368, name: "Дарий Назаров", handle: "@dariy" });
  });

  it("подпись от другого бота отклоняется", () => {
    const foreign = signInitData(freshPairs(), "999:other-token");
    expect(() => verifyInitData(foreign, BOT_TOKEN)).toThrow(AuthError);
  });

  it("подмена пользователя ломает подпись", () => {
    const pairs = freshPairs();
    const signed = signInitData(pairs);
    const tampered = new URLSearchParams(signed);
    tampered.set("user", JSON.stringify({ ...user, id: 1 }));
    expect(() => verifyInitData(tampered.toString(), BOT_TOKEN)).toThrow(AuthError);
  });

  it("устаревшие данные запуска отклоняются", () => {
    const pairs = freshPairs();
    pairs.auth_date = String(Math.floor(Date.now() / 1000) - 48 * 3600);
    expect(() => verifyInitData(signInitData(pairs), BOT_TOKEN)).toThrow(/устарели/);
  });

  it("пустые данные отклоняются, а не считаются гостем", () => {
    expect(() => verifyInitData("", BOT_TOKEN)).toThrow(AuthError);
  });
});

describe("токен сессии", () => {
  const viewer = { id: 42, name: "Кто-то", handle: null };

  it("читается обратно тем же секретом", () => {
    expect(readToken(issueToken(viewer, BOT_TOKEN), BOT_TOKEN)).toEqual(viewer);
  });

  it("не читается чужим секретом", () => {
    expect(() => readToken(issueToken(viewer, BOT_TOKEN), "другой")).toThrow(AuthError);
  });

  it("подделанный payload не проходит", () => {
    const [, signature] = issueToken(viewer, BOT_TOKEN).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...viewer, id: 1, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString("base64url");
    expect(() => readToken(`${forged}.${signature}`, BOT_TOKEN)).toThrow(AuthError);
  });

  it("заголовок без Bearer отклоняется", () => {
    expect(() => bearer("Token abc")).toThrow(AuthError);
    expect(bearer("Bearer abc")).toBe("abc");
  });
});

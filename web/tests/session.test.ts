import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Вход в Mini App со стороны браузера.
 *
 * Проверяется то, на чём вход ломался вживую: имя человека показывалось, а
 * заявки и загрузка картинок не работали. Оба симптома — один и тот же отказ
 * получить токен, причём молчаливый: экран выглядит рабочим.
 *
 * Модуль держит состояние на уровне файла (токен и код в памяти), поэтому
 * каждый тест импортирует его заново.
 */

type FetchCall = { url: string; init: RequestInit | undefined };

function stubBrowser({ storage }: { storage: "ok" | "blocked" }) {
  const calls: FetchCall[] = [];
  const replaced: string[] = [];
  const store = new Map<string, string>();

  vi.stubGlobal("window", {
    location: { search: "?c=CODE.SIG", pathname: "/my/", hash: "" },
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        replaced.push(url);
      },
    },
  });

  vi.stubGlobal(
    "localStorage",
    storage === "ok"
      ? {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
        }
      : {
          getItem() {
            throw new Error("хранилище заблокировано");
          },
          setItem() {
            throw new Error("хранилище заблокировано");
          },
        },
  );

  return { calls, replaced, store };
}

function respond(
  calls: FetchCall[],
  plan: Array<{ status: number; body?: unknown; renew?: string }>,
) {
  let index = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = plan[Math.min(index++, plan.length - 1)];
    return Promise.resolve({
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      // Заголовки настоящий ответ несёт всегда: через них приходит продлённый
      // токен, и без них стаб перестал бы моделировать fetch.
      headers: { get: (name: string) => (name === "X-Session-Token" ? step.renew ?? null : null) },
      json: () => Promise.resolve(step.body ?? {}),
    });
  });
}

const session = { token: "TOKEN-1", user: { id: 7, name: "Дарий", handle: "@dariy" } };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("сессия Mini App", () => {
  it("код входа обменивается на токен и убирается из адреса", async () => {
    const { calls, replaced } = stubBrowser({ storage: "ok" });
    respond(calls, [{ status: 200, body: session }]);

    const api = await import("@/lib/client/api");
    expect((await api.exchangeSession())?.token).toBe("TOKEN-1");

    expect(calls[0].url).toContain("/api/auth/redeem/");
    // Код не должен остаться в адресе: приложение перезагружается по кнопкам,
    // и лишний обмен на каждом переходе бессмысленен.
    expect(replaced).toEqual(["/my/"]);
  });

  it("код обменивается один раз на запуск приложения", async () => {
    // Вход подтверждается на старте (оболочка) и ещё раз запрашивается на
    // экране профиля. Второй обмен тем же кодом не нужен и, если сервер начнёт
    // считать код одноразовым, будет отказом.
    const { calls } = stubBrowser({ storage: "ok" });
    respond(calls, [{ status: 200, body: session }]);

    const api = await import("@/lib/client/api");
    const [first, second] = await Promise.all([
      api.exchangeSession(),
      api.exchangeSession(),
    ]);
    const third = await api.exchangeSession();

    expect(first?.token).toBe("TOKEN-1");
    expect(second?.token).toBe("TOKEN-1");
    expect(third?.token).toBe("TOKEN-1");
    expect(calls).toHaveLength(1);
  });

  it("при заблокированном хранилище токен живёт в памяти", async () => {
    // Вебвью Telegram и приватный режим умеют бросать на localStorage. Раньше
    // это означало, что вход есть, а картинки грузить нельзя: следующий запрос
    // токена уже не находил.
    const { calls } = stubBrowser({ storage: "blocked" });
    respond(calls, [
      { status: 200, body: session },
      { status: 200, body: { requests: [] } },
    ]);

    const api = await import("@/lib/client/api");
    await api.exchangeSession();
    expect(await api.sessionToken()).toBe("TOKEN-1");
    expect(await api.fetchMyRequests()).toEqual([]);

    // Ровно два запроса: обмен и заявки. Третий означал бы повторный обмен.
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/api/requests/");
    expect(api.loginTrace().storageAvailable).toBe(false);
  });

  it("истёкший токен обменивается заново кодом из памяти", async () => {
    const { calls } = stubBrowser({ storage: "ok" });
    respond(calls, [
      { status: 200, body: session },
      { status: 401 },
      { status: 200, body: { token: "TOKEN-2", user: session.user } },
      { status: 200, body: { requests: [{ taskId: 1 }] } },
    ]);

    const api = await import("@/lib/client/api");
    await api.exchangeSession();
    const requests = await api.fetchMyRequests();

    expect(requests).toEqual([{ taskId: 1 }]);
    // Второй обмен идёт тем же кодом: человек не должен возвращаться в чат за
    // свежей кнопкой из-за истёкшего токена.
    expect(calls.map((call) => call.url.replace(/^.*\/api/, "/api"))).toEqual([
      "/api/auth/redeem/",
      "/api/requests/",
      "/api/auth/redeem/",
      "/api/requests/",
    ]);
  });

  it("отказ обмена виден в диагностике, а не молчит", async () => {
    const { calls } = stubBrowser({ storage: "ok" });
    respond(calls, [{ status: 401, body: { error: "код входа истёк" } }]);

    const api = await import("@/lib/client/api");
    expect(await api.exchangeSession()).toBeNull();

    const trace = api.loginTrace();
    expect(trace.hadCode).toBe(true);
    expect(trace.redeemStatus).toBe(401);
    expect(trace.tokenPresent).toBe(false);
    expect(trace.error).toBe("код входа истёк");
  });

  it("продлённый токен заменяет старый и уходит в следующий запрос", async () => {
    const { calls, store } = stubBrowser({ storage: "ok" });
    respond(calls, [
      { status: 200, body: session },
      { status: 200, body: { requests: [] }, renew: "TOKEN-RENEWED" },
      { status: 200, body: { requests: [] } },
    ]);

    const api = await import("@/lib/client/api");
    await api.exchangeSession();
    await api.fetchMyRequests();
    await api.fetchMyRequests();

    // Смысл продления: месяц перестаёт быть стеной, и человеку не нужно идти в
    // чат за свежей кнопкой, пока он приложением пользуется.
    expect(store.get("comp-design-bot:session-token")).toBe("TOKEN-RENEWED");
    const authorizations = calls
      .filter((call) => call.url.includes("/api/requests/"))
      .map((call) => (call.init?.headers as Record<string, string>)?.Authorization);
    expect(authorizations).toEqual(["Bearer TOKEN-1", "Bearer TOKEN-RENEWED"]);
  });

  it("ответ без продления оставляет прежний токен", async () => {
    const { calls, store } = stubBrowser({ storage: "ok" });
    respond(calls, [
      { status: 200, body: session },
      { status: 200, body: { requests: [] } },
    ]);

    const api = await import("@/lib/client/api");
    await api.exchangeSession();
    await api.fetchMyRequests();

    expect(store.get("comp-design-bot:session-token")).toBe("TOKEN-1");
  });
});

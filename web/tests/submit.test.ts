import { describe, expect, it } from "vitest";
import { buildRequestPayload } from "@/features/requests/submit";

/**
 * Форма собирает то, что читает Python-обработчик бота, поэтому проверяется
 * именно состав payload: лишние ключи бот игнорирует, а недостающие меняют его
 * поведение (без `description` он начинает опрос в чате заново).
 */
describe("payload заявки", () => {
  it("тема — единственное обязательное поле", () => {
    expect(buildRequestPayload({ topic: "revit" })).toEqual({ case: "revit" });
  });

  it("пустые и пробельные поля не отправляются", () => {
    const payload = buildRequestPayload({
      topic: "revit",
      description: "   ",
      project: "",
      deadline: "   \n ",
    });
    expect(payload).toEqual({ case: "revit" });
  });

  it("описание, проект, срок и источник едут под ключами бота", () => {
    const payload = buildRequestPayload({
      topic: "physics",
      description: "Нужна инсоляция двора",
      project: "1-19-2026 МР Верейская БЦ",
      deadline: "к 28 августа",
      origin: "Инструмент · IND Solar",
      originPath: "X:\\CompDesign_Projects\\Library\\tools\\ind_solar",
      source: "X:\\CompDesign_Projects\\1-19-2026",
    });
    expect(payload).toEqual({
      case: "physics",
      description: "Нужна инсоляция двора",
      project: "1-19-2026 МР Верейская БЦ",
      deadline: "к 28 августа",
      origin: "Инструмент · IND Solar",
      origin_path: "X:\\CompDesign_Projects\\Library\\tools\\ind_solar",
      source: "X:\\CompDesign_Projects\\1-19-2026",
    });
  });

  it("длинные значения обрезаются до лимитов бота", () => {
    const payload = buildRequestPayload({
      topic: "unique",
      description: "д".repeat(4000),
      project: "п".repeat(400),
      source: "и".repeat(900),
    });
    expect(payload.description).toHaveLength(3000);
    expect(payload.project).toHaveLength(200);
    expect(payload.source).toHaveLength(500);
  });

  it("текст обрезается по краям — иначе перевод строки уедет в карточку отдела", () => {
    const payload = buildRequestPayload({
      topic: "curved",
      description: "  нужен карниз \n",
    });
    expect(payload.description).toBe("нужен карниз");
  });
  it("guid картинок едут строкой через запятую — sendData принимает только текст", () => {
    const payload = buildRequestPayload({
      topic: "revit",
      description: "нужно",
      photoGuids: ["aaa", "bbb"],
    });
    expect(payload.photos).toBe("aaa,bbb");
  });

  it("пустой список картинок не добавляет поле", () => {
    const payload = buildRequestPayload({ topic: "revit", description: "нужно", photoGuids: [] });
    expect(payload.photos).toBeUndefined();
  });
});

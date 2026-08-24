import { describe, expect, it } from "vitest";
import {
  MESSAGE_LIMIT,
  isRequestAction,
  needsText,
  planAction,
} from "@/features/requests/actions";

/**
 * Действия по заявке уходят сразу в два места — в задачу Pyrus и в чат отдела.
 * Ошибка здесь тихая: сообщение доходит, но без номера заявки, без автора или
 * вовсе пустое, и отдел не понимает, о чём речь. Поэтому проверяется сам текст,
 * а не факт вызова.
 */

const request = { number: 12, topic: "Физика: инсоляция", author: "Дарий Назаров @dariy" };

describe("действия по заявке", () => {
  it("сообщение уходит с номером заявки и автором", () => {
    const plan = planAction("note", request, "  Добавьте второй вариант двора  ");
    expect(plan?.comment).toBe(
      "Сообщение от заявителя (Дарий Назаров @dariy):\nДобавьте второй вариант двора",
    );
    // В чате отдела номер обязателен: там висят десятки заявок, и без него
    // сообщение не к чему привязать.
    expect(plan?.chat.startsWith("Заявка №12 · Физика: инсоляция")).toBe(true);
    expect(plan?.action).toBeUndefined();
  });

  it("доработка без объяснения не отправляется", () => {
    expect(planAction("rework", request, "   ")).toBeNull();
    expect(planAction("note", request, "")).toBeNull();
    // А приёмка и отмена текста не требуют — там всё сказано самим действием.
    expect(planAction("accept", request, "")).not.toBeNull();
    expect(planAction("cancel", request, "")).not.toBeNull();
  });

  it("доработка переоткрывает задачу, отмена закрывает", () => {
    expect(planAction("rework", request, "Не тот двор")?.action).toBe("reopened");
    expect(planAction("cancel", request, "")?.action).toBe("finished");
    // Приёмка ничего не меняет: задача закрылась ещё переходом в «Готово».
    expect(planAction("accept", request, "")?.action).toBeUndefined();
  });

  it("длинное сообщение обрезается, а не отвергается", () => {
    const plan = planAction("note", request, "я".repeat(MESSAGE_LIMIT + 500));
    expect(plan?.comment).toContain("я".repeat(MESSAGE_LIMIT));
    expect(plan?.comment).not.toContain("я".repeat(MESSAGE_LIMIT + 1));
  });

  it("заявка без номера не ломает текст", () => {
    // Номер пишет бот при создании; у заявки, созданной в Pyrus руками, его нет.
    const plan = planAction("accept", { number: null, topic: null, author: "Кто-то" }, "");
    expect(plan?.chat).toContain("Заявка №—");
  });

  it("чужое действие из тела запроса отбрасывается", () => {
    expect(isRequestAction("note")).toBe(true);
    expect(isRequestAction("delete")).toBe(false);
    expect(isRequestAction(undefined)).toBe(false);
    expect(needsText("rework")).toBe(true);
    expect(needsText("accept")).toBe(false);
  });
});

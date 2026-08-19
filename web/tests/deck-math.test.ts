import { describe, expect, it } from "vitest";
import {
  SWIPE_THRESHOLD_PX,
  counterLabel,
  dragTransform,
  flyOutTransform,
  isDragged,
  nextIndex,
  prevIndex,
  secondCardIndex,
  shouldSwapSecondCard,
  stackLayer,
  swipeOutcome,
} from "@/app/_lib/deck-math";

const TOTAL = 8;

describe("обход колоды", () => {
  it("идёт вперёд и заворачивается с последней на первую", () => {
    expect(nextIndex(0, TOTAL)).toBe(1);
    expect(nextIndex(TOTAL - 1, TOTAL)).toBe(0);
  });

  it("идёт назад и заворачивается с первой на последнюю", () => {
    expect(prevIndex(1, TOTAL)).toBe(0);
    expect(prevIndex(0, TOTAL)).toBe(TOTAL - 1);
  });
});

describe("второй слой стопки", () => {
  it("показывает следующий кейс, когда идём вперёд", () => {
    expect(secondCardIndex(3, TOTAL, true)).toBe(4);
  });

  it("показывает предыдущий кейс, когда тянут назад", () => {
    expect(secondCardIndex(3, TOTAL, false)).toBe(2);
  });

  it("заворачивается в обе стороны", () => {
    expect(secondCardIndex(TOTAL - 1, TOTAL, true)).toBe(0);
    expect(secondCardIndex(0, TOTAL, false)).toBe(TOTAL - 1);
  });

  it("подменяет слой только после заметного сдвига", () => {
    expect(shouldSwapSecondCard(10)).toBe(false);
    expect(shouldSwapSecondCard(11)).toBe(true);
    expect(shouldSwapSecondCard(-11)).toBe(true);
  });
});

// Строки ниже сверялись с прод-версией попиксельно: если они изменятся,
// стопка визуально разъедется. Тест держит их как контракт.
describe("раскладка стопки", () => {
  it("верхняя карточка без сдвига и масштаба", () => {
    expect(stackLayer(0)).toEqual({
      transform: "translateY(0px) scale(1)",
      zIndex: "10",
      opacity: "1",
    });
  });

  it("второй и третий слой уходят вниз и уменьшаются", () => {
    expect(stackLayer(1).transform).toBe("translateY(12px) scale(0.955)");
    expect(stackLayer(2).transform).toBe("translateY(24px) scale(0.91)");
    expect(stackLayer(1).zIndex).toBe("9");
    expect(stackLayer(2).zIndex).toBe("8");
  });

  it("всё глубже третьего слоя прозрачно", () => {
    expect(stackLayer(2).opacity).toBe("1");
    expect(stackLayer(3).opacity).toBe("0");
  });
});

describe("тап против драга", () => {
  it("мелкое дрожание пальца остаётся тапом", () => {
    expect(isDragged(8, 0)).toBe(false);
    expect(isDragged(0, 8)).toBe(false);
  });

  it("движение по любой оси делает жест драгом", () => {
    expect(isDragged(9, 0)).toBe(true);
    expect(isDragged(0, -9)).toBe(true);
  });
});

describe("итог свайпа", () => {
  it("ровно на пороге ещё возвращает карточку", () => {
    expect(swipeOutcome(SWIPE_THRESHOLD_PX)).toBe("snap");
    expect(swipeOutcome(-SWIPE_THRESHOLD_PX)).toBe("snap");
  });

  it("влево — вперёд по колоде, вправо — назад", () => {
    expect(swipeOutcome(-(SWIPE_THRESHOLD_PX + 1))).toBe("next");
    expect(swipeOutcome(SWIPE_THRESHOLD_PX + 1)).toBe("prev");
  });
});

describe("трансформы жестов", () => {
  it("карточка под пальцем следует по X и приглушённо по Y", () => {
    expect(dragTransform(100, 40)).toBe(
      "translate(100px, 10px) rotate(5deg)",
    );
  });

  it("уход за экран совпадает с направлением жеста", () => {
    expect(flyOutTransform(-1)).toBe("translateX(-130%) rotate(-14deg)");
    expect(flyOutTransform(1)).toBe("translateX(130%) rotate(14deg)");
  });
});

describe("счётчик карточек", () => {
  it("нумерует с единицы и дополняет нулём", () => {
    expect(counterLabel(0, 8)).toBe("01 / 08");
    expect(counterLabel(7, 8)).toBe("08 / 08");
  });

  it("не ломается на двузначном количестве", () => {
    expect(counterLabel(9, 12)).toBe("10 / 12");
  });
});

/**
 * Чистая логика свайп-колоды: индексы, пороги жестов, трансформы слоёв.
 *
 * Вынесено из компонента не ради «слоёв», а чтобы решения, которые легко
 * сломать незаметно (порядок обхода кейсов, порог свайпа, отличие тапа от
 * драга), проверялись тестами без DOM и анимаций. Строки трансформов должны
 * совпадать с прежними символ в символ — на них завязано визуальное
 * сравнение с прод-версией.
 */

export type Case = {
  key: string;
  title: string;
  hint: string;
  /** Уже с префиксом «⏱ » — как показывается на карточке. */
  eta: string;
  frontImg: string;
  backImg: string | null;
};

/** Сколько карточек держим в стопке: верхняя + две за ней. */
export const STACK_SIZE = 3;

/** Порог, после которого отпускание карточки считается свайпом, а не возвратом. */
export const SWIPE_THRESHOLD_PX = 90;

/** Люфт, в пределах которого движение пальца ещё считается тапом. */
export const TAP_SLOP_PX = 8;

/** Сдвиг, после которого начинаем подменять второй слой стопки. */
export const SECOND_CARD_SWAP_PX = 10;

export function nextIndex(current: number, total: number): number {
  return (current + 1) % total;
}

export function prevIndex(current: number, total: number): number {
  return (current - 1 + total) % total;
}

/**
 * Какой кейс должен лежать во втором слое стопки.
 *
 * Обычно — следующий (готовимся к свайпу вперёд). Но если палец тянет вправо,
 * значит идём назад, и под верхней карточкой должен оказаться предыдущий кейс,
 * иначе в момент отпускания палец видит один кейс, а после анимации внезапно
 * другой.
 */
export function secondCardIndex(
  current: number,
  total: number,
  showNext: boolean,
): number {
  return showNext ? nextIndex(current, total) : prevIndex(current, total);
}

/** Вид слоя стопки по его глубине: 0 — верхняя карточка. */
export function stackLayer(depth: number): {
  transform: string;
  zIndex: string;
  opacity: string;
} {
  return {
    transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.045})`,
    zIndex: String(10 - depth),
    // Всё, что глубже третьего слоя, не показываем — стопка визуально из трёх.
    opacity: depth > 2 ? "0" : "1",
  };
}

/** Считается ли жест движением (а не тапом) — по любой из осей. */
export function isDragged(dx: number, dy: number): boolean {
  return Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX;
}

/**
 * Насколько вертикальное движение должно превосходить горизонтальное, чтобы
 * считаться прокруткой страницы, а не свайпом карточки.
 */
const SCROLL_BIAS = 1.4;

/**
 * Уводит ли жест в прокрутку страницы.
 *
 * Карточка занимает почти всю ширину экрана, и под ней лежит список готового
 * по теме. Пока любое движение по карточке считалось её свайпом, до списка
 * было не долистать: палец попадал в карточку, она чуть съезжала и
 * возвращалась, а страница стояла. Явно вертикальный жест отдаём скроллу.
 */
export function isScrollGesture(dx: number, dy: number): boolean {
  return Math.abs(dy) > TAP_SLOP_PX && Math.abs(dy) > Math.abs(dx) * SCROLL_BIAS;
}

export function shouldSwapSecondCard(dx: number): boolean {
  return Math.abs(dx) > SECOND_CARD_SWAP_PX;
}

/**
 * Чем закончится отпускание карточки.
 *
 * Влево — вперёд по колоде, вправо — назад; не дотянули до порога — возврат.
 */
export function swipeOutcome(dx: number): "next" | "prev" | "snap" {
  if (Math.abs(dx) <= SWIPE_THRESHOLD_PX) return "snap";
  return dx < 0 ? "next" : "prev";
}

/** Трансформ карточки под пальцем. */
export function dragTransform(dx: number, dy: number): string {
  return `translate(${dx}px, ${dy * 0.25}px) rotate(${dx * 0.05}deg)`;
}

/**
 * Трансформ ухода карточки за экран.
 *
 * `flyDir` — направление ухода по экрану (-1 влево, +1 вправо), оно не всегда
 * совпадает с направлением обхода колоды: стрелки и клавиатура двигают
 * колоду, не имея жеста.
 */
export function flyOutTransform(flyDir: -1 | 1): string {
  return `translateX(${flyDir * 130}%) rotate(${flyDir * 14}deg)`;
}

/** Подпись счётчика карточек: «01 / 08». */
export function counterLabel(index: number, total: number): string {
  return `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
}

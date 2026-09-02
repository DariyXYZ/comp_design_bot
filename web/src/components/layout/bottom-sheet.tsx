"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SheetSnap } from "@/features/requests/draft-store";

/**
 * Нижняя шторка с тремя положениями — как лист заказа в Яндекс.Такси.
 *
 * Зачем вообще шторка, а не экран: главный экран приложения (колода) и форма
 * заявки нужны одновременно. Человек листает карточки и тут же пишет задачу,
 * останавливаясь на подходящей теме. Отдельный маршрут формы это запрещал:
 * чтобы посмотреть соседний кейс, надо было уйти с формы.
 *
 * Три положения, а не два:
 *
 * - `peek` — видна только шапка (основа заявки) и кнопка. Колода открыта
 *   целиком, ею удобно листать.
 * - `half` — плюс поле описания и решения по теме. Положение по умолчанию:
 *   человек должен видеть, что заявку можно начать писать прямо здесь.
 * - `full` — вся форма. Верхняя полоска колоды остаётся видна, чтобы шторка
 *   читалась шторкой, а не экраном.
 *
 * Высота считается замером, а не долями экрана: `peek` — это ровно шапка плюс
 * подвал, `full` — ровно столько, сколько занимает содержимое, но не выше
 * экрана. Фрейм Mini App бывает какой угодно высоты, и фиксированные проценты
 * в нём либо режут кнопку, либо оставляют пустую полосу.
 *
 * Высота живёт в инлайн-стиле, а не в состоянии React: во время жеста она
 * меняется на каждый кадр, и ререндер оболочки приложения на каждое движение
 * пальца — это подёргивания колоды под шторкой.
 */

/** Сколько экрана остаётся видно над развёрнутой шторкой. */
const TOP_GAP_PX = 56;

/**
 * Доля экрана в среднем положении. Уточняется границами `peek` и `full`.
 *
 * Ровно столько, сколько нужно на основу заявки и начало описания: человек
 * должен видеть, что заявку можно писать прямо здесь, не разворачивая шторку.
 * Больше отдавать нельзя — остаток экрана занимает колода, и от него же
 * считается размер карточки.
 */
const HALF_RATIO = 0.42;

/** Скорость, после которой отпускание считается броском, а не установкой. */
const FLING_PX_PER_MS = 0.5;

/** Люфт, в пределах которого движение по ручке ещё считается тапом. */
const TAP_SLOP_PX = 6;

const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

export function BottomSheet({
  snap,
  onSnapChange,
  label,
  head,
  foot,
  children,
}: Readonly<{
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  label: string;
  /** Не скроллится и служит ручкой: шапка — основная зона перетаскивания. */
  head: React.ReactNode;
  /** Не скроллится: главное действие всегда на экране, как «Заказать». */
  foot: React.ReactNode;
  children: React.ReactNode;
}>) {
  const sheetRef = useRef<HTMLElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);

  // Колбэк в ref: жесты поднимаются один раз, и замыкание на первый проп
  // сделало бы отпускание шторки немым.
  const notifyRef = useRef(onSnapChange);
  useEffect(() => {
    notifyRef.current = onSnapChange;
  }, [onSnapChange]);

  const snapRef = useRef(snap);

  /**
   * Высоты трёх положений в пикселях.
   *
   * `peek` — шапка с ручкой и подвал: тело при такой высоте получает ноль
   * (`flex:1; min-height:0`) и просто исчезает. `full` — по содержимому, но не
   * выше экрана без верхней полоски.
   */
  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    const grab = grabRef.current;
    const head = headRef.current;
    const body = bodyRef.current;
    const foot = footRef.current;
    if (!sheet || !grab || !head || !body || !foot) return null;

    // Нижний отступ под жест-полоску входит в высоту элемента (border-box),
    // поэтому его нужно прибавить, иначе `peek` срежет кнопку.
    const padBottom = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
    const peek = grab.offsetHeight + head.offsetHeight + foot.offsetHeight + padBottom;
    const limit = Math.max(peek, window.innerHeight - TOP_GAP_PX);
    const full = Math.min(limit, peek + body.scrollHeight);
    const half = Math.min(full, Math.max(peek, Math.round(window.innerHeight * HALF_RATIO)));
    return { peek, half, full };
  }, []);

  const applySnap = useCallback(
    (next: SheetSnap) => {
      const sheet = sheetRef.current;
      const sizes = measure();
      if (!sheet || !sizes) return;
      // Сравнение до записи — не микрооптимизация: высоту пересчитывает
      // ResizeObserver, повешенный на части самой шторки, и запись той же
      // величины запускала бы наблюдателя по кругу.
      const height = `${sizes[next]}px`;
      if (sheet.style.height !== height) sheet.style.height = height;
      // Колода считает своё место от СРЕДНЕГО положения шторки, а не от
      // нижнего. Карточка — предмет, а не карта: наполовину закрытая, она
      // теряет ровно то, ради чего её показывают (название, подсказку, срок).
      // Поэтому она умещается целиком в положении, в котором шторка стоит по
      // умолчанию, а в нижнем под ней просто остаётся воздух.
      document.documentElement.style.setProperty("--sheet-rest", `${sizes.half}px`);
    },
    [measure],
  );

  useEffect(() => {
    snapRef.current = snap;
    applySnap(snap);
  }, [snap, applySnap]);

  // Пересчёт при смене размеров: поворот экрана, разворачивание фрейма Mini
  // App, появление и исчезновение содержимого шторки (чипы решений, картинки,
  // баннер ошибки). ResizeObserver — потому что содержимое меняет высоту само,
  // без события окна.
  useEffect(() => {
    const relayout = () => applySnap(snapRef.current);
    const observer = new ResizeObserver(relayout);
    for (const el of [headRef.current, footRef.current, bodyRef.current]) {
      if (el) observer.observe(el);
    }
    window.addEventListener("resize", relayout);
    const tg = window.Telegram?.WebApp;
    tg?.onEvent?.("viewportChanged", relayout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", relayout);
      tg?.offEvent?.("viewportChanged", relayout);
      document.documentElement.style.removeProperty("--sheet-rest");
    };
  }, [applySnap]);

  // Перетаскивание. Слушатели на window, а не на ручке: палец легко уводит за
  // её границы, а жест обязан продолжаться.
  useEffect(() => {
    const sheet = sheetRef.current;
    const grab = grabRef.current;
    const head = headRef.current;
    if (!sheet || !grab || !head) return;

    let active = false;
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let moved = false;
    let fromGrab = false;
    let sizes: { peek: number; half: number; full: number } | null = null;

    function onDown(e: PointerEvent) {
      if (!(e.target instanceof Node)) return;
      // Тянуть можно за ручку и за шапку. Кнопки внутри шапки (переключение
      // основы) должны нажиматься, поэтому жест на них не начинаем — до
      // порога `TAP_SLOP_PX` он всё равно ничего не двигает, а после порога
      // клик уже не сработает.
      if (!grab!.contains(e.target) && !head!.contains(e.target)) return;
      sizes = measure();
      if (!sizes) return;
      active = true;
      moved = false;
      fromGrab = grab!.contains(e.target);
      startY = e.clientY;
      lastY = e.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      startH = sheet!.getBoundingClientRect().height;
      sheet!.classList.add("dragging");
    }

    function onMove(e: PointerEvent) {
      if (!active || !sizes) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > TAP_SLOP_PX) moved = true;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      // Вниз — палец идёт вниз, высота уменьшается. Границы жёсткие: тянуть
      // шторку выше содержимого или ниже кнопки некуда.
      const height = Math.min(sizes.full, Math.max(sizes.peek, startH - dy));
      sheet!.style.height = `${height}px`;
    }

    function onUp() {
      if (!active || !sizes) return;
      active = false;
      sheet!.classList.remove("dragging");
      const height = sheet!.getBoundingClientRect().height;
      const current = snapRef.current;

      if (!moved) {
        // Тап по ручке — следующее положение по кругу: единственный способ
        // узнать про шторку, не трогая её пальцем в первый раз. Тап по шапке
        // так не работает: там живут кнопки выбора основы, и подмена их
        // нажатия движением шторки была бы сюрпризом.
        if (fromGrab) {
          const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
          notifyRef.current(next);
          applySnap(next);
        } else {
          applySnap(current);
        }
        return;
      }

      let target: SheetSnap;
      if (Math.abs(velocity) > FLING_PX_PER_MS) {
        // Бросок: шаг в сторону броска, независимо от того, докуда дотянули.
        const step = velocity > 0 ? -1 : 1;
        const index = Math.min(
          ORDER.length - 1,
          Math.max(0, ORDER.indexOf(current) + step),
        );
        target = ORDER[index];
      } else {
        target = ORDER.reduce((best, candidate) =>
          Math.abs(sizes![candidate] - height) < Math.abs(sizes![best] - height)
            ? candidate
            : best,
        );
      }
      notifyRef.current(target);
      applySnap(target);
    }

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [measure, applySnap]);

  return (
    <section className="sheet" aria-label={label} ref={sheetRef}>
      {/* Ручка — не декор: по ней шторку тянут и по ней же понимают, что её
          можно тянуть. Поэтому это кнопка, доступная и с клавиатуры. */}
      <div
        className="sheet-grab"
        ref={grabRef}
        role="button"
        tabIndex={0}
        aria-label="Развернуть или свернуть заявку"
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const index = Math.min(ORDER.length - 1, ORDER.indexOf(snap) + 1);
            onSnapChange(ORDER[index]);
          }
          if (event.key === "ArrowDown" || event.key === "Escape") {
            event.preventDefault();
            const index = Math.max(0, ORDER.indexOf(snap) - 1);
            onSnapChange(ORDER[index]);
          }
        }}
      />
      <div className="sheet-head" ref={headRef}>
        {head}
      </div>
      <div className="sheet-body" ref={bodyRef}>
        {children}
      </div>
      <div className="sheet-foot" ref={footRef}>
        {foot}
      </div>
    </section>
  );
}

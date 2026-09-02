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
 * Три положения:
 *
 * - `peek` — видна только основа заявки и кнопка. Колода открыта целиком.
 * - `half` — плюс поле описания. Положение по умолчанию: человек должен
 *   видеть, что заявку можно начать писать прямо здесь.
 * - `full` — вся форма. Верхняя полоска экрана остаётся видна, чтобы шторка
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
 * Среднее положение: доля экрана, но не меньше, чем нужно на первое поле.
 *
 * Доля намеренно маленькая. Всё, что шторка забирает сверх необходимого, —
 * это отнятая ширина карточки: колода считает своё место от этой же величины.
 */
const HALF_RATIO = 0.3;

/** Сколько тела шторки обязано быть видно в среднем положении: первое поле. */
const HALF_MIN_BODY_PX = 96;

/** Выше половины экрана среднее положение не поднимается ни при каком фрейме. */
const HALF_MAX_RATIO = 0.5;

/** Скорость, после которой отпускание считается броском, а не установкой. */
const FLING_PX_PER_MS = 0.5;

/** Люфт, в пределах которого движение по ручке ещё считается тапом. */
const TAP_SLOP_PX = 6;

/** Насколько надо потянуть тело вниз, чтобы жест перешёл к шторке. */
const BODY_TAKEOVER_PX = 8;

const ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

type Sizes = { peek: number; half: number; full: number };

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
   * Идёт ли жест прямо сейчас.
   *
   * Без этого флага шторку невозможно было тянуть, и это стоит помнить:
   * высоту пересчитывает ResizeObserver, повешенный на части самой шторки, а
   * тело меняет высоту на каждый кадр жеста. Наблюдатель тут же возвращал
   * шторку в её положение — палец тянул, шторка отпрыгивала обратно, и
   * двигалась она только тапами.
   */
  const draggingRef = useRef(false);

  /**
   * Высоты трёх положений в пикселях.
   *
   * `peek` — шапка с ручкой и подвал: тело при такой высоте получает ноль
   * (`flex:1; min-height:0`) и просто исчезает. `full` — по содержимому, но не
   * выше экрана без верхней полоски. `half` — столько, чтобы над кнопкой
   * помещалось первое поле формы.
   */
  const measure = useCallback((): Sizes | null => {
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
    const half = Math.min(
      full,
      Math.round(window.innerHeight * HALF_MAX_RATIO),
      Math.max(peek + HALF_MIN_BODY_PX, Math.round(window.innerHeight * HALF_RATIO)),
    );
    return { peek, half: Math.max(peek, half), full };
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
      // Экран под шторкой считает своё место от её СРЕДНЕГО положения, а не от
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
  // App, появление и исчезновение содержимого шторки (вторая строка основы,
  // картинки, баннер ошибки). ResizeObserver — потому что содержимое меняет
  // высоту само, без события окна.
  useEffect(() => {
    const relayout = () => {
      if (draggingRef.current) return;
      applySnap(snapRef.current);
    };
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
    const body = bodyRef.current;
    if (!sheet || !grab || !head || !body) return;

    let armed = false;
    /** Жест начат с тела: перехватываем, только если прокручивать уже нечего. */
    let fromBody = false;
    let fromGrab = false;
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let moved = false;
    let sizes: Sizes | null = null;

    function begin(clientY: number) {
      sizes = measure();
      if (!sizes) return false;
      draggingRef.current = true;
      startH = sheet!.getBoundingClientRect().height;
      startY = clientY;
      sheet!.classList.add("dragging");
      return true;
    }

    function onDown(e: PointerEvent) {
      if (!(e.target instanceof Node)) return;
      const inTop = grab!.contains(e.target) || head!.contains(e.target);
      const inBody = body!.contains(e.target);
      if (!inTop && !inBody) return;
      armed = true;
      fromBody = !inTop && inBody;
      fromGrab = grab!.contains(e.target);
      moved = false;
      velocity = 0;
      startY = e.clientY;
      lastY = e.clientY;
      lastT = e.timeStamp;
      // Жест с верхней части начинается сразу — тянуть там больше нечего.
      // Из тела он ещё не жест: сначала это может быть прокрутка формы.
      if (!fromBody && !begin(e.clientY)) armed = false;
    }

    function onMove(e: PointerEvent) {
      if (!armed) return;

      if (fromBody && !draggingRef.current) {
        // Смахнуть шторку вниз можно и с формы, но только когда прокручивать
        // уже нечего: иначе жест отбирал бы у формы её собственный скролл.
        if (e.clientY - startY <= BODY_TAKEOVER_PX || body!.scrollTop > 0) return;
        if (!begin(e.clientY)) {
          armed = false;
          return;
        }
      }
      if (!draggingRef.current || !sizes) return;

      if (Math.abs(e.clientY - startY) > TAP_SLOP_PX) moved = true;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = e.timeStamp;
      // Палец идёт вниз — высота уменьшается. Границы жёсткие: тянуть шторку
      // выше содержимого или ниже кнопки некуда.
      const height = Math.min(
        sizes.full,
        Math.max(sizes.peek, startH - (e.clientY - startY)),
      );
      sheet!.style.height = `${height}px`;
    }

    function onUp() {
      if (!armed) return;
      armed = false;
      if (!draggingRef.current || !sizes) return;
      draggingRef.current = false;
      sheet!.classList.remove("dragging");
      const height = sheet!.getBoundingClientRect().height;
      const current = snapRef.current;

      if (!moved) {
        // Тап по ручке — переключатель, а не карусель: развёрнутая шторка
        // уходит вниз, свёрнутая поднимается к полю описания. Три положения
        // по кругу от одного тапа читались случайными.
        if (fromGrab) {
          const next: SheetSnap = current === "peek" ? "half" : "peek";
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
        // Медленное движение — магнит к ближайшему положению.
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
      draggingRef.current = false;
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

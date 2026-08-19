"use client";

import { useEffect, useRef } from "react";
import { fetchCases } from "../_lib/cases";
import {
  STACK_SIZE,
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
  type Case,
} from "../_lib/deck-math";

/** Длительности анимаций, подобранные эмпирически — не «круглые» числа наугад. */
const SWIPE_OUT_MS = 460;
const ANTICIPATE_MS = 160;
const FLY_UP_MS = 620;

/**
 * Свайп-колода кейсов.
 *
 * Внутренности деки намеренно императивные (прямые
 * `insertBefore`/`replaceChild`/`style.transform` на узлах), а не состояние
 * React. Это не обход правил, а требование механики — три причины, каждая из
 * которых уже была источником бага:
 *
 * 1. Карточки живут внутри CSS-переходов, которые ререндер обрывает.
 * 2. Второй слой стопки подменяется посреди драга (`setSecondCard`).
 * 3. Гашение соседних карточек обязано быть инлайн-стилем, потому что
 *    `applyStack()` сам держит там `opacity` инлайном, а инлайн не
 *    перебивается классом из стилевого листа.
 *
 * React владеет статичной оболочкой (стрелки, CTA, подпись), решения о
 * жестах и индексах вынесены в `_lib/deck-math.ts` под тесты. Будущие табы
 * (каталог, лента, профиль) — списки и формы, там будет обычный
 * декларативный React.
 */
export function CaseDeck() {
  const deckWrapRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const arrowLeftRef = useRef<HTMLButtonElement>(null);
  const arrowRightRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const deckWrap = deckWrapRef.current;
    const deck = deckRef.current;
    const dots = dotsRef.current;
    const arrowLeft = arrowLeftRef.current;
    const arrowRight = arrowRightRef.current;
    const cta = ctaRef.current;
    if (!deckWrap || !deck || !dots || !arrowLeft || !arrowRight || !cta) return;

    let cases: Case[] = [];
    let current = 0;
    let animating = false; // guard: быстрый второй свайп не трогает ту же карточку
    let picked = false; // sendData закрывает Mini App; дубль до закрытия глушим
    let secondShowsNext = true;

    // Таймеры анимаций трогают DOM после задержки — на размонтировании
    // (строгий режим в dev, HMR) их нужно снять, иначе колбэк придёт к уже
    // вычищенной деке.
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function later(fn: () => void, ms: number) {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    }

    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.(); // вертикальный драг карточки не должен закрывать Mini App

    /**
     * Уточняет ширину карточки замером вместо приблизительной формулы в CSS.
     *
     * Свободную высоту даёт сам флексбокс: `.deck-wrap` растянут на остаток
     * экрана после заголовка, CTA и подписи, так что считать высоту обвязки
     * руками не нужно. Ширину берём по пропорции 5:7 от того, что осталось под
     * карточку, но не больше предела по ширине экрана — карточка уменьшается
     * целиком и никогда не сплющивается.
     *
     * Обратной связи по вёрстке нет: `.deck-wrap` растянут флексом, и карточка,
     * которая в него влезает, его размер не меняет.
     */
    function sizeCard() {
      const wrapStyle = getComputedStyle(deckWrap!);
      const insets =
        (parseFloat(wrapStyle.paddingTop) || 0) +
        (parseFloat(wrapStyle.paddingBottom) || 0);
      const availableH = deckWrap!.clientHeight - insets - dots!.offsetHeight;
      const maxByWidth = Math.min(window.innerWidth * 0.88, 400);
      const width = Math.min(maxByWidth, (availableH * 5) / 7);
      document.documentElement.style.setProperty(
        "--card-w",
        `${Math.max(0, Math.round(width))}px`,
      );
    }

    function pick(key: string) {
      if (picked) return;
      if (!tg) {
        // Открыто не из кнопки бота (прямая ссылка/браузер) — sendData недоступен.
        alert(
          "Выбор работает только внутри Telegram — откройте бота @comp_design_bot и нажмите «Возможности отдела».",
        );
        return;
      }
      picked = true;
      try {
        tg.sendData(JSON.stringify({ case: key }));
      } catch {
        // Нестандартное окружение — sendData кинул исключение вместо тихого
        // закрытия. Без сброса picked/animating вся колода виснет намертво.
        picked = false;
        animating = false;
      }
    }

    function makeCard(idx: number): HTMLDivElement {
      const c = cases[idx % cases.length];
      const el = document.createElement("div");
      el.className = "swipe-card";
      el.dataset.idx = String(idx % cases.length);
      el.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-front">
            <div class="media">
              <img src="${c.frontImg}" alt="" draggable="false" loading="lazy">
            </div>
            <div class="body">
              <h3>${c.title}</h3>
              <p>${c.hint}</p>
              <span class="eta">${c.eta}</span>
              <span class="num">${counterLabel(idx % cases.length, cases.length)}</span>
            </div>
          </div>
          <div class="card-face card-back">
            ${
              c.backImg
                ? `<img class="back-photo" src="${c.backImg}" alt="" draggable="false" loading="lazy">`
                : `<div class="back-placeholder">Примеры такой геометрии</div>`
            }
          </div>
        </div>`;
      return el;
    }

    /** Раскладывает стопку: последний ребёнок — верхняя карточка. */
    function applyStack() {
      const cards = [...deck!.children] as HTMLElement[];
      cards.forEach((el, i) => {
        const depth = cards.length - 1 - i;
        const layer = stackLayer(depth);
        el.style.zIndex = layer.zIndex;
        if (!el.classList.contains("dragging")) {
          el.style.transform = layer.transform;
          el.style.opacity = layer.opacity;
        }
      });
      [...dots!.children].forEach((d, i) => {
        d.className = i === current ? "on" : "";
      });
    }

    function fill() {
      while (deck!.children.length < STACK_SIZE) {
        const idx = (current + deck!.children.length) % cases.length;
        deck!.insertBefore(makeCard(idx), deck!.firstChild);
      }
      secondShowsNext = true; // свежая стопка всегда смотрит вперёд
      applyStack();
    }

    function setSecondCard(showNext: boolean) {
      if (secondShowsNext === showNext) return;
      secondShowsNext = showNext;
      const cards = [...deck!.children] as HTMLElement[];
      const second = cards[cards.length - 2];
      if (!second) return;
      const fresh = makeCard(secondCardIndex(current, cases.length, showNext));
      fresh.style.cssText = second.style.cssText; // та же позиция/масштаб слоя стопки
      deck!.replaceChild(fresh, second);
    }

    function flyAway(flyDir: -1 | 1, advance: () => void, rebuild: boolean) {
      const top = deck!.lastElementChild as HTMLElement | null;
      if (!top || animating) return;
      animating = true;
      top.classList.add("gone");
      top.style.transform = flyOutTransform(flyDir);
      advance();
      later(() => {
        top.remove();
        // Назад по колоде — стопку пересобираем целиком: за верхней карточкой
        // лежат «будущие» кейсы, а после шага назад там должны оказаться другие.
        if (rebuild) deck!.replaceChildren();
        fill();
        animating = false;
      }, SWIPE_OUT_MS);
    }

    function goNext(flyDir: -1 | 1 = -1) {
      flyAway(flyDir, () => (current = nextIndex(current, cases.length)), false);
    }

    function goPrev(flyDir: -1 | 1 = 1) {
      flyAway(flyDir, () => (current = prevIndex(current, cases.length)), true);
    }

    // Драг: одни слушатели на window + активная карточка в переменной, иначе на
    // каждую созданную карточку копился бы новый window-хендлер.
    // Pointer Events, а не отдельно touch+mouse: на тач-устройствах браузер
    // синтезирует mousedown/mouseup ПОСЛЕ touchend — с раздельными хендлерами
    // один тап дважды переключал .flipped (флип→сразу обратно).
    const drag = {
      el: null as HTMLElement | null,
      startX: 0,
      startY: 0,
      dx: 0,
      moved: false,
    };

    function onDown(e: PointerEvent) {
      const top = deck!.lastElementChild as HTMLElement | null;
      if (!top || animating) return;
      if (!(e.target instanceof Node) || !top.contains(e.target)) return;
      drag.el = top;
      drag.moved = false;
      drag.dx = 0;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      top.classList.add("dragging");
    }

    function onMove(e: PointerEvent) {
      if (!drag.el) return;
      drag.dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (isDragged(drag.dx, dy)) drag.moved = true;
      if (shouldSwapSecondCard(drag.dx)) setSecondCard(drag.dx < 0);
      drag.el.style.transform = dragTransform(drag.dx, dy);
    }

    function onUp(e: PointerEvent) {
      if (!drag.el) return;
      const el = drag.el;
      drag.el = null;
      el.classList.remove("dragging");

      if (e.type === "pointercancel") {
        // Прервано системой — не считаем ни свайпом, ни тапом.
        setSecondCard(true);
        applyStack();
        return;
      }

      const outcome = swipeOutcome(drag.dx);
      if (outcome === "next") {
        goNext();
        return;
      }
      if (outcome === "prev") {
        goPrev();
        return;
      }

      // Не дотянули до порога — стопка возвращается к дефолтному виду, иначе
      // после пары неудачных свайпов вправо там навсегда останется предыдущий
      // кейс.
      setSecondCard(true);
      applyStack();
      // Тап без движения = переворот карточки (детали на обратной стороне).
      // Выбор задачи — только через большую кнопку/Enter (см. chooseCurrent).
      if (!drag.moved) el.classList.toggle("flipped");
    }

    function chooseCurrent() {
      const top = deck!.lastElementChild as HTMLElement | null;
      if (!top || animating) return;
      const key = cases[Number(top.dataset.idx)].key;
      if (!tg) {
        pick(key); // вне Telegram — просто подскажем, картой не жертвуем
        return;
      }
      animating = true;

      // Карточки под верхней гаснут вместе со стартом полёта — иначе последний
      // кадр перед закрытием миниаппа это соседняя карточка стопки, а не пусто.
      // Инлайн, а не класс: applyStack() сам держит opacity инлайном.
      ([...deck!.children] as HTMLElement[])
        .filter((el) => el !== top)
        .forEach((el) => {
          el.style.transition = "none";
          el.style.opacity = "0";
        });

      // Замах вниз, потом полёт вверх: чат открывается быстро следом, но полёт
      // успевает прочитаться.
      top.classList.add("anticipate");
      top.style.transform = "translateY(14px) scale(.99)";
      later(() => {
        top.classList.remove("anticipate");
        top.classList.add("flying");
        top.style.transform = "translateY(-150%) scale(.94)";
      }, ANTICIPATE_MS);

      later(() => pick(key), ANTICIPATE_MS + FLY_UP_MS);
    }

    const onNextClick = () => goNext();
    const onPrevClick = () => goPrev();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Enter") chooseCurrent();
    }

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", sizeCard);
    // Фрейм Mini App меняет высоту при разворачивании — своё событие клиента
    // приходит и там, где window.resize не срабатывает.
    tg?.onEvent?.("viewportChanged", sizeCard);
    arrowRight.addEventListener("click", onNextClick);
    arrowLeft.addEventListener("click", onPrevClick);
    cta.addEventListener("click", chooseCurrent);

    sizeCard();
    // Пока не подхватился Golos, заголовок другой высоты — после подмены шрифта
    // свободного места под карточку становится иначе, пересчитываем.
    document.fonts?.ready.then(() => sizeCard());

    const abort = new AbortController();
    let disposed = false;

    void (async () => {
      let rows: Case[];
      try {
        rows = await fetchCases({ signal: abort.signal });
      } catch {
        if (disposed) return;
        deck.innerHTML = `<div class="deck-error">Не получилось загрузить карточки — проверьте интернет и откройте ещё раз.</div>`;
        return;
      }
      if (disposed) return;

      cases = rows;
      cases.forEach((_, i) => {
        const d = document.createElement("i");
        if (i === 0) d.className = "on";
        dots.appendChild(d);
      });
      sizeCard(); // точки появились — свободной высоты под карточку стало меньше
      fill();
    })();

    return () => {
      disposed = true;
      abort.abort();
      timers.forEach(clearTimeout);
      timers.clear();
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", sizeCard);
      tg?.offEvent?.("viewportChanged", sizeCard);
      arrowRight.removeEventListener("click", onNextClick);
      arrowLeft.removeEventListener("click", onPrevClick);
      cta.removeEventListener("click", chooseCurrent);
      // Возвращаем расчёт ширины к CSS-формуле, иначе замер от размонтированной
      // разметки останется висеть на :root.
      document.documentElement.style.removeProperty("--card-w");
      deck.replaceChildren();
      dots.replaceChildren();
    };
  }, []);

  return (
    <>
      <div className="deck-wrap" ref={deckWrapRef}>
        <button ref={arrowLeftRef} className="arrow left" aria-label="Предыдущая">
          <ArrowIcon />
        </button>
        <div className="deck-col">
          <div className="deck" ref={deckRef} />
          <div className="dots-row dots" ref={dotsRef} />
        </div>
        <button ref={arrowRightRef} className="arrow right" aria-label="Следующая">
          <ArrowIcon />
        </button>
      </div>

      <button className="cta" ref={ctaRef}>
        <span className="cta-label">Выбрать задачу и составить ТЗ</span>
        <span className="cta-arrow" aria-hidden="true">
          <ArrowIcon />
        </span>
      </button>

      <p className="swipe-hint">
        Свайпайте карточки, нажимайте на них — увидите примеры
      </p>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h13.5M13 6l6.5 6-6.5 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

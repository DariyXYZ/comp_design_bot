"use client";

import { useEffect, useRef } from "react";
import { fetchCases } from "@/lib/cases";

/**
 * Свайп-колода кейсов.
 *
 * Внутренности деки специально остались императивными (прямые
 * insertBefore/replaceChild/style.transform на узлах), а не состоянием React.
 * Здесь это не лень, а требование механики: карточки живут внутри CSS-переходов,
 * которые нельзя прерывать ререндером, второй слой стопки подменяется прямо
 * посреди драга, а гашение соседних карточек обязано идти инлайн-стилем (см.
 * chooseCurrent). Тайминги анимаций подобраны эмпирически — переписывание
 * этого на state ломает ровно те баги, которые уже были найдены и закрыты.
 * React отвечает за статичную оболочку: заголовок, стрелки, CTA, подпись.
 */
export default function Deck() {
  const deckRef = useRef(null);
  const dotsRef = useRef(null);
  const arrowLeftRef = useRef(null);
  const arrowRightRef = useRef(null);
  const ctaRef = useRef(null);

  useEffect(() => {
    const deck = deckRef.current;
    const dots = dotsRef.current;
    const arrowLeft = arrowLeftRef.current;
    const arrowRight = arrowRightRef.current;
    const cta = ctaRef.current;

    let CASES = [];
    let current = 0;

    // Таймеры анимаций трогают DOM после задержки — на размонтировании
    // (dev-строгий режим, HMR) их нужно снять, иначе колбэк придёт к уже
    // вычищенной деке.
    const timers = new Set();
    function later(fn, ms) {
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

    let picked = false; // sendData закрывает Mini App; дубль до закрытия глушим
    function pick(key) {
      if (picked) return;
      if (tg?.sendData) {
        picked = true;
        try {
          tg.sendData(JSON.stringify({ case: key }));
        } catch {
          // Нестандартное окружение — sendData кинул исключение вместо тихого
          // закрытия. Без сброса picked/animating вся колода виснет намертво.
          picked = false;
          animating = false;
        }
      } else {
        // Открыто не из кнопки бота (прямая ссылка/браузер) — sendData недоступен.
        alert(
          "Выбор работает только внутри Telegram — откройте бота @comp_design_bot и нажмите «Возможности отдела»."
        );
      }
    }

    function makeCard(idx) {
      const c = CASES[idx % CASES.length];
      const el = document.createElement("div");
      el.className = "swipe-card";
      el.dataset.idx = idx % CASES.length;
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
              <span class="num">${String((idx % CASES.length) + 1).padStart(2, "0")} / ${String(CASES.length).padStart(2, "0")}</span>
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

    // стопка из трёх: текущая + две за ней
    function layout() {
      const cards = [...deck.children];
      cards.forEach((el, i) => {
        const depth = cards.length - 1 - i; // 0 = верхняя (последний ребёнок)
        el.style.zIndex = 10 - depth;
        if (!el.classList.contains("dragging")) {
          el.style.transform = `translateY(${depth * 12}px) scale(${1 - depth * 0.045})`;
          el.style.opacity = depth > 2 ? 0 : 1;
        }
      });
      [...dots.children].forEach((d, i) => (d.className = i === current ? "on" : ""));
    }

    function fill() {
      while (deck.children.length < 3) {
        const nextIdx = (current + deck.children.length) % CASES.length;
        deck.insertBefore(makeCard(nextIdx), deck.firstChild);
      }
      secondShowsNext = true; // свежая стопка всегда смотрит вперёд, см. setSecondCard
      layout();
    }

    // Слой сразу под верхней карточкой обычно показывает СЛЕДУЮЩий кейс (для
    // свайпа влево). Но если тянуть вправо (значит идём НАЗАД), под пальцем
    // должен появляться уже ПРЕДЫДУЩИЙ кейс — иначе в момент отпускания палец
    // видит один кейс, а после анимации внезапно другой (выглядит как глюк).
    // Подменяем содержимое второго слоя прямо во время движения, до отпускания.
    let secondShowsNext = true;

    function setSecondCard(showNext) {
      if (secondShowsNext === showNext) return;
      secondShowsNext = showNext;
      const cards = [...deck.children];
      const second = cards[cards.length - 2];
      if (!second) return;
      const idx = showNext
        ? (current + 1) % CASES.length
        : (current - 1 + CASES.length) % CASES.length;
      const fresh = makeCard(idx);
      fresh.style.cssText = second.style.cssText; // та же позиция/масштаб слоя стопки
      deck.replaceChild(fresh, second);
    }

    let animating = false; // guard: быстрый второй свайп не трогает ту же карточку

    // Свайп/смахивание влево -> вперёд по колоде, вправо -> назад. flyDir всегда
    // совпадает с направлением ухода карточки с экрана (визуально), а не с тем,
    // вперёд мы идём или назад, — те же -1/+1, что и раньше, просто теперь оба
    // направления реально ведут в разные стороны по CASES, а не всегда вперёд.
    function goNext(flyDir = -1) {
      const top = deck.lastElementChild;
      if (!top || animating) return;
      animating = true;
      top.classList.add("gone");
      top.style.transform = `translateX(${flyDir * 130}%) rotate(${flyDir * 14}deg)`;
      current = (current + 1) % CASES.length;
      later(() => {
        top.remove();
        fill();
        animating = false;
      }, 460);
    }

    function goPrev(flyDir = 1) {
      const top = deck.lastElementChild;
      if (!top || animating) return;
      animating = true;
      top.classList.add("gone");
      top.style.transform = `translateX(${flyDir * 130}%) rotate(${flyDir * 14}deg)`;
      current = (current - 1 + CASES.length) % CASES.length;
      later(() => {
        top.remove();
        deck.replaceChildren();
        fill();
        animating = false;
      }, 460);
    }

    // Драг: одни слушатели на window + активная карточка в переменной,
    // иначе на каждую созданную карточку копился бы новый window-хендлер.
    // Pointer Events, а не отдельно touch+mouse: на тач-устройствах браузер
    // синтезирует mousedown/mouseup ПОСЛЕ touchend — с раздельными хендлерами
    // один тап дважды переключал .flipped (флип→сразу обратно), отсюда
    // нестабильность «иногда работает». Один событийный поток эту гонку убирает.
    const drag = { el: null, startX: 0, startY: 0, dx: 0, moved: false };

    function onDown(e) {
      const top = deck.lastElementChild;
      if (!top || animating) return;
      if (!top.contains(e.target)) return;
      drag.el = top;
      drag.moved = false;
      drag.dx = 0;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      top.classList.add("dragging");
    }

    function onMove(e) {
      if (!drag.el) return;
      drag.dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(drag.dx) > 8 || Math.abs(dy) > 8) drag.moved = true;
      if (Math.abs(drag.dx) > 10) setSecondCard(drag.dx < 0);
      drag.el.style.transform = `translate(${drag.dx}px, ${dy * 0.25}px) rotate(${drag.dx * 0.05}deg)`;
    }

    function onUp(e) {
      if (!drag.el) return;
      const el = drag.el;
      drag.el = null;
      el.classList.remove("dragging");
      if (e && e.type === "pointercancel") {
        setSecondCard(true);
        layout();
        return;
      } // прервано системой — не считаем тапом
      if (Math.abs(drag.dx) > 90) {
        if (drag.dx < 0) goNext();
        else goPrev();
      } else {
        // Не дотянули до порога — стопка возвращается к дефолтному виду
        // (второй слой снова смотрит вперёд), иначе после пары неудачных
        // свайпов вправо там навсегда останется предыдущий кейс.
        setSecondCard(true);
        layout();
        // Тап без движения = переворот карточки (детали на обратной стороне).
        // Выбор задачи — только через большую кнопку/Enter (см. chooseCurrent).
        if (!drag.moved) el.classList.toggle("flipped");
      }
    }

    function chooseCurrent() {
      const top = deck.lastElementChild;
      if (!top || animating) return;
      const key = CASES[top.dataset.idx].key;
      if (!tg?.sendData) {
        pick(key);
        return;
      } // вне Telegram — просто подскажем, картой не жертвуем
      animating = true;

      // Карточки под верхней гаснут вместе со стартом полёта — иначе последний
      // кадр перед закрытием миниаппа это соседняя карточка стопки, а не пусто.
      // Инлайн, а не класс: layout() сам держит opacity инлайном на каждой
      // карточке — класс с opacity в стилевом листе такой инлайн не перебьёт.
      [...deck.children]
        .filter((el) => el !== top)
        .forEach((el) => {
          el.style.transition = "none";
          el.style.opacity = "0";
        });

      // Замах: короткий сброс вниз, потом полёт вверх — чуть неспешнее, чем
      // раньше (было 120+460=580мс, стало 160+620=780мс), чат всё ещё открывается
      // быстро следом, но полёт читается, а не дёргается.
      top.classList.add("anticipate");
      top.style.transform = "translateY(14px) scale(.99)";
      later(() => {
        top.classList.remove("anticipate");
        top.classList.add("flying");
        top.style.transform = "translateY(-150%) scale(.94)";
      }, 160);

      later(() => pick(key), 160 + 620);
    }

    const onNextClick = () => goNext();
    const onPrevClick = () => goPrev();
    function onKeyDown(e) {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Enter") chooseCurrent();
    }

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    arrowRight.addEventListener("click", onNextClick);
    arrowLeft.addEventListener("click", onPrevClick);
    cta.addEventListener("click", chooseCurrent);

    const abort = new AbortController();
    let disposed = false;

    (async function init() {
      let rows;
      try {
        rows = await fetchCases({ signal: abort.signal });
      } catch {
        if (disposed) return;
        deck.innerHTML = `<div class="deck-error">Не получилось загрузить карточки — проверьте интернет и откройте ещё раз.</div>`;
        return;
      }
      if (disposed) return;

      CASES = rows;

      CASES.forEach((_, i) => {
        const d = document.createElement("i");
        if (i === 0) d.className = "on";
        dots.appendChild(d);
      });

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
      arrowRight.removeEventListener("click", onNextClick);
      arrowLeft.removeEventListener("click", onPrevClick);
      cta.removeEventListener("click", chooseCurrent);
      deck.replaceChildren();
      dots.replaceChildren();
    };
  }, []);

  return (
    <>
      <div className="deck-wrap">
        <button ref={arrowLeftRef} className="arrow left" aria-label="Предыдущая">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h13.5M13 6l6.5 6-6.5 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="deck-col">
          <div className="deck" ref={deckRef} />
          <div className="dots-row dots" ref={dotsRef} />
        </div>
        <button ref={arrowRightRef} className="arrow right" aria-label="Следующая">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h13.5M13 6l6.5 6-6.5 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <button className="cta" ref={ctaRef}>
        <span className="cta-label">Выбрать задачу и составить ТЗ</span>
        <span className="cta-arrow" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h13.5M13 6l6.5 6-6.5 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <p className="swipe-hint">Свайпайте карточки, нажимайте на них — увидите примеры</p>
    </>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Картинка заявки крупно — проверить, что приложил то.
 *
 * Открывается из своего слота и закрывается в него же: снимок вырастает из
 * миниатюры и возвращается обратно (FLIP по transform — единственное, что
 * анимируется без перекладки страницы). Закрытие — тап в любое место:
 * отдельной кнопки нет, потому что весь экран и есть кнопка.
 *
 * Поверх шторки (z-index выше её), в портале — иначе `overflow:hidden` слота
 * и стек шторки обрезали бы снимок.
 */
type Props = {
  src: string;
  alt: string;
  /** Откуда расти: прямоугольник миниатюры на момент тапа. */
  from: DOMRect;
  onClose: () => void;
};

const MARGIN = 16;
const DURATION_MS = 320;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Размер и положение снимка по центру экрана с полями. */
function fit(naturalW: number, naturalH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = vw - MARGIN * 2;
  const maxH = vh - MARGIN * 2;
  // Без ограничения сверху: снимки из заявки уже сжаты до 1600px, а мелкую
  // картинку смотреть в её натуральные 100px бессмысленно.
  const scale = Math.min(maxW / naturalW, maxH / naturalH) || 1;
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { w, h, x: (vw - w) / 2, y: (vh - h) / 2 };
}

/** Трансформ, который кладёт снимок из его конечного места в миниатюру. */
function towards(from: DOMRect, to: { w: number; h: number; x: number; y: number }) {
  const scale = Math.max(from.width / to.w, from.height / to.h);
  const dx = from.left + from.width / 2 - (to.x + to.w / 2);
  const dy = from.top + from.height / 2 - (to.y + to.h / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

export function PhotoLightbox({ src, alt, from, onClose }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<"enter" | "open" | "leave">("enter");
  const [box, setBox] = useState<{ w: number; h: number; x: number; y: number } | null>(null);

  // Размер снимка известен только после загрузки — до него ничего не рисуем,
  // иначе расчёт «откуда расти» шёл бы от нулевого прямоугольника.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ready = () => setBox(fit(img.naturalWidth || 1, img.naturalHeight || 1));
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });
    return () => img.removeEventListener("load", ready);
  }, [src]);

  // Кадр после появления — переход к раскрытому состоянию.
  useEffect(() => {
    if (!box || phase !== "enter") return;
    // Два кадра: первый — браузер кладёт снимок в миниатюру, второй — переход.
    // Без reduced-motion тот же путь, просто переход нулевой (см. transition).
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
    return () => cancelAnimationFrame(id);
  }, [box, phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    if (phase === "leave") return;
    if (reducedMotion()) {
      onClose();
      return;
    }
    setPhase("leave");
    window.setTimeout(onClose, DURATION_MS);
  }

  const collapsed = box ? towards(from, box) : undefined;
  const transform = phase === "open" ? "none" : collapsed;
  const transition = reducedMotion()
    ? undefined
    : `transform ${DURATION_MS}ms var(--ease), opacity ${DURATION_MS}ms var(--ease)`;

  return createPortal(
    <div
      className={`lightbox ${phase === "open" ? "lightbox-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Картинка крупно, тап — закрыть"
      onPointerDown={(e) => {
        // Жесты шторки и колоды слушают window — сюда они дойти не должны.
        e.stopPropagation();
      }}
      onClick={close}
      style={{ transition: reducedMotion() ? undefined : `background-color ${DURATION_MS}ms var(--ease)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="lightbox-img"
        style={
          box
            ? {
                width: box.w,
                height: box.h,
                left: box.x,
                top: box.y,
                transform,
                transition,
                visibility: "visible",
              }
            : { visibility: "hidden" }
        }
      />
    </div>,
    document.body,
  );
}

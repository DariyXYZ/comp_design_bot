"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Картинка заявки крупно — проверить, что приложил то.
 *
 * Открывается из своего слота и закрывается в него же. Анимируется не масштаб
 * всей картинки, а её рамка: снимок с `object-fit: cover` плавно меняет
 * прямоугольник от квадрата миниатюры до своих полных пропорций, и вместе с
 * рамкой уходит скругление углов. Так миниатюра «раскрывается» в полный кадр,
 * а не увеличивается и потом резко обрезается. Обратно — тот же путь задом
 * наперёд. Закрытие — тап в любое место: весь экран и есть кнопка.
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

type Box = { w: number; h: number; x: number; y: number };

const MARGIN = 16;
const DURATION_MS = 360;
/** Скругление миниатюры — то же, что у слота (`--r2`). */
const THUMB_RADIUS = 12;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Размер и положение снимка по центру экрана с полями. */
function fit(naturalW: number, naturalH: number): Box {
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

function thumbBox(from: DOMRect): Box {
  return { w: from.width, h: from.height, x: from.left, y: from.top };
}

export function PhotoLightbox({ src, alt, from, onClose }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<"enter" | "open" | "leave">("enter");
  const [full, setFull] = useState<Box | null>(null);

  // Пропорции снимка известны только после загрузки — до неё рамку считать
  // не от чего, и снимок стоит в миниатюре невидимым.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ready = () => setFull(fit(img.naturalWidth || 1, img.naturalHeight || 1));
    if (img.complete && img.naturalWidth) ready();
    else img.addEventListener("load", ready, { once: true });
    return () => img.removeEventListener("load", ready);
  }, [src]);

  // Два кадра после появления: первый — браузер кладёт снимок в миниатюру,
  // второй — переход к полному кадру. С reduced-motion переход нулевой.
  useEffect(() => {
    if (!full || phase !== "enter") return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
    return () => cancelAnimationFrame(id);
  }, [full, phase]);

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

  const box = phase === "open" && full ? full : thumbBox(from);
  const radius = phase === "open" ? 0 : THUMB_RADIUS;
  const transition = reducedMotion()
    ? undefined
    : [
        `left ${DURATION_MS}ms var(--ease)`,
        `top ${DURATION_MS}ms var(--ease)`,
        `width ${DURATION_MS}ms var(--ease)`,
        `height ${DURATION_MS}ms var(--ease)`,
        `border-radius ${DURATION_MS}ms var(--ease)`,
      ].join(", ");

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
      style={{
        transition: reducedMotion() ? undefined : `background-color ${DURATION_MS}ms var(--ease)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="lightbox-img"
        style={{
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderRadius: radius,
          transition,
          visibility: full ? "visible" : "hidden",
        }}
      />
    </div>,
    document.body,
  );
}

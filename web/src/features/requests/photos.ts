"use client";

import { exchangeSession, sessionToken } from "@/lib/client/api";

/**
 * Картинки заявки: сжатие в браузере и загрузка в Pyrus через свой роут.
 *
 * Сжатие обязательно, а не «на всякий случай»: снимок с телефона это 3–8 МБ,
 * а serverless-функция принимает запрос целиком в память (на Hobby-плане
 * потолок около 4.5 МБ). Плюс заявке не нужен исходник — отделу важно увидеть
 * место и пометки, а не разглядывать пиксели.
 */

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type UploadedPhoto = {
  /** Локальный ключ для списка в интерфейсе. */
  id: string;
  /** Ссылка на превью (object URL). */
  preview: string;
  /** guid в Pyrus — им файл прикладывается к задаче. */
  guid: string;
  name: string;
};

/** Уменьшает картинку по длинной стороне и переводит в JPEG. */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? file),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

export type UploadResult =
  | { ok: true; guid: string }
  | { ok: false; reason: "no-session" | "too-large" | "failed" };

/**
 * Загружает одну картинку. Требует сессии: роут не примет файл без токена,
 * иначе хранилище Pyrus мог бы наполнять кто угодно.
 *
 * Токен берём общей функцией, а не читаем хранилище напрямую: в вебвью оно
 * бывает недоступно, и тогда картинки не грузились бы при живом входе. На 401
 * пробуем обменяться заново — токен мог истечь, пока экран был открыт.
 */
export async function uploadPhoto(file: File): Promise<UploadResult> {
  let token = await sessionToken();
  if (!token) return { ok: false, reason: "no-session" };

  const blob = await compressImage(file);

  for (const attempt of [1, 2]) {
    const form = new FormData();
    form.append("file", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
    try {
      const response = await fetch(`${API_BASE}/api/uploads/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (response.status === 401 && attempt === 1) {
        token = (await exchangeSession())?.token ?? null;
        if (!token) return { ok: false, reason: "no-session" };
        continue;
      }
      if (response.status === 413) return { ok: false, reason: "too-large" };
      if (!response.ok) return { ok: false, reason: "failed" };
      const body = (await response.json()) as { guid?: string };
      return body.guid ? { ok: true, guid: body.guid } : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }
  return { ok: false, reason: "failed" };
}

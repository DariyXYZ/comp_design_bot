"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionBar } from "@/components/layout/action-bar";
import { Screen } from "@/components/layout/screen";
import { itemHref, routes } from "@/config/navigation";
import { MATERIAL_TYPE_LABEL, materialById } from "@/features/materials";
import { uploadPhoto, type UploadedPhoto } from "@/features/requests/photos";
import { submitRequest } from "@/features/requests/submit";
import { setLeaveGuard } from "@/lib/client/leave-guard";

/**
 * Новая заявка.
 *
 * Форма никогда не открывается пустой: сверху стоит чип происхождения — тема
 * или конкретный материал, из которого пришли. Он не удаляется, потому что
 * именно он отвечает отделу на вопрос «что человек хочет получить» до чтения
 * описания. У заявки из материала источник приложится сам.
 *
 * Текст заявки уходит боту через `sendData` — Telegram закрывает приложение
 * сразу после отправки и показывает превью в чате.
 *
 * Картинки идут другим путём: `sendData` файлы не передаёт вовсе, поэтому они
 * сразу загружаются в Pyrus через свой роут, а с заявкой едут только их guid.
 * Загрузка начинается в момент выбора файла, а не при отправке: так человек
 * видит, что картинка принята, и не ждёт всё разом на последнем шаге.
 */
export function RequestForm() {
  const params = useSearchParams();
  const material = materialById(params.get("item") ?? "");
  const topicKey = material?.topic ?? params.get("topic") ?? "";
  const topicTitle = params.get("t");

  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [deadline, setDeadline] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Есть ли что терять. Через ref, потому что спрашивают снаружи (кнопка
  // «назад» клиента и ссылка в шапке) в момент, когда рендер уже прошёл.
  const filled =
    project.trim().length > 0 ||
    description.trim().length > 0 ||
    source.trim().length > 0 ||
    deadline.length > 0 ||
    photos.length > 0;
  const filledRef = useRef(filled);

  useEffect(() => {
    setLeaveGuard(() => filledRef.current);
    return () => setLeaveGuard(null);
  }, []);

  useEffect(() => {
    filledRef.current = filled;
    // Закрытие приложения — отдельный путь мимо «назад»: свайп вниз или
    // крест в шапке. Telegram умеет спросить сам, но только если его
    // попросить, и просить надо ровно пока есть что терять.
    const tg = window.Telegram?.WebApp;
    if (filled) tg?.enableClosingConfirmation?.();
    else tg?.disableClosingConfirmation?.();
  }, [filled]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setProblem(null);
    for (const file of Array.from(files)) {
      setUploading((count) => count + 1);
      const preview = URL.createObjectURL(file);
      const result = await uploadPhoto(file);
      setUploading((count) => count - 1);
      if (!result.ok) {
        URL.revokeObjectURL(preview);
        setProblem(
          result.reason === "no-session"
            ? "Картинки загружаются только при запуске из Telegram — откройте приложение кнопкой в чате бота."
            : result.reason === "too-large"
              ? "Картинка слишком большая даже после сжатия — попробуйте другую."
              : "Картинку не удалось загрузить. Попробуйте ещё раз.",
        );
        continue;
      }
      setPhotos((current) => [
        ...current,
        { id: `${file.name}-${current.length}`, preview, guid: result.guid, name: file.name },
      ]);
    }
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) URL.revokeObjectURL(photo.preview);
      // Файл остаётся в хранилище Pyrus, но к задаче не привязывается: удалять
      // его отдельным запросом незачем — он никуда не попадёт.
      return current.filter((item) => item.id !== id);
    });
  }

  const origin = material
    ? {
        label: `${MATERIAL_TYPE_LABEL[material.type]} · ${material.title}`,
        backHref: itemHref(material.id),
        path: material.files,
      }
    : {
        label: `Тема · ${topicTitle ?? "не выбрана"}`,
        backHref: routes.topics,
        path: undefined,
      };

  // Описание — единственное обязательное поле: без него отделу не с чем
  // работать, а бот в этом случае начнёт задавать вопросы заново в чате.
  const ready = description.trim().length > 0 && topicKey.length > 0;

  function send() {
    const result = submitRequest({
      topic: topicKey,
      origin: origin.label,
      originPath: origin.path,
      project,
      description,
      source,
      deadline,
      photoGuids: photos.map((photo) => photo.guid),
    });
    if (result === "sent") {
      // Приложение закрывается само — спрашивать «выйти?» уже не о чем.
      setLeaveGuard(null);
      window.Telegram?.WebApp?.disableClosingConfirmation?.();
      return;
    }
    setProblem(
      result === "outside-telegram"
        ? "Отправка работает только внутри Telegram: откройте бота @comp_design_bot и нажмите «Возможности отдела»."
        : result === "too-long"
          ? "Текст слишком длинный для отправки — сократите описание, детали можно дописать в чате."
          : "Не получилось отправить. Попробуйте ещё раз или напишите в чат боту.",
    );
  }

  return (
    <>
      <Screen title="Новая заявка" backHref={origin.backHref}>
        <div className="origin">
          <span className="origin-key">Заявка по</span>
          <span className="origin-value">{origin.label}</span>
        </div>
        {origin.path ? (
          <p className="section-note">
            Ссылка на источник приложится к заявке автоматически
          </p>
        ) : null}

        <label className="field">
          <span>Номер и название проекта</span>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="1-19-2026 МР Верейская БЦ"
            enterKeyHint="next"
          />
        </label>

        <label className="field">
          <span>
            Описание задачи и ожидаемый результат <em>обязательно</em>
          </span>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Что нужно сделать и что хотите получить на выходе"
          />
        </label>

        <label className="field">
          <span>Ссылка или путь к исходным файлам</span>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="X:\CompDesign_Projects\..."
          />
        </label>

        <label className="field">
          <span>
            Срок <em>необязательно</em>
          </span>
          {/* Календарь, а не свободный текст: в Pyrus это поле-дата, по нему
              работают фильтры реестра и правила SLA. Фразы вроде «зависит от
              заказчика» пишутся в описании. */}
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>

        <div className="field">
          <span>
            Изображения и референсы <em>необязательно</em>
          </span>
          <div className="slots">
            {photos.map((photo) => (
              <div key={photo.id} className="slot slot-filled">
                {/* Обычный img, а не next/image: это локальный object URL
                    выбранного файла, оптимизатору его нечего оптимизировать. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt="" />
                <button
                  type="button"
                  className="slot-remove"
                  onClick={() => removePhoto(photo.id)}
                  aria-label={`Убрать ${photo.name}`}
                >
                  ×
                </button>
              </div>
            ))}
            {uploading > 0 ? <div className="slot slot-busy">…</div> : null}
            {photos.length + uploading < 6 ? (
              <button
                type="button"
                className="slot"
                onClick={() => fileInput.current?.click()}
                aria-label="Добавить картинку"
              >
                +
              </button>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <p className="section-note" style={{ margin: 0 }}>
            Отметьте на снимке проблемное место — так отдел поймёт задачу
            быстрее. Картинки уходят сразу в задачу, до отправки заявки.
          </p>
        </div>

        {topicKey ? null : (
          <div className="banner">
            <strong>Тема не определена</strong>
            <span>
              Ссылка устарела — вернитесь к темам и создайте заявку из карточки
              или из готового решения.
            </span>
          </div>
        )}

        {problem ? (
          <div className="banner">
            <strong>Не отправлено</strong>
            <span>{problem}</span>
          </div>
        ) : null}
      </Screen>

      <ActionBar
        label="Отправить заявку"
        note={
          uploading > 0
            ? "Дождитесь загрузки картинок"
            : ready
              ? undefined
              : "Заполните описание задачи"
        }
        onClick={send}
        disabled={!ready || uploading > 0}
      />
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/layout/bottom-sheet";
import { RESTART_HINT } from "@/config/copy";
import { MATERIAL_TYPE_FORMAL, materialById } from "@/features/materials";
import { topicColor } from "@/features/topics/color";
import { useRequestDraft } from "../draft-store";
import { uploadPhoto } from "../photos";
import { submitRequest } from "../submit";

/**
 * Заявка как шторка над колодой.
 *
 * Строение повторяет лист заказа в такси, и не ради сходства: там решена та же
 * задача — оформить заказ, не теряя из виду то, из чего выбираешь.
 *
 * - Шапка отвечает на вопрос «о чём заявка». Строка карточки есть всегда и
 *   идёт следом за колодой. Строка решения появляется только когда решение
 *   открыто: на экране материала. Пока человек листает колоду, писать «решение
 *   не выбрано» незачем — это половина высоты свёрнутой шторки, потраченная на
 *   отсутствие факта.
 * - Тело — поля заявки, и больше ничего. Выбор предмета заявки живёт снаружи,
 *   на «карте»: карточку выбирают свайпом колоды, решение — открыв его из
 *   списка под колодой. Дублировать этот выбор внутри шторки значило бы
 *   завести два способа делать одно и то же.
 * - Подвал — кнопка заказа. Она на месте всегда, при любой высоте шторки.
 *
 * Максимум шести картинок — не каприз: `sendData` ограничен четырьмя
 * килобайтами, а с заявкой едут guid'ы, и каждый занимает место в этом лимите.
 */

const MAX_PHOTOS = 6;

export function RequestSheet() {
  const {
    fields,
    setField,
    photos,
    addPhoto,
    removePhoto,
    topic,
    materialId,
    snap,
    setSnap,
    filled,
    reset,
  } = useRequestDraft();

  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Закрытие приложения — путь мимо всякой навигации: свайп вниз или крест в
  // шапке клиента. Черновик переживает переходы между экранами, но не
  // закрытие, поэтому спрашивает об этом сам Telegram — и только пока есть что
  // терять.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (filled) tg?.enableClosingConfirmation?.();
    else tg?.disableClosingConfirmation?.();
  }, [filled]);

  const material = materialId ? materialById(materialId) : undefined;
  // Тема берётся у закреплённого решения: колода и решение всегда с одной темы
  // (см. `setTopic` в сторе), но у решения она достоверна и без загруженной
  // колоды.
  const topicKey = material?.topic ?? topic?.key ?? "";

  const origin = material
    ? {
        label: `${MATERIAL_TYPE_FORMAL[material.type]} · ${material.title}`,
        path: material.files as string | undefined,
      }
    : { label: `Тема · ${topic?.title ?? "не выбрана"}`, path: undefined };

  // Описание — единственное обязательное поле: без него отделу не с чем
  // работать, а бот в этом случае начнёт задавать вопросы заново в чате.
  const ready = fields.description.trim().length > 0 && topicKey.length > 0;

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
            ? `Картинки загружаются только при запуске из Telegram — откройте приложение кнопкой в чате бота. ${RESTART_HINT}`
            : result.reason === "too-large"
              ? "Картинка слишком большая даже после сжатия — попробуйте другую."
              : `Картинку не удалось загрузить. Попробуйте ещё раз. ${RESTART_HINT}`,
        );
        continue;
      }
      addPhoto({
        id: `${file.name}-${Date.now()}`,
        preview,
        guid: result.guid,
        name: file.name,
      });
    }
  }

  function send() {
    const result = submitRequest({
      topic: topicKey,
      origin: origin.label,
      originPath: origin.path,
      project: fields.project,
      description: fields.description,
      source: fields.source,
      deadline: fields.deadline,
      photoGuids: photos.map((photo) => photo.guid),
    });
    if (result === "sent") {
      // Приложение закрывается само — но если человек вернётся, он не должен
      // увидеть уже отправленный черновик.
      window.Telegram?.WebApp?.disableClosingConfirmation?.();
      reset();
      setSnap("peek");
      return;
    }
    setProblem(
      result === "outside-telegram"
        ? `Отправка работает только внутри Telegram: откройте бота @comp_design_bot и нажмите «Решения и заявки». ${RESTART_HINT}`
        : result === "wrong-launch"
          ? // Telegram разрешает отправку боту только из приложения, открытого
            // кнопкой клавиатуры. Кнопка в сообщении (/app) для этого не
            // годится — говорим об этом прямо, а не «попробуйте ещё раз».
            `Приложение открыто кнопкой из сообщения — из неё Telegram не разрешает отправку. Откройте его кнопкой «✦ Решения и заявки» внизу чата и отправьте заявку оттуда. ${RESTART_HINT}`
          : result === "too-long"
            ? "Текст слишком длинный для отправки — сократите описание, детали можно дописать в чате."
            : `Не получилось отправить. Попробуйте ещё раз. ${RESTART_HINT}`,
    );
  }

  // В нижнем положении формы не видно, и заблокированная кнопка объясняла бы
  // отказ текстом, которого там негде прочитать. Поэтому свёрнутая шторка
  // предлагает не отправку, а раскрытие.
  const collapsedEntry = snap === "peek" && !ready;

  return (
    <BottomSheet
      snap={snap}
      onSnapChange={setSnap}
      label="Заявка в отдел"
      head={
        <div className="sheet-origin">
          {/* Тему называем только когда знаем её название. По прямой ссылке на
              решение колода ещё не загружалась, и звать листать её на экране,
              где её нет, — враньё; решение в такой ситуации и так полностью
              определяет заявку. */}
          {topic?.title || !material ? (
          <button
            type="button"
            className="origin-row"
            onClick={() => setSnap(snap === "peek" ? "half" : snap)}
          >
            <span
              className="origin-mark origin-mark-on"
              style={{ background: topicColor(topicKey) }}
              aria-hidden="true"
            />
            <span className="origin-body">
              <span className="origin-label">Карточка</span>
              <span className="origin-title">
                {topic?.title || "листайте колоду"}
              </span>
            </span>
            {material ? null : <span className="origin-aside">свайп</span>}
          </button>
          ) : null}

          {/* Появляется вместе с открытым решением и исчезает вместе с ним.
              Не кнопка: решение выбирают снаружи — открывают его из списка под
              колодой, — а здесь оно только названо. */}
          {material ? (
            <div className="origin-row">
              <span className="origin-mark" aria-hidden="true" />
              <span className="origin-body">
                <span className="origin-label">Решение</span>
                <span className="origin-title">{material.title}</span>
              </span>
            </div>
          ) : null}
        </div>
      }
      foot={
        <>
          {problem ? (
            <div className="banner">
              <strong>Не отправлено</strong>
              <span>{problem}</span>
            </div>
          ) : null}
          <p className="action-note">
            {uploading > 0
              ? "Дождитесь загрузки картинок"
              : ready
                ? origin.path
                  ? "Ссылка на решение уйдёт в заявку"
                  : "Заявка уйдёт по карточке из шапки"
                : "Опишите задачу — это единственное обязательное поле"}
          </p>
          {collapsedEntry ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSnap("full")}
            >
              Заполнить заявку
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={send}
              disabled={!ready || uploading > 0}
            >
              Отправить заявку
            </button>
          )}
        </>
      }
    >
      {/* Фокус в любом поле разворачивает шторку целиком: клавиатура съедает
          пол-экрана, и поле, набранное в среднем положении, оказалось бы под
          ней. */}
      <div className="sheet-form" onFocusCapture={() => setSnap("full")}>
        {/* Описание идёт первым: в среднем положении шторки видно начало тела,
            и там должно лежать то, без чего заявку не отправить. */}
        <label className="field">
          <span>
            Описание задачи и ожидаемый результат <em>обязательно</em>
          </span>
          <textarea
            rows={3}
            value={fields.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Что нужно сделать и что хотите получить на выходе"
          />
        </label>

        <label className="field">
          <span>Номер и название проекта</span>
          <input
            type="text"
            value={fields.project}
            onChange={(e) => setField("project", e.target.value)}
            placeholder="1-19-2026 МР Верейская БЦ"
            enterKeyHint="next"
          />
        </label>

        <label className="field">
          <span>Ссылка или путь к исходным файлам</span>
          <input
            type="text"
            value={fields.source}
            onChange={(e) => setField("source", e.target.value)}
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
            value={fields.deadline}
            onChange={(e) => setField("deadline", e.target.value)}
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
            {photos.length + uploading < MAX_PHOTOS ? (
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
          <p className="sheet-note">
            Отметьте на снимке проблемное место — так отдел поймёт задачу
            быстрее. Картинки уходят сразу в задачу, до отправки заявки.
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}

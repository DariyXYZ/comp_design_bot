"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ActionBar } from "@/components/layout/action-bar";
import { Screen } from "@/components/layout/screen";
import { itemHref, routes } from "@/config/navigation";
import { MATERIAL_TYPE_LABEL, materialById } from "@/features/materials";
import { submitRequest } from "@/features/requests/submit";

/**
 * Новая заявка.
 *
 * Форма никогда не открывается пустой: сверху стоит чип происхождения — тема
 * или конкретный материал, из которого пришли. Он не удаляется, потому что
 * именно он отвечает отделу на вопрос «что человек хочет получить» до чтения
 * описания. У заявки из материала источник приложится сам.
 *
 * Отправка идёт боту через `sendData`: приложение статическое, сервера у него
 * нет, и это единственный канал. Telegram закрывает Mini App сразу после
 * отправки, поэтому дальше разговор продолжается в чате — там бот просит
 * картинки (файлы через `sendData` не проходят) и показывает превью заявки.
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
    });
    if (result === "sent") return; // Telegram закрывает приложение сам
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

        <p className="section-note">
          Картинки и референсы попросит бот в чате сразу после отправки —
          файлы из Mini App не передаются.
        </p>

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
        note={ready ? undefined : "Заполните описание задачи"}
        onClick={send}
        disabled={!ready}
      />
    </>
  );
}

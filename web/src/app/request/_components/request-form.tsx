"use client";

import { useSearchParams } from "next/navigation";
import { ActionBar } from "@/components/action-bar";
import { Screen } from "@/components/screen";
import { MATERIAL_TYPE_LABEL, materialById } from "@/lib/mock/materials";
import { itemHref, routes } from "@/lib/routes";

/**
 * Новая заявка.
 *
 * Форма никогда не открывается пустой: сверху стоит чип происхождения — тема
 * или конкретный материал, из которого пришли. Он не удаляется, потому что
 * именно он отвечает отделу на вопрос «что человек хочет получить» до чтения
 * описания. У заявки из материала источник приложится сам, и спрашивать его
 * текстом не нужно.
 *
 * Поля собраны по MVP-модели. Отправки в черновике нет — кнопка ведёт в «Мои
 * заявки», чтобы поток можно было пройти целиком. В проде отсюда уйдёт
 * `sendData` в бота (или запрос на сервер, когда он появится).
 */
export function RequestForm() {
  const params = useSearchParams();
  const material = materialById(params.get("item") ?? "");
  const topicTitle = params.get("t");

  const origin = material
    ? {
        kind: `${MATERIAL_TYPE_LABEL[material.type]} · ${material.title}`,
        backHref: itemHref(material.id),
        source: material.files,
      }
    : {
        kind: `Тема · ${topicTitle ?? "не выбрана"}`,
        backHref: routes.topics,
        source: null,
      };

  return (
    <>
      <Screen title="Новая заявка" backHref={origin.backHref}>
        <div className="origin">
          <span className="origin-key">Заявка по</span>
          <span className="origin-value">{origin.kind}</span>
        </div>
        {origin.source ? (
          <p className="section-note">
            Ссылка на источник приложится к заявке автоматически
          </p>
        ) : null}

        <label className="field">
          <span>Номер и название проекта</span>
          <input type="text" placeholder="1-19-2026 МР Верейская БЦ" />
        </label>

        <label className="field">
          <span>Описание задачи и ожидаемый результат</span>
          <textarea rows={5} placeholder="Что нужно сделать и что хотите получить на выходе" />
        </label>

        <div className="field">
          <span>Изображения и референсы</span>
          <div className="slots">
            <button type="button" className="slot">
              +
            </button>
            <button type="button" className="slot">
              +
            </button>
            <button type="button" className="slot">
              +
            </button>
          </div>
        </div>

        <label className="field">
          <span>Ссылка или путь к исходным файлам</span>
          <input type="text" placeholder="X:\CompDesign_Projects\..." />
        </label>

        <label className="field">
          <span>
            Жёсткий срок <em>необязательно</em>
          </span>
          <input type="text" placeholder="Например, к 28 августа" />
        </label>
      </Screen>

      <ActionBar href={routes.myRequests} label="Отправить заявку" />
    </>
  );
}

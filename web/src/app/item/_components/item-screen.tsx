"use client";

import { useSearchParams } from "next/navigation";
import { ActionBar } from "@/components/action-bar";
import { PathField } from "@/components/path-field";
import { Screen } from "@/components/screen";
import { MATERIAL_TYPE_LABEL, materialById } from "@/lib/mock/materials";
import { requestHref, routes } from "@/lib/routes";

/**
 * Оформленный материал: кейс, инструмент или модуль.
 *
 * Экран сделан так, чтобы человек мог применить решение сам — демо, короткая
 * инструкция и путь к файлам. Заявка тут не главное действие, а выход на
 * случай «сам не справлюсь» или «нужна адаптация», и она уже привязана к
 * этому материалу.
 */
export function ItemScreen() {
  const id = useSearchParams().get("id") ?? "";
  const material = materialById(id);

  if (!material) {
    return (
      <Screen title="Материал не найден" backHref={routes.topics}>
        <p className="section-note">
          Ссылка устарела — вернитесь к темам и выберите заново.
        </p>
      </Screen>
    );
  }

  const typeLabel = MATERIAL_TYPE_LABEL[material.type];

  return (
    <>
      <Screen
        title={material.title}
        subtitle={`${typeLabel} · обновлён ${material.updated}`}
        backHref={routes.topics}
      >
        <div className="media-slot">
          <span>{material.media}</span>
        </div>

        <p className="lead">{material.summary}</p>

        {material.project ? (
          <div className="fact">
            <span className="fact-key">Где применялось</span>
            <span className="fact-value">{material.project}</span>
          </div>
        ) : null}

        <section className="section">
          <div className="section-head">
            <h2>Как применить</h2>
          </div>
          <ol className="steps">
            {material.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Файлы</h2>
          </div>
          <PathField path={material.files} />
        </section>
      </Screen>

      <ActionBar
        href={requestHref({ item: material.id })}
        label="Создать заявку"
        note={
          material.type === "case"
            ? "«Хочу так же» — ссылка на этот кейс уйдёт в заявку"
            : "Нужна помощь или адаптация под ваш проект"
        }
      />
    </>
  );
}

"use client";

import { useCallback, useState } from "react";
import { ActionBar } from "@/components/layout/action-bar";
import { requestHref } from "@/config/navigation";
import { MaterialRow, materialsByTopic } from "@/features/materials";
import type { Case } from "../_lib/deck-math";
import { CaseDeck } from "./case-deck";

/**
 * Стартовый экран: колода тем отдела, а под ней — что по этой теме уже
 * оформлено и лежит готовым.
 *
 * Порядок блоков не случаен. Сначала готовое, заявка — внизу и после списка:
 * цель продукта в том, чтобы человек нашёл готовое решение, а заявку писал,
 * когда готового нет. Кнопка заявки при этом всегда на одном и том
 * же месте, чтобы её не приходилось искать.
 */
export function TopicsScreen() {
  const [topic, setTopic] = useState<Case | null>(null);
  // Стабильный колбэк: дека держит его в ref и не переподписывается.
  const handleTopicChange = useCallback((next: Case) => setTopic(next), []);

  const materials = topic ? materialsByTopic(topic.key) : [];

  return (
    <>
      <div className="scroll">
        <header className="topics-head">
          <h1>Когда звать нас</h1>
          <div className="brand">Отдел вычислительного проектирования</div>
        </header>

        <CaseDeck onTopicChange={handleTopicChange} />

        <section className="section">
          <div className="section-head">
            <h2>Уже готово по теме</h2>
            {materials.length > 0 ? (
              <span className="count">{materials.length}</span>
            ) : null}
          </div>

          {/* Название темы не повторяем: оно уже на карточке над списком и в
              подписи у кнопки заявки. Три повтора на одном экране — шум. */}
          {topic ? null : (
            <p className="section-note">Листайте колоду — список меняется вместе с темой</p>
          )}

          {materials.length > 0 ? (
            <div className="rows">
              {materials.map((material) => (
                <MaterialRow key={material.id} material={material} />
              ))}
            </div>
          ) : null}

          {/* «Ничего нет» — только когда тема действительно выбрана: пока
              карточки едут, отсутствие материалов ничего не означает. */}
          {topic && materials.length === 0 ? (
            <div className="empty">
              <p>
                По этой теме готового пока нет — такие задачи отдел собирает под
                проект.
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {topic ? (
        // Кнопка называет действие, а не объект: «Создать заявку» стояло и
        // здесь, и на материале, из-за чего два разных входа выглядели одним
        // (см. CALL_TO_ACTION в item-screen). Подпись остаётся контекстом —
        // по какой именно теме уйдёт заявка.
        <ActionBar
          href={requestHref({ topic: topic.key, topicTitle: topic.title })}
          label="Создать задачу по теме карточки"
          context={{ kind: "Карточка", title: topic.title }}
        />
      ) : null}
    </>
  );
}

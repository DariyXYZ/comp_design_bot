"use client";

import { useCallback, useState } from "react";
import { ActionBar } from "@/components/action-bar";
import { MaterialRow } from "@/components/material-row";
import { materialsByTopic } from "@/lib/mock/materials";
import { requestHref } from "@/lib/routes";
import type { Case } from "../_lib/deck-math";
import { CaseDeck } from "./case-deck";

/**
 * Стартовый экран: колода тем отдела, а под ней — что по этой теме уже
 * оформлено и лежит готовым.
 *
 * Порядок блоков не случаен. Сначала готовое, заявка — внизу и после списка:
 * цель продукта в том, чтобы человек нашёл готовое решение, а заявку писал,
 * когда готового нет. Кнопка «Создать заявку» при этом всегда на одном и том
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
          ) : (
            <div className="empty">
              <p>
                По этой теме готового пока нет — такие задачи отдел собирает под
                проект.
              </p>
            </div>
          )}
        </section>
      </div>

      {topic ? (
        <ActionBar
          href={requestHref({ topic: topic.key, topicTitle: topic.title })}
          label="Создать заявку"
          note={`По теме «${topic.title}»`}
        />
      ) : null}
    </>
  );
}

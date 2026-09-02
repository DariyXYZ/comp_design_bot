"use client";

import { useCallback } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { RequestSheet } from "@/features/requests/components/request-sheet";
import { useRequestDraft } from "@/features/requests/draft-store";
import { MaterialRow, materialsByTopic } from "@/features/materials";
import type { Case } from "../_lib/deck-math";
import { CaseDeck } from "./case-deck";

/**
 * Главный экран: колода тем, готовое по теме под ней и шторка заявки поверх.
 *
 * Устройство взято у экрана заказа в такси. «Карта» — это колода и список под
 * ней: то, из чего выбирают. Шторка — сам заказ: поля заявки и кнопка
 * отправки. Раньше это были два экрана подряд, и человек, начавший заполнять
 * заявку, уже не мог сравнить её с соседним кейсом, не потеряв набранное.
 *
 * Порядок блоков под колодой прежний: сначала готовое, потом заявка. Цель
 * продукта в том, чтобы человек нашёл готовое решение, а заявку писал, когда
 * готового нет. Разница в том, что заявка теперь не «потом», а всё это время
 * лежит внизу и ждёт.
 *
 * Заголовка на экране нет намеренно: над Mini App уже стоит шапка клиента
 * Telegram с названием бота, а карточки сами говорят, что это за приложение.
 */
export function TopicsScreen() {
  const { setTopic, readInitialTopicKey, topic } = useRequestDraft();

  // Стабильный колбэк: дека держит его в ref и не переподписывается.
  const handleTopicChange = useCallback(
    (next: Case) => setTopic({ key: next.key, title: next.title }),
    [setTopic],
  );

  const materials = topic ? materialsByTopic(topic.key) : [];

  return (
    <>
      <main className="stage">
        <TopBar />
        <div className="scroll">
          <CaseDeck
            onTopicChange={handleTopicChange}
            resolveInitialKey={readInitialTopicKey}
          />

          <section className="section">
            <div className="section-head">
              <h2>Уже готово по теме</h2>
              {materials.length > 0 ? (
                <span className="count">{materials.length}</span>
              ) : null}
            </div>

            {/* Название темы не повторяем: оно уже на карточке над списком и в
                шапке шторки. Три повтора на одном экране — шум. */}
            {topic ? null : (
              <p className="section-note">
                Листайте колоду — список меняется вместе с темой
              </p>
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
                  По этой теме готового пока нет — такие задачи отдел собирает
                  под проект.
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </main>

      <RequestSheet />
    </>
  );
}

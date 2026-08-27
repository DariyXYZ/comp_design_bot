"use client";

import { useSearchParams } from "next/navigation";
import { ActionBar } from "@/components/layout/action-bar";
import { PathField } from "@/components/ui/path-field";
import { Screen } from "@/components/layout/screen";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { MATERIAL_TYPE_LABEL, materialById, type Material } from "@/features/materials";
import { topicColor } from "@/features/topics/color";
import { requestHref, routes } from "@/config/navigation";
import { RESTART_HINT } from "@/config/copy";

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
          Ссылка устарела — вернитесь к темам и выберите заново. {RESTART_HINT}
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
          <ScriptGlyph className="glyph glyph-lg" />
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
        label={CALL_TO_ACTION[material.type].label}
        context={{ kind: typeLabel, title: material.title, color: topicColor(material.topic) }}
        note={CALL_TO_ACTION[material.type].note}
      />
    </>
  );
}

/**
 * Что написано на кнопке заявки.
 *
 * Раньше везде стояло «Создать заявку» — и на теме, и на материале. Два
 * разных действия выглядели одним, а разница («что уйдёт в заявку») жила в
 * подписи под кнопкой, в самом тихом месте экрана. Люди не понимали модель
 * приложения именно из-за этого, а не из-за отсутствия онбординга.
 *
 * Теперь кнопка называет действие, а подпись говорит про альтернативу:
 * у инструмента и модуля она напоминает, что можно забрать файлы и сделать
 * самому — ради этого материалы и оформляют.
 */
const CALL_TO_ACTION: Record<Material["type"], { label: string; note: string }> = {
  case: {
    label: "Хочу так же",
    note: "Ссылка на этот кейс уйдёт в заявку",
  },
  tool: {
    label: "Настроить под мой проект",
    note: "Или заберите файлы выше и примените сами",
  },
  module: {
    label: "Помочь с этим скриптом",
    note: "Или заберите файлы выше и вставьте в своё определение",
  },
};

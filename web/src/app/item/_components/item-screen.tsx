"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { PathField } from "@/components/ui/path-field";
import { Screen } from "@/components/layout/screen";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { MATERIAL_TYPE_LABEL, materialById, type Material } from "@/features/materials";
import { routes } from "@/config/navigation";
import { RESTART_HINT } from "@/config/copy";
import { useRequestDraft } from "@/features/requests/draft-store";

/**
 * Оформленный материал: кейс, инструмент или модуль.
 *
 * Экран сделан так, чтобы человек мог применить решение сам — демо, короткая
 * инструкция и путь к файлам. Заявка тут не главное действие, а выход на
 * случай «сам не справлюсь» или «нужна адаптация».
 *
 * Своей кнопки заявки у экрана нет. Внизу стоит та же шторка, что и на колоде,
 * и открытое решение само становится основой заявки — оно названо второй
 * строкой в её шапке. Отдельная кнопка «создать заявку по этому решению»
 * означала бы второй способ сделать то, что уже сделано открытием экрана.
 *
 * Основа держится, пока экран открыт: уход назад к колоде её снимает, потому
 * что заявка снова становится заявкой по теме.
 */
export function ItemScreen() {
  const id = useSearchParams().get("id") ?? "";
  const material = materialById(id);
  const { pinMaterial } = useRequestDraft();
  const materialId = material?.id ?? null;

  useEffect(() => {
    if (!materialId) return;
    pinMaterial(materialId);
    return () => pinMaterial(null);
  }, [materialId, pinMaterial]);

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
        {/* Подпись стоит у файлов, а не под кнопкой заявки: она про них и
            говорит. У инструмента и модуля это главная альтернатива заявке —
            ради неё материалы и оформляют. */}
        <p className="section-note" style={{ margin: "var(--s3) 0 0" }}>
          {SELF_SERVICE[material.type]}
        </p>
      </section>
    </Screen>
  );
}

/**
 * Что человек может сделать с материалом сам, не обращаясь в отдел.
 *
 * Раньше эти фразы стояли подписью под кнопкой заявки — в самом тихом месте
 * экрана и далеко от файлов, о которых говорят. Кнопки больше нет (заявка
 * лежит в шторке внизу и уже знает про это решение), а подпись переехала туда,
 * где она осмысленна.
 */
const SELF_SERVICE: Record<Material["type"], string> = {
  case: "Заявка внизу уже привязана к этому кейсу — опишите, что нужно повторить.",
  tool: "Заберите файлы и примените сами — или опишите задачу в заявке внизу, отдел настроит под ваш проект.",
  module: "Заберите файлы и вставьте в своё определение — или опишите задачу в заявке внизу.",
};

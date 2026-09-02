import Link from "next/link";
import { ScriptGlyph } from "@/components/ui/script-glyph";
import { MATERIAL_TYPE_LABEL, type Material } from "../data";
import { itemHref } from "@/config/navigation";

/**
 * Строка списка материалов под темой.
 *
 * Тип материала подписан явно, потому что от него зависит, что человек может
 * сделать дальше: инструмент — взять и применить самому, модуль — вставить в
 * своё определение, кейс — попросить «хочу так же». Без подписи все три
 * выглядят одинаково, и список читается как однородная лента, чем он не
 * является.
 *
 * Подписи — из `MATERIAL_TYPE_LABEL`, то есть на языке заявителя («Уже
 * делали», а не «Кейс»): внутренние слова отдела не говорят архитектору,
 * что ему с этим делать.
 */
export function MaterialRow({ material }: Readonly<{ material: Material }>) {
  return (
    <Link href={itemHref(material.id)} className="row">
      <div className="row-thumb">
        {material.cover ? (
          // Обычный img, а не next/image: оптимизатор в проекте выключен
          // (см. next.config.ts), а превью уже сжато под этот размер.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb-cover" src={material.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <ScriptGlyph className="glyph" />
        )}
      </div>
      <div className="row-text">
        <div className="row-meta">
          <span className={`tag tag-${material.type}`}>
            {MATERIAL_TYPE_LABEL[material.type]}
          </span>
          {material.project ? <span className="row-dim">{material.project}</span> : null}
        </div>
        <h3>{material.title}</h3>
        <p>{material.summary}</p>
      </div>
    </Link>
  );
}

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
 */
export function MaterialRow({ material }: Readonly<{ material: Material }>) {
  return (
    <Link href={itemHref(material.id)} className="row">
      <div className="row-thumb">
        <ScriptGlyph className="glyph" />
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

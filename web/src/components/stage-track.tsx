import { REQUEST_STAGES } from "@/lib/mock/materials";

/**
 * Вехи заявки: пройденное закрашено, текущее обведено, будущее пунктиром.
 *
 * Один индикатор, а не два. В вайрфреймах рядом с кружками стояла ещё и
 * полоса прогресса — она показывала то же самое второй раз, а на вопрос «что
 * дальше» не отвечала ни одна из них. Поэтому вехи подписаны.
 *
 * «Требуется уточнение» и «На доработке» здесь не появляются намеренно: они
 * возвращают заявку назад, а шкала вех идёт только вперёд. Их место — баннер
 * над шкалой.
 */
export function StageTrack({ stage }: Readonly<{ stage: number }>) {
  return (
    <ol className="stages">
      {REQUEST_STAGES.map((label, i) => {
        const state = i < stage ? "done" : i === stage ? "now" : "next";
        return (
          <li key={label} className={`stage stage-${state}`}>
            <span className="stage-dot" aria-hidden="true" />
            <span className="stage-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

import { BOARD_STATUS } from "@/lib/board-status";
import type { PyrusRequest } from "@/lib/server/pyrus";

/**
 * Состояние заявки одним словом — по колонке доски отдела и закрытости.
 *
 * Цвет только у «Требуется уточнение»: это единственное состояние, где ход
 * за заявителем, остальные — информация.
 */
export function requestStatus(request: Pick<PyrusRequest, "status" | "closed">): {
  label: string;
  className: string;
} {
  if (request.status === BOARD_STATUS.rejected) return { label: "Отклонена", className: "tag" };
  if (request.closed) return { label: "Завершена", className: "tag" };
  if (request.status === BOARD_STATUS.clarify) {
    return { label: "Требуется уточнение", className: "tag tag-flag" };
  }
  if (request.status === BOARD_STATUS.new) return { label: "Новая", className: "tag tag-work" };
  return { label: "В работе", className: "tag tag-work" };
}

export function StatusTag({ request }: { request: Pick<PyrusRequest, "status" | "closed"> }) {
  const { label, className } = requestStatus(request);
  return <span className={className}>{label}</span>;
}

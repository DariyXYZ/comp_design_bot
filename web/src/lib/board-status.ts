/**
 * Колонки канбан-доски отдела в Pyrus — варианты поля «Статус» формы.
 * Отдельным модулем без серверного кода: нужен и серверному клиенту Pyrus,
 * и плану действий, который импортируют клиентские экраны.
 */
export const BOARD_STATUS = {
  new: "Новая задача",
  work: "В работе",
  clarify: "Требуется уточнение",
  done: "Выполнено",
  rejected: "Отклонена",
} as const;

export type BoardStatus = (typeof BOARD_STATUS)[keyof typeof BOARD_STATUS];

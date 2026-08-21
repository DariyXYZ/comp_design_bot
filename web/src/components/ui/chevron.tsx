/**
 * Шеврон в конце строки-действия.
 *
 * Раньше здесь стояла текстовая стрелка «→». У неё две беды: рисунок зависит от
 * шрифта клиента (в Telegram на Android она выходит толстой и великоватой), а
 * смысл у неё другой — «→» читается как переход или следствие, а не как «внутри
 * есть продолжение». Шеврон — привычный для списков знак, и он векторный, то
 * есть одинаковый во всех клиентах.
 */
export function Chevron() {
  return (
    <svg
      className="chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

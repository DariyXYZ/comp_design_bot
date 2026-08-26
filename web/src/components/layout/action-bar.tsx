import Link from "next/link";

/**
 * Полоса главного действия — одна и та же внизу всех экранов, где действие
 * есть.
 *
 * Смысл в постоянстве места: пользователь не ищет вход в заявку, он всегда
 * внизу. Меняется только контекст.
 *
 * Действие бывает двух видов — переход на другой экран (ссылка) и отправка
 * (кнопка). Разные элементы, а не один div с обработчиком: ссылку нужно уметь
 * открыть в новой вкладке и увидеть в статусной строке, кнопку — заблокировать,
 * пока форма не готова.
 */
type Common = {
  label: string;
  /**
   * Из чего заявка — карточка темы или конкретное решение.
   *
   * Стоит отдельной плашкой, а не подписью: подпись набрана caption'ом серым,
   * и люди её попросту не видели — заявку отправляли, не понимая, что у неё уже
   * есть контекст.
   *
   * Плашка идёт последней перед кнопкой, вплотную: соседство и означает, что
   * кнопка сработает именно для этой карточки. Подсказка отодвинута выше —
   * она про действие, а не про контекст.
   */
  context?: { kind: string; title: string };
  /** Короткая подсказка про само действие. Второстепенна и может отсутствовать. */
  note?: string;
};

export function ActionBar(
  props: Readonly<
    | (Common & { href: string })
    | (Common & { onClick: () => void; disabled?: boolean })
  >,
) {
  return (
    <div className="action-bar">
      {props.note ? <p className="action-note">{props.note}</p> : null}
      {props.context ? (
        <div className="action-context">
          {/* Знак карточки: он же стоит на строках материалов, поэтому связь
              «плашка — карточка, из которой я пришёл» читается без слов. */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="6.5"
              y="3.5"
              width="11"
              height="17"
              rx="2.6"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M3.5 7.5v9M20.5 7.5v9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <span className="action-context-kind">{props.context.kind}</span>
          <span className="action-context-title">{props.context.title}</span>
        </div>
      ) : null}
      {"href" in props ? (
        <Link href={props.href} className="btn btn-primary">
          {props.label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={props.onClick}
          disabled={props.disabled}
          className="btn btn-primary"
        >
          {props.label}
        </button>
      )}
    </div>
  );
}

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
   * Подпись и кнопка стоят на общей серой плашке — так это один предмет, а не
   * два соседних. Цвет — тот же, что у кружка на карточке в колоде: связь
   * «кнопка про эту карточку» читается до того, как прочитан текст.
   */
  context?: { kind: string; title: string; color: string };
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
      {/* Подпись и кнопка — один блок на общей плашке: раньше подпись стояла
          отдельной карточкой, и связь «эта кнопка про эту карточку» держалась
          только на близости. Кнопка внутри плашки уже её на padding — видно,
          что она принадлежит подписи, а не полосе экрана. */}
      <div className={props.context ? "action-card" : undefined}>
        {props.context ? (
          <div className="action-context">
            {/* Кружок того же цвета, что на карточке в колоде: по нему видно,
                к какой именно карточке относится кнопка. */}
            <span
              className="topic-dot topic-dot-inline"
              style={{ background: props.context.color }}
              aria-hidden="true"
            />
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
    </div>
  );
}

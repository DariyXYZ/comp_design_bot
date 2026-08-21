import Link from "next/link";

/**
 * Полоса главного действия — одна и та же внизу всех экранов, где действие
 * есть.
 *
 * Смысл в постоянстве места: пользователь не ищет вход в заявку, он всегда
 * внизу. Меняется только контекст, и подпись его проговаривает.
 *
 * Действие бывает двух видов — переход на другой экран (ссылка) и отправка
 * (кнопка). Разные элементы, а не один div с обработчиком: ссылку нужно уметь
 * открыть в новой вкладке и увидеть в статусной строке, кнопку — заблокировать,
 * пока форма не готова.
 */
type Common = { label: string; note?: string };

export function ActionBar(
  props: Readonly<
    | (Common & { href: string })
    | (Common & { onClick: () => void; disabled?: boolean })
  >,
) {
  return (
    <div className="action-bar">
      {props.note ? <p className="action-note">{props.note}</p> : null}
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

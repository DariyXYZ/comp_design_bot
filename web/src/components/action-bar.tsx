import Link from "next/link";

/**
 * Кнопка «Создать заявку» — одна и та же полоса внизу экрана на всех экранах,
 * где заявка имеет смысл.
 *
 * Смысл в постоянстве места: пользователь не ищет вход в заявку, он всегда
 * внизу. Меняется только контекст — на теме заявка уходит по теме, внутри
 * материала по этому материалу, и подпись это проговаривает.
 *
 * В проде эту роль должен взять `MainButton` Telegram: он живёт вне вёрстки и
 * не прыгает вместе с клавиатурой. В черновике — своя полоса, чтобы поток
 * можно было кликать в браузере.
 */
export function ActionBar({
  href,
  label,
  note,
}: Readonly<{ href: string; label: string; note?: string }>) {
  return (
    <div className="action-bar">
      {note ? <p className="action-note">{note}</p> : null}
      <Link href={href} className="btn btn-primary">
        {label}
      </Link>
    </div>
  );
}

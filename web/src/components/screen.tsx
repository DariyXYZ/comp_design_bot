import Link from "next/link";

/**
 * Вложенный экран: заголовок с «назад» и скроллящееся тело.
 *
 * Ссылка, а не `router.back()`: экран открывается и по прямой ссылке (в
 * черновике это обычная вкладка браузера), и тогда истории за спиной нет.
 *
 * В проде «назад» должен уехать в `BackButton` Telegram — он рисуется самим
 * клиентом в шапке, и своя кнопка в вёрстке становится лишней.
 */
export function Screen({
  title,
  subtitle,
  backHref,
  children,
}: Readonly<{
  title: string;
  subtitle?: string;
  backHref: string;
  children: React.ReactNode;
}>) {
  return (
    <>
      <div className="screen-top">
        <Link href={backHref} className="back" aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M19 12H5.5M11 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <div className="screen-titles">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="scroll">{children}</div>
    </>
  );
}

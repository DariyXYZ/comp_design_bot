import { BackLink } from "./back-link";

/**
 * Вложенный экран: заголовок с «назад» и скроллящееся тело.
 *
 * Кнопка «назад» вынесена в `BackLink`: с заполненной формы уход идёт через
 * подтверждение, и для этого нужен клиентский обработчик, а сам экран
 * остаётся серверным компонентом.
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
        <BackLink href={backHref} />
        <div className="screen-titles">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <div className="scroll">{children}</div>
    </>
  );
}

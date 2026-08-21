/**
 * Серверные переменные окружения. **Не для клиента:** без префикса
 * `NEXT_PUBLIC_` Next не отдаёт их в бандл, и это здесь принципиально —
 * токен бота подписывает сессии, ключ Pyrus открывает все задачи аккаунта.
 *
 * Проверка ленивая, а не на импорте: статическая сборка под GitHub Pages идёт
 * без этих значений, и падать она не должна — там просто нет API-роутов.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Для локального запуска — в .env.local, на Vercel — в настройках проекта.`,
    );
  }
  return value;
}

export function serverEnv() {
  return {
    /** Токен бота: им подписаны данные запуска Mini App и наши токены сессии. */
    botToken: required("TELEGRAM_TOKEN"),
    pyrusLogin: required("PYRUS_LOGIN"),
    pyrusSecurityKey: required("PYRUS_SECURITY_KEY"),
    pyrusFormId: Number(required("PYRUS_FORM_ID")),
    // Те же значения, что у бота. Без префикса NEXT_PUBLIC_ они не попадают в
    // браузер — и это правильно: карточки читает серверный роут, а не клиент.
    supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  };
}

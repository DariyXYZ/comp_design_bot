/**
 * Отправка сообщений от имени бота. **Только сервер:** токен бота даёт полный
 * доступ к боту, в браузер он попасть не должен.
 *
 * Зачем это здесь, если бот и так работает: приложение живёт на Vercel, а бот —
 * на компьютере отдела, и достучаться до него по сети нельзя (туннель на этой
 * машине заблокирован). Поэтому действия из личного кабинета пишут в чат отдела
 * напрямую через Bot API — тем же токеном, которым проверяется вход.
 *
 * Чат отдела и ветка берутся из переменных окружения. Их может не быть (черновой
 * деплой, локальный запуск) — тогда сообщение не уходит, а действие всё равно
 * доводится до конца: комментарий в задаче Pyrus остаётся.
 */
const API = "https://api.telegram.org";

/**
 * Пишет в чат отдела. `false` — чат не настроен или Telegram отказал.
 *
 * Ошибки не бросаем: заявка к этому моменту уже прокомментирована в Pyrus, и
 * ронять запрос из-за недоставленного сообщения было бы хуже.
 */
export async function notifyDept(
  text: string,
  env: { botToken: string; deptChatId?: string; deptThreadId?: string },
): Promise<boolean> {
  if (!env.deptChatId) return false;
  try {
    const response = await fetch(`${API}/bot${env.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.deptChatId,
        // Ветка заявок в чате отдела: без неё сообщение уедет в общий поток.
        ...(env.deptThreadId ? { message_thread_id: Number(env.deptThreadId) } : {}),
        text,
        disable_notification: false,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Telegram: сообщение в чат отдела не ушло", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Telegram: сообщение в чат отдела не ушло", error);
    return false;
  }
}

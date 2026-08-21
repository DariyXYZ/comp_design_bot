/**
 * Типизированный доступ к публичным переменным окружения.
 *
 * Обе переменные с префиксом `NEXT_PUBLIC_`, потому что запрос к Supabase
 * уходит из браузера — значения попадают в бандл по определению. Это
 * допустимо: `anon`-ключ публичен по дизайну, читать таблицу `cases` ему
 * разрешает Row Level Security, а писать он не может. Секретов здесь нет и
 * быть не должно — они в `server-env.ts`.
 *
 * Значения читаются **при обращении, а не при импорте**. Раньше модуль падал
 * на этапе загрузки, и отсутствие переменной валило всю сборку на пререндере
 * первой же страницы. Теперь ошибка возникает там, где значение реально
 * нужно — в запросе карточек, — и колода показывает понятный текст вместо
 * пустого экрана, а сборка проходит.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Локально — в .env.local, на Vercel — в переменных проекта.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
} as const;

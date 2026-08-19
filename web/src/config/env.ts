/**
 * Типизированный доступ к переменным окружения.
 *
 * Обе переменные с префиксом `NEXT_PUBLIC_`, потому что запрос к Supabase
 * уходит из браузера — значения попадают в бандл по определению. Это
 * допустимо: `anon`-ключ публичен по дизайну, читать таблицу `cases` ему
 * разрешает Row Level Security, а писать он не может. Секретов здесь нет и
 * быть не должно.
 *
 * При `output: 'export'` значения подставляются на этапе сборки, поэтому
 * отсутствие переменной валит `next build`, а не прод в рантайме.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Не задана переменная окружения ${name}. Скопируйте .env.example в .env.local (локально) или задайте её в переменных репозитория (CI).`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
} as const;

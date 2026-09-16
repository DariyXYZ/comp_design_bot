import type { NextConfig } from "next";

/**
 * Два режима сборки, пока идёт переезд на C#-сервер (`server/`):
 *
 * - обычный — для Vercel: API-роуты `src/app/api` живут рядом с экранами;
 * - `NEXT_OUTPUT=export` — статика в `out/`, которую раздаёт C#-сервер из
 *   wwwroot, а `/api/*` отвечает он сам. `output: 'export'` несовместим с
 *   динамическими route-хендлерами, поэтому в этом режиме Next видит только
 *   `.tsx`-файлы приложения: все `route.ts` выпадают из сборки, экраны
 *   остаются. После переключения webhook папки `src/app/api` и
 *   `src/lib/server` удаляются вместе с этим переключателем.
 */
const staticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  output: staticExport ? "export" : undefined,
  pageExtensions: staticExport ? ["tsx"] : undefined,
  // basePath не задаём: и на Vercel, и на C#-сервере приложение живёт в корне
  // домена. Раздача из подпапки (project pages) ушла вместе с GitHub Pages.
  trailingSlash: true,
  // Оптимизатор картинок отключён сознательно: своих растровых картинок в
  // приложении нет — карточки тем приходят из Supabase Storage, а места без
  // изображений заняты знаком скрипта (inline SVG).
  images: { unoptimized: true },
  // Плашка Next.js в углу мешает смотреть черновик экранов: она закрывает
  // правый верхний угол ровно там, где у Mini App заголовок. Ошибки сборки и
  // рантайма Next всё равно покажет, отключается только индикатор.
  devIndicators: false,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Статический экспорт: экран читает Supabase прямо из браузера, серверного
  // кода нет — и на GitHub Pages его быть не может. Когда дойдём до AI Q&A
  // или профиля «мои заявки», сервер понадобится (проверка подписи initData,
  // ключ Claude API), и хостинг придётся пересматривать — см. README.
  output: "export",
  // Сайт живёт не в корне домена, а на project pages:
  // https://dariyxyz.github.io/comp_design_bot/
  // Черновик публикуется в отдельный репозиторий (и, значит, по другому пути),
  // поэтому путь параметризован — сборка одна и та же, меняется адрес.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "/comp_design_bot",
  trailingSlash: true,
  // Оптимизатор картинок — серверная фича, при output:'export' её нет.
  images: { unoptimized: true },
  // Плашка Next.js в углу мешает смотреть черновик экранов: она закрывает
  // правый верхний угол ровно там, где у Mini App заголовок. Ошибки сборки и
  // рантайма Next всё равно покажет, отключается только индикатор.
  devIndicators: false,
};

export default nextConfig;

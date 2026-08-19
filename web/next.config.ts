import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Статический экспорт: экран читает Supabase прямо из браузера, серверного
  // кода нет — и на GitHub Pages его быть не может. Когда дойдём до AI Q&A
  // или профиля «мои заявки», сервер понадобится (проверка подписи initData,
  // ключ Claude API), и хостинг придётся пересматривать — см. README.
  output: "export",
  // Сайт живёт не в корне домена, а на project pages:
  // https://dariyxyz.github.io/comp_design_bot/
  basePath: "/comp_design_bot",
  trailingSlash: true,
  // Оптимизатор картинок — серверная фича, при output:'export' её нет.
  images: { unoptimized: true },
};

export default nextConfig;

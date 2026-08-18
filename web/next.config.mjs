/** @type {import('next').NextConfig} */
const nextConfig = {
  // Статический экспорт: Mini App — один клиентский экран (Supabase читается
  // прямо из браузера), сервер не нужен и на GitHub Pages его всё равно нет.
  // Когда дойдём до AI Q&A или профиля «мои заявки» — там понадобится
  // серверный код (проверка подписи initData, ключ Claude API), и хостинг
  // придётся пересматривать: Vercel или Supabase Edge Functions.
  output: "export",
  // Сайт живёт не в корне домена, а на project pages:
  // https://dariyxyz.github.io/comp_design_bot/
  basePath: "/comp_design_bot",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Именно localhost, не 127.0.0.1: dev-сервер Next считает обращение по IP
// сторонним источником и блокирует раздачу собственных чанков — страница
// открывается, но не гидратируется.
const ORIGIN = `http://localhost:${PORT}`;
// basePath больше нет: на Vercel приложение живёт в корне домена, и
// проверять готовность сервера нужно по корню — иначе Playwright не увидит
// уже запущенный dev и попробует поднять второй.
const APP_URL = `${ORIGIN}/`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Тесты трогают одну и ту же страницу жестами — параллельные воркеры дали бы
  // гонки на общем dev-сервере, выигрыш по времени тут нулевой.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      // Размер под телефон стоит ПОСЛЕ пресета устройства и это важно:
      // `devices["Desktop Chrome"]` несёт собственный viewport 1280×720, и
      // раньше он перебивал размер из общего `use` — весь «телефонный» набор
      // проверок много месяцев гонялся в настольном окне. Колода считает
      // ширину карточки от высоты экрана, так что на широком окне проверялась
      // не та раскладка, которую видит человек.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      },
    },
  ],
  // dev-сервер, а не собранная статика: он сам знает про basePath, иначе
  // пришлось бы раздавать out/ по вложенному пути вручную.
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

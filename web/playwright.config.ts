import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Именно localhost, не 127.0.0.1: dev-сервер Next считает обращение по IP
// сторонним источником и блокирует раздачу собственных чанков — страница
// открывается, но не гидратируется.
const ORIGIN = `http://localhost:${PORT}`;
// Путь приложения задан basePath — тесты открывают его явно (см. APP_PATH в
// spec), поэтому baseURL здесь только origin.
const APP_URL = `${ORIGIN}/comp_design_bot/`;

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
    // Размер под телефон: колода считает ширину от vw, а высоту ограничивает
    // 62vh — на «настольном» окне пропорция карточки другая.
    viewport: { width: 390, height: 844 },
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Desktop Chrome"], hasTouch: true },
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

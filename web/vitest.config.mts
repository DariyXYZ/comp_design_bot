import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e живут рядом, но их запускает Playwright — vitest их не трогает.
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    // Модуль config/env падает, если переменных нет — задаём заглушки, чтобы
    // тесты проверяли логику, а не наличие настроек окружения.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

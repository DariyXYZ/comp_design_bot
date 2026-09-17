// Статический экспорт для C#-сервера: `out/` без API-роутов. Отдельный скрипт,
// а не строка в package.json, чтобы переменная выставлялась одинаково в
// Windows и в CI.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  // Экспорт живёт только на C#-сервере, поэтому заявка там всегда через API.
  env: { ...process.env, NEXT_OUTPUT: "export", NEXT_PUBLIC_SUBMIT_VIA_API: "1" },
});
process.exit(result.status ?? 1);

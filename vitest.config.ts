import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/lib/__tests__/setup.ts"],
    pool: "threads",
    /* быстрый прогон — без watch по умолчанию */
    reporters: ["default"],
  },
});

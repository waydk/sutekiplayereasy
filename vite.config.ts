import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** GitHub project Pages: VITE_BASE=/имя-репозитория/ в CI (см. workflow). */
function appBase(): string {
  const raw = (process.env.VITE_BASE ?? "/").trim();
  if (!raw || raw === "/") return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export default defineConfig({
  plugins: [react()],
  base: appBase(),
  server: {
    proxy: {
      "/api/v1": {
        target: process.env.VITE_DEV_API_ORIGIN ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});


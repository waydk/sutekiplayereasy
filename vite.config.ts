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
});


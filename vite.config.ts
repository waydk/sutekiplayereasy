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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "react-vendor";
          if (id.includes("node_modules/hls.js")) return "hls";
          if (id.includes("node_modules/plyr")) return "plyr";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api/v1": {
        target: process.env.VITE_DEV_API_ORIGIN ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});


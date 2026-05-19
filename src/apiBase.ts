/** Базовый URL Sutekihub API — build-time VITE_API_BASE или runtime-config.json на Pages. */

const BUILD_BASE = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");

let resolvedBase = BUILD_BASE;

export function getApiBase(): string {
  return resolvedBase;
}

/** Загрузить /runtime-config.json (можно обновить без пересборки). */
export async function initApiBase(): Promise<void> {
  if (typeof window !== "undefined" && !BUILD_BASE) {
    const host = window.location.hostname;
    if (host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") {
      resolvedBase = `${window.location.origin}/api/v1`;
      return;
    }
  }
  const base = import.meta.env.BASE_URL || "/";
  const cfgUrl = `${base.replace(/\/?$/, "/")}runtime-config.json`.replace(/\/+/g, "/");
  try {
    const r = await fetch(cfgUrl, { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { apiBase?: string };
    const raw = (j.apiBase ?? "").trim().replace(/\/+$/, "");
    if (raw) resolvedBase = raw;
  } catch {
    // оставляем BUILD_BASE или dev proxy
  }
}

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const hubPath = p.startsWith("/api/v1")
    ? p
    : p.startsWith("/playereasy") || p.startsWith("/anime/") || p.startsWith("/media/")
      ? `/api/v1${p}`
      : `/api/v1/playereasy${p}`;
  const base = getApiBase().replace(/\/+$/, "");
  if (!base) return hubPath;
  const origin = base.endsWith("/api/v1") ? base.slice(0, -"/api/v1".length) : base.replace(/\/api\/v1$/, "");
  return `${origin.replace(/\/$/, "")}${hubPath}`;
}

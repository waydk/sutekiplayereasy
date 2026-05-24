/** Базовый URL Sutekihub API — build-time VITE_API_BASE или runtime-config.json на Pages. */

const BUILD_BASE = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");

let resolvedBase = BUILD_BASE;

if (typeof window !== "undefined") {
  const { protocol, hostname } = window.location;
  if (
    !BUILD_BASE &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      protocol === "https:" ||
      hostname.endsWith(".vercel.app"))
  ) {
    resolvedBase = `${window.location.origin}/api/v1`;
  }
}

let apiBaseReady: Promise<void> = Promise.resolve();

export function getApiBase(): string {
  return resolvedBase;
}

function useSameOriginApiBase(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (protocol === "https:") return true;
  if (hostname.endsWith(".vercel.app")) return true;
  return false;
}

/** Загрузить /runtime-config.json (можно обновить без пересборки). */
export function initApiBase(): Promise<void> {
  apiBaseReady = (async () => {
    if (typeof window !== "undefined" && !BUILD_BASE && useSameOriginApiBase()) {
      resolvedBase = `${window.location.origin}/api/v1`;
      return;
    }
    const base = import.meta.env.BASE_URL || "/";
    const cfgUrl = `${base.replace(/\/?$/, "/")}runtime-config.json`.replace(/\/+/g, "/");
    try {
      const r = await fetch(cfgUrl, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { apiBase?: string };
      const raw = (j.apiBase ?? "").trim().replace(/\/+$/, "");
      if (raw) resolvedBase = raw;
      else if (typeof window !== "undefined" && useSameOriginApiBase()) {
        resolvedBase = `${window.location.origin}/api/v1`;
      }
    } catch {
      if (typeof window !== "undefined" && useSameOriginApiBase()) {
        resolvedBase = `${window.location.origin}/api/v1`;
      }
    }
  })();
  return apiBaseReady;
}

export function whenApiBaseReady(): Promise<void> {
  return apiBaseReady;
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

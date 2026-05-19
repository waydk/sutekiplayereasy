/** Базовый URL Sutekihub API (см. VITE_API_BASE в CI / .env.local). */

const RAW = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");

/** Пусто = только dev (vite proxy). В production задайте https://…/api/v1 */
export const API_BASE = RAW;

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) {
    return `/api/v1${p.startsWith("/playereasy") ? p : `/playereasy${p}`}`;
  }
  if (p.startsWith("/api/v1")) return `${API_BASE.replace(/\/api\/v1$/, "")}${p}`;
  if (p.startsWith("/playereasy")) return `${API_BASE}${p}`;
  return `${API_BASE}/playereasy${p}`;
}

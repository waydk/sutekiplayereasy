declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand?: () => void;
        initDataUnsafe?: { start_param?: string };
      };
    };
  }
}

export function initTelegramWebApp(): void {
  if (typeof window === "undefined") return;
  const w = window.Telegram?.WebApp;
  if (!w) return;
  w.ready();
  w.expand?.();
}

/** Shikimori id from ?shiki_id= / ?shikimori_id= / ?id= or Mini App start_param (digits or shiki_123). */
export function parseLaunchShikiId(): number | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  for (const key of ["shiki_id", "shikimori_id", "id"]) {
    const raw = params.get(key);
    if (raw == null || raw === "") continue;
    const n = Math.floor(Number(String(raw).trim()));
    if (Number.isFinite(n) && n > 0) return n;
  }

  const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (sp && typeof sp === "string") {
    const s = sp.trim();
    const m = /^shiki[_-]?(\d+)$/i.exec(s);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const n = Math.floor(Number(s));
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

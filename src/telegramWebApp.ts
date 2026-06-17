declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand?: () => void;
        close?: () => void;
        platform?: string;
        version?: string;
        initData?: string;
        initDataUnsafe?: {
          start_param?: string;
          user?: { id?: number };
        };
        safeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
        contentSafeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
        isExpanded?: boolean;
        viewportHeight?: number;
        viewportStableHeight?: number;
        onEvent?: (event: string, handler: () => void) => void;
        offEvent?: (event: string, handler: () => void) => void;
        disableVerticalSwipes?: () => void;
        enableVerticalSwipes?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        themeParams?: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        HapticFeedback?: {
          impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred?: (type: "error" | "success" | "warning") => void;
          selectionChanged?: () => void;
        };
        sendData?: (data: string) => void;
      };
    };
  }
}

function applyTelegramTheme(): void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  const tp = tg.themeParams;
  const headerBg = tp?.bg_color || "#0b0d12";
  try {
    tg.setHeaderColor?.(headerBg);
    tg.setBackgroundColor?.(headerBg);
  } catch {
    /* */
  }
}

export function isTelegramWebApp(): boolean {
  if (typeof window === "undefined") return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Telegram/i.test(ua)) return true;
  const tg = window.Telegram?.WebApp;
  if (!tg) return false;
  if (typeof tg.initData === "string" && tg.initData.length > 0) return true;
  if (tg.platform && tg.platform !== "unknown") return true;
  return Boolean(window.location.search.includes("tgWebApp") || window.location.hash.includes("tgWebApp"));
}

function parseShikiIdFromStartParam(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const m = /^shiki[_-]?(\d+)$/i.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const n = Math.floor(Number(s));
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

/** Shikimori id из URL или start_param Mini App. */
export function parseLaunchShikiId(): number | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  for (const key of ["shiki_id", "shikimori_id", "anime_id", "id"]) {
    const raw = params.get(key);
    if (raw == null || raw === "") continue;
    const n = Math.floor(Number(String(raw).trim()));
    if (Number.isFinite(n) && n > 0) return n;
  }

  const tgStart = parseShikiIdFromStartParam(params.get("tgWebAppStartParam"));
  if (tgStart) return tgStart;

  const sp = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const fromInit = parseShikiIdFromStartParam(sp);
  if (fromInit) return fromInit;

  return null;
}

export function initTelegramWebApp(): void {
  if (typeof window === "undefined") return;
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  try {
    applyTelegramTheme();
    tg.onEvent?.("themeChanged", applyTelegramTheme);
    tg.ready();
    tg.expand?.();
    tg.disableVerticalSwipes?.();
  } catch {
    /* */
  }

  if (isTelegramWebApp()) {
    document.documentElement.classList.add("tg-webapp");
    document.body.classList.add("tg-webapp");
  }
}

function debugQueryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  return p.get("debug") === "1" || p.get("debug") === "true";
}

export function shouldShowDebugPanel(): boolean {
  if (debugQueryEnabled()) return true;
  const flag = import.meta.env.VITE_SHOW_DEBUG;
  if (import.meta.env.PROD) return flag === "1";
  return flag !== "0";
}

/** Компактная строка метрик старта (?debug=1), без полной debug-панели. */
export function shouldShowStartupTrace(): boolean {
  return debugQueryEnabled();
}

import { useEffect } from "react";

export function useTelegramWebApp(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
    } catch {
      /* */
    }
  }, [enabled]);
}

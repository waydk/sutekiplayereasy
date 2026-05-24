import { useEffect } from "react";
import { initTelegramWebApp, isTelegramWebApp } from "../telegramWebApp";

function applyTelegramSafeAreaInsets() {
  if (typeof document === "undefined") return;
  const tg = window.Telegram?.WebApp;
  const root = document.documentElement;
  const sa = tg?.safeAreaInset;
  const cs = tg?.contentSafeAreaInset;
  const top = Math.max(sa?.top ?? 0, cs?.top ?? 0);
  const right = Math.max(sa?.right ?? 0, cs?.right ?? 0);
  const bottom = Math.max(sa?.bottom ?? 0, cs?.bottom ?? 0);
  const left = Math.max(sa?.left ?? 0, cs?.left ?? 0);
  root.style.setProperty("--tg-safe-top", `${top}px`);
  root.style.setProperty("--tg-safe-right", `${right}px`);
  root.style.setProperty("--tg-safe-bottom", `${bottom}px`);
  root.style.setProperty("--tg-safe-left", `${left}px`);
}

/** Текущая высота Mini App (меняется при клавиатуре). Stable — только без клавиатуры. */
function applyTelegramViewportHeights() {
  if (typeof document === "undefined") return;
  const tg = window.Telegram?.WebApp;
  const root = document.documentElement;
  const vh = tg?.viewportHeight;
  const stable = tg?.viewportStableHeight;
  if (typeof vh === "number" && vh > 0) {
    root.style.setProperty("--tg-viewport-height", `${vh}px`);
  }
  if (typeof stable === "number" && stable > 0) {
    root.style.setProperty("--tg-viewport-stable-height", `${stable}px`);
  }
}

function applyVisualViewportHeight() {
  if (typeof document === "undefined") return;
  const vv = window.visualViewport;
  if (!vv || vv.height <= 0) return;
  document.documentElement.style.setProperty("--visual-viewport-height", `${vv.height}px`);
}

function syncViewportCssVars() {
  applyTelegramSafeAreaInsets();
  applyTelegramViewportHeights();
  applyVisualViewportHeight();
}

export function useTelegramWebApp(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    initTelegramWebApp();
    const tg = window.Telegram?.WebApp;
    syncViewportCssVars();
    tg?.onEvent?.("viewportChanged", syncViewportCssVars);
    window.visualViewport?.addEventListener("resize", applyVisualViewportHeight);
    window.visualViewport?.addEventListener("scroll", applyVisualViewportHeight);
    return () => {
      tg?.offEvent?.("viewportChanged", syncViewportCssVars);
      window.visualViewport?.removeEventListener("resize", applyVisualViewportHeight);
      window.visualViewport?.removeEventListener("scroll", applyVisualViewportHeight);
    };
  }, [enabled]);
}

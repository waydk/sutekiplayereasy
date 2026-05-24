import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { getApiBase, initApiBase } from "./apiBase";
import { isHomeRoute } from "./lib/homePreload";
import { kickHomePreload } from "./lib/homePreload";
import { warmBootstrap } from "./lib/playerCache";
import { resolveLaunchWatch } from "./lib/watchProgress";
import { initTelegramWebApp, parseLaunchShikiId } from "./telegramWebApp";

function registerPosterServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  /* SW только на главной — кэширует assets-постеры, не ломает Shikimori <img> в плеере. */
  if (!isHomeRoute()) return;
  void navigator.serviceWorker.register("/poster-sw.js", { scope: "/" }).catch(() => {});
}

function preconnectApiOrigin(): void {
  try {
    const base = getApiBase();
    if (!base) return;
    const origin = new URL(base, window.location.origin).origin;
    if (document.querySelector(`link[rel="preconnect"][data-suteki-api-origin="${origin}"]`)) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    link.setAttribute("data-suteki-api-origin", origin);
    document.head.appendChild(link);
  } catch {
    /* */
  }
}

function kickWarmup(): void {
  const params = new URLSearchParams(window.location.search);
  const launchId = parseLaunchShikiId();
  if (!launchId) return;
  const qpTid = params.get("translation_id")?.trim() || null;
  const qpEpRaw = params.get("episode");
  const qpEp =
    qpEpRaw && !Number.isNaN(Number(qpEpRaw)) && Number(qpEpRaw) > 0 ? Math.floor(Number(qpEpRaw)) : 1;
  const launch = resolveLaunchWatch(launchId, {
    explicitEpisode: params.has("episode"),
    urlEpisode: qpEp,
    urlTranslationId: qpTid,
  });
  /* bootstrap с include_link=true — отдельный /kodik/link не нужен (экономит ~2s HEAD на бэке). */
  void warmBootstrap(launchId, launch.translationId ?? qpTid, launch.episode);
}

function boot(): void {
  initTelegramWebApp();
  registerPosterServiceWorker();
  kickHomePreload();
  // Не блокируем mount React — runtime-config подтягивается параллельно.
  void initApiBase().then(() => {
    preconnectApiOrigin();
    kickWarmup();
    kickHomePreload();
  });
  // Same-origin API доступен сразу на vercel.app — стартуем bootstrap до initApiBase.
  kickWarmup();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { whenApiBaseReady } from "./apiBase";
import { HomePage } from "./HomePage";
import { pushLaunchShikiId, pushLaunchWatch, useLaunchShikiId } from "./hooks/useLaunchShikiId";
import { warmBootstrap } from "./lib/playerCache";
import type { ContinueWatchEntry } from "./lib/watchProgress";
import { resolveLaunchWatch } from "./lib/watchProgress";

const KodikPlayer = lazy(() =>
  import("./KodikPlayer").then((m) => ({ default: m.KodikPlayer })),
);

function canMountImmediately(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (protocol === "https:") return true;
  return hostname.endsWith(".vercel.app");
}

export function App() {
  const [ready, setReady] = useState(canMountImmediately);
  const launchId = useLaunchShikiId();

  useEffect(() => {
    if (ready) {
      void whenApiBaseReady();
      return;
    }
    void whenApiBaseReady().then(() => setReady(true));
  }, [ready]);

  const openAnime = useCallback((id: number) => {
    pushLaunchShikiId(id);
    const launch = resolveLaunchWatch(id, {
      explicitEpisode: false,
      urlEpisode: 1,
      urlTranslationId: null,
    });
    void warmBootstrap(id, launch.translationId, launch.episode);
  }, []);

  const openContinueWatch = useCallback((entry: ContinueWatchEntry) => {
    pushLaunchWatch({
      shikiId: entry.animeId,
      episode: entry.episode,
      translationId: entry.translationId,
    });
    void warmBootstrap(entry.animeId, entry.translationId, entry.episode);
  }, []);

  if (!ready) {
    return (
      <main className="sh-page sh-app-boot" aria-busy="true">
        <p className="sh-app-boot-text">Загрузка…</p>
      </main>
    );
  }

  if (!launchId) {
    return <HomePage onSelectAnime={openAnime} onContinueWatch={openContinueWatch} />;
  }

  return (
    <Suspense
      fallback={
        <main className="sh-page sh-app-boot" aria-busy="true">
          <p className="sh-app-boot-text">Загрузка плеера…</p>
        </main>
      }
    >
      <KodikPlayer />
    </Suspense>
  );
}

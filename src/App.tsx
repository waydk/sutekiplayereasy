import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { whenApiBaseReady } from "./apiBase";
import { HomePage } from "./HomePage";
import { pushLaunchShikiId, useLaunchShikiId } from "./hooks/useLaunchShikiId";
import { warmBootstrap } from "./lib/playerCache";
import { resolveLaunchWatch } from "./lib/watchProgress";

const KodikPlayer = lazy(() =>
  import("./KodikPlayer").then((m) => ({ default: m.KodikPlayer })),
);

function canMountPlayerImmediately(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (protocol === "https:") return true;
  return hostname.endsWith(".vercel.app");
}

export function App() {
  const [ready, setReady] = useState(canMountPlayerImmediately);
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

  if (!ready) {
    return (
      <main className="sh-page sh-app-boot" aria-busy="true">
        <p className="sh-app-boot-text">Загрузка…</p>
      </main>
    );
  }

  if (!launchId) {
    return <HomePage onSelectAnime={openAnime} />;
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

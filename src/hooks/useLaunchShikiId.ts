import { useEffect, useState } from "react";
import { parseLaunchShikiId } from "../telegramWebApp";

export type LaunchWatchParams = {
  shikiId: number;
  episode?: number;
  translationId?: string | null;
};

export function pushLaunchWatch({ shikiId, episode, translationId }: LaunchWatchParams): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("shiki_id", String(shikiId));
    const ep = episode != null && Number.isFinite(episode) && episode > 0 ? Math.floor(episode) : 0;
    if (ep > 0) u.searchParams.set("episode", String(ep));
    else u.searchParams.delete("episode");
    const tid = (translationId ?? "").trim();
    if (tid) u.searchParams.set("translation_id", tid);
    else u.searchParams.delete("translation_id");
    window.history.pushState(window.history.state, "", u);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* */
  }
}

export function pushLaunchShikiId(next: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (next && next > 0) {
      pushLaunchWatch({ shikiId: next });
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.delete("shiki_id");
    u.searchParams.delete("anime_id");
    u.searchParams.delete("episode");
    u.searchParams.delete("translation_id");
    window.history.pushState(window.history.state, "", u);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* */
  }
}

export function useLaunchShikiId(): number | null {
  const [id, setId] = useState<number | null>(() => parseLaunchShikiId());

  useEffect(() => {
    const sync = () => setId(parseLaunchShikiId());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return id;
}

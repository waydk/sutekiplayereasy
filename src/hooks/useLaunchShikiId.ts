import { useEffect, useState } from "react";
import { parseLaunchShikiId } from "../telegramWebApp";

export function pushLaunchShikiId(next: number | null): void {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (next && next > 0) {
      u.searchParams.set("shiki_id", String(next));
      u.searchParams.set("episode", "1");
      u.searchParams.delete("translation_id");
    } else {
      u.searchParams.delete("shiki_id");
      u.searchParams.delete("anime_id");
      u.searchParams.delete("episode");
      u.searchParams.delete("translation_id");
    }
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

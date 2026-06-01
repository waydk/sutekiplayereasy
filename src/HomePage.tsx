import { HomeCalendar } from "./components/HomeCalendar";
import { HomeCatalog } from "./components/HomeCatalog";
import { HomeContinueWatching } from "./components/HomeContinueWatching";
import { HomeHero } from "./components/HomeHero";
import type { ContinueWatchEntry } from "./lib/watchProgress";

type HomePageProps = {
  onSelectAnime: (shikiId: number) => void;
  onContinueWatch: (entry: ContinueWatchEntry) => void;
};

export function HomePage({ onSelectAnime, onContinueWatch }: HomePageProps) {
  return (
    <main className="sh-page home-page">
      <HomeHero onSelectAnime={onSelectAnime} />

      <div className="sh-shell home-shell">
        <HomeContinueWatching onContinue={onContinueWatch} />

        <HomeCatalog onSelectAnime={onSelectAnime} />

        <HomeCalendar onSelectAnime={onSelectAnime} />

        <p className="home-foot home-enter home-enter--4">
          Постеры —{" "}
          <a href="https://shikimori.one" target="_blank" rel="noopener noreferrer">
            Shikimori
          </a>
        </p>
      </div>
    </main>
  );
}

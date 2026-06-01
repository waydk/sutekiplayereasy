import { useEffect, useRef, useState } from "react";
import { fetchCatalog, type CatalogCard, type CatalogTab } from "../lib/animeLists";
import { useJikanMeta } from "../lib/jikanImages";
import { posterAssetUrl } from "../lib/posterPreload";
import { PosterImage } from "./PosterImage";

type HomeCatalogProps = {
  onSelectAnime: (shikiId: number) => void;
};

const TABS: { key: CatalogTab; label: string; icon: string }[] = [
  { key: "season", label: "Этот сезон", icon: "📈" },
  { key: "popular", label: "Популярное", icon: "🔥" },
  { key: "top", label: "По рейтингу", icon: "★" },
];

function CatCard({
  card,
  index,
  onSelect,
}: {
  card: CatalogCard;
  index: number;
  onSelect: (id: number) => void;
}) {
  const meta = useJikanMeta(card.id);
  const year = card.year ?? meta?.year ?? null;
  const src = meta ? meta.image || posterAssetUrl(card.id) : null;

  return (
    <li className="home-cat__cell">
      <button type="button" className="cat-card" onClick={() => onSelect(card.id)} title={card.title}>
        <span className="cat-card__art">
          {src ? (
            <PosterImage
              src={src}
              width={300}
              height={424}
              loading={index < 8 ? "eager" : "lazy"}
              fetchPriority={index < 4 ? "high" : undefined}
              instant={index < 6}
            />
          ) : (
            <span className="cat-card__art-sk" />
          )}

          {card.score ? (
            <span className="cat-card__score">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.8l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94L12 2.5z"
                  fill="currentColor"
                />
              </svg>
              {card.score}
            </span>
          ) : null}

          {card.ongoing ? <span className="cat-card__live">ONGOING</span> : null}

          <span className="cat-card__shade" aria-hidden="true" />
          <span className="cat-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </span>
        </span>

        <span className="cat-card__foot">
          <span className="cat-card__meta">
            <span className="cat-card__kind">{card.tag}</span>
            {year ? <span className="cat-card__year">{year}</span> : null}
          </span>
          <span className="cat-card__title">{card.title}</span>
        </span>
      </button>
    </li>
  );
}

export function HomeCatalog({ onSelectAnime }: HomeCatalogProps) {
  const [tab, setTab] = useState<CatalogTab>("season");
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    void fetchCatalog(tab)
      .then((rows) => {
        if (id !== reqId.current) return;
        setCards(rows);
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setError("Не удалось загрузить подборку");
        setCards([]);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [tab]);

  return (
    <section className="home-cat home-enter home-enter--2" aria-labelledby="home-cat-title">
      <div className="home-cat__head">
        <h2 id="home-cat-title" className="home-section-head__title">
          Каталог аниме
        </h2>
        <div className="home-cat__tabs" role="tablist" aria-label="Подборки">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === tab}
              className={`home-cat__tab${t.key === tab ? " home-cat__tab--active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="home-cat__tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="home-cat__state home-cat__state--error">{error}</p> : null}

      <ol className="home-cat__grid" aria-label="Аниме">
        {loading
          ? Array.from({ length: 12 }, (_, i) => (
              <li key={`sk-${i}`} className="home-cat__cell">
                <div className="cat-card cat-card--skeleton" aria-hidden="true">
                  <span className="cat-card__art" />
                </div>
              </li>
            ))
          : cards.map((card, index) => (
              <CatCard key={card.id} card={card} index={index} onSelect={onSelectAnime} />
            ))}
      </ol>
    </section>
  );
}

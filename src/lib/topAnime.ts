/** Топ-20 аниме (Shikimori id) — статический каталог на главной. */
export type CardVariant = "circle" | "diagonal" | "fade" | "dark";

export type TopAnimeEntry = {
  shikiId: number;
  title: string;
  titleJa: string;
  year: number;
  genres: string;
  episodesLabel: string;
  rank: number;
  variant: CardVariant;
};

export const TOP_ANIME_ALL_TIME: TopAnimeEntry[] = [
  {
    rank: 1,
    shikiId: 5114,
    title: "Стальной алхимик: Братство",
    titleJa: "鋼の錬金術師",
    year: 2009,
    genres: "Экшен, Приключения",
    episodesLabel: "64 серии",
    variant: "circle",
  },
  {
    rank: 2,
    shikiId: 9253,
    title: "Steins;Gate",
    titleJa: "シュタインズ・ゲート",
    year: 2011,
    genres: "Sci-Fi, Триллер",
    episodesLabel: "24 серии",
    variant: "fade",
  },
  {
    rank: 3,
    shikiId: 16498,
    title: "Атака титанов",
    titleJa: "進撃の巨人",
    year: 2013,
    genres: "Экшен, Драма",
    episodesLabel: "25 серий",
    variant: "diagonal",
  },
  {
    rank: 4,
    shikiId: 11061,
    title: "Hunter × Hunter",
    titleJa: "ハンター×ハンター",
    year: 2011,
    genres: "Приключения, Экшен",
    episodesLabel: "148 серий",
    variant: "fade",
  },
  {
    rank: 5,
    shikiId: 1535,
    title: "Тетрадь смерти",
    titleJa: "デスノート",
    year: 2006,
    genres: "Триллер, Сверхъестественное",
    episodesLabel: "37 серий",
    variant: "dark",
  },
  {
    rank: 6,
    shikiId: 30276,
    title: "Ванпанчмен",
    titleJa: "ワンパンマン",
    year: 2015,
    genres: "Комедия, Экшен",
    episodesLabel: "12 серий",
    variant: "diagonal",
  },
  {
    rank: 7,
    shikiId: 2904,
    title: "Код Гиас R2",
    titleJa: "コードギアス",
    year: 2008,
    genres: "Меха, Драма",
    episodesLabel: "25 серий",
    variant: "circle",
  },
  {
    rank: 8,
    shikiId: 1,
    title: "Ковбой Бибоп",
    titleJa: "カウボーイビバップ",
    year: 1998,
    genres: "Космос, Экшен",
    episodesLabel: "26 серий",
    variant: "fade",
  },
  {
    rank: 9,
    shikiId: 918,
    title: "Гинтама",
    titleJa: "銀魂",
    year: 2006,
    genres: "Комедия, Экшен",
    episodesLabel: "367+ серий",
    variant: "diagonal",
  },
  {
    rank: 10,
    shikiId: 38000,
    title: "Клинок, рассекающий демонов",
    titleJa: "鬼滅の刃",
    year: 2019,
    genres: "Экшен, Фэнтези",
    episodesLabel: "26 серий",
    variant: "circle",
  },
  {
    rank: 11,
    shikiId: 32182,
    title: "Моб Психо 100",
    titleJa: "モブサイコ100",
    year: 2016,
    genres: "Комедия, Сверхъестественное",
    episodesLabel: "12 серий",
    variant: "fade",
  },
  {
    rank: 12,
    shikiId: 32281,
    title: "Твоё имя",
    titleJa: "君の名は。",
    year: 2016,
    genres: "Романтика, Драма",
    episodesLabel: "Фильм",
    variant: "diagonal",
  },
  {
    rank: 13,
    shikiId: 4085,
    title: "Унесённые призраками",
    titleJa: "千と千尋の神隠し",
    year: 2001,
    genres: "Фэнтези, Приключения",
    episodesLabel: "Фильм",
    variant: "fade",
  },
  {
    rank: 14,
    shikiId: 33352,
    title: "Вайолет Эвергарден",
    titleJa: "ヴァイオレット・エヴァーガーデン",
    year: 2018,
    genres: "Драма, Фэнтези",
    episodesLabel: "13 серий",
    variant: "circle",
  },
  {
    rank: 15,
    shikiId: 40748,
    title: "Магическая битва",
    titleJa: "呪術廻戦",
    year: 2020,
    genres: "Экшен, Фэнтези",
    episodesLabel: "24 серии",
    variant: "circle",
  },
  {
    rank: 16,
    shikiId: 21,
    title: "Ван Пис",
    titleJa: "ワンピース",
    year: 1999,
    genres: "Приключения, Экшен",
    episodesLabel: "1100+ серий",
    variant: "diagonal",
  },
  {
    rank: 17,
    shikiId: 1735,
    title: "Наруто: Ураганные хроники",
    titleJa: "ナルト 疾風伝",
    year: 2007,
    genres: "Сёнэн, Экшен",
    episodesLabel: "500 серий",
    variant: "fade",
  },
  {
    rank: 18,
    shikiId: 31964,
    title: "Моя геройская академия",
    titleJa: "僕のヒーローアカデミア",
    year: 2016,
    genres: "Супергерои, Экшен",
    episodesLabel: "13 сезонов",
    variant: "diagonal",
  },
  {
    rank: 19,
    shikiId: 30,
    title: "Евангелион",
    titleJa: "新世紀エヴァンゲリオン",
    year: 1995,
    genres: "Меха, Психология",
    episodesLabel: "26 серий",
    variant: "fade",
  },
  {
    rank: 20,
    shikiId: 11757,
    title: "Sword Art Online",
    titleJa: "ソードアート・オンライン",
    year: 2012,
    genres: "Исекай, Экшен",
    episodesLabel: "25 серий",
    variant: "circle",
  },
];

/** 9 тайтлов на главной — блок «Рекомендации». */
export const RECOMMENDED_ANIME: TopAnimeEntry[] = TOP_ANIME_ALL_TIME.slice(0, 9).map((entry, index) => ({
  ...entry,
  rank: index + 1,
}));

const ASSETS_CACHE_BUST = "20260525";

export function topAnimeHeroUrl(shikiId: number): string {
  return `/api/v1/assets/anime/${shikiId}/hero.jpg?v=${ASSETS_CACHE_BUST}`;
}

export function topAnimePosterUrl(shikiId: number): string {
  return `/api/v1/assets/anime/${shikiId}/poster.jpg?v=${ASSETS_CACHE_BUST}`;
}

export function formatRank(rank: number): string {
  return `${String(rank).padStart(2, "0")}.`;
}

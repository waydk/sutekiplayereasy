/** Дефолтная гифка ожидания (Giphy). Переопределение: `VITE_PLAYER_WAIT_GIF_URL`. */
export const PLAYER_WAIT_GIF_DEFAULT =
  "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExbGJqcjU1d3pvYW5jdWp1YzBlOTZldGJwc214b3F3bTY5N3dnY3VxOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/nPQ14ReLW7U4GC5Jlo/giphy.gif";

/** Фразы при подгрузке сегмента (буферизация). */
export const WAIT_PHRASES_BUFFER: string[] = [
  "Щас, подожди~",
  "Секундочку…",
  "Почти, подкручиваем~",
  "Не уходи, щас будет~",
  "Ещё чуть-чуть…",
  "Терпение, тян~",
  "Грузим, не переключайся~",
];

/** Фразы при старте / bootstrap (полный оверлей). */
export const WAIT_PHRASES_LOADER: string[] = [
  "Щас всё подтянем~",
  "Подожди чуток…",
  "Уже несём тайтл~",
  "Собираем серии…",
  "Связываемся с сервером~",
  "Почти готово…",
  "Загружаем магию…",
];

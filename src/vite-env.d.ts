/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE?: string;
  readonly VITE_API_BASE?: string;
  /** Прямая ссылка на GIF для экранов ожидания плеера (иначе используется дефолт из `waitPhrases.ts`). */
  readonly VITE_PLAYER_WAIT_GIF_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

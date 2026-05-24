/* vitest setup: общие моки и подавление шума jsdom. */
import { beforeEach } from "vitest";

function ensureLocalStorage(): void {
  if (typeof window === "undefined") return;
  const ls = window.localStorage as Storage & { clear?: () => void };
  if (typeof ls.clear === "function" && typeof ls.getItem === "function") return;
  const bag = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return bag.size;
    },
    clear() {
      bag.clear();
    },
    getItem(key: string) {
      return bag.has(key) ? bag.get(key)! : null;
    },
    setItem(key: string, value: string) {
      bag.set(key, String(value));
    },
    removeItem(key: string) {
      bag.delete(key);
    },
    key(index: number) {
      return [...bag.keys()][index] ?? null;
    },
  };
  Object.defineProperty(window, "localStorage", { value: mock, configurable: true });
}

ensureLocalStorage();

beforeEach(() => {
  /* Чистим глобалы между тестами, чтобы head-prefetch / DOM-кэш не утекал. */
  if (typeof window !== "undefined") {
    delete (window as unknown as { __sutekiBoot__?: unknown }).__sutekiBoot__;
    window.localStorage.clear();
  }
});

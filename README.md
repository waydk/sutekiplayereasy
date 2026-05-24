# sutekiplayereasy

Статический плеер (GitHub Pages): **Shikimori + Kodik** через **Sutekihub API** на VPS.

## Запуск локально

```bash
cd sutekiplayereasy
npm install
# в другом терминале — API из ../sutekihub/backend (порт 8000)
npm run dev
```

Опционально `.env.local`:

```
VITE_API_BASE=http://127.0.0.1:8000/api/v1
# Прямая ссылка на GIF для экранов ожидания плеера (иначе — дефолт из `src/lib/waitPhrases.ts`).
# VITE_PLAYER_WAIT_GIF_URL=https://example.com/your-wait.gif
```

## Production

- **Фронт:** GitHub Pages → `deploy-pages.yml`
- **Бэк:** FastAPI на VPS `103.74.92.49:8000` (HTTP, без своего TLS)
- **HTTPS к API:** папка [`api-proxy/`](api-proxy/) на Vercel (`https://suteki-api-proxy.vercel.app` → VPS)

Один раз задеплой прокси: [`api-proxy/README.md`](api-proxy/README.md).  
URL прокси: `public/runtime-config.json` (можно менять без пересборки).

**Vercel (корень `sutekiplayereasy`, Edge `middleware.ts`):** в настройках проекта задайте **`BACKEND_ORIGIN=https://suteki-api-proxy.vercel.app`** (или другой рабочий HTTPS до API). Так первый запрос идёт в стабильный прокси, а не напрямую на VPS с Edge.

## Как пользоваться

- Найди аниме по названию или открой с `?shiki_id=` (Telegram WebApp).
- Озвучка и iframe Kodik — как раньше; поиск Kodik идёт через сервер (быстрее, без CORS, токен не в бандле).

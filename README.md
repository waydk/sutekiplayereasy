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
```

## Production

- Фронт: GitHub Pages (`deploy-pages.yml`).
- API: `sutekihub/backend` на `103.74.92.49`, HTTPS через cloudflared.
- Сборка задаёт `VITE_API_BASE` (секрет репозитория или URL в workflow).

## Как пользоваться

- Найди аниме по названию или открой с `?shiki_id=` (Telegram WebApp).
- Озвучка и iframe Kodik — как раньше; поиск Kodik идёт через сервер (быстрее, без CORS, токен не в бандле).

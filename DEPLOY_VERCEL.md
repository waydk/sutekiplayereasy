# Деплой на Vercel (фронт + API-прокси → VPS)

## В дашборде Vercel (рекомендуется)

1. [vercel.com/new](https://vercel.com/new) → Import **waydk/sutekiplayereasy**
2. **Root Directory:** `.` (корень репо)
3. Framework: **Vite** (подхватится из `vercel.json`)
4. **Environment variables:**
   - `BACKEND_ORIGIN` = `http://103-74-92-49.sslip.io:8765` (hostname вместо IP — Edge Vercel не ходит на голый IP)
5. Deploy

Сайт: `https://<project>.vercel.app` — API на том же домене: `/api/v1/…`

## Бэкенд на VPS

```bash
ssh sutekibot@103.74.92.49
~/sutekihub-api/deploy/run-api-public.sh
curl http://127.0.0.1:8765/health
```

## Telegram WebApp

В боте на VPS: `PLAYER_WEBAPP_BASE=https://sutekiplayereasy.vercel.app`

Параметры: `?shiki_id=21` или `?anime_id=21`

## CLI (после настройки команды в Vercel)

```bash
cd sutekiplayereasy
npx vercel link
npx vercel env add BACKEND_ORIGIN   # http://103-74-92-49.sslip.io:8765
npm run deploy:vercel
```

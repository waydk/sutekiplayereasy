# HTTPS-прокси к VPS (без TLS на сервере)

GitHub Pages отдаёт фронт по **HTTPS**. Бэкенд на VPS — **HTTP** `:8000`.  
Этот проект на **Vercel** даёт стабильный `https://….vercel.app` → `http://103.74.92.49:8765`.

## Один раз

1. [vercel.com](https://vercel.com) → Import `waydk/sutekiplayereasy`, **Root Directory**: `api-proxy`
2. Environment: `BACKEND_ORIGIN` = `http://103.74.92.49:8765`
3. Deploy → скопируй URL, например `https://suteki-api-proxy.vercel.app`
4. В репо `public/runtime-config.json`: `"apiBase": "https://….vercel.app/api/v1"`

Или CLI:

```bash
cd api-proxy
npx vercel --prod
# задай BACKEND_ORIGIN при первом деплое
```

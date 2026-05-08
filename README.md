# sutekiplayereasy

Статическая страница: **Shikimori ID → Kodik API → iframe** (без бэкенда).

## Запуск

```bash
cd sutekiplayereasy
npm install
npm run dev
```

## Как пользоваться

- Введи **Shikimori ID**, при необходимости **серию**, нажми **Найти**, затем **Открыть**.
- Токен Kodik **встроен в код**; поле «KODIK_TOKEN» — только если нужен другой ключ (сохраняется в `localStorage`).

## Ограничения

- Запрос к `kodikapi.com` из браузера может упираться в CORS в некоторых окружениях.

# Mindcore MiniApp Telegram Webhook Bot (Vercel)

Простой Telegram-бот на webhook для выдачи доступа в Mindcore SaaS через Supabase Edge Function `issue-access`.

## Что делает бот

- Работает **только** через Telegram webhook.
- Не использует long polling.
- Не использует Express.
- Не хранит логины/пароли у себя.
- Только вызывает `ISSUE_ACCESS_URL` и возвращает ответ пользователю.

## Структура

- `api/webhook.js` — Vercel serverless webhook endpoint.
- `package.json` — минимальные настройки проекта.

## Необходимые переменные окружения

Добавьте в Vercel Project Settings → Environment Variables:

- `BOT_TOKEN` — токен Telegram-бота.
- `ISSUE_ACCESS_URL` — URL вашего Supabase Edge Function `issue-access`.

Если хотя бы одной переменной нет, endpoint вернёт `500`.

## Деплой на Vercel

1. Создайте проект в Vercel из этого репозитория.
2. Добавьте переменные окружения `BOT_TOKEN` и `ISSUE_ACCESS_URL`.
3. Выполните деплой.

Webhook endpoint после деплоя:

`https://<vercel-project>.vercel.app/api/webhook`

## Установка Telegram webhook

Откройте в браузере (или curl):

`https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<vercel-project>.vercel.app/api/webhook`

Пример:

```bash
curl "https://api.telegram.org/bot123456:ABCDEF/setWebhook?url=https://my-project.vercel.app/api/webhook"
```

## Локальный запуск (опционально)

```bash
npm install
npm run start
```

> Для локальной проверки webhook используйте публичный URL (например, через tunnel), затем установите его через `setWebhook`.

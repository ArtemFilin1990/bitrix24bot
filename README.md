# Bitrix24 AI Bot

Внутренний ИИ-ассистент для Bitrix24 на базе Cloudflare Workers и Google Gemini 2.5 Flash.

## Возможности

- 🤖 ИИ-ответы через Google Gemini 2.5 Flash
- 📦 Поиск по каталогу подшипников (D1 SQLite)
- 💬 История диалогов (KV storage)
- 🔧 Интеграция с CRM Bitrix24
- ☁️ Бессерверная архитектура на Cloudflare Workers

## Быстрый старт

Полные инструкции: [QUICKSTART.md](QUICKSTART.md)

Для деплоя потребуются следующие секреты:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put IMPORT_SECRET
wrangler secret put WORKER_HOST
wrangler secret put B24_APP_TOKEN
wrangler secret put BITRIX_WEBHOOK_URL
```

## Структура

```
b24-imbot/worker.js    # Cloudflare Worker (основной файл)
migrations/            # D1 миграции (применять через wrangler d1 migrations apply)
tests/                 # Тесты и verify-скрипты
```

## Деплой

```bash
npm install
wrangler deploy
```

Применить D1-схему:

```bash
wrangler d1 migrations apply bearings-catalog --remote
```

## Документация

- [QUICKSTART.md](QUICKSTART.md) — быстрый старт
- [DEPLOYMENT.md](DEPLOYMENT.md) — подробные инструкции по деплою

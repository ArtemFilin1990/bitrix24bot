# bitrix24bot

# b24-imbot — Setup Guide

## Структура
```
b24-imbot/
├── worker.js     — Cloudflare Worker (бот + Gemini + B24 REST)
└── wrangler.toml — конфиг деплоя (с KV binding)
```

---

## Шаг 1 — Создать KV namespace (хранение истории)

```bash
wrangler kv:namespace create CHAT_HISTORY
# → Скопировать id в wrangler.toml → kv_namespaces[0].id
```

---

## Шаг 2 — Деплой

```bash
wrangler secret put GEMINI_API_KEY    # aistudio.google.com (бесплатно)
wrangler secret put B24_PORTAL        # your-portal.bitrix24.ru
wrangler secret put B24_USER_ID       # ID пользователя REST
wrangler secret put B24_TOKEN         # токен входящего webhook
wrangler secret put WORKER_HOST       # b24-imbot.YOUR.workers.dev

wrangler deploy
```

---

## Шаг 3 — Зарегистрировать бота в B24

Открыть в браузере (один раз):
```
https://b24-imbot.YOUR.workers.dev/register
```

Ответ вернёт `bot_id`. Сохранить:
```bash
wrangler secret put BOT_ID   # число из ответа /register
wrangler deploy               # передеплой с BOT_ID
```

---

## Шаг 4 — Найти бота в B24

```
Мессенджер B24 → поиск → "ИИ-помощник Эверест" → написать /start
```

---

## Команды бота

| Команда | Действие |
|---|---|
| `/start` или `помощь` | Показать список возможностей |
| `/сброс` | Очистить историю диалога |
| `мои сделки` | Активные сделки менеджера |
| `найди сделку [название]` | Поиск по CRM |
| `данные сделки [ID]` | Полная карточка сделки |
| `аналог [артикул]` | Вопрос по каталогу подшипников |

---

## Риски

| Риск | Решение |
|---|---|
| `imbot.register` уже зарегистрирован | Вызвать `imbot.unregister` → повторить |
| BOT_ID не задан → ошибка отправки | `wrangler secret put BOT_ID` после /register |
| KV id не вставлен → история не сохраняется | Вставить id в wrangler.toml |
| Gemini 15 req/min превышен | Добавить задержку или rate limit в Worker |
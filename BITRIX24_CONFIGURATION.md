# Полная настройка Bitrix24 бота на Cloudflare Workers

Бот «ИИ-помощник Эверест» разворачивается на стеке **Cloudflare Workers + D1 + KV + Gemini 2.5 Flash + Bitrix24 REST API**. Это руководство проводит через десять этапов — от регистрации аккаунтов до работающего бота в чате Bitrix24.

> Время настройки: **30–60 минут** при наличии облачного портала Bitrix24 на коммерческом тарифе.

---

## 1) Создание и настройка аккаунта Cloudflare

### Регистрация

Откройте:

- `https://dash.cloudflare.com/sign-up/workers-and-pages`

Создайте аккаунт Cloudflare. Для старта обычно хватает бесплатного плана Workers.

### Получение Account ID

Получить Account ID можно так:

- из URL после `https://dash.cloudflare.com/`;
- на главной странице аккаунта в блоке API;
- через меню аккаунта (`⋮` → `Copy account ID`).

Сохраните `ACCOUNT_ID` — он нужен для деплоя и CI/CD.

### Создание API-токена

Откройте:

- `https://dash.cloudflare.com/profile/api-tokens`

Создайте `Custom token` и выдайте права:

- `Account → Workers Scripts → Edit`
- `Account → D1 → Edit`
- `Account → Workers KV Storage → Edit`

В `Account Resources` укажите нужный аккаунт, сохраните токен и запишите его сразу (показывается один раз).

---

## 2) Установка Wrangler CLI и авторизация

### Установка Wrangler 4

Требуется Node.js 18+.

```bash
# Глобально
npm install -g wrangler@latest

# Локально в проекте (предпочтительно)
npm install -D wrangler@latest
```

### Авторизация

```bash
npx wrangler login
```

Для CI/CD:

```bash
export CLOUDFLARE_API_TOKEN=<your_token>
export CLOUDFLARE_ACCOUNT_ID=<your_account_id>
```

### Проверка

```bash
npx wrangler --version
npx wrangler whoami
```

### Важно про Wrangler 4

- `wrangler publish` заменён на `wrangler deploy`.
- Для D1/KV/R2 многие команды локальные по умолчанию.
- Для работы с production-ресурсами используйте `--remote`.

---

## 3) Создание базы данных Cloudflare D1

### Создание базы

База данных уже описана в `wrangler.toml` как `bearings-catalog` с binding `CATALOG`. Если создаёте с нуля:

```bash
npx wrangler d1 create bearings-catalog
```

В `wrangler.toml` это выглядит так (уже настроено в проекте):

```toml
[[d1_databases]]
binding = "CATALOG"
database_name = "bearings-catalog"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"
```

### Применение миграций

В проекте настроен `migrations_dir = "migrations"` — всегда используйте `wrangler d1 migrations apply`:

```bash
# Локально
npx wrangler d1 migrations apply bearings-catalog

# Продакшн
npx wrangler d1 migrations apply bearings-catalog --remote
```

---

## 4) Создание Cloudflare KV namespace

```bash
npx wrangler kv namespace create CHAT_HISTORY
```

В `wrangler.toml` это выглядит так (уже настроено в проекте):

```toml
[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Использование в коде:

- `env.CHAT_HISTORY.get(key)`
- `env.CHAT_HISTORY.put(key, value)`

### Пример `wrangler.toml`

```toml
name = "bitrix24bot"
main = "b24-imbot/worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[[d1_databases]]
binding = "CATALOG"
database_name = "bearings-catalog"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"

[vars]
BOT_ID    = "0"
CLIENT_ID = "your_client_id"
GEMINI_MODEL = "gemini-2.5-flash"
```

---

## 5) Получение Google Gemini API Key

1. Откройте `https://aistudio.google.com`.
2. Перейдите в `Get API key`.
3. Нажмите `Create API key`.
4. Скопируйте ключ (обычно начинается с `AIza...`).

Практически полезно сразу проверить лимиты проекта:

- `https://aistudio.google.com/rate-limit`

---

## 6) Настройка входящего вебхука в Bitrix24

Путь в облачном Bitrix24:

- `Приложения → Разработчикам → Готовые сценарии → Другое → Входящий вебхук`

Выдайте права:

- `imbot` (обязательно)
- `im` (обязательно)
- `crm` (опционально, если нужен доступ к CRM)

Пример webhook URL:

```text
https://<portal>.bitrix24.ru/rest/1/<token>/
```

Не публикуйте этот URL в репозитории и логах.

---

## 7) Установка секретов через Wrangler

Воркер читает следующие секреты (имена должны совпадать точно):

```bash
npx wrangler secret put GEMINI_API_KEY      # Google Gemini API ключ
npx wrangler secret put B24_PORTAL          # URL портала: https://<portal>.bitrix24.ru
npx wrangler secret put B24_USER_ID         # ID пользователя REST-вебхука
npx wrangler secret put B24_TOKEN           # Токен REST-вебхука
npx wrangler secret put B24_APP_TOKEN       # Токен приложения (обязателен для /register)
npx wrangler secret put IMPORT_SECRET       # Секрет для защиты admin-эндпоинтов
npx wrangler secret put WORKER_HOST         # Домен воркера (без https://), напр.: bitrix24bot.workers.dev
```

Проверка:

```bash
npx wrangler secret list
```

Локальная разработка (`.dev.vars`):

```env
GEMINI_API_KEY=AIza...your_key
B24_PORTAL=https://<portal>.bitrix24.ru
B24_USER_ID=1
B24_TOKEN=<rest_webhook_token>
B24_APP_TOKEN=<app_token>
IMPORT_SECRET=<your_import_secret>
WORKER_HOST=bitrix24bot.workers.dev
```

Убедитесь, что `.dev.vars` в `.gitignore`.

---

## 8) Деплой Worker на Cloudflare

```bash
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot
npm install
npx wrangler deploy
```

После деплоя примените миграции в удалённой D1:

```bash
npx wrangler d1 migrations apply bearings-catalog --remote
```

Проверки:

```bash
# Проверка статуса воркера (endpoint защищён секретом)
curl "https://<worker>.workers.dev/status?secret=<IMPORT_SECRET>"
npx wrangler tail
npx wrangler versions list
```

---

## 9) Регистрация бота в Bitrix24 через `/register`

```bash
curl "https://<worker>.workers.dev/register?secret=<IMPORT_SECRET>"
```

Endpoint защищён `IMPORT_SECRET` и требует GET-запроса с query-параметром `secret`.

Внутри вызывается `imbot.v2.Bot.register` — для этого **обязателен** секрет `B24_APP_TOKEN`.

Ключевые параметры регистрации (из кода воркера):

- Код бота: `everest_imbot_v2`
- Webhook: `https://<WORKER_HOST>/imbot`
- Токен: `B24_APP_TOKEN`
- Автоматически регистрируются команды: `/подшипник`, `/аналог`, `/статус`

В ответе приходит числовой `BOT_ID`, который нужно сохранить в `wrangler.toml` в секции `[vars]` (`BOT_ID`).

---

## 10) Финальная проверка

### Проверка endpoint статуса

Endpoint `/status` защищён `IMPORT_SECRET`:

```bash
curl "https://<worker>.workers.dev/status?secret=<IMPORT_SECRET>"
```

### Проверка в Bitrix24

1. Найдите бота в мессенджере.
2. Отправьте тестовое сообщение.
3. Если бот не отвечает, откройте логи:

```bash
npx wrangler tail
```

---

## Типовые проблемы

- Бот не отображается: повторите `/register`, проверьте права `imbot`.
- `ACCESS_DENIED: Client ID not specified`: проверьте `CLIENT_ID` в `[vars]` в `wrangler.toml`.
- `QUERY_LIMIT_EXCEEDED`: превышен лимит Bitrix24 API, добавьте throttling/очередь.
- Ошибки D1: убедитесь, что миграции применялись с `--remote`.
- Gemini не отвечает: проверьте лимиты проекта в AI Studio.

---

## Команды для быстрого старта

```bash
# 1) Wrangler
npm install -g wrangler@latest
wrangler login
wrangler whoami

# 2) Проект
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot
npm install

# 3) Ресурсы (если создаёте с нуля — уже описаны в wrangler.toml)
npx wrangler d1 create bearings-catalog
npx wrangler kv namespace create CHAT_HISTORY

# 4) Секреты
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put B24_PORTAL
npx wrangler secret put B24_USER_ID
npx wrangler secret put B24_TOKEN
npx wrangler secret put B24_APP_TOKEN
npx wrangler secret put IMPORT_SECRET
npx wrangler secret put WORKER_HOST

# 5) Миграции и деплой
npx wrangler d1 migrations apply bearings-catalog --remote
npx wrangler deploy

# 6) Регистрация бота
curl "https://<worker>.workers.dev/register?secret=<IMPORT_SECRET>"

# 7) Проверка статуса
curl "https://<worker>.workers.dev/status?secret=<IMPORT_SECRET>"
```

Готово: бот работает в serverless-режиме, масштабируется автоматически и не требует отдельного сервера.

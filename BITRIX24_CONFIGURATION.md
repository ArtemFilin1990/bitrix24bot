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

```bash
npx wrangler d1 create bitrix24bot-db
```

Добавьте binding в `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "bitrix24bot-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Применение схемы

```bash
# Локально
npx wrangler d1 execute bitrix24bot-db --local --file=./schema.sql

# Продакшн
npx wrangler d1 execute bitrix24bot-db --remote --file=./schema.sql
```

---

## 4) Создание Cloudflare KV namespace

```bash
npx wrangler kv namespace create CACHE
```

Добавьте в `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "06779da6940b431db6e566b4846d64db"
```

Использование в коде:

- `env.CACHE.get(key)`
- `env.CACHE.put(key, value)`

### Пример `wrangler.toml`

```toml
name = "bitrix24bot"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "bitrix24bot-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

[[kv_namespaces]]
binding = "CACHE"
id = "06779da6940b431db6e566b4846d64db"

[vars]
BOT_NAME = "ИИ-помощник Эверест"
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

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put BITRIX24_WEBHOOK_URL
npx wrangler secret put BITRIX24_CLIENT_ID
```

Проверка:

```bash
npx wrangler secret list
```

Локальная разработка (`.dev.vars`):

```env
GEMINI_API_KEY=AIza...your_key
BITRIX24_WEBHOOK_URL=https://<portal>.bitrix24.ru/rest/1/<token>/
BITRIX24_CLIENT_ID=everest_bot_client_001
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

После деплоя выполните миграции в удалённой D1:

```bash
npx wrangler d1 execute bitrix24bot-db --remote --file=./schema.sql
```

Проверки:

```bash
curl https://<worker>.workers.dev
npx wrangler tail
npx wrangler versions list
```

---

## 9) Регистрация бота в Bitrix24 через `/register`

```bash
curl -X POST https://<worker>.workers.dev/register
```

Ожидаемо внутри вызывается `imbot.register` на вашем Bitrix24 webhook URL.

Ключевые параметры регистрации:

- `CODE=everest_bot`
- `TYPE=B`
- `EVENT_HANDLER=https://<worker>.workers.dev/webhook`
- `CLIENT_ID=everest_bot_client_001`
- `PROPERTIES[NAME]=ИИ-помощник Эверест`

В ответе приходит числовой `BOT_ID`, который нужно сохранить (например, в KV).

---

## 10) Финальная проверка

### Проверка endpoint статуса

```bash
curl https://<worker>.workers.dev/status
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
- `ACCESS_DENIED: Client ID not specified`: проверьте `BITRIX24_CLIENT_ID`.
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

# 3) Ресурсы
npx wrangler d1 create bitrix24bot-db
npx wrangler kv namespace create CACHE

# 4) Секреты
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put BITRIX24_WEBHOOK_URL
npx wrangler secret put BITRIX24_CLIENT_ID

# 5) Миграции и деплой
npx wrangler d1 execute bitrix24bot-db --remote --file=./schema.sql
npx wrangler deploy

# 6) Регистрация бота
curl -X POST https://<worker>.workers.dev/register

# 7) Проверка статуса
curl https://<worker>.workers.dev/status
```

Готово: бот работает в serverless-режиме, масштабируется автоматически и не требует отдельного сервера.

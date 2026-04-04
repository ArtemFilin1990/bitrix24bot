# Полная настройка Bitrix24 бота на Cloudflare Workers

Бот «ИИ-помощник Эверест» разворачивается на стеке Cloudflare Workers + D1 + KV + Gemini 2.5 Flash + Bitrix24 REST API. Это руководство проведёт вас через все десять этапов — от регистрации аккаунтов до работающего бота в чате Bitrix24. Каждый шаг содержит точные команды, URL-адреса и параметры, актуальные на 2025–2026 год. Весь процесс занимает **30–60 минут** при условии, что у вас уже есть облачный портал Bitrix24 на коммерческом тарифе.

> **Примечание**: этот гайд описывает общий процесс развёртывания. Реальная конфигурация проекта использует биндинги `CATALOG` (D1) и `CHAT_HISTORY` (KV), секреты `B24_PORTAL` + `B24_USER_ID` + `B24_TOKEN` и входную точку `b24-imbot/worker.js`. См. `wrangler.toml` и `CLAUDE.md` для актуальных значений.

---

## 1. Создание и настройка аккаунта Cloudflare

### Регистрация

Перейдите на **https://dash.cloudflare.com/sign-up/workers-and-pages** и создайте бесплатный аккаунт. Бесплатный план Workers Free включает **100 000 запросов в день**, базу D1 объёмом до 5 ГБ и KV с 100 000 операций чтения в день — этого более чем достаточно для корпоративного чат-бота.

### Получение Account ID

После входа в дашборд найдите Account ID одним из трёх способов:

- **Из URL браузера**: строка после `https://dash.cloudflare.com/` — это ваш Account ID
- **Из главной страницы аккаунта**: раздел **API** в нижней части страницы
- **Через меню**: нажмите кнопку **⋮** рядом с именем аккаунта → **Copy account ID**

Запишите Account ID — он понадобится для CI/CD и настройки переменных окружения.

### Создание API-токена с нужными правами

Перейдите в **https://dash.cloudflare.com/profile/api-tokens** → **Create Token** → **Custom token**. Задайте имя (например, `Workers-D1-KV-Deploy`) и добавьте три разрешения:

- **Account → Workers Scripts → Edit** — деплой воркеров
- **Account → D1 → Edit** — создание и управление базами D1
- **Account → Workers KV Storage → Edit** — создание и управление KV

В разделе **Account Resources** выберите конкретный аккаунт. Нажмите **Continue to summary → Create Token**. **Скопируйте токен немедленно** — он показывается только один раз.

> **Примечание**: при использовании `wrangler login` (OAuth-поток) токен создаётся автоматически. Ручное создание токена нужно только для CI/CD пайплайнов.

---

## 2. Установка Wrangler CLI и авторизация

### Установка Wrangler 4

Wrangler 4 вышел **13 марта 2025** и является текущей стабильной версией. Требует **Node.js 18+**.

```bash
# Глобальная установка
npm install -g wrangler@latest

# Или локально в проект (рекомендуется)
npm install -D wrangler@latest
```

### Авторизация

```bash
npx wrangler login
```

Для CI/CD вместо `wrangler login` используйте переменные окружения:

```bash
export CLOUDFLARE_API_TOKEN=ваш_токен
export CLOUDFLARE_ACCOUNT_ID=ваш_account_id
```

### Проверка

```bash
npx wrangler --version
npx wrangler whoami
```

### Ключевые отличия Wrangler 4 от 3

**Все команды D1, KV, R2 теперь по умолчанию работают локально** — для работы с продакшн-ресурсами нужно явно указывать флаг `--remote`. Команда `wrangler publish` удалена — используйте `wrangler deploy`. Минимальная версия Node.js поднята до 18.

---

## 3. Создание базы данных Cloudflare D1

### Создание базы

```bash
npx wrangler d1 create bearings-catalog
```

В `wrangler.toml` этого проекта используется:

```toml
[[d1_databases]]
binding = "CATALOG"
database_name = "bearings-catalog"
database_id = "ваш-database-id"
migrations_dir = "migrations"
```

### Инициализация схемы

```bash
# Локально (для разработки)
npx wrangler d1 migrations apply bearings-catalog --local

# На продакшне (обязательно --remote в Wrangler 4!)
npx wrangler d1 migrations apply bearings-catalog --remote
```

> **Важно**: в Wrangler 4 команда `d1 execute` по умолчанию работает **локально**. Забыть `--remote` — самая частая ошибка.

---

## 4. Создание Cloudflare KV namespace

```bash
npx wrangler kv namespace create CHAT_HISTORY
```

В `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "ваш-kv-id"
```

В коде Worker обращается к KV через `env.CHAT_HISTORY.get(key)` и `env.CHAT_HISTORY.put(key, value)`.

---

## 5. Получение Google Gemini API Key

### Регистрация в Google AI Studio

Перейдите на **https://aistudio.google.com** и войдите под Google-аккаунтом.

### Создание API-ключа

1. В левом меню нажмите **Get API key**
2. Нажмите **Create API key**
3. Выберите Google Cloud Project
4. **Скопируйте ключ** — он начинается с `AIza...`

### Лимиты бесплатного тарифа Gemini 2.5 Flash

| Параметр | Бесплатный тариф |
|----------|-----------------|
| **Запросов в минуту (RPM)** | 10 |
| **Токенов в минуту (TPM)** | 250 000 |
| **Запросов в день (RPD)** | 250–500 |

Актуальные лимиты: **https://aistudio.google.com/rate-limit**

Бот использует `thinkingBudget: 2048` для улучшения качества ответов по каталогам и спецификациям подшипников.

---

## 6. Настройка входящего вебхука в Bitrix24

### Создание вебхука

В облачном Bitrix24: **Приложения → Разработчикам → вкладка «Готовые сценарии» → Другое → Входящий вебхук**.

> **Предусловие**: функция вебхуков доступна только на коммерческих тарифах.

### Настройка прав доступа

- **imbot** — создание и управление чат-ботами (обязательно)
- **im** — мессенджер, работа с чатами (обязательно)
- **crm** — доступ к CRM (для интеграции бота с CRM)

### Формат URL вебхука

```
https://ваш-портал.bitrix24.ru/rest/{USER_ID}/{TOKEN}/
```

| Компонент | Значение |
|-----------|----------|
| `{USER_ID}` | ID пользователя, создавшего вебхук → секрет `B24_USER_ID` |
| `{TOKEN}` | Секретный ключ → секрет `B24_TOKEN` |
| Портал | Домен → секрет `B24_PORTAL` |

### Ограничения

Облачный Bitrix24 допускает **2 запроса в секунду** на вебхук.

---

## 7. Установка секретов через Wrangler

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put B24_PORTAL        # https://ваш-портал.bitrix24.ru
npx wrangler secret put B24_USER_ID       # числовой ID из URL вебхука
npx wrangler secret put B24_TOKEN         # токен из URL вебхука
npx wrangler secret put B24_APP_TOKEN     # токен приложения (для imbot.v2 API)
npx wrangler secret put IMPORT_SECRET     # секрет для админских эндпоинтов
npx wrangler secret put WORKER_HOST       # домен воркера (для регистрации бота)
```

### Локальная разработка

Создайте файл `.dev.vars` (уже в `.gitignore`):

```env
GEMINI_API_KEY=AIzaSy...
B24_PORTAL=https://ваш-портал.bitrix24.ru
B24_USER_ID=1
B24_TOKEN=seycsj9qf5hbgrua
IMPORT_SECRET=ваш_секрет
WORKER_HOST=bitrix24bot.ваш-субдомен.workers.dev
```

---

## 8. Деплой Worker на Cloudflare

```bash
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot
npm install
npx wrangler deploy
```

### Применение миграций к продакшн-базе D1

```bash
npx wrangler d1 migrations apply bearings-catalog --remote
```

---

## 9. Регистрация бота в Bitrix24 через /register endpoint

```bash
curl "https://bitrix24bot.ваш-субдомен.workers.dev/register?secret=ВАШ_IMPORT_SECRET"
```

Worker вызывает `imbot.register` / `imbot.v2.Bot.register` и автоматически регистрирует слэш-команды (`/подшипник`, `/аналог`, `/статус`).

### Поток сообщений после регистрации

```
Пользователь пишет боту в чате Bitrix24
        ↓
Bitrix24 отправляет POST на /imbot (EVENT_HANDLER)
        ↓
Worker → ONIMBOTJOINCHAT: приветственное сообщение
Worker → ONIMBOTMESSAGEADD: обработка через Gemini
Worker → ONIMCOMMANDADD: слэш-команды
        ↓
Gemini 2.5 Flash + function calling (до 8 итераций)
        ↓
Ответ бота в BB-code → imbot.message.add → чат Bitrix24
```

---

## 10. Проверка статуса и финальное тестирование

```bash
curl "https://bitrix24bot.ваш-субдомен.workers.dev/status?secret=ВАШ_IMPORT_SECRET"
```

Ожидаемый ответ:

```json
{
  "status": "ok",
  "bot_id": "1279",
  "worker": "bitrix24bot",
  "database": "connected",
  "kv": "connected",
  "gemini": "configured",
  "bitrix24": "configured"
}
```

### Типичные проблемы

- **Бот не появляется** — `/register` не был вызван или вебхук без прав `imbot`
- **`ACCESS_DENIED`** — не установлен `B24_APP_TOKEN` или `CLIENT_ID`
- **`QUERY_LIMIT_EXCEEDED`** — превышен лимит 2 RPS Bitrix24
- **Gemini не отвечает** — проверьте лимит на https://aistudio.google.com/rate-limit
- **Таблицы не найдены** — забыли `--remote` при миграциях

---

## Итоговая сводка

```bash
# 1. Установить Wrangler и авторизоваться
npm install -g wrangler@latest
wrangler login

# 2. Клонировать проект
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot && npm install

# 3. Установить секреты
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put B24_PORTAL
npx wrangler secret put B24_USER_ID
npx wrangler secret put B24_TOKEN
npx wrangler secret put B24_APP_TOKEN
npx wrangler secret put IMPORT_SECRET
npx wrangler secret put WORKER_HOST

# 4. Применить миграции и задеплоить
npx wrangler d1 migrations apply bearings-catalog --remote
npx wrangler deploy

# 5. Зарегистрировать бота
curl "https://bitrix24bot.ваш-субдомен.workers.dev/register?secret=ВАШ_SECRET"

# 6. Проверить статус
curl "https://bitrix24bot.ваш-субдомен.workers.dev/status?secret=ВАШ_SECRET"
```

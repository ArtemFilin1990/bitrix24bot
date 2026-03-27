# Развертывание и запуск бота Bitrix24

## Обзор

Этот документ описывает процесс развертывания и запуска ИИ-бота для Bitrix24 на платформе Cloudflare Workers.

## Архитектура

```
┌─────────────────┐
│   Bitrix24 IM   │
│   (вебхук)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Cloudflare Worker          │
│  (worker.js)                │
│  ┌──────────────────────┐   │
│  │ askGemini()          │   │
│  │ ↓                    │   │
│  │ Gemini 2.5 Flash API │   │
│  └──────────────────────┘   │
└────┬────────────────────┬───┘
     │                    │
     ▼                    ▼
┌─────────────┐    ┌──────────────┐
│ D1 Database │    │ KV Namespace │
│ (SQLite)    │    │ (История)    │
└─────────────┘    └──────────────┘
```

## Предварительные требования

### 1. Аккаунт Cloudflare

- Зарегистрируйтесь на [Cloudflare](https://dash.cloudflare.com/)
- Создайте API токен с правами:
  - Workers Scripts:Edit
  - Workers KV Storage:Edit
  - D1:Edit

### 2. Установленное ПО

- Node.js 24+
- Python 3.9+
- Git
- Wrangler CLI 4.76.0

```bash
npm install -g wrangler@4.76.0
```

### 3. Bitrix24 Portal

- Активный портал Bitrix24
- Права администратора для создания приложений
- Вебхук для REST API

## Структура секретов

Для работы бота требуются следующие секреты:

| Секрет | Описание | Где получить |
|--------|----------|--------------|
| `GEMINI_API_KEY` | API ключ Google Gemini | [Google AI Studio](https://makersuite.google.com/app/apikey) |
| `B24_PORTAL` | URL портала Bitrix24 | https://your-portal.bitrix24.ru |
| `B24_USER_ID` | ID пользователя для REST API | Профиль → ID |
| `B24_TOKEN` | Токен REST API | Настройки → REST API |
| `IMPORT_SECRET` | Секрет для защиты эндпоинтов импорта | Сгенерируйте случайную строку |
| `WORKER_HOST` | Домен Worker | subdomain.workers.dev |
| `B24_APP_TOKEN` | Токен приложения (опционально) | Приложения → Создать |

## Установка секретов

### Локально

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put IMPORT_SECRET
wrangler secret put WORKER_HOST
```

### В GitHub Actions

1. Перейдите в Settings → Secrets and variables → Actions
2. Добавьте следующие секреты:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `GEMINI_API_KEY`
   - `B24_PORTAL`
   - `B24_USER_ID`
   - `B24_TOKEN`
   - `IMPORT_SECRET`

## Создание ресурсов Cloudflare

### 1. D1 Database

```bash
# Создать базу данных
wrangler d1 create bearings-catalog

# Скопируйте database_id из вывода и обновите wrangler.toml
```

### 2. KV Namespace

```bash
# Создать KV namespace для истории чата
wrangler kv:namespace create "CHAT_HISTORY"

# Скопируйте id из вывода и обновите wrangler.toml
```

### 3. Обновите wrangler.toml

```toml
[[d1_databases]]
binding = "CATALOG"
database_name = "bearings-catalog"
database_id = "ваш-database-id"

[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "ваш-kv-namespace-id"
```

## Процесс развертывания

### Метод 1: Автоматический скрипт (рекомендуется)

Используйте скрипт `run-bot.sh` для автоматической установки:

```bash
# Полная установка (деплой + загрузка данных + регистрация)
./run-bot.sh full

# Или отдельные шаги:
./run-bot.sh deploy    # Только деплой Worker
./run-bot.sh seed      # Только загрузка данных
./run-bot.sh register  # Только регистрация бота
```

### Метод 2: Через GitHub Actions

1. **Деплой Worker** - автоматически при push в `main`:
   ```bash
   git push origin main
   ```

2. **Загрузка данных** - ручной запуск workflow `seed-database.yml`:
   - GitHub → Actions → Seed Database → Run workflow

3. **Регистрация бота** - автоматически выполняется в `seed-database.yml`

### Метод 3: Пошаговая установка вручную

#### Шаг 1: Деплой Worker

```bash
# Из корня репозитория
wrangler deploy
```

#### Шаг 2: Применить схему базы данных

```bash
wrangler d1 execute bearings-catalog --file schema.sql --remote
```

#### Шаг 3: Загрузить данные о подшипниках

```bash
# Клонировать источник данных
git clone https://github.com/ArtemFilin1990/BearingsInfo.git /tmp/BearingsInfo

# Сгенерировать SQL
python3 scripts/build_bearings_seed.py \
  --source-dir /tmp/BearingsInfo \
  --output /tmp/bearings.seed.sql \
  --source-repo ArtemFilin1990/BearingsInfo \
  --source-snapshot $(git -C /tmp/BearingsInfo rev-parse HEAD)

# Загрузить в D1
wrangler d1 execute bearings-catalog --file /tmp/bearings.seed.sql --remote
```

#### Шаг 4: Загрузить базу знаний

```bash
# Клонировать источник данных
git clone https://github.com/ArtemFilin1990/knowledge-base.git /tmp/knowledge-base

# Сгенерировать SQL
python3 scripts/build_kb_seed.py \
  --source-dir /tmp/knowledge-base \
  --output /tmp/kb.seed.sql \
  --source-repo ArtemFilin1990/knowledge-base \
  --source-snapshot $(git -C /tmp/knowledge-base rev-parse HEAD)

# Загрузить в D1
wrangler d1 execute bearings-catalog --file /tmp/kb.seed.sql --remote
```

#### Шаг 5: Зарегистрировать бота в Bitrix24

```bash
# Получите URL вашего Worker
WORKER_URL=$(wrangler deployments list | grep "https://" | awk '{print $1}')

# Зарегистрируйте бота (замените YOUR_IMPORT_SECRET)
curl "${WORKER_URL}/register?secret=YOUR_IMPORT_SECRET"
```

## Проверка развертывания

### 1. Проверить статус Worker

```bash
wrangler deployments list
```

### 2. Проверить данные в D1

```bash
# Проверить количество записей
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM catalog"
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM kb_documents"
```

Или используйте workflow `check-db.yml`:

```bash
# GitHub → Actions → Check Database → Run workflow
```

### 3. Проверить логи Worker

```bash
wrangler tail
```

### 4. Тестовый запрос

```bash
curl -X POST "https://your-worker.workers.dev/imbot" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Работа с данными

### Обновление данных через inbox/

Самый простой способ добавить данные:

1. Поместите файлы в соответствующую папку `inbox/`:
   - `inbox/docs/` - документы Markdown
   - `inbox/catalog/` - CSV файлы каталога
   - `inbox/analogs/` - CSV файлы аналогов
   - `inbox/brands/` - CSV файлы брендов

2. Закоммитьте и запушьте в `main`:
   ```bash
   git add inbox/
   git commit -m "feat: add new catalog items"
   git push origin main
   ```

3. GitHub Actions автоматически обработает файлы и загрузит в D1

### Импорт данных через API

Бот предоставляет несколько эндпоинтов для импорта (требуется `IMPORT_SECRET`):

```bash
# Импорт каталога из CSV
curl "https://your-worker.workers.dev/import-catalog-csv?secret=SECRET&file_id=123"

# Импорт документа
curl "https://your-worker.workers.dev/import-doc?secret=SECRET&file_id=456"

# Импорт аналогов
curl "https://your-worker.workers.dev/import-analogs?secret=SECRET&file_id=789"
```

## Эндпоинты бота

| Эндпоинт | Метод | Описание |
|----------|-------|----------|
| `/imbot` | POST | Основной вебхук для Bitrix24 |
| `/register` | GET | Регистрация бота в Bitrix24 |
| `/reset` | POST | Сброс истории диалога |
| `/import-catalog` | GET | Импорт каталога из CSV |
| `/import-catalog-csv` | GET | Импорт расширенного CSV |
| `/import-catalog-crm` | GET | Импорт из каталога CRM |
| `/import-doc` | GET | Импорт документа Markdown |
| `/import-doc-bulk` | POST | Массовый импорт документов |
| `/import-brands-bulk` | POST | Массовый импорт брендов |
| `/import-analogs` | GET | Импорт аналогов |
| `/discover-catalog` | GET | Список доступных каталогов |
| `/preview-file` | GET | Предпросмотр файла |

## Настройка в Bitrix24

### 1. Создание приложения

1. Перейдите в Applications → Create Application
2. Заполните информацию о приложении:
   - Name: "Эксперт по подшипникам"
   - Description: "ИИ-консультант по подшипникам"
3. Добавьте права:
   - `im` - доступ к чату
   - `crm` - доступ к CRM
4. Установите webhook URL: `https://your-worker.workers.dev/imbot`

### 2. Регистрация бота

После деплоя выполните:

```bash
curl "https://your-worker.workers.dev/register?secret=YOUR_IMPORT_SECRET"
```

Скопируйте полученный `BOT_ID` и обновите `wrangler.toml`:

```toml
[vars]
BOT_ID = "1267"
```

### 3. Настройка вебхука

В Bitrix24:
1. Настройки → Интеграция → Боты
2. Найдите вашего бота
3. Добавьте команды и события

## Мониторинг и логирование

### Просмотр логов в реальном времени

```bash
wrangler tail --format pretty
```

### Просмотр метрик

```bash
wrangler deployments view
```

### Cloudflare Dashboard

1. Перейдите в [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Workers & Pages → bitrix24bot
3. Просмотрите метрики, логи и аналитику

## Тестирование

### Запуск тестов

```bash
# Python тесты
python3 -m unittest discover tests/ -v

# Или используйте pytest
pytest tests/ -v
```

### Тест функциональности бота

1. Откройте чат с ботом в Bitrix24
2. Отправьте тестовое сообщение: "6205"
3. Бот должен ответить с информацией о подшипнике

## Устранение неполадок

### Бот не отвечает

1. Проверьте логи Worker:
   ```bash
   wrangler tail
   ```

2. Проверьте секреты:
   ```bash
   wrangler secret list
   ```

3. Убедитесь, что вебхук настроен в Bitrix24

### Ошибки базы данных

1. Проверьте, что схема применена:
   ```bash
   wrangler d1 execute bearings-catalog --command "SELECT name FROM sqlite_master WHERE type='table'"
   ```

2. Пересоздайте схему если нужно:
   ```bash
   wrangler d1 execute bearings-catalog --file schema.sql --remote
   ```

### Ошибки Gemini API

1. Проверьте квоты в [Google AI Studio](https://makersuite.google.com/)
2. Убедитесь, что API ключ действителен
3. Проверьте формат запросов в логах

### Таймауты

Если Worker завершается по таймауту:
1. Проверьте использование `ctx.waitUntil()` для тяжелых операций
2. Оптимизируйте SQL запросы
3. Увеличьте лимиты в Cloudflare (платный план)

## Обновление бота

### Обновление кода

```bash
git pull origin main
wrangler deploy
```

### Обновление данных

```bash
# Через inbox
git add inbox/new-data.csv
git commit -m "feat: update catalog"
git push origin main

# Или ручной запуск workflow
# GitHub → Actions → Process Inbox → Run workflow
```

### Обновление схемы

```bash
# ВНИМАНИЕ: это удалит все данные
wrangler d1 execute bearings-catalog --file schema.sql --remote

# Затем перезагрузите данные
./run-bot.sh seed
```

## Безопасность

### Рекомендации

1. **Никогда не коммитьте секреты в Git**
2. **Используйте сложные `IMPORT_SECRET`**
3. **Регулярно ротируйте API ключи**
4. **Ограничьте права токенов Bitrix24**
5. **Используйте HTTPS для всех запросов**
6. **Мониторьте использование API (Gemini, Bitrix24)**

### Защита эндпоинтов импорта

Все эндпоинты импорта защищены `IMPORT_SECRET`:

```javascript
if (url.searchParams.get('secret') !== env.IMPORT_SECRET) {
  return new Response('Forbidden', { status: 403 });
}
```

## Полезные ссылки

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Bitrix24 REST API](https://dev.bitrix24.com/rest_help/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## Лицензия и поддержка

Для вопросов и поддержки обращайтесь к документации проекта или создавайте Issue в GitHub.

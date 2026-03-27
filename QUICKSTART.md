# 🚀 Быстрый старт: Запуск бота

## Для GitHub Actions (автоматический деплой)

### 1. Настройка секретов GitHub

Перейдите в Settings → Secrets and variables → Actions и добавьте:

```
CLOUDFLARE_API_TOKEN=ваш-токен
CLOUDFLARE_ACCOUNT_ID=ваш-account-id
GEMINI_API_KEY=ваш-gemini-api-key
IMPORT_SECRET=любая-случайная-строка
```

Остальные секреты (B24_PORTAL, B24_USER_ID, B24_TOKEN) установите через Wrangler:

```bash
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put WORKER_HOST
```

### 2. Запуск деплоя

```bash
# Просто запушьте в main
git push origin main

# Или запустите workflow вручную
GitHub → Actions → Deploy to Cloudflare Workers → Run workflow
```

### 3. Загрузка данных

```bash
GitHub → Actions → Seed Database → Run workflow
```

Готово! Бот работает.

---

## Для локального запуска

### 1. Установка и авторизация

```bash
# Установите Wrangler
npm install -g wrangler@4.76.0

# Авторизуйтесь в Cloudflare
wrangler login
```

### 2. Создание ресурсов (автоматически)

Скрипт `setup` создаёт D1 базу данных и KV хранилище, обновляет `wrangler.toml`
и запрашивает все необходимые секреты:

```bash
./run-bot.sh setup
```

Скрипт запросит значения секретов интерактивно:
- `GEMINI_API_KEY` — ключ из [Google AI Studio](https://makersuite.google.com/)
- `B24_PORTAL` — URL портала Bitrix24 (например, `company.bitrix24.ru`)
- `B24_USER_ID` — ID пользователя для REST API
- `B24_TOKEN` — токен REST API Bitrix24
- `IMPORT_SECRET` — любая случайная строка для защиты эндпоинтов
- `WORKER_HOST` — домен воркера (например, `bitrix24bot.xxx.workers.dev`)

<details>
<summary>Или создание ресурсов вручную</summary>

```bash
# Создать D1 базу данных
wrangler d1 create bearings-catalog
# Скопируйте database_id из вывода в wrangler.toml

# Создать KV namespace
wrangler kv namespace create "CHAT_HISTORY"
# Скопируйте id из вывода в wrangler.toml

# Установите секреты
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put IMPORT_SECRET
wrangler secret put WORKER_HOST
```

</details>

### 3. Проверка конфигурации

```bash
./run-bot.sh check
```

### 4. Запуск бота

```bash
# Автоматическая установка (деплой + данные + регистрация)
./run-bot.sh full
```

**Или пошагово:**

```bash
# Шаг 1: Деплой Worker
./run-bot.sh deploy

# Шаг 2: Загрузка данных (схема + каталог + база знаний)
./run-bot.sh seed

# Шаг 3: Регистрация бота в Bitrix24
./run-bot.sh register
```

---

## Проверка работы

### 1. Проверить деплой

```bash
wrangler deployments list
```

### 2. Проверить данные

```bash
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM catalog"
```

### 3. Посмотреть логи

```bash
wrangler tail --format pretty
```

### 4. Тест в Bitrix24

1. Откройте чат с ботом
2. Напишите: `6205`
3. Бот должен ответить информацией о подшипнике

---

## Обновление данных

### Через inbox/ (рекомендуется)

```bash
# Добавьте файлы в inbox/
cp new-catalog.csv inbox/catalog/

# Закоммитьте и запушьте
git add inbox/
git commit -m "feat: update catalog"
git push origin main

# Данные автоматически загрузятся в D1
```

### Ручная загрузка

```bash
# Обновить каталог подшипников
./run-bot.sh seed
```

---

## Команды для работы

| Команда | Описание |
|---------|----------|
| `./run-bot.sh setup` | Создание D1/KV ресурсов и установка секретов |
| `./run-bot.sh full` | Полная установка (деплой + данные + регистрация) |
| `./run-bot.sh deploy` | Только деплой Worker |
| `./run-bot.sh seed` | Только загрузка данных (схема + каталог + база знаний) |
| `./run-bot.sh register` | Только регистрация бота в Bitrix24 |
| `./run-bot.sh check` | Проверка конфигурации wrangler.toml |
| `./run-bot.sh help` | Справка по командам |
| `wrangler tail` | Просмотр логов в реальном времени |
| `wrangler deployments list` | Список деплоев |
| `wrangler d1 execute bearings-catalog --command "SQL"` | Выполнить SQL запрос |

---

## Troubleshooting

### Бот не отвечает

```bash
# Проверьте логи
wrangler tail

# Проверьте секреты
wrangler secret list

# Проверьте деплой
wrangler deployments list
```

### База данных пуста

```bash
# Пересоздайте схему
wrangler d1 execute bearings-catalog --file schema.sql --remote

# Загрузите данные
./run-bot.sh seed
```

### Ошибки Gemini API

- Проверьте квоты в [Google AI Studio](https://makersuite.google.com/)
- Убедитесь, что API ключ действителен
- Проверьте `GEMINI_API_KEY` секрет

---

## Полезные ссылки

- 📖 **Полная документация**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- 🏗️ **Архитектура проекта**: [CLAUDE.md](./CLAUDE.md)
- 🗺️ **Структура репозитория**: [SITEMAP.md](./SITEMAP.md)
- 🔧 **Cloudflare Dashboard**: https://dash.cloudflare.com/
- 🤖 **Google AI Studio**: https://makersuite.google.com/

---

## Быстрая справка по Git

```bash
# Клонировать репозиторий
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot

# Создать новую ветку
git checkout -b feature/my-changes

# Закоммитить изменения
git add .
git commit -m "feat: add new feature"

# Запушить в GitHub
git push origin feature/my-changes

# Создать Pull Request на GitHub
```

---

## Контакты

Для вопросов и поддержки создавайте Issue в GitHub репозитории.

**Приятного использования! 🎉**

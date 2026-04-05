# Быстрый старт — Bitrix24 Bot

## Требования

Перед началом убедитесь, что у вас есть:

- [ ] Аккаунт Cloudflare с Workers и D1
- [ ] Портал Bitrix24 с правами администратора
- [ ] Аккаунт Google AI Studio для Gemini API
- [ ] Node.js 24+ и Git

## Автоматический деплой (через GitHub Actions)

### 1. Fork репозитория

```bash
# Перейдите на https://github.com/ArtemFilin1990/bitrix24bot
# Нажмите Fork
```

### 2. Настройте секреты GitHub

Перейдите в Settings → Secrets and variables → Actions и добавьте:

```
CLOUDFLARE_API_TOKEN=ваш-cloudflare-api-token
CLOUDFLARE_ACCOUNT_ID=ваш-account-id
GEMINI_API_KEY=ваш-gemini-api-key
B24_PORTAL=https://your-portal.bitrix24.ru
B24_USER_ID=ваш-user-id
B24_TOKEN=ваш-b24-token
IMPORT_SECRET=ваш-случайный-секрет
B24_APP_TOKEN=токен-приложения-bitrix24
BITRIX_WEBHOOK_URL=https://portal.bitrix24.ru/rest/user_id/token/
```

### 3. Создайте ресурсы Cloudflare

1. **D1 Database**:
   ```bash
   wrangler d1 create bearings-catalog
   ```
   Скопируйте `database_id` в `wrangler.toml`

2. **KV Namespace**:
   ```bash
   wrangler kv:namespace create "CHAT_HISTORY"
   ```
   Скопируйте `id` в `wrangler.toml`

3. **Обновите `wrangler.toml`**: замените все значения помеченные `# REPLACE`

### 4. Запустите деплой

Push в `main` запустит автоматический деплой:

```bash
git push origin main
```

### 5. Загрузите данные

Запустите workflow вручную:

```bash
# GitHub → Actions → Seed Database → Run workflow
```

### 6. Зарегистрируйте бота

```bash
curl "https://your-worker.workers.dev/register?secret=YOUR_IMPORT_SECRET"
```

Сохраните полученный `BOT_ID` в `wrangler.toml` (поле `BOT_ID = "..."`) и задеплойте снова.

---

## Ручной деплой (локально)

### 1. Клонируйте репозиторий

```bash
git clone https://github.com/ArtemFilin1990/bitrix24bot.git
cd bitrix24bot
npm install
```

### 2. Настройте секреты через `run-bot.sh`

```bash
./run-bot.sh setup
```

Скрипт запросит следующие значения:

```
GEMINI_API_KEY=ваш-gemini-api-key
B24_PORTAL=https://your-portal.bitrix24.ru
B24_USER_ID=ваш-user-id
B24_TOKEN=ваш-b24-token
IMPORT_SECRET=ваш-случайный-секрет
WORKER_HOST=ваш-worker.workers.dev
B24_APP_TOKEN=токен-приложения-bitrix24
BITRIX_WEBHOOK_URL=https://portal.bitrix24.ru/rest/user_id/token/
```

### 3. Разверните Worker

```bash
./run-bot.sh deploy
```

### 4. Загрузите данные и зарегистрируйте бота

```bash
./run-bot.sh full  # деплой + загрузка данных + регистрация
```

---

## Проверка

После установки убедитесь, что всё работает:

### 1. Статус Worker

```bash
wrangler deployments list
```

### 2. Проверить базу данных

```bash
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) as total FROM catalog"
```

### 3. Тест бота в Bitrix24

1. Откройте чат с ботом
2. Напишите: `6205`
3. Бот должен ответить с информацией о подшипнике

---

## Устранение неполадок

### Бот не отвечает

```bash
# Проверьте логи
wrangler tail

# Проверьте наличие всех секретов
wrangler secret list
```

### Ошибка при регистрации

Убедитесь, что установлен секрет `B24_APP_TOKEN`:

```bash
wrangler secret put B24_APP_TOKEN
```

### База данных пуста

Примените схему и загрузите данные:

```bash
# Применить схему через миграции
wrangler d1 migrations apply bearings-catalog --remote

# Затем загрузить данные
./run-bot.sh seed
```

### Ошибки Gemini

Проверьте квоты в [Google AI Studio](https://makersuite.google.com/app/apikey).

---

## Что дальше?

- Ознакомьтесь с [DEPLOYMENT.md](DEPLOYMENT.md) для подробных инструкций
- Добавьте данные через папку `inbox/`
- Настройте команды бота в Bitrix24

# 🤖 Бот настроен и готов к запуску!

## ✅ Что было сделано

В репозиторий добавлены все необходимые инструменты для запуска бота Bitrix24:

### 1. 📜 Скрипт автоматического деплоя: `run-bot.sh`

Универсальный bash-скрипт для автоматизации всех операций по развертыванию бота.

**Использование:**

```bash
# Полная установка (все шаги сразу)
./run-bot.sh full

# Или отдельные команды:
./run-bot.sh deploy    # Деплой только Worker
./run-bot.sh seed      # Загрузка только данных
./run-bot.sh register  # Регистрация только бота
```

### 2. 📚 Документация

Созданы три документа с полной информацией:

- **`QUICKSTART.md`** - Быстрый старт (5 минут до первого запуска)
- **`DEPLOYMENT.md`** - Подробная документация по развертыванию
- **`CLAUDE.md`** - Техническая документация для разработчиков (уже была)

### 3. ⚙️ Обновлен `.gitignore`

Добавлено исключение для `run-bot.sh`, чтобы скрипт был в репозитории.

---

## 🚀 Как запустить бота прямо сейчас

### Вариант А: GitHub Actions (рекомендуется)

**Требуется настроить один раз:**

1. Перейдите в Settings → Secrets and variables → Actions
2. Добавьте секреты:
   - `CLOUDFLARE_API_TOKEN` - токен Cloudflare с правами Workers, D1, KV
   - `CLOUDFLARE_ACCOUNT_ID` - ID аккаунта Cloudflare
   - `GEMINI_API_KEY` - API ключ Google Gemini
   - `IMPORT_SECRET` - любая случайная строка (для защиты эндпоинтов)

3. Установите секреты Bitrix24 через Wrangler CLI:
```bash
npm install -g wrangler@4.76.0
export CLOUDFLARE_API_TOKEN=ваш-токен
export CLOUDFLARE_ACCOUNT_ID=ваш-account-id

wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put WORKER_HOST
```

**Запуск:**

```bash
# 1. Деплой Worker (автоматически при push в main)
git push origin main

# 2. Загрузка данных
GitHub → Actions → "Seed Database" → Run workflow
  ✓ Отметьте все опции
  ✓ Нажмите "Run workflow"

# Готово! Бот работает.
```

### Вариант Б: Локальный запуск

**Требуется:**
- Node.js 24+
- Python 3.9+
- Git

**Шаги:**

```bash
# 1. Установите Wrangler
npm install -g wrangler@4.76.0

# 2. Авторизуйтесь в Cloudflare
wrangler login

# 3. Создайте ресурсы (один раз)
wrangler d1 create bearings-catalog
# Скопируйте database_id в wrangler.toml

wrangler kv:namespace create "CHAT_HISTORY"
# Скопируйте id в wrangler.toml

# 4. Установите секреты
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put IMPORT_SECRET
wrangler secret put WORKER_HOST

# 5. Запустите бота
./run-bot.sh full
```

---

## 📋 Что делает скрипт `run-bot.sh full`

1. **Деплой Worker** → Загружает `worker.js` на Cloudflare Workers
2. **Применяет схему БД** → Создает таблицы в D1 SQLite
3. **Загружает каталог подшипников** → ~32,000 аналогов, ~200 позиций каталога
4. **Загружает базу знаний** → ~120 технических статей с FTS5 поиском
5. **Регистрирует бота** → Создает бота в Bitrix24 через REST API

**Время выполнения:** 2-5 минут (зависит от скорости интернета)

---

## 🔍 Проверка работы

### 1. Проверить статус деплоя

```bash
wrangler deployments list
```

Вывод должен показать последний деплой с URL:
```
https://bitrix24bot.your-subdomain.workers.dev
```

### 2. Проверить данные в базе

```bash
# Количество товаров в каталоге
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM catalog"

# Количество статей в базе знаний
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM kb_documents"

# Количество аналогов
wrangler d1 execute bearings-catalog --command "SELECT COUNT(*) FROM analogs"
```

Или используйте GitHub Actions workflow:
```
GitHub → Actions → "Check Database" → Run workflow
```

### 3. Проверить логи Worker

```bash
wrangler tail --format pretty
```

### 4. Протестировать в Bitrix24

1. Откройте Bitrix24
2. Найдите бота "Алексей" или "Эксперт по подшипникам"
3. Напишите: `6205`
4. Бот должен ответить:

```
[B]6205[/B] — шариковый радиальный, серия 62
• d=25мм, D=52мм, B=15мм
• Цена: [B]185 руб[/B] • Остаток: [B]47 шт[/B]
Аналоги: 180205 (ГОСТ), 6205-2RS (с уплотнениями)
```

---

## 📊 Архитектура бота

```
┌─────────────────────────────────────────────────────┐
│                   Bitrix24 IM                       │
│              (Личный чат менеджера)                 │
└──────────────────────┬──────────────────────────────┘
                       │ POST /imbot (webhook)
                       ▼
┌─────────────────────────────────────────────────────┐
│           Cloudflare Worker (worker.js)             │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ askGemini() - Iterative function calling     │  │
│  │   ↓ 1. User message → Gemini 2.0 Flash       │  │
│  │   ↓ 2. Gemini → Tool calls (search_catalog)  │  │
│  │   ↓ 3. executeTool() → D1 queries            │  │
│  │   ↓ 4. Results → Gemini                      │  │
│  │   ↓ 5. Gemini → Final answer                 │  │
│  │   ↓ 6. botReply() → Bitrix24 (BB-code)       │  │
│  └──────────────────────────────────────────────┘  │
└──────┬──────────────────────────────────────┬───────┘
       │                                      │
       ▼                                      ▼
┌──────────────────┐              ┌──────────────────┐
│  D1 Database     │              │  KV Namespace    │
│  (SQLite)        │              │  (Chat History)  │
│                  │              │                  │
│ • catalog        │              │ • 24h TTL        │
│ • analogs        │              │ • Last 20 turns  │
│ • brands         │              │                  │
│ • kb_documents   │              └──────────────────┘
│ • kb_chunks_fts  │
└──────────────────┘
```

---

## 🔧 Обслуживание

### Обновление кода бота

```bash
# Отредактируйте worker.js
vim b24-imbot/worker.js

# Задеплойте изменения
wrangler deploy
# или
git push origin main  # автоматический деплой через GitHub Actions
```

### Обновление данных

**Способ 1: через inbox/ (рекомендуется)**

```bash
# Добавьте файлы в соответствующие папки
cp новый-каталог.csv inbox/catalog/
cp новая-статья.md inbox/docs/
cp аналоги.csv inbox/analogs/

# Закоммитьте и запушьте
git add inbox/
git commit -m "feat: update catalog and knowledge base"
git push origin main

# GitHub Actions автоматически обработает и загрузит данные
```

**Способ 2: через скрипт**

```bash
./run-bot.sh seed
```

**Способ 3: через API эндпоинты**

```bash
# Импорт каталога из Bitrix24 Disk
curl "https://your-worker.workers.dev/import-catalog-csv?secret=YOUR_SECRET&file_id=123"

# Импорт документа Markdown
curl "https://your-worker.workers.dev/import-doc?secret=YOUR_SECRET&file_id=456"
```

### Мониторинг

```bash
# Логи в реальном времени
wrangler tail --format pretty

# Статистика деплоев
wrangler deployments view

# Или через Cloudflare Dashboard:
# https://dash.cloudflare.com/ → Workers & Pages → bitrix24bot
```

---

## 🛠️ Инструменты бота (Function Calling)

Бот использует 9 инструментов для работы с данными:

### CRM (Bitrix24 REST API)

1. **`get_deal`** - получить данные сделки по ID
2. **`search_deals`** - поиск сделок по фильтрам
3. **`get_company`** - данные компании
4. **`get_deal_products`** - товары в сделке
5. **`get_my_deals`** - сделки текущего пользователя

### Каталог и справочники (D1 SQLite)

6. **`search_catalog`** - поиск подшипников (артикул, размеры, цена, остаток)
7. **`search_analogs`** - поиск аналогов (ГОСТ ↔ ISO ↔ бренды)
8. **`search_brand`** - информация о производителе
9. **`search_knowledge`** - поиск по базе знаний (FTS5)

---

## 📝 Примеры диалогов

**Запрос:** `6205`

**Бот:**
```
[B]6205[/B] — шариковый радиальный однорядный, серия 62

[B]Размеры:[/B]
• d (внутренний) = 25 мм
• D (наружный) = 52 мм
• B (ширина) = 15 мм

[B]Наличие и цена:[/B]
• SKF 6205: 185 руб, в наличии 47 шт
• FAG 6205: 175 руб, в наличии 23 шт

[B]Аналоги:[/B]
• ГОСТ: 180205
• ISO: 6205
• С уплотнениями: 6205-2RS, 6205-2Z
```

---

**Запрос:** `Чем заменить 180205?`

**Бот:**
```
[B]180205[/B] (ГОСТ) имеет прямые аналоги:

[B]ISO:[/B]
• 6205 (международное обозначение)

[B]В наличии:[/B]
• SKF 6205 — 185 руб (47 шт)
• FAG 6205 — 175 руб (23 шт)
• NSK 6205 — 180 руб (12 шт)

Размеры совпадают полностью: 25×52×15 мм
```

---

**Запрос:** `Что значит C3 в подшипнике?`

**Бот:**
```
[B]C3[/B] — это радиальный зазор подшипника по классификации ISO.

[B]Обозначение зазоров:[/B]
• C2 — зазор меньше нормального
• CN (Normal) — нормальный зазор (по умолчанию)
• C3 — зазор больше нормального
• C4 — значительно увеличенный зазор

[B]Когда применяется C3:[/B]
• При высоких рабочих температурах
• При тугой посадке на вал
• При нагреве внутреннего кольца
• В тяжелых условиях эксплуатации

Пример: [B]6205-C3[/B] — это подшипник 6205 с увеличенным радиальным зазором.
```

---

## 🔐 Безопасность

### Секреты

Все критические данные хранятся как секреты Cloudflare Workers:

- ✅ API ключи (Gemini, Bitrix24)
- ✅ Токены авторизации
- ✅ Секреты для защиты эндпоинтов

**Никогда не коммитьте секреты в Git!**

### Защита эндпоинтов

Все эндпоинты импорта защищены `IMPORT_SECRET`:

```javascript
if (url.searchParams.get('secret') !== env.IMPORT_SECRET) {
  return new Response('Forbidden', { status: 403 });
}
```

### Рекомендации

1. Используйте сложные пароли для `IMPORT_SECRET` (32+ символов)
2. Регулярно ротируйте API ключи
3. Ограничьте права токенов Bitrix24 только необходимыми
4. Мониторьте использование квот Gemini API
5. Используйте Cloudflare WAF для дополнительной защиты

---

## 📚 Дополнительные материалы

- **QUICKSTART.md** - быстрый старт за 5 минут
- **DEPLOYMENT.md** - полная документация по развертыванию
- **CLAUDE.md** - техническая документация для разработчиков
- **SITEMAP.md** - структура репозитория
- **schema.sql** - схема базы данных

### Официальная документация

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Bitrix24 REST API](https://dev.bitrix24.com/rest_help/)
- [Google Gemini API](https://ai.google.dev/docs)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

---

## 🎯 Следующие шаги

1. ✅ **Настройте секреты** (GitHub Actions или локально)
2. ✅ **Запустите деплой** (`./run-bot.sh full` или через GitHub Actions)
3. ✅ **Проверьте работу** (логи, база данных, тест в Bitrix24)
4. 📝 **Настройте бота под себя** (отредактируйте `SYSTEM_PROMPT` в `worker.js`)
5. 📊 **Добавьте свои данные** (через `inbox/` или API эндпоинты)

---

## ❓ Нужна помощь?

- **Документация**: см. `DEPLOYMENT.md` и `QUICKSTART.md`
- **Логи**: `wrangler tail --format pretty`
- **База данных**: `wrangler d1 execute bearings-catalog --command "SELECT ..."`
- **GitHub Issues**: создайте Issue в репозитории

**Бот готов к работе! 🚀**

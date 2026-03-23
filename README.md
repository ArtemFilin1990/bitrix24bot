# b24-imbot — ИИ-бот для Bitrix24

Cloudflare Worker. ИИ-помощник менеджера по подшипникам: поиск в каталоге, аналоги, CRM-сделки.

**Стек:** Cloudflare Workers + KV + D1 · Gemini 2.5 Flash (function calling) · Bitrix24 imbot

---

## Структура

```
b24-imbot/
├── worker.js     — основной Worker (бот + AI + B24 REST + импорт)
└── wrangler.toml — конфиг деплоя (KV + D1 bindings)
wrangler.toml     — корневой конфиг деплоя (используется GitHub Actions)
.github/
└── workflows/deploy.yml  — автодеплой при push в main
```

---

## Шаг 1 — Создать ресурсы Cloudflare

```bash
# KV для истории диалогов
wrangler kv:namespace create CHAT_HISTORY
# → вставить id в оба wrangler.toml

# D1 база данных
wrangler d1 create bearings-catalog
# → вставить database_id в оба wrangler.toml
```

### Создать схему D1

```bash
wrangler d1 execute bearings-catalog --file=schema.sql
```

Или через Cloudflare Dashboard → D1 → Console (выполнить SQL из раздела «Схема» ниже).

---

## Шаг 2 — Secrets

```bash
wrangler secret put GEMINI_API_KEY    # aistudio.google.com (бесплатно)
wrangler secret put GEMINI_MODEL      # необязательно; по умолчанию: gemini-2.5-flash
wrangler secret put B24_PORTAL        # your-portal.bitrix24.ru
wrangler secret put B24_USER_ID       # ID пользователя REST
wrangler secret put B24_TOKEN         # токен входящего webhook
wrangler secret put WORKER_HOST       # bitrix24bot.YOUR.workers.dev
wrangler secret put IMPORT_SECRET     # любая строка-пароль для эндпоинтов импорта
```

---

## Шаг 3 — Деплой

```bash
wrangler deploy        # из корня репозитория
```

или через GitHub Actions (push в `main` → автодеплой).

---

## Шаг 4 — Зарегистрировать бота в B24

```
GET https://bitrix24bot.YOUR.workers.dev/register
```

Ответ вернёт `bot_id`. Сохранить в secrets или в `wrangler.toml → [vars]`:

```bash
wrangler secret put BOT_ID   # число из ответа /register
wrangler deploy               # передеплой с BOT_ID
```

---

## Шаг 5 — Импорт данных (после первого деплоя)

### Просмотр CSV перед импортом

```
GET /preview-file?file_id=<B24_FILE_ID>&secret=<IMPORT_SECRET>&lines=5
```

### Импорт подшипников из CSV (таблица `bearings`)

```
GET /import-catalog?file_id=<ID>&secret=<IMPORT_SECRET>
```

### Импорт расширенного каталога из CSV → `catalog`

```
# Сначала dry_run: показывает обнаруженные колонки
GET /import-catalog-csv?file_id=<ID>&secret=<IMPORT_SECRET>&dry_run=1

# Полный импорт
GET /import-catalog-csv?file_id=<ID>&secret=<IMPORT_SECRET>

# Ручная привязка колонок (индексы с 0)
GET /import-catalog-csv?file_id=<ID>&secret=<IMPORT_SECRET>&c_desig=3&c_d=8&c_D=9
```

### Импорт каталога из Bitrix24 CRM (`catalog.product.list`)

```
GET /import-catalog-crm?secret=<IMPORT_SECRET>
GET /import-catalog-crm?secret=<IMPORT_SECRET>&section_id=42&limit=500
```

### Импорт аналогов CSV → таблица `analogs`

```
# dry_run: авто-детект колонок
GET /import-analogs?file_id=<ID>&secret=<IMPORT_SECRET>&dry_run=1

# Полный импорт
GET /import-analogs?file_id=<ID>&secret=<IMPORT_SECRET>
```

### Импорт документов в базу знаний

```
# Одиночный MD-файл из Bitrix24 Disk
GET /import-doc?file_id=<ID>&secret=<IMPORT_SECRET>&tags=подшипники,ГОСТ

# Bulk-импорт JSON
POST /import-doc-bulk
Content-Type: application/json
{"secret":"...","docs":[{"title":"...","content":"...","tags":"..."}]}

# Bulk-импорт брендов
POST /import-brands-bulk
{"secret":"...","brands":[{"name":"SKF","description":"...","logo_url":"..."}]}
```

---

## Команды бота

| Команда / фраза | Действие |
|---|---|
| `/start` · `помощь` | Приветствие и список возможностей |
| `/сброс` | Очистить историю диалога |
| `мои сделки` | Активные сделки менеджера |
| `найди сделку <название>` | Поиск по CRM |
| `данные сделки <ID>` | Полная карточка сделки |
| `6205 цена` | Поиск подшипника в каталоге (цена, остаток) |
| `аналог 6205` | Найти аналоги ГОСТ/ISO |
| `что такое SKF` | Информация о производителе |

---

## Инструменты ИИ (function calling)

| Инструмент | Назначение |
|---|---|
| `get_deal` | Данные сделки по ID |
| `search_deals` | Поиск сделок (по названию, стадии) |
| `get_company` | Данные компании из CRM |
| `get_deal_products` | Товары в сделке |
| `get_my_deals` | Активные сделки менеджера |
| `search_catalog` | Поиск в каталоге → `catalog` → fallback на `bearings` |
| `search_analogs` | Аналоги подшипников (ГОСТ ↔ ISO, таблица `analogs`) |
| `search_brand` | Информация о бренде/производителе |
| `search_knowledge` | Полнотекстовый поиск (FTS5) по базе знаний |

---

## Схема D1 (`bearings-catalog`)

```sql
-- Базовый каталог (только name/article/brand/weight)
CREATE TABLE IF NOT EXISTS bearings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  article TEXT NOT NULL,
  brand   TEXT,
  weight  REAL
);
CREATE INDEX IF NOT EXISTS idx_article ON bearings(article);
CREATE INDEX IF NOT EXISTS idx_name    ON bearings(name);

-- Расширенный каталог (с ценой, остатком, размерами, ГОСТ/ISO)
CREATE TABLE IF NOT EXISTS catalog (
  item_id          TEXT PRIMARY KEY,
  manufacturer     TEXT,
  category_ru      TEXT,
  subcategory_ru   TEXT,
  series_ru        TEXT,
  name_ru          TEXT,
  designation      TEXT,
  iso_ref          TEXT,
  section          TEXT,
  d_mm             REAL,
  big_d_mm         REAL,
  b_mm             REAL,
  t_mm             REAL,
  mass_kg          REAL,
  analog_ref       TEXT,
  price_rub        REAL,
  qty              INTEGER,
  stock_flag       INTEGER DEFAULT 0,
  bitrix_section_1 TEXT,
  bitrix_section_2 TEXT,
  bitrix_section_3 TEXT,
  gost_ref         TEXT,
  brand_display    TEXT,
  suffix_desc      TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_designation  ON catalog(designation);
CREATE INDEX IF NOT EXISTS idx_catalog_manufacturer ON catalog(manufacturer);
CREATE INDEX IF NOT EXISTS idx_catalog_category     ON catalog(category_ru);
CREATE INDEX IF NOT EXISTS idx_catalog_stock        ON catalog(stock_flag);

-- Аналоги (ГОСТ ↔ ISO, отечественные ↔ импортные)
CREATE TABLE IF NOT EXISTS analogs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  brand              TEXT,
  designation        TEXT,
  analog_designation TEXT,
  analog_brand       TEXT,
  factory            TEXT
);
CREATE INDEX IF NOT EXISTS idx_analogs_designation ON analogs(designation);
CREATE INDEX IF NOT EXISTS idx_analogs_analog      ON analogs(analog_designation);

-- Бренды / производители
CREATE TABLE IF NOT EXISTS brands (
  name        TEXT PRIMARY KEY,
  description TEXT,
  logo_url    TEXT,
  search_url  TEXT
);
CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

-- База знаний (MD-документы)
CREATE TABLE IF NOT EXISTS knowledge (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  title   TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  tags    TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge(title);

-- FTS5 для полнотекстового поиска по базе знаний
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
  USING fts5(title, content, tags, content=knowledge, content_rowid=id);

CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
  VALUES('delete', old.id, old.title, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
  VALUES('delete', old.id, old.title, old.content, old.tags);
  INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
END;
```

---

## Риски и решения

| Ситуация | Решение |
|---|---|
| `imbot.register` уже зарегистрирован | Вызвать `imbot.unregister` → повторить `/register` |
| BOT_ID не задан → ошибка отправки | `wrangler secret put BOT_ID` после `/register` |
| KV id не вставлен → история не сохраняется | Вставить id в оба `wrangler.toml` |
| `catalog` пуст → нет цен и остатков | Запустить `/import-catalog-crm` или `/import-catalog-csv` |
| Gemini 429 (rate limit) | Бесплатный тариф: 15 req/min. Добавить задержку или перейти на платный |
| FTS5 не возвращает результаты | При добавлении записей вне импорт-эндпоинтов — вручную: `INSERT INTO knowledge_fts(knowledge_fts) VALUES('rebuild')` |

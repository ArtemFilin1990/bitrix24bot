-- Схема D1 для базы данных bearings-catalog
-- Выполнить один раз: wrangler d1 execute bearings-catalog --file=schema.sql
-- Или через Cloudflare Dashboard → D1 → Console

-- Базовый каталог (только name/article/brand/weight, импорт через /import-catalog)
CREATE TABLE IF NOT EXISTS bearings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  article TEXT NOT NULL,
  brand   TEXT,
  weight  REAL
);
CREATE INDEX IF NOT EXISTS idx_article ON bearings(article);
CREATE INDEX IF NOT EXISTS idx_name    ON bearings(name);

-- Расширенный каталог (цена, остаток, размеры, ГОСТ/ISO, импорт через /import-catalog-csv или /import-catalog-crm)
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

-- Аналоги (ГОСТ ↔ ISO, отечественные ↔ импортные, импорт через /import-analogs)
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

-- Бренды / производители (импорт через POST /import-brands-bulk)
CREATE TABLE IF NOT EXISTS brands (
  name        TEXT PRIMARY KEY,
  description TEXT,
  logo_url    TEXT,
  search_url  TEXT
);
CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

-- База знаний — MD-документы (импорт через /import-doc или POST /import-doc-bulk)
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
  INSERT INTO knowledge_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
  VALUES('delete', old.id, old.title, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
  VALUES('delete', old.id, old.title, old.content, old.tags);
  INSERT INTO knowledge_fts(rowid, title, content, tags)
  VALUES (new.id, new.title, new.content, new.tags);
END;

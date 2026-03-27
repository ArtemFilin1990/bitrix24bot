-- Initial D1 schema for b24-imbot
-- Base runtime schema + normalized ingestion tables.
-- Migrated from schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bearings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  article TEXT NOT NULL,
  brand   TEXT,
  weight  REAL
);
CREATE INDEX IF NOT EXISTS idx_article ON bearings(article);
CREATE INDEX IF NOT EXISTS idx_name    ON bearings(name);

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

CREATE TABLE IF NOT EXISTS brands (
  name        TEXT PRIMARY KEY,
  description TEXT,
  logo_url    TEXT,
  search_url  TEXT
);
CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

CREATE TABLE IF NOT EXISTS bearing_ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_snapshot TEXT,
  source_repo TEXT NOT NULL,
  files_seen INTEGER DEFAULT 0,
  bearings_loaded INTEGER DEFAULT 0,
  catalog_loaded INTEGER DEFAULT 0,
  analogs_loaded INTEGER DEFAULT 0,
  brands_loaded INTEGER DEFAULT 0,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS kb_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_repo TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  lang TEXT DEFAULT 'ru',
  slug TEXT,
  title TEXT NOT NULL,
  section_path TEXT,
  frontmatter_json TEXT DEFAULT '{}',
  raw_markdown TEXT NOT NULL,
  plain_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  is_canonical INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kb_documents_type ON kb_documents(source_type, is_canonical);
CREATE INDEX IF NOT EXISTS idx_kb_documents_lang ON kb_documents(lang);
CREATE INDEX IF NOT EXISTS idx_kb_documents_slug ON kb_documents(slug);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_no INTEGER NOT NULL,
  heading_path TEXT,
  content TEXT NOT NULL,
  tokens_est INTEGER,
  title TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  FOREIGN KEY(document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
  UNIQUE(document_id, chunk_no)
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id);

CREATE TABLE IF NOT EXISTS kb_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS kb_document_tags (
  document_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(document_id, tag_id),
  FOREIGN KEY(document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kb_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  target_path TEXT,
  anchor_text TEXT,
  link_type TEXT DEFAULT 'internal',
  FOREIGN KEY(document_id) REFERENCES kb_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_links_document ON kb_links(document_id);

CREATE TABLE IF NOT EXISTS kb_ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_snapshot TEXT,
  files_seen INTEGER DEFAULT 0,
  files_loaded INTEGER DEFAULT 0,
  files_skipped INTEGER DEFAULT 0,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  notes TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts
USING fts5(
  title,
  heading_path,
  content,
  tags,
  content='kb_chunks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS kb_documents_touch_updated_at
AFTER UPDATE ON kb_documents
BEGIN
  UPDATE kb_documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(rowid, title, heading_path, content, tags)
  VALUES (
    NEW.id,
    NEW.title,
    COALESCE(NEW.heading_path, ''),
    NEW.content,
    NEW.tags
  );
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, heading_path, content, tags)
  VALUES(
    'delete',
    OLD.id,
    OLD.title,
    COALESCE(OLD.heading_path, ''),
    OLD.content,
    OLD.tags
  );
END;
CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
  INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, title, heading_path, content, tags)
  VALUES(
    'delete',
    OLD.id,
    OLD.title,
    COALESCE(OLD.heading_path, ''),
    OLD.content,
    OLD.tags
  );
  INSERT INTO kb_chunks_fts(rowid, title, heading_path, content, tags)
  VALUES (
    NEW.id,
    NEW.title,
    COALESCE(NEW.heading_path, ''),
    NEW.content,
    NEW.tags
  );
END;

CREATE TABLE IF NOT EXISTS knowledge (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  title   TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  tags    TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge(title);

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

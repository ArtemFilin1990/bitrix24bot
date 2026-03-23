# b24-imbot — ИИ-бот для Bitrix24

Cloudflare Worker для менеджеров по подшипникам: поиск по каталогу, аналогам, брендам, CRM и базе знаний.

## Что изменено в ingestion

В репозитории теперь два воспроизводимых SQL seed pipeline:

- `scripts/build_bearings_seed.py` — строит повторяемый импорт справочника из `BearingsInfo/main`.
- `scripts/build_kb_seed.py` — строит нормализованный ingestion базы знаний из `knowledge-base/main`.

Оба скрипта:

- работают от локальной копии source repo;
- не требуют ручного копипаста в исходники;
- поддерживают повторный запуск без дублей;
- сохраняют совместимость с текущим runtime бота.

## Структура репозитория

```text
.
├── b24-imbot/
│   ├── worker.js
│   └── wrangler.toml
├── scripts/
│   ├── build_bearings_seed.py
│   └── build_kb_seed.py
├── tests/
│   ├── fixtures/
│   ├── test_build_bearings_seed.py
│   └── test_build_kb_seed.py
├── schema.sql
└── wrangler.toml
```

## Mapping источников

### BearingsInfo → bitrix24bot

| Источник BearingsInfo | Mapping в bitrix24bot | Зачем |
|---|---|---|
| `data/csv/master_catalog.csv` | `bearings`, `catalog` | базовые позиции, размеры, ISO/ГОСТ, веса |
| `data/analogs/gost_to_iso.csv` | `analogs` | канонические ГОСТ → ISO соответствия |
| `data/analogs/iso_to_gost.csv` | `analogs` | обратный поиск ISO → ГОСТ |
| `data/analogs/import_analogs.csv` | `analogs` | кросс-брендовые аналоги SKF/FAG/NSK/NTN/KOYO |
| `data/brands.csv`, `data/brands/**/*.csv` | `brands` | справка по брендам и производителям |

### knowledge-base → bitrix24bot

| Источник knowledge-base | Тип | Таблицы |
|---|---|---|
| `kb/ru/**/README.md`, `kb/ru/INDEX.md`, `kb/ru/**/INDEX.md` | `article` | `kb_documents`, `kb_chunks`, `kb_tags`, `kb_document_tags`, `kb_links` |
| `prompts/**/*.md` | `prompt` | `kb_documents` + связанные таблицы |
| `_templates/**/*.md` | `template` | `kb_documents` + связанные таблицы |
| `_meta/**/*.md`, `_meta/**/*.json` | `meta` | `kb_documents` + связанные таблицы |
| `inbox/**`, `scripts/**`, `tests/**`, `.github/**`, `.vscode/**` | пропуск | не импортируются в production knowledge |

## Схема D1

`schema.sql` создаёт:

- runtime-таблицы `bearings`, `catalog`, `analogs`, `brands`;
- аудит импортов `bearing_ingest_runs`, `kb_ingest_runs`;
- нормализованный knowledge ingestion слой `kb_documents`, `kb_chunks`, `kb_tags`, `kb_document_tags`, `kb_links`, `kb_chunks_fts`;
- legacy compatibility таблицу `knowledge` + `knowledge_fts` для старых точек входа.

`search_knowledge` в `b24-imbot/worker.js` сначала ищет по `kb_chunks_fts`, затем делает LIKE fallback по `kb_*`, и только потом — по legacy `knowledge`, поэтому обратная совместимость сохранена.

## Как обновлять данные из source repos

### 1. Подготовить схему

```bash
wrangler d1 execute bearings-catalog --file=schema.sql
```

### 2. Обновить BearingsInfo seed

```bash
git clone https://github.com/ArtemFilin1990/BearingsInfo ../BearingsInfo
python scripts/build_bearings_seed.py \
  --source-dir ../BearingsInfo \
  --output data/bearings_seed.sql \
  --source-snapshot "BearingsInfo@$(git -C ../BearingsInfo rev-parse --short HEAD)"
wrangler d1 execute bearings-catalog --file=data/bearings_seed.sql
```

### 3. Обновить knowledge-base seed

```bash
git clone https://github.com/ArtemFilin1990/knowledge-base ../knowledge-base
python scripts/build_kb_seed.py \
  --source-dir ../knowledge-base \
  --output data/kb_seed.sql \
  --source-snapshot "knowledge-base@$(git -C ../knowledge-base rev-parse --short HEAD)"
wrangler d1 execute bearings-catalog --file=data/kb_seed.sql
```

## Правила ingestion

### Bearings pipeline

1. scan source CSV;
2. normalize master catalog → `bearings` и `catalog`;
3. map analog CSV → `analogs`;
4. merge brand CSV → `brands`;
5. write idempotent SQL seed;
6. log `bearing_ingest_runs`.

### Knowledge pipeline

1. scan markdown/json source files;
2. classify content type;
3. normalize frontmatter and metadata;
4. chunk content for FTS;
5. upsert documents/tags/links/chunks;
6. refresh compatibility table `knowledge`;
7. log `kb_ingest_runs`.

## Проверка локально

```bash
python -m unittest tests/test_build_bearings_seed.py
python -m unittest tests/test_build_kb_seed.py
```

Дополнительно можно проверить готовый seed вручную:

```bash
sqlite3 /tmp/b24bot.db < schema.sql
sqlite3 /tmp/b24bot.db < data/bearings_seed.sql
sqlite3 /tmp/b24bot.db < data/kb_seed.sql
sqlite3 /tmp/b24bot.db "SELECT COUNT(*) FROM catalog WHERE bitrix_section_1 = 'BearingsInfo';"
sqlite3 /tmp/b24bot.db "SELECT title, heading_path FROM kb_chunks_fts WHERE kb_chunks_fts MATCH 'монтаж' LIMIT 5;"
```

## ASSUMPTIONS

- Для импорта BearingsInfo в существующую модель `catalog` используется явный mapping layer: одна строка `master_catalog.csv` раскрывается в несколько строк `catalog` по брендовым колонкам `SKF/FAG/NSK/NTN/KOYO`.
- В `kb_documents.source_type='article'` импортируются только production-материалы из `kb/ru/**`; `inbox/**` не попадает в production seed.
- `_meta/**/*.json` допустимо хранить как `meta`, потому что это отдельный тип контента и он не смешивается со статьями.

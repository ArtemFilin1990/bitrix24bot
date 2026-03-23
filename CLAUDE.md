# CLAUDE.md — AI Assistant Guide for bitrix24bot

## Project Overview

**bitrix24bot** is a production Bitrix24 IM bot powered by Gemini 2.0 Flash with agentic function-calling. It serves as a bearing/roller bearing consultant ("Alexey from Everest") with deep knowledge of Russian/international bearing catalogs, CRM integration, and a full-text-searchable knowledge base.

**Core stack:**
- **Runtime**: Cloudflare Workers (JavaScript, ES modules)
- **AI**: Google Gemini 2.0 Flash with function calling
- **Database**: Cloudflare D1 (SQLite) for catalog, knowledge base, analogs, brands
- **Cache**: Cloudflare KV for 24-hour conversation history
- **CRM**: Bitrix24 REST API
- **Data pipelines**: Python 3 scripts generating idempotent SQL seeds
- **Deployment**: GitHub Actions → Wrangler CLI → Cloudflare Workers

---

## Repository Structure

```
bitrix24bot/
├── b24-imbot/
│   ├── worker.js          # Main Cloudflare Worker — all bot logic lives here
│   └── wrangler.toml      # Worker-specific Wrangler config (local overrides)
├── scripts/
│   ├── build_bearings_seed.py  # Generate SQL seed from BearingsInfo CSV sources
│   └── build_kb_seed.py        # Generate SQL seed from knowledge-base markdown
├── tests/
│   ├── fixtures/
│   │   ├── BearingsInfo/       # Sample CSVs for bearing pipeline tests
│   │   └── knowledge-base/     # Sample markdown/JSON for KB pipeline tests
│   ├── test_build_bearings_seed.py
│   └── test_build_kb_seed.py
├── schema.sql             # D1 database schema (SQLite + FTS5)
├── wrangler.toml          # Root Wrangler config (production bindings)
└── .github/workflows/
    └── deploy.yml         # CI/CD: push to main → deploy to Cloudflare Workers
```

---

## Architecture & Data Flow

```
External Git repos
  BearingsInfo/         knowledge-base/
       │                      │
       ▼                      ▼
  build_bearings_seed.py   build_kb_seed.py
       │                      │
       └──────┬───────────────┘
              ▼
         *.seed.sql  (idempotent SQL)
              │
              ▼  wrangler d1 execute
         D1 SQLite (Cloudflare)
         ├── bearings, catalog, analogs, brands
         └── kb_documents, kb_chunks, kb_chunks_fts, ...
              │
              ▼
         worker.js  (Cloudflare Worker)
         ├── POST /imbot   ← Bitrix24 webhook
         ├── askGemini()   → Gemini 2.0 Flash API
         │     └── executeTool()  → D1 queries
         └── botReply()    → Bitrix24 REST API
```

---

## Key Files

### `b24-imbot/worker.js`

The entire bot logic in one file (~1,237 lines). Major sections:

| Section | Description |
|---|---|
| `SYSTEM_PROMPT` | Persona, behavioral rules, and proactive tool-use instructions for Gemini |
| `TOOLS` array | 9 function definitions sent to Gemini: `get_deal`, `search_deals`, `get_company`, `get_deal_products`, `get_my_deals`, `search_catalog`, `search_knowledge`, `search_brand`, `search_analogs` |
| `b24(env, method, params)` | Bitrix24 REST API HTTP wrapper |
| `botReply(env, chatId, text)` | Send BB-code message to Bitrix24 chat |
| `askGemini(env, history, userText)` | Iterative Gemini function-calling loop (max 5 iterations) |
| `executeTool(toolName, args, env)` | Dispatch tool calls to D1 queries or Bitrix24 API |
| `getHistory / saveHistory` | KV conversation history (last 20 turns, 24-hour TTL) |
| Import endpoints | `/import-catalog`, `/import-catalog-csv`, `/import-catalog-crm`, `/import-doc`, `/import-doc-bulk`, `/import-brands-bulk`, `/import-analogs` |
| Main handler | Route dispatch: `/imbot` (webhook), `/register`, `/discover-catalog`, `/preview-file` |

**Text formatting**: Bitrix24 uses BB-code: `[B]bold[/B]`, `[I]italic[/I]`, `[U]underline[/U]` — not markdown.

**Group chat filtering**: Bot only responds if message contains keywords like "подшипник", "сделка", "цена", "каталог", "заказ", etc., or the bot is @-mentioned.

### `schema.sql`

Canonical D1 schema. Key tables:

| Table | Purpose |
|---|---|
| `bearings` | Simple lookup: article, name, brand, weight |
| `catalog` | Extended: 24 cols — dimensions (d_mm, big_d_mm, b_mm), GOST/ISO refs, prices, stock |
| `analogs` | 37,000+ cross-references: designation ↔ analog_designation across GOST/ISO/brands |
| `brands` | Manufacturer info: name, description, logo_url, search_url |
| `kb_documents` | Knowledge base docs: source_path (UNIQUE), type, lang, title, markdown, plain_text, hash |
| `kb_chunks` | Heading-aware content chunks with chunk_no ordering |
| `kb_chunks_fts` | FTS5 virtual table (auto-synced via triggers) |
| `kb_tags`, `kb_document_tags` | Many-to-many tagging |
| `kb_links` | Internal markdown link graph |
| `knowledge` | Legacy flat table for backwards-compatible queries |
| `bearing_ingest_runs`, `kb_ingest_runs` | Audit log for data imports |

### `scripts/build_bearings_seed.py`

Reads CSVs from the BearingsInfo repository and generates idempotent SQL for `bearings`, `catalog`, `analogs`, and `brands`.

```bash
python scripts/build_bearings_seed.py \
  --source-dir /path/to/BearingsInfo \
  --output bearings.seed.sql \
  --source-repo ArtemFilin1990/BearingsInfo \
  --source-snapshot <git-sha>
```

- Each `master_catalog.csv` row expands to **5 catalog rows** (one per brand: SKF, FAG, NSK, NTN, KOYO).
- Seeds are **idempotent**: uses `DELETE WHERE source_repo=...` + `INSERT OR REPLACE` / `ON CONFLICT DO UPDATE`.

### `scripts/build_kb_seed.py`

Recursively scans a knowledge-base repository, classifies documents, chunks by heading hierarchy, and generates SQL for the full normalized KB schema.

```bash
python scripts/build_kb_seed.py \
  --source-dir /path/to/knowledge-base \
  --output kb.seed.sql \
  --source-repo ArtemFilin1990/knowledge-base \
  --source-snapshot <git-sha>
```

**Document classification rules:**

| Path pattern | Type | Canonical? |
|---|---|---|
| `kb/ru/**/{README.md,INDEX.md}` | article | yes |
| `prompts/**/*.md` | prompt | no |
| `_templates/**/*.md` | template | no |
| `_meta/**/*.{md,json}` | meta | no |
| `inbox/**, scripts/**, tests/**, .github/` | — | **SKIPPED** |

---

## Development Workflows

### Running Tests

```bash
cd /path/to/bitrix24bot
python -m pytest tests/ -v
```

Tests use in-memory SQLite (`:memory:`) — no Cloudflare account or D1 required. All fixtures are in `tests/fixtures/`.

Test files:
- `tests/test_build_bearings_seed.py` — verifies catalog/analog/brand counts and idempotency
- `tests/test_build_kb_seed.py` — verifies document classification, FTS indexing, and idempotency

### Deploying the Worker

```bash
# From repo root
wrangler deploy
# or
wrangler deploy --config b24-imbot/wrangler.toml
```

Deployment is also automated via GitHub Actions on push to `main`.

### Loading Data into D1

```bash
# Apply schema
wrangler d1 execute bearings-catalog --file schema.sql

# Generate and apply bearing seed
python scripts/build_bearings_seed.py --source-dir ../BearingsInfo --output /tmp/bearings.sql
wrangler d1 execute bearings-catalog --file /tmp/bearings.sql

# Generate and apply knowledge base seed
python scripts/build_kb_seed.py --source-dir ../knowledge-base --output /tmp/kb.sql
wrangler d1 execute bearings-catalog --file /tmp/kb.sql
```

### Registering the Bot

```
GET <worker-url>/register?secret=<IMPORT_SECRET>
```

Must be done once after initial deployment.

### Import Endpoints (Admin)

All require `?secret=<IMPORT_SECRET>` header or query param.

| Endpoint | Method | Description |
|---|---|---|
| `/import-catalog` | GET | Import semicolon-delimited CSV from Bitrix24 Disk |
| `/import-catalog-csv` | GET | Import extended CSV with auto-detected columns |
| `/import-catalog-crm` | GET | Import from Bitrix24 trade or CRM catalog |
| `/import-doc` | GET | Import single Markdown doc from Disk |
| `/import-doc-bulk` | POST | Bulk import docs (JSON array) |
| `/import-brands-bulk` | POST | Bulk import brands (JSON array) |
| `/import-analogs` | GET | Import analog mappings from CSV |
| `/discover-catalog` | GET | List available Bitrix24 catalog iblock IDs |
| `/preview-file` | GET | Preview first N lines of a Disk file |

---

## Key Conventions

### JavaScript (worker.js)

- **Single-file architecture**: all logic in `b24-imbot/worker.js` — no bundler, no imports.
- **Environment variables** accessed via `env.*` (injected by Wrangler):
  - `env.GEMINI_API_KEY` — Google Gemini API key
  - `env.BITRIX_WEBHOOK_URL` — Bitrix24 webhook base URL
  - `env.IMPORT_SECRET` — Secret for admin import endpoints
  - `env.BOT_ID` — Bitrix24 bot ID
  - `env.CHAT_HISTORY` — KV namespace binding
  - `env.DB` — D1 database binding
- **Error handling**: wrap tool calls in try/catch, return error strings that Gemini can relay to the user.
- **Bitrix24 text format**: always use BB-code, never markdown, in bot replies.
- **History trimming**: keep last 20 turns (40 messages) to stay within Gemini context limits.
- **Function calling loop**: max 5 Gemini iterations per user message to prevent infinite loops.

### Python (scripts/)

- **Python 3.9+** compatible; use `pathlib`, `dataclasses`, `argparse`, `csv`, `hashlib`, `json`.
- No third-party dependencies — stdlib only.
- **Idempotency is critical**: all seeds must be safe to re-run. Use `DELETE WHERE source_repo=...` before re-inserting.
- **SQL escaping**: use the project's `sql_quote()` / `sql_value()` helpers — do not use f-strings directly for SQL values.
- **CSV reading**: always use `read_csv()` helper (handles UTF-8 BOM and semicolon delimiters).
- **Logging**: print progress to stdout; use `bearing_ingest_runs` / `kb_ingest_runs` tables for audit.

### SQL / Schema

- Database: SQLite dialect (Cloudflare D1). No PostgreSQL-specific syntax.
- FTS: use FTS5 (`USING fts5`) with `content=` and `content_rowid=` for external content tables.
- Triggers maintain FTS index sync automatically — do not manually insert into `_fts` tables.
- Indexes: always index columns used in `WHERE` / `JOIN` clauses.
- All tables use `INTEGER PRIMARY KEY` (auto-increment).
- `UNIQUE` constraints + `ON CONFLICT` or `INSERT OR REPLACE` for upsert patterns.

### Testing

- Every script change must have corresponding tests in `tests/`.
- Use fixture data in `tests/fixtures/` — never make network calls in tests.
- Test idempotency: run the seed twice and assert row counts are stable.
- Test skipping: verify that `inbox/`, `scripts/`, `tests/`, `.github/` paths are never imported.

### Git / CI

- Feature branches follow the pattern: `claude/<task-name>-<id>` or `codex/<task-name>`.
- PRs are merged into `main`; `main` auto-deploys via GitHub Actions.
- Commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:` prefixes.
- The `.gitignore` excludes `*.sh` (secrets/scripts) and `.wrangler/` (local build artifacts).

---

## Environment Variables & Secrets

| Variable | Location | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Cloudflare Worker secret | Google Gemini API access |
| `BITRIX_WEBHOOK_URL` | Cloudflare Worker secret | Bitrix24 REST endpoint |
| `IMPORT_SECRET` | Cloudflare Worker secret | Protects admin import endpoints |
| `BOT_ID` | `wrangler.toml` vars | Bitrix24 bot registration ID |
| `CLIENT_ID` | `wrangler.toml` vars | Bitrix24 app client ID |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Wrangler deployment auth |

Secrets are set via `wrangler secret put <NAME>` — never commit secret values.

---

## Common Tasks for AI Assistants

### Adding a New Tool (Gemini Function)

1. Add function definition to the `TOOLS` array in `worker.js` with name, description, and parameters schema.
2. Add the corresponding handler case in `executeTool()`.
3. If it queries D1, write the SQL using prepared statements: `env.DB.prepare(...).bind(...).all()`.
4. Update `SYSTEM_PROMPT` to instruct Gemini when/how to use the new tool.

### Adding a New Import Endpoint

1. Add a route check in the main `fetch()` handler.
2. Validate `IMPORT_SECRET` before processing.
3. Write results to D1 and log to the appropriate `*_ingest_runs` table.

### Modifying the Database Schema

1. Edit `schema.sql` (source of truth).
2. Write a migration or re-apply full schema to D1: `wrangler d1 execute bearings-catalog --file schema.sql`.
3. Update any affected queries in `worker.js` and seed scripts.
4. Update fixtures and tests accordingly.

### Adding Knowledge Base Document Types

1. Add classification rule in `build_kb_seed.py`'s `classify()` function.
2. Add fixture files in `tests/fixtures/knowledge-base/`.
3. Add test assertions in `test_build_kb_seed.py`.

---

## Bearing Domain Context

The bot works with Russian and international bearing standards:

- **ГОСТ (GOST)**: Russian standard designation (e.g., `207`, `305`, `6205`)
- **ISO**: International standard (e.g., `6205`, `NU 205`)
- **Brand codes**: Manufacturer-specific (e.g., SKF `6205`, FAG `6205.C3`)
- **Size matching**: d × D × B (inner diameter × outer diameter × width in mm)
- **Key brands**: SKF, FAG, NSK, NTN, KOYO, TIMKEN, INA, IKO, ZKL, GPZ

Search priority in `search_catalog`: exact designation match → GOST/ISO ref match → size match.

Search priority in `search_analogs`: exact designation → partial match → cross-reference chains.

# CLAUDE.md — AI Assistant Guide for bitrix24bot

## Project Overview

**bitrix24bot** is a production Bitrix24 IM bot powered by Gemini 2.5 Flash with agentic function-calling. It serves as a bearing/roller bearing consultant ("Alexey from Everest") with deep knowledge of Russian/international bearing catalogs, CRM integration, and a full-text-searchable knowledge base.

**Core stack:**
- **Runtime**: Cloudflare Workers (JavaScript, ES modules)
- **AI**: Google Gemini 2.5 Flash with function calling
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
│   ├── worker.js          # Main Cloudflare Worker — all bot logic lives here (~1,240 lines)
│   └── worker.test.js     # Vitest tests for the worker
├── scripts/
│   ├── build_bearings_seed.py  # Generate SQL seed from BearingsInfo CSV sources
│   ├── build_kb_seed.py        # Generate SQL seed from knowledge-base markdown
│   └── process_inbox.py        # Process inbox/ folder files into idempotent SQL
├── tests/
│   ├── fixtures/
│   │   ├── BearingsInfo/       # Sample CSVs for bearing pipeline tests
│   │   ├── knowledge-base/     # Sample markdown/JSON for KB pipeline tests
│   │   └── inbox/              # Sample inbox files (docs, catalog, analogs, brands)
│   ├── test_build_bearings_seed.py
│   ├── test_build_kb_seed.py
│   └── test_process_inbox.py
├── inbox/
│   ├── catalog/           # Drop CSV files here to import into catalog table
│   ├── analogs/           # Drop CSV files here to import analog mappings
│   ├── brands/            # Drop CSV files here to import brand metadata
│   └── docs/              # Drop Markdown files here to import into knowledge base
├── schema.sql             # D1 database schema reference (deprecated — use migrations/)
├── migrations/
│   └── 0001_initial.sql   # Initial D1 migration (canonical schema source)
├── requirements.txt       # Python dependencies (pytest for tests)
├── wrangler.toml          # Wrangler config (single source of truth)
├── SITEMAP.md             # Repository navigation guide
└── .github/workflows/
    ├── deploy.yml         # CI/CD: push to main (non-inbox) → deploy to Cloudflare Workers
    ├── process-inbox.yml  # CI/CD: push to main (inbox/ changes) → process files into D1
    ├── seed-database.yml  # Manual/push: apply schema + seed bearings + KB + register bot
    └── check-db.yml       # Manual: query D1 table counts and last ingest timestamps
```

The repository root also contains 100+ Markdown reference documents covering GOST/ISO bearing standards, bearing types, manufacturers, and technical specifications.

---

## Architecture & Data Flow

```
External Git repos          inbox/ folder (git-tracked)
  BearingsInfo/  knowledge-base/  │
       │               │          │ (CSV/Markdown commits)
       ▼               ▼          ▼
  build_bearings_  build_kb_   process_inbox.py
     seed.py         seed.py       │
       │               │          │
       └───────┬────────┘          │
               ▼                   ▼
          *.seed.sql           /tmp/inbox.sql
               │                   │
               └─────────┬─────────┘
                          ▼  wrangler d1 execute
                     D1 SQLite (Cloudflare)
                     ├── bearings, catalog, analogs, brands
                     └── kb_documents, kb_chunks, kb_chunks_fts, ...
                          │
                          ▼
                     worker.js  (Cloudflare Worker)
                     ├── POST /imbot   ← Bitrix24 webhook
                     ├── askGemini()   → Gemini 2.5 Flash API
                     │     └── executeTool()  → D1 queries
                     └── botReply()    → Bitrix24 REST API
```

---

## Key Files

### `b24-imbot/worker.js`

The entire bot logic in one file (~1,240 lines). Major sections:

| Section | Description |
|---|---|
| `SYSTEM_PROMPT` | Persona, behavioral rules, and proactive tool-use instructions for Gemini |
| `TOOLS` array | 9 function definitions sent to Gemini: `get_deal`, `search_deals`, `get_company`, `get_deal_products`, `get_my_deals`, `search_catalog`, `search_knowledge`, `search_brand`, `search_analogs` |
| `b24(env, method, params)` | Bitrix24 REST API HTTP wrapper |
| `botReply(env, chatId, text)` | Send BB-code message to Bitrix24 chat |
| `extractHeadingChunks(markdown)` | Parse markdown into heading-aware chunks (1200 chars max) |
| `stripMarkdown(markdown)` | Remove markdown formatting for plain text indexing |
| `upsertKnowledgeDocument(env, {...})` | Insert/update KB doc with chunks, tags, links, FTS sync |
| `askGemini(env, history, userText)` | Iterative Gemini function-calling loop (max 5 iterations) |
| `executeTool(toolName, args, env)` | Dispatch tool calls to D1 queries or Bitrix24 API |
| `getHistory / saveHistory` | KV conversation history (last 20 turns, 24-hour TTL) |

**Text formatting**: Bitrix24 uses BB-code: `[B]bold[/B]`, `[I]italic[/I]`, `[U]underline[/U]` — not markdown.

**Group chat filtering**: Bot only responds if message contains keywords like "подшипник", "сделка", "цена", "каталог", "заказ", etc., or the bot is @-mentioned.

**Endpoints (12 total):**

| Route | Method | Auth | Description |
|---|---|---|---|
| `/imbot` | POST | B24 signature | Main webhook for incoming Bitrix24 messages |
| `/register` | GET | None | Register bot with Bitrix24 (run once after deploy) |
| `/reset` | POST | None | Clear a user's conversation history in KV |
| `/import-catalog` | GET | IMPORT_SECRET | Import semicolon-delimited CSV from Bitrix24 Disk |
| `/import-catalog-csv` | GET | IMPORT_SECRET | Import extended CSV with auto-detected columns |
| `/import-catalog-crm` | GET | IMPORT_SECRET | Import from Bitrix24 trade or CRM catalog iblock |
| `/import-doc` | GET | IMPORT_SECRET | Import single Markdown doc from Disk |
| `/import-doc-bulk` | POST | IMPORT_SECRET | Bulk import docs (JSON array) |
| `/import-brands-bulk` | POST | IMPORT_SECRET | Bulk import brands (JSON array) |
| `/import-analogs` | GET | IMPORT_SECRET | Import analog mappings from CSV |
| `/discover-catalog` | GET | IMPORT_SECRET | List available Bitrix24 catalog iblock IDs |
| `/preview-file` | GET | IMPORT_SECRET | Preview first N lines of a Disk file |

### `schema.sql` / `migrations/`

Database schema managed via D1 migrations in `migrations/`. `schema.sql` is kept as a reference. Key tables:

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
| `knowledge` | Legacy flat table for backwards-compatible queries (auto-synced via triggers) |
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

### `scripts/process_inbox.py`

Processes files committed to the `inbox/` folder and generates idempotent SQL for D1. This is the primary workflow for day-to-day data updates — drop files into `inbox/` subfolders and commit to `main`.

```bash
python scripts/process_inbox.py \
  --inbox inbox \
  --output /tmp/inbox.sql \
  --source-repo ArtemFilin1990/bitrix24bot
```

**Processes four inbox subfolder types:**

| Subfolder | Content | Target Tables |
|---|---|---|
| `inbox/docs/` | Markdown files (with optional YAML frontmatter) | `kb_documents`, `kb_chunks`, `kb_tags`, `kb_links`, `kb_chunks_fts`, `knowledge` |
| `inbox/catalog/` | CSV files (comma or semicolon separated, Russian/English headers) | `catalog` |
| `inbox/analogs/` | CSV files with `brand`, `designation`, `analog_designation`, `analog_brand`, `factory` | `analogs` |
| `inbox/brands/` | CSV files with `name`, `description`, `logo_url`, `search_url` | `brands` |

After processing, the CI workflow auto-deletes the processed files and commits with `[skip ci]`.

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
- `tests/test_process_inbox.py` — verifies inbox/ processing for docs, catalog, analogs, brands, and FTS

### Deploying the Worker

```bash
# From repo root
wrangler deploy
```

Deployment is automated via GitHub Actions on push to `main` (excluding `inbox/` path changes).

### Loading Data into D1

```bash
# Apply schema via migrations
wrangler d1 migrations apply bearings-catalog

# Generate and apply bearing seed
python scripts/build_bearings_seed.py --source-dir ../BearingsInfo --output /tmp/bearings.sql
wrangler d1 execute bearings-catalog --file /tmp/bearings.sql

# Generate and apply knowledge base seed
python scripts/build_kb_seed.py --source-dir ../knowledge-base --output /tmp/kb.sql
wrangler d1 execute bearings-catalog --file /tmp/kb.sql

# Process inbox files manually
python scripts/process_inbox.py --inbox inbox --output /tmp/inbox.sql
wrangler d1 execute bearings-catalog --file /tmp/inbox.sql --remote
```

### Using the Inbox Workflow

The easiest way to add data is the inbox/ git workflow:

1. Copy files into the appropriate `inbox/` subfolder
2. Commit and push to `main`
3. GitHub Actions (`process-inbox.yml`) automatically processes the files and loads them into D1
4. Processed files are auto-deleted in a follow-up `[skip ci]` commit

### Registering the Bot

```
GET <worker-url>/register?secret=<IMPORT_SECRET>
```

Must be done once after initial deployment.

---

## Key Conventions

### JavaScript (worker.js)

- **Single-file architecture**: all logic in `b24-imbot/worker.js` — no bundler, no imports.
- **Environment variables** accessed via `env.*` (injected by Wrangler):
  - `env.GEMINI_API_KEY` — Google Gemini API key
  - `env.B24_PORTAL` — Bitrix24 portal URL
  - `env.B24_USER_ID` — Bitrix24 REST auth user ID
  - `env.B24_TOKEN` — Bitrix24 REST auth token
  - `env.IMPORT_SECRET` — Secret for admin import endpoints
  - `env.BOT_ID` — Bitrix24 bot ID
  - `env.CHAT_HISTORY` — KV namespace binding
  - `env.CATALOG` — D1 database binding (note: binding name is `CATALOG`, not `DB`)
- **Error handling**: wrap tool calls in try/catch, return error strings that Gemini can relay to the user.
- **Bitrix24 text format**: always use BB-code, never markdown, in bot replies.
- **History trimming**: keep last 20 turns (40 messages) to stay within Gemini context limits.
- **Function calling loop**: max 5 Gemini iterations per user message to prevent infinite loops.
- **D1 queries**: use prepared statements — `env.CATALOG.prepare(...).bind(...).all()`.

### Python (scripts/)

- **Python 3.9+** compatible; use `pathlib`, `dataclasses`, `argparse`, `csv`, `hashlib`, `json`.
- No third-party dependencies — stdlib only.
- **Idempotency is critical**: all seeds must be safe to re-run. Use `DELETE WHERE source_repo=...` before re-inserting.
- **SQL escaping**: use the project's `sql_quote()` / `sql_value()` helpers — do not use f-strings directly for SQL values.
- **CSV reading**: always use `read_csv()` / `_read_csv()` helpers (handles UTF-8 BOM, semicolon/comma delimiters).
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
- The `.gitignore` excludes `*.sh` (secrets/scripts), `.wrangler/` (local build artifacts), `__pycache__/`, `*.pyc`, `*.pyo`.
- The `process-inbox.yml` workflow uses `[skip ci]` in auto-commits to prevent deploy loops.

**GitHub Actions workflows (4 total):**

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy.yml` | Push to `main` (non-`inbox/` paths) or `workflow_dispatch` | Build & deploy Worker via `wrangler deploy` |
| `process-inbox.yml` | Push to `main` (`inbox/**` paths) or `workflow_dispatch` | Process inbox files → D1; auto-delete + commit `[skip ci]` |
| `seed-database.yml` | Push to `main` (own file changes) or `workflow_dispatch` | Apply D1 migrations, clone & seed BearingsInfo + knowledge-base, register bot |
| `check-db.yml` | `workflow_dispatch` only | Query D1 row counts and last ingest audit rows (read-only diagnostic) |

All workflows use `wrangler@4.76.0` and Node.js 24. `deploy.yml` and `seed-database.yml` accept an optional `cf_token` input to override `secrets.CLOUDFLARE_API_TOKEN`.

---

## Environment Variables & Secrets

| Variable | Location | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Cloudflare Worker secret | Google Gemini API access |
| `B24_PORTAL` | Cloudflare Worker secret | Bitrix24 portal URL |
| `B24_USER_ID` | Cloudflare Worker secret | Bitrix24 REST auth user ID |
| `B24_TOKEN` | Cloudflare Worker secret | Bitrix24 REST auth token |
| `IMPORT_SECRET` | Cloudflare Worker secret | Protects admin import endpoints |
| `WORKER_HOST` | Cloudflare Worker secret | Worker domain (for registration callback) |
| `BOT_ID` | `wrangler.toml` vars | Bitrix24 bot registration ID |
| `CLIENT_ID` | `wrangler.toml` vars | Bitrix24 app client ID |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Wrangler deployment auth |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Cloudflare account ID for D1 remote access |

Secrets are set via `wrangler secret put <NAME>` — never commit secret values.

---

## Common Tasks for AI Assistants

### Adding a New Tool (Gemini Function)

1. Add function definition to the `TOOLS` array in `worker.js` with name, description, and parameters schema.
2. Add the corresponding handler case in `executeTool()`.
3. If it queries D1, write the SQL using prepared statements: `env.CATALOG.prepare(...).bind(...).all()`.
4. Update `SYSTEM_PROMPT` to instruct Gemini when/how to use the new tool.

### Adding a New Import Endpoint

1. Add a route check in the main `fetch()` handler.
2. Validate `IMPORT_SECRET` before processing.
3. Write results to D1 and log to the appropriate `*_ingest_runs` table.

### Modifying the Database Schema

1. Create a new migration file in `migrations/` (e.g., `migrations/0002_add_column.sql`).
2. Apply locally: `wrangler d1 migrations apply bearings-catalog --local`.
3. Apply to production: `wrangler d1 migrations apply bearings-catalog --remote`.
4. Update any affected queries in `worker.js` and seed scripts.
5. Update fixtures and tests accordingly.

### Adding Knowledge Base Document Types

1. Add classification rule in `build_kb_seed.py`'s `classify()` function.
2. Add fixture files in `tests/fixtures/knowledge-base/`.
3. Add test assertions in `test_build_kb_seed.py`.

### Adding a New Inbox Data Type

1. Add a new subfolder under `inbox/` (e.g., `inbox/newtype/`).
2. Add a `process_newtype(path)` function in `scripts/process_inbox.py`.
3. Wire it into the main `process_inbox()` dispatcher.
4. Add fixture files in `tests/fixtures/inbox/newtype/`.
5. Add test assertions in `tests/test_process_inbox.py`.

---

## Bearing Domain Context

The bot works with Russian and international bearing standards:

- **ГОСТ (GOST)**: Russian standard designation (e.g., `207`, `305`, `6205`)
- **ISO**: International standard (e.g., `6205`, `NU 205`)
- **Brand codes**: Manufacturer-specific (e.g., SKF `6205`, FAG `6205.C3`)
- **Size matching**: d × D × B (inner diameter × outer diameter × width in mm)
- **Key brands**: SKF, FAG, NSK, NTN, KOYO, TIMKEN, INA, IKO, ZKL, GPZ, CRAFT, BBC-R, ГПЗ, АПП

Search priority in `search_catalog`: exact designation match → GOST/ISO ref match → size match.

Search priority in `search_analogs`: exact designation → partial match → cross-reference chains.

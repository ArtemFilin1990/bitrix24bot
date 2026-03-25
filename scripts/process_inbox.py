#!/usr/bin/env python3
"""
Process inbox/ files and generate idempotent SQL for D1 import.

Folder conventions:
  inbox/docs/     → .md  → kb_documents + kb_chunks + FTS rebuild
  inbox/catalog/  → .csv → catalog table (INSERT OR REPLACE)
  inbox/analogs/  → .csv → analogs table (DELETE by stem + INSERT)
  inbox/brands/   → .csv → brands table  (INSERT OR REPLACE)

Usage:
  python scripts/process_inbox.py --inbox inbox --output /tmp/inbox.sql
"""
from __future__ import annotations

import argparse
import csv as csv_module
import hashlib
import io
import json
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(_SCRIPTS_DIR))

from build_kb_seed import (  # noqa: E402
    LINK_RE,
    chunk_markdown,
    infer_title,
    parse_frontmatter,
    sql_quote,
    strip_markdown,
)

_DEFAULT_SOURCE_REPO = "ArtemFilin1990/bitrix24bot"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _detect_sep(text: str) -> str:
    """Detect CSV delimiter using Sniffer; fall back to semicolon."""
    sample = "\n".join(text.splitlines()[:5])
    try:
        dialect = csv_module.Sniffer().sniff(sample, delimiters=",;\t")
        return dialect.delimiter
    except csv_module.Error:
        return ";"


def _read_csv(text: str, sep: str = ";") -> tuple[list[str], list[list[str]]]:
    text = text.lstrip("\ufeff")
    reader = csv_module.reader(io.StringIO(text), delimiter=sep)
    rows = list(reader)
    if not rows:
        return [], []
    return [h.strip() for h in rows[0]], rows[1:]


def _find(header_lower: list[str], *keywords: str) -> int:
    return next(
        (i for i, h in enumerate(header_lower) if any(kw in h for kw in keywords)),
        -1,
    )


def _find_exact(header: list[str], *names: str) -> int:
    """Exact case-sensitive match — used to distinguish d / D / B columns."""
    return next(
        (i for i, h in enumerate(header) if h.strip() in names),
        -1,
    )


def _get(row: list[str], idx: int) -> str:
    return (row[idx] if 0 <= idx < len(row) else "").strip()


def _getnum(row: list[str], idx: int) -> float | None:
    v = _get(row, idx).replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None


# ── Markdown → kb_documents ───────────────────────────────────────────────────

def process_doc(path: Path, docs_root: Path, source_repo: str) -> str:
    """Generate UPSERT SQL for a single Markdown file."""
    raw = path.read_text(encoding="utf-8")
    frontmatter, body = parse_frontmatter(raw)

    rel_in_docs = path.relative_to(docs_root).as_posix()
    source_path = f"inbox/docs/{rel_in_docs}"
    slug = path.stem

    title = frontmatter.get("title") or infer_title(body, slug)
    rel_parent = path.parent.relative_to(docs_root).as_posix()
    section_path = "" if rel_parent == "." else rel_parent

    plain_text = strip_markdown(body)
    content_hash = _sha256(raw)
    source_type = str(frontmatter.get("type", "article"))
    lang = str(frontmatter.get("lang", "ru"))
    is_canonical = 1 if source_type == "article" else 0

    tags: list[str] = []
    if isinstance(frontmatter.get("tags"), list):
        tags.extend(str(t) for t in frontmatter["tags"])
    tags.extend([source_type, lang])
    tags = sorted({t.strip() for t in tags if t.strip()})

    fm_json = json.dumps(frontmatter, ensure_ascii=False, sort_keys=True)
    chunks = chunk_markdown(body)
    links = [(target, text) for text, target in LINK_RE.findall(body)]

    sp = sql_quote(source_path)
    lines = [
        f"-- doc: {source_path}",
        # Clean up existing data for this specific document
        f"DELETE FROM kb_chunks WHERE document_id = (SELECT id FROM kb_documents WHERE source_path = {sp});",
        f"DELETE FROM kb_document_tags WHERE document_id = (SELECT id FROM kb_documents WHERE source_path = {sp});",
        f"DELETE FROM kb_links WHERE document_id = (SELECT id FROM kb_documents WHERE source_path = {sp});",
        # Upsert document
        (
            "INSERT INTO kb_documents "
            "(source_repo, source_path, source_type, lang, slug, title, section_path, "
            "frontmatter_json, raw_markdown, plain_text, content_hash, is_canonical) "
            f"VALUES ({sql_quote(source_repo)}, {sp}, {sql_quote(source_type)}, "
            f"{sql_quote(lang)}, {sql_quote(slug)}, {sql_quote(title)}, "
            f"{sql_quote(section_path)}, {sql_quote(fm_json)}, {sql_quote(raw)}, "
            f"{sql_quote(plain_text)}, {sql_quote(content_hash)}, {is_canonical}) "
            "ON CONFLICT(source_path) DO UPDATE SET "
            "source_type=excluded.source_type, lang=excluded.lang, slug=excluded.slug, "
            "title=excluded.title, section_path=excluded.section_path, "
            "frontmatter_json=excluded.frontmatter_json, raw_markdown=excluded.raw_markdown, "
            "plain_text=excluded.plain_text, content_hash=excluded.content_hash, "
            "is_canonical=excluded.is_canonical, updated_at=CURRENT_TIMESTAMP;"
        ),
    ]

    for tag in tags:
        qt = sql_quote(tag)
        lines.append(f"INSERT INTO kb_tags (name) VALUES ({qt}) ON CONFLICT(name) DO NOTHING;")
        lines.append(
            "INSERT OR IGNORE INTO kb_document_tags (document_id, tag_id) "
            f"SELECT d.id, t.id FROM kb_documents d JOIN kb_tags t ON t.name = {qt} "
            f"WHERE d.source_path = {sp};"
        )

    for idx, chunk in enumerate(chunks):
        lines.append(
            "INSERT INTO kb_chunks (document_id, chunk_no, heading_path, content, tokens_est) "
            f"SELECT id, {idx}, {sql_quote(chunk['heading_path'])}, "
            f"{sql_quote(chunk['content'])}, {chunk['tokens_est']} "
            f"FROM kb_documents WHERE source_path = {sp};"
        )

    for target_path, anchor_text in links:
        lines.append(
            "INSERT INTO kb_links (document_id, target_path, anchor_text, link_type) "
            f"SELECT id, {sql_quote(target_path)}, {sql_quote(anchor_text)}, 'internal' "
            f"FROM kb_documents WHERE source_path = {sp};"
        )

    if is_canonical and source_type == "article":
        tags_csv = ", ".join(tags)
        lines.append(
            f"INSERT INTO knowledge (title, content, tags) "
            f"VALUES ({sql_quote(title)}, {sql_quote(raw)}, {sql_quote(tags_csv)}) "
            "ON CONFLICT(title) DO UPDATE SET content=excluded.content, tags=excluded.tags;"
        )

    return "\n".join(lines)


# ── CSV → catalog ──────────────────────────────────────────────────────────────

def process_catalog(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    header, rows = _read_csv(text, _detect_sep(text))
    hl = [h.lower() for h in header]

    # For d / D / B: try Russian keywords first, then exact case-sensitive match.
    # This handles both "Внутр.диаметр" style and bare "d", "D", "B" columns.
    def _col_dim(ru_kw: str, exact: str) -> int:
        idx = _find(hl, ru_kw)
        return idx if idx >= 0 else _find_exact(header, exact)

    cols = {
        "item_id":        _find(hl, "id"),
        "manufacturer":   _find(hl, "произв", "завод"),
        "category_ru":    _find(hl, "раздел1", "категор"),
        "subcategory_ru": _find(hl, "раздел2", "подкатег"),
        "series_ru":      _find(hl, "серия", "раздел3"),
        "name_ru":        _find(hl, "наимен"),
        "designation":    _find(hl, "обознач", "артикул"),
        "iso_ref":        _find(hl, "iso"),
        "gost_ref":       _find(hl, "гост"),
        "section":        _find(hl, "секция", "тип"),
        "d_mm":           _col_dim("внутр", "d"),
        "big_d_mm":       _col_dim("наруж", "D"),
        "b_mm":           _col_dim("шири", "B"),
        "t_mm":           _find_exact(header, "T", "t"),
        "mass_kg":        _find(hl, "масс", "вес"),
        "analog_ref":     _find(hl, "аналог"),
        "price_rub":      _find(hl, "цен"),
        "qty":            _find(hl, "кол", "остат"),
        "stock_flag":     _find(hl, "налич"),
        "brand_display":  _find(hl, "бренд"),
        "suffix_desc":    _find(hl, "суффикс", "модиф"),
    }

    lines = [f"-- catalog: {path.name}"]
    for j, row in enumerate(rows):
        if not any(c.strip() for c in row):
            continue
        item_id = _get(row, cols["item_id"]) or f"{path.stem}:{j + 1}"
        qty_raw = _get(row, cols["qty"])
        stock_raw = _get(row, cols["stock_flag"]).lower()
        stock = 1 if stock_raw in ("1", "да", "yes", "true") else 0
        qty_sql = str(int(qty_raw)) if qty_raw.isdigit() else "NULL"

        def n(key: str) -> str:
            v = _getnum(row, cols[key])
            return str(v) if v is not None else "NULL"

        vals = (
            f"{sql_quote(item_id)}, "
            f"{sql_quote(_get(row, cols['manufacturer']))}, "
            f"{sql_quote(_get(row, cols['category_ru']))}, "
            f"{sql_quote(_get(row, cols['subcategory_ru']))}, "
            f"{sql_quote(_get(row, cols['series_ru']))}, "
            f"{sql_quote(_get(row, cols['name_ru']))}, "
            f"{sql_quote(_get(row, cols['designation']))}, "
            f"{sql_quote(_get(row, cols['iso_ref']))}, "
            f"{sql_quote(_get(row, cols['section']))}, "
            f"{n('d_mm')}, {n('big_d_mm')}, {n('b_mm')}, {n('t_mm')}, {n('mass_kg')}, "
            f"{sql_quote(_get(row, cols['analog_ref']))}, "
            f"{n('price_rub')}, "
            f"{qty_sql}, {stock}, "
            "'', '', '', "
            f"{sql_quote(_get(row, cols['gost_ref']))}, "
            f"{sql_quote(_get(row, cols['brand_display']))}, "
            f"{sql_quote(_get(row, cols['suffix_desc']))}"
        )
        lines.append(
            "INSERT OR REPLACE INTO catalog "
            "(item_id, manufacturer, category_ru, subcategory_ru, series_ru, name_ru, "
            "designation, iso_ref, section, d_mm, big_d_mm, b_mm, t_mm, mass_kg, "
            "analog_ref, price_rub, qty, stock_flag, "
            "bitrix_section_1, bitrix_section_2, bitrix_section_3, "
            f"gost_ref, brand_display, suffix_desc) VALUES ({vals});"
        )
    return "\n".join(lines)


# ── CSV → analogs ──────────────────────────────────────────────────────────────

def process_analogs(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    header, rows = _read_csv(text, _detect_sep(text))
    hl = [h.lower() for h in header]

    iBrand  = _find(hl, "бренд", "марка", "brand")
    iDesig  = _find(hl, "обозначен", "артикул", "designation", "номер")
    iADesig = _find(hl, "аналог", "analog")
    iABrand = _find(hl, "произв", "завод", "factory", "manufacturer")

    factory = sql_quote(path.stem)
    lines = [
        f"-- analogs: {path.name}",
        f"DELETE FROM analogs WHERE factory = {factory};",
    ]
    for row in rows:
        desig  = _get(row, iDesig)
        adesig = _get(row, iADesig)
        if not desig and not adesig:
            continue
        lines.append(
            "INSERT INTO analogs (brand, designation, analog_designation, analog_brand, factory) "
            f"VALUES ({sql_quote(_get(row, iBrand))}, {sql_quote(desig)}, "
            f"{sql_quote(adesig)}, {sql_quote(_get(row, iABrand))}, {factory});"
        )
    return "\n".join(lines)


# ── CSV → brands ───────────────────────────────────────────────────────────────

def process_brands(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    header, rows = _read_csv(text, _detect_sep(text))
    hl = [h.lower() for h in header]

    iName   = _find(hl, "name", "название", "бренд", "марка")
    iDesc   = _find(hl, "desc", "описан")
    iLogo   = _find(hl, "logo")
    iSearch = _find(hl, "search", "url", "сайт")

    lines = [f"-- brands: {path.name}"]
    for row in rows:
        name = _get(row, iName)
        if not name:
            continue
        lines.append(
            "INSERT INTO brands (name, description, logo_url, search_url) "
            f"VALUES ({sql_quote(name)}, {sql_quote(_get(row, iDesc))}, "
            f"{sql_quote(_get(row, iLogo))}, {sql_quote(_get(row, iSearch))}) "
            "ON CONFLICT(name) DO UPDATE SET description=excluded.description, "
            "logo_url=excluded.logo_url, search_url=excluded.search_url;"
        )
    return "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Process inbox/ files → SQL for D1")
    parser.add_argument("--inbox", default="inbox", help="Path to inbox directory")
    parser.add_argument("--output", required=True, help="Output .sql file path")
    parser.add_argument(
        "--source-repo",
        default=_DEFAULT_SOURCE_REPO,
        help="Source repo string written into kb_documents.source_repo",
    )
    args = parser.parse_args()

    inbox = Path(args.inbox)
    source_repo = args.source_repo
    stats = {"docs": 0, "catalog": 0, "analogs": 0, "brands": 0, "total_files": 0}

    sql_parts = [
        "-- Generated by scripts/process_inbox.py",
        "PRAGMA foreign_keys = ON;",
        "BEGIN TRANSACTION;",
    ]

    # Markdown docs → kb_documents + kb_chunks (FTS updated via schema triggers)
    for md_file in sorted((inbox / "docs").rglob("*.md")):
        sql_parts.append(process_doc(md_file, inbox / "docs", source_repo))
        stats["docs"] += 1

    for csv_file in sorted((inbox / "catalog").glob("*.csv")):
        sql_parts.append(process_catalog(csv_file))
        stats["catalog"] += 1

    for csv_file in sorted((inbox / "analogs").glob("*.csv")):
        sql_parts.append(process_analogs(csv_file))
        stats["analogs"] += 1

    for csv_file in sorted((inbox / "brands").glob("*.csv")):
        sql_parts.append(process_brands(csv_file))
        stats["brands"] += 1

    stats["total_files"] = stats["docs"] + stats["catalog"] + stats["analogs"] + stats["brands"]
    notes = json.dumps(
        {"docs": stats["docs"], "catalog": stats["catalog"],
         "analogs": stats["analogs"], "brands": stats["brands"]},
        ensure_ascii=False,
    )
    sql_parts.append(
        f"INSERT INTO kb_ingest_runs (source_snapshot, files_seen, files_loaded, files_skipped, finished_at, notes) "
        f"VALUES ({sql_quote(source_repo)}, {stats['total_files']}, {stats['total_files']}, 0, CURRENT_TIMESTAMP, {sql_quote(notes)});"
    )
    sql_parts.append("COMMIT;")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(sql_parts) + "\n", encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()

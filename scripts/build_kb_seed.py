#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

HEADING_RE = re.compile(r'^(#{1,3})\s+(.+?)\s*$', re.MULTILINE)
FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n?', re.DOTALL)
LINK_RE = re.compile(r'\[([^\]]+)\]\((?!https?:|mailto:|#)([^)]+)\)')


@dataclass
class Document:
    source_repo: str
    source_path: str
    source_type: str
    lang: str
    slug: str
    title: str
    section_path: str
    frontmatter_json: str
    raw_markdown: str
    plain_text: str
    content_hash: str
    is_canonical: int
    tags: list[str]
    links: list[tuple[str, str]]
    chunks: list[dict]


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).splitlines():
        if ':' not in line:
            continue
        key, raw = line.split(':', 1)
        key = key.strip()
        raw = raw.strip()
        if raw.startswith('[') and raw.endswith(']'):
            meta[key] = [item.strip().strip('"\'') for item in raw[1:-1].split(',') if item.strip()]
        else:
            meta[key] = raw.strip('"\'')
    return meta, text[match.end():]


def strip_markdown(text: str) -> str:
    text = re.sub(r'```[\s\S]*?```', ' ', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'[>*_~]', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def chunk_markdown(text: str, chunk_size: int = 1200) -> list[dict]:
    normalized = text.replace('\r\n', '\n')
    lines = normalized.split('\n')
    chunks: list[dict] = []
    headings: list[str] = []
    body: list[str] = []

    def flush() -> None:
        content = '\n'.join(body).strip()
        if not content:
            return
        chunks.append({
            'heading_path': ' > '.join(headings) if headings else '',
            'content': content,
            'tokens_est': max(1, len(content) // 4),
        })
        body.clear()

    for line in lines:
        match = re.match(r'^(#{1,3})\s+(.+?)\s*$', line)
        if match:
            flush()
            level = len(match.group(1))
            headings[:] = headings[: level - 1]
            if len(headings) < level:
                headings.extend([''] * (level - len(headings)))
            headings[level - 1] = match.group(2).strip()
        else:
            body.append(line)
    flush()

    if chunks:
        return chunks

    plain = normalized.strip()
    return [
        {
            'heading_path': '',
            'content': plain[i:i + chunk_size].strip(),
            'tokens_est': max(1, len(plain[i:i + chunk_size].strip()) // 4),
        }
        for i in range(0, len(plain), chunk_size)
        if plain[i:i + chunk_size].strip()
    ]


def classify(rel_path: str) -> tuple[str, int, str] | None:
    path = rel_path.replace('\\', '/')
    if path.startswith('inbox/') or path.startswith('scripts/') or path.startswith('tests/') or path.startswith('.github/') or path.startswith('.vscode/'):
        return None
    if path.startswith('kb/ru/') and path.endswith(('/README.md', '/INDEX.md')):
        return 'article', 1, 'ru'
    if path == 'kb/ru/INDEX.md':
        return 'article', 1, 'ru'
    if path.startswith('prompts/') and path.endswith('.md'):
        return 'prompt', 0, 'ru'
    if path.startswith('_templates/') and path.endswith('.md'):
        return 'template', 0, 'ru'
    if path.startswith('_meta/') and path.endswith(('.md', '.json')):
        return 'meta', 0, 'ru'
    return None


def infer_title(content: str, fallback: str) -> str:
    match = re.search(r'^#\s+(.+)$', content, flags=re.MULTILINE)
    return match.group(1).strip() if match else fallback.replace('-', ' ').replace('_', ' ')


def build_documents(source_dir: Path, source_repo: str) -> tuple[list[Document], dict]:
    docs: list[Document] = []
    seen = loaded = skipped = 0
    for path in sorted(source_dir.rglob('*')):
        if not path.is_file():
            continue
        rel_path = path.relative_to(source_dir).as_posix()
        seen += 1
        cls = classify(rel_path)
        if not cls:
            skipped += 1
            continue
        source_type, is_canonical, lang = cls
        loaded += 1
        raw = path.read_text(encoding='utf-8')
        frontmatter, body = parse_frontmatter(raw)
        default_name = path.parent.name if path.name in {'README.md', 'INDEX.md'} else path.stem
        title = frontmatter.get('title') or infer_title(body, default_name)
        slug = default_name
        section_path = path.parent.relative_to(source_dir).as_posix()
        plain_text = strip_markdown(body)
        content_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        tags = []
        if isinstance(frontmatter.get('tags'), list):
            tags.extend(str(t) for t in frontmatter['tags'])
        tags.extend([source_type, lang])
        tags.extend(segment for segment in Path(section_path).parts if not segment.startswith('_'))
        tags = sorted({t.strip() for t in tags if t and t.strip()})
        docs.append(Document(
            source_repo=source_repo,
            source_path=rel_path,
            source_type=source_type,
            lang=lang,
            slug=slug,
            title=title,
            section_path=section_path,
            frontmatter_json=json.dumps(frontmatter, ensure_ascii=False, sort_keys=True),
            raw_markdown=raw,
            plain_text=plain_text,
            content_hash=content_hash,
            is_canonical=is_canonical,
            tags=tags,
            links=[(target, text) for text, target in LINK_RE.findall(body)],
            chunks=chunk_markdown(body),
        ))
    return docs, {'files_seen': seen, 'files_loaded': loaded, 'files_skipped': skipped}


def emit_sql(documents: Iterable[Document], stats: dict, source_snapshot: str) -> str:
    documents = list(documents)
    source_repo = documents[0].source_repo if documents else 'ArtemFilin1990/knowledge-base'
    lines = [
        '-- Generated by scripts/build_kb_seed.py',
        'PRAGMA foreign_keys = ON;',
        'BEGIN TRANSACTION;',
        f"DELETE FROM kb_document_tags WHERE document_id IN (SELECT id FROM kb_documents WHERE source_repo = {sql_quote(source_repo)});",
        f"DELETE FROM kb_links WHERE document_id IN (SELECT id FROM kb_documents WHERE source_repo = {sql_quote(source_repo)});",
        f"DELETE FROM kb_chunks WHERE document_id IN (SELECT id FROM kb_documents WHERE source_repo = {sql_quote(source_repo)});",
        f"DELETE FROM kb_documents WHERE source_repo = {sql_quote(source_repo)};",
        f"DELETE FROM knowledge WHERE title IN (SELECT title FROM kb_documents WHERE source_repo = {sql_quote(source_repo)});",
        f"INSERT INTO kb_ingest_runs (source_snapshot, files_seen, files_loaded, files_skipped, finished_at, notes) VALUES ({sql_quote(source_snapshot)}, {stats['files_seen']}, {stats['files_loaded']}, {stats['files_skipped']}, CURRENT_TIMESTAMP, 'seed build');",
    ]
    for doc in documents:
        lines.append(
            'INSERT INTO kb_documents (source_repo, source_path, source_type, lang, slug, title, section_path, frontmatter_json, raw_markdown, plain_text, content_hash, is_canonical) VALUES '
            f"({sql_quote(doc.source_repo)}, {sql_quote(doc.source_path)}, {sql_quote(doc.source_type)}, {sql_quote(doc.lang)}, {sql_quote(doc.slug)}, {sql_quote(doc.title)}, {sql_quote(doc.section_path)}, {sql_quote(doc.frontmatter_json)}, {sql_quote(doc.raw_markdown)}, {sql_quote(doc.plain_text)}, {sql_quote(doc.content_hash)}, {doc.is_canonical});"
        )
        for tag in doc.tags:
            lines.append(f"INSERT INTO kb_tags (name) VALUES ({sql_quote(tag)}) ON CONFLICT(name) DO NOTHING;")
            lines.append(
                f"INSERT OR IGNORE INTO kb_document_tags (document_id, tag_id) SELECT d.id, t.id FROM kb_documents d JOIN kb_tags t ON t.name = {sql_quote(tag)} WHERE d.source_path = {sql_quote(doc.source_path)};"
            )
        for idx, chunk in enumerate(doc.chunks):
            lines.append(
                'INSERT INTO kb_chunks (document_id, chunk_no, heading_path, content, tokens_est) '
                f"SELECT id, {idx}, {sql_quote(chunk['heading_path'])}, {sql_quote(chunk['content'])}, {chunk['tokens_est']} FROM kb_documents WHERE source_path = {sql_quote(doc.source_path)};"
            )
        for target_path, anchor_text in doc.links:
            lines.append(
                'INSERT INTO kb_links (document_id, target_path, anchor_text, link_type) '
                f"SELECT id, {sql_quote(target_path)}, {sql_quote(anchor_text)}, 'internal' FROM kb_documents WHERE source_path = {sql_quote(doc.source_path)};"
            )
        if doc.is_canonical and doc.source_type == 'article':
            tags_csv = ', '.join(doc.tags)
            lines.append(
                f"INSERT INTO knowledge (title, content, tags) VALUES ({sql_quote(doc.title)}, {sql_quote(doc.raw_markdown)}, {sql_quote(tags_csv)}) ON CONFLICT(title) DO UPDATE SET content=excluded.content, tags=excluded.tags;"
            )
    lines.extend([
        "INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES ('delete-all');",
        "INSERT INTO kb_chunks_fts(rowid, title, heading_path, content, tags) SELECT c.id, d.title, COALESCE(c.heading_path, ''), c.content, COALESCE((SELECT group_concat(t.name, ' ') FROM kb_document_tags dt JOIN kb_tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id), '') FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id;",
        'COMMIT;',
    ])
    return '\n'.join(lines) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--source-repo', default='ArtemFilin1990/knowledge-base')
    parser.add_argument('--source-snapshot', default='manual')
    args = parser.parse_args()

    source_dir = Path(args.source_dir)
    documents, stats = build_documents(source_dir, args.source_repo)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(emit_sql(documents, stats, args.source_snapshot), encoding='utf-8')
    print(json.dumps({'documents': len(documents), **stats}, ensure_ascii=False))


if __name__ == '__main__':
    main()

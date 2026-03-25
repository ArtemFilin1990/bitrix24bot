import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'knowledge-base'
SCRIPT = ROOT / 'scripts' / 'build_kb_seed.py'
SCHEMA = ROOT / 'schema.sql'

sys.path.insert(0, str(ROOT / 'scripts'))
from build_kb_seed import _split_text, chunk_markdown, strip_markdown  # noqa: E402


class SplitTextTests(unittest.TestCase):
    def test_short_text_returned_as_is(self):
        self.assertEqual(_split_text('hello world', 100), ['hello world'])

    def test_splits_at_paragraph_boundary(self):
        text = ('A ' * 200).strip() + '\n\n' + ('B ' * 200).strip()
        parts = _split_text(text, 500)
        self.assertGreater(len(parts), 1)
        # each part must be ≤ chunk_size
        for p in parts:
            self.assertLessEqual(len(p), 500)
        # reassembled content must not lose words
        full = ' '.join(parts)
        self.assertIn('A', full)
        self.assertIn('B', full)

    def test_splits_at_sentence_boundary(self):
        text = ('word ' * 60).strip() + '. ' + ('word ' * 60).strip()
        parts = _split_text(text, 300)
        self.assertGreater(len(parts), 1)
        for p in parts:
            self.assertLessEqual(len(p), 300)

    def test_splits_at_word_boundary(self):
        # Long word-separated text with no paragraph or sentence breaks
        text = ' '.join(['слово'] * 300)
        parts = _split_text(text, 200)
        self.assertGreater(len(parts), 1)
        for p in parts:
            self.assertLessEqual(len(p), 200)
        # No mid-word cuts: all parts are space-separated words
        for p in parts:
            self.assertFalse(p.startswith('лово'), f'mid-word cut detected: {p[:20]}')

    def test_empty_string(self):
        self.assertEqual(_split_text('', 100), [])

    def test_exact_size_not_split(self):
        text = 'x' * 100
        self.assertEqual(_split_text(text, 100), [text])


class ChunkMarkdownTests(unittest.TestCase):
    def test_one_chunk_per_heading_section(self):
        md = '# H1\n\nпервый раздел.\n\n## H2\n\nвторой раздел.\n'
        chunks = chunk_markdown(md)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0]['heading_path'], 'H1')
        self.assertEqual(chunks[1]['heading_path'], 'H1 > H2')

    def test_large_section_split_into_sub_chunks(self):
        # section body > 1200 chars must produce multiple chunks
        body = ('Длинное предложение о подшипниках. ' * 50)  # ~1750 chars
        md = f'## Большой раздел\n\n{body}'
        chunks = chunk_markdown(md, chunk_size=1200)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertEqual(c['heading_path'], 'Большой раздел')
            self.assertLessEqual(len(c['content']), 1200)

    def test_heading_path_skips_empty_levels(self):
        # Jump from H1 straight to H3 — middle level must not appear as empty segment
        md = '# Верхний уровень\n\nтекст.\n\n### Глубокий раздел\n\nдругой текст.\n'
        chunks = chunk_markdown(md)
        paths = [c['heading_path'] for c in chunks]
        self.assertIn('Верхний уровень', paths)
        deep = next(p for p in paths if 'Глубокий' in p)
        self.assertNotIn(' >  > ', deep, 'empty level in heading_path')
        self.assertEqual(deep, 'Верхний уровень > Глубокий раздел')

    def test_fallback_split_respects_word_boundaries(self):
        # flat text (no headings) longer than chunk_size must not cut mid-word
        text = 'подшипник ' * 200  # ~2000 chars
        chunks = chunk_markdown(text, chunk_size=500)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(len(c['content']), 500)
            # Each chunk must start/end on a word boundary (no partial «одшипник»)
            self.assertFalse(
                c['content'].startswith('одшипник'),
                f'mid-word cut: {c["content"][:30]}',
            )

    def test_no_headings_single_short_chunk(self):
        md = 'Простой текст без заголовков.'
        chunks = chunk_markdown(md)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]['heading_path'], '')


class StripMarkdownTests(unittest.TestCase):
    def test_removes_fenced_code_blocks(self):
        result = strip_markdown('text\n```python\ncode()\n```\nafter')
        self.assertNotIn('```', result)
        self.assertNotIn('code()', result)
        self.assertIn('text', result)
        self.assertIn('after', result)

    def test_removes_inline_code(self):
        result = strip_markdown('используй `INSERT OR REPLACE` для апсерта')
        self.assertNotIn('`', result)
        self.assertIn('INSERT OR REPLACE', result)

    def test_removes_links_keeps_anchor(self):
        result = strip_markdown('смотри [документацию](../docs/README.md) здесь')
        self.assertNotIn('[', result)
        self.assertIn('документацию', result)

    def test_removes_headings(self):
        result = strip_markdown('## Раздел\n\nтекст раздела')
        self.assertNotIn('##', result)
        self.assertIn('Раздел', result)

    def test_removes_html_tags(self):
        result = strip_markdown('текст <b>жирный</b> и <br/> перенос')
        self.assertNotIn('<b>', result)
        self.assertNotIn('</b>', result)
        self.assertNotIn('<br/>', result)
        self.assertIn('жирный', result)

    def test_removes_table_rows(self):
        table = '| Колонка 1 | Колонка 2 |\n|-----------|----------|\n| значение | другое |\n'
        result = strip_markdown(table)
        self.assertNotIn('|', result)

    def test_removes_horizontal_rules(self):
        result = strip_markdown('выше\n\n---\n\nниже')
        self.assertNotIn('---', result)
        self.assertIn('выше', result)
        self.assertIn('ниже', result)


class BuildKbSeedTests(unittest.TestCase):
    def build_seed(self, output: Path):
        subprocess.run([
            'python', str(SCRIPT),
            '--source-dir', str(FIXTURE),
            '--output', str(output),
            '--source-snapshot', 'fixture@tests',
        ], check=True, cwd=ROOT)

    def prepare_db(self, seed_sql: Path):
        conn = sqlite3.connect(':memory:')
        conn.executescript(SCHEMA.read_text(encoding='utf-8'))
        conn.executescript(seed_sql.read_text(encoding='utf-8'))
        return conn

    def test_imports_expected_documents_and_skips_inbox(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'kb_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM kb_documents').fetchone()[0], 5)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents WHERE source_type = 'article' AND is_canonical = 1").fetchone()[0], 1)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents WHERE source_path LIKE 'inbox/%'").fetchone()[0], 0)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents WHERE source_type = 'meta' AND source_path = '_meta/topics.json'").fetchone()[0], 1)
            self.assertGreater(cur.execute('SELECT COUNT(*) FROM kb_chunks').fetchone()[0], 1)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM knowledge WHERE title = 'Тестовая статья'").fetchone()[0], 1)
            self.assertGreater(cur.execute("SELECT COUNT(*) FROM kb_links WHERE target_path = '../other/README.md'").fetchone()[0], 0)

    def test_seed_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'kb_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            conn.executescript(seed.read_text(encoding='utf-8'))
            cur = conn.cursor()
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM kb_documents').fetchone()[0], 5)
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM kb_ingest_runs').fetchone()[0], 2)

    def test_fts_search_returns_chunk_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'kb_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            rows = cur.execute("""
                SELECT d.title, c.heading_path
                FROM kb_chunks_fts
                JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid
                JOIN kb_documents d ON d.id = c.document_id
                WHERE kb_chunks_fts MATCH 'монтаж'
            """).fetchall()
            self.assertTrue(any(row[0] == 'Тестовая статья' for row in rows))


if __name__ == '__main__':
    unittest.main()

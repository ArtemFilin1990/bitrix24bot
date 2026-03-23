import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'knowledge-base'
SCRIPT = ROOT / 'scripts' / 'build_kb_seed.py'
SCHEMA = ROOT / 'schema.sql'


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
        conn.executescript(SCHEMA.read_text(encoding='utf-8').split('-- Seed reference data from BearingsInfo repository')[0])
        conn.executescript(seed_sql.read_text(encoding='utf-8'))
        return conn

    def test_imports_expected_documents_and_skips_inbox(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'kb_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM kb_documents').fetchone()[0], 4)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents WHERE source_type = 'article' AND is_canonical = 1").fetchone()[0], 1)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents WHERE source_path LIKE 'inbox/%'").fetchone()[0], 0)
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
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM kb_documents').fetchone()[0], 4)
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

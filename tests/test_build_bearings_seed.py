import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'BearingsInfo'
SCRIPT = ROOT / 'scripts' / 'build_bearings_seed.py'
SCHEMA = ROOT / 'schema.sql'


class BuildBearingsSeedTests(unittest.TestCase):
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

    def test_imports_catalog_analogs_and_brands(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'bearings_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM bearings WHERE brand = 'Reference'").fetchone()[0], 3)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM catalog WHERE bitrix_section_1 = 'BearingsInfo'").fetchone()[0], 18)
            self.assertGreaterEqual(cur.execute("SELECT COUNT(*) FROM analogs WHERE designation = '6205'").fetchone()[0], 1)
            self.assertGreaterEqual(cur.execute("SELECT COUNT(*) FROM brands WHERE name IN ('SKF', 'FAG', 'NSK', 'NTN', 'KOYO')").fetchone()[0], 5)
            row = cur.execute("SELECT designation, gost_ref, iso_ref FROM catalog WHERE item_id = 'skf:6205'").fetchone()
            self.assertEqual(row, ('6205', '207 (6205)', '6205'))

    def test_dimensions_catalog_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'bearings_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            # Dimensions catalog entries use ref: prefix
            dim_count = cur.execute("SELECT COUNT(*) FROM catalog WHERE section = 'BearingsInfo dimensions'").fetchone()[0]
            self.assertEqual(dim_count, 3)
            row = cur.execute("SELECT designation, d_mm, big_d_mm, b_mm, mass_kg FROM catalog WHERE item_id = 'ref:6205'").fetchone()
            self.assertEqual(row, ('6205', 25.0, 52.0, 15.0, 0.128))

    def test_nomenclature_analogs_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'bearings_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            # nomenclature.csv analogs should be imported
            nom_count = cur.execute("SELECT COUNT(*) FROM analogs WHERE factory = 'nomenclature.csv'").fetchone()[0]
            self.assertGreaterEqual(nom_count, 3)  # SKF/6205->6205-2RS, NSK/6205->6205DDU, FAG/6000->6000-C-2HRS
            # Verify specific analog from nomenclature
            row = cur.execute("SELECT designation, analog_designation FROM analogs WHERE brand = 'SKF' AND designation = '6205' AND factory = 'nomenclature.csv'").fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[1], '6205-2RS')

    def test_new_analog_files_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'bearings_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            # gost_iso.csv analogs
            gost_iso = cur.execute("SELECT COUNT(*) FROM analogs WHERE factory = 'gost_iso.csv'").fetchone()[0]
            self.assertGreaterEqual(gost_iso, 2)  # 2205->22205, 3306->22306 (bidirectional = 4)
            # housings.csv analogs
            housings = cur.execute("SELECT COUNT(*) FROM analogs WHERE factory = 'housings.csv'").fetchone()[0]
            self.assertGreaterEqual(housings, 1)
            # units.csv analogs
            units = cur.execute("SELECT COUNT(*) FROM analogs WHERE factory = 'units.csv'").fetchone()[0]
            self.assertGreaterEqual(units, 2)

    def test_seed_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / 'bearings_seed.sql'
            self.build_seed(seed)
            conn = self.prepare_db(seed)
            conn.executescript(seed.read_text(encoding='utf-8'))
            cur = conn.cursor()
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM bearings WHERE brand = 'Reference'").fetchone()[0], 3)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM catalog WHERE bitrix_section_1 = 'BearingsInfo'").fetchone()[0], 18)
            self.assertEqual(cur.execute('SELECT COUNT(*) FROM bearing_ingest_runs').fetchone()[0], 2)


if __name__ == '__main__':
    unittest.main()

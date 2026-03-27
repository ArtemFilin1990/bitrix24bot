import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'BearingsInfo'
SCRIPT = ROOT / 'scripts' / 'build_bearings_seed.py'
SCHEMA = ROOT / 'schema.sql'

sys.path.insert(0, str(ROOT / 'scripts'))
from build_bearings_seed import build_bearings, build_catalog, build_brands  # noqa: E402


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


class BuildBearingsUnitTests(unittest.TestCase):
    """Direct unit tests for build_bearings(), build_catalog(), build_brands()."""

    # ── build_bearings ────────────────────────────────────────────────────────

    def _row(self, **kw):
        """Return a master_catalog row dict with sensible defaults."""
        defaults = {
            'ISO': '', 'GOST': '', 'Type': '', 'Category': '',
            'Status': '', 'd': '', 'D': '', 'B': '', 'Weight_kg': '',
            'SKF': '', 'FAG': '', 'NSK': '', 'NTN': '', 'KOYO': '',
        }
        defaults.update(kw)
        return defaults

    def test_build_bearings_skips_row_without_iso_or_gost(self):
        rows = [self._row(ISO='', GOST='')]
        self.assertEqual(build_bearings(rows), [])

    def test_build_bearings_uses_iso_when_present(self):
        rows = [self._row(ISO='6205', GOST='207')]
        result = build_bearings(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].article, '6205')

    def test_build_bearings_falls_back_to_gost_when_no_iso(self):
        rows = [self._row(ISO='', GOST='207')]
        result = build_bearings(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].article, '207')

    def test_build_bearings_deduplicates_same_article(self):
        # Two rows with the same ISO designation should produce one bearing row
        rows = [self._row(ISO='6205'), self._row(ISO='6205', Weight_kg='0.2')]
        result = build_bearings(rows)
        self.assertEqual(len(result), 1)

    def test_build_bearings_weight_parsed(self):
        rows = [self._row(ISO='6205', Weight_kg='0,128')]
        result = build_bearings(rows)
        self.assertAlmostEqual(result[0].weight, 0.128)

    # ── build_catalog ─────────────────────────────────────────────────────────

    def test_build_catalog_skips_brand_with_empty_designation(self):
        rows = [self._row(ISO='6205', GOST='207', SKF='6205')]
        # Only SKF has a designation; FAG/NSK/NTN/KOYO are all empty
        result = list(build_catalog(rows).values())
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].manufacturer, 'SKF')

    def test_build_catalog_skips_row_with_no_brands(self):
        rows = [self._row(ISO='6205')]  # all brand columns empty
        self.assertEqual(len(build_catalog(rows)), 0)

    def test_build_catalog_series_ru_for_long_designation(self):
        rows = [self._row(ISO='6205', SKF='6205')]
        result = list(build_catalog(rows).values())
        self.assertEqual(result[0].series_ru, '62xx')

    def test_build_catalog_series_ru_none_for_short_designation(self):
        """Designations shorter than 2 chars must produce series_ru = None."""
        rows = [self._row(ISO='X', SKF='X')]
        result = list(build_catalog(rows).values())
        self.assertIsNone(result[0].series_ru)

    def test_build_catalog_iso_ref_and_gost_ref_set(self):
        rows = [self._row(ISO='6205', GOST='207', SKF='6205')]
        result = list(build_catalog(rows).values())
        self.assertEqual(result[0].iso_ref, '6205')
        self.assertEqual(result[0].gost_ref, '207')

    def test_build_catalog_iso_ref_none_when_iso_empty(self):
        rows = [self._row(GOST='207', SKF='207')]
        result = list(build_catalog(rows).values())
        self.assertIsNone(result[0].iso_ref)

    def test_build_catalog_dimensions_parsed(self):
        rows = [self._row(ISO='6205', SKF='6205', d='25', D='52', B='15', Weight_kg='0.128')]
        result = list(build_catalog(rows).values())
        self.assertEqual(result[0].d_mm, 25.0)
        self.assertEqual(result[0].big_d_mm, 52.0)
        self.assertEqual(result[0].b_mm, 15.0)
        self.assertAlmostEqual(result[0].mass_kg, 0.128)

    def test_build_catalog_item_id_format(self):
        rows = [self._row(ISO='6205', SKF='6205')]
        result = list(build_catalog(rows).values())
        self.assertEqual(result[0].item_id, 'skf:6205')

    # ── build_brands ──────────────────────────────────────────────────────────

    def test_build_brands_url_prefix_added_when_missing(self):
        """A URL without http(s):// prefix must be prefixed with https://."""
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp)
            brands_dir = source_dir / 'data' / 'brands'
            brands_dir.mkdir(parents=True)
            brands_file = brands_dir / 'brands.csv'
            brands_file.write_text(
                'Name,Website\nSKF,www.skf.com\n',
                encoding='utf-8',
            )
            result = build_brands(source_dir)
        skf = next((b for b in result if b.name == 'SKF'), None)
        self.assertIsNotNone(skf)
        self.assertTrue(
            skf.search_url.startswith('https://'),
            f"Expected https:// prefix, got: {skf.search_url}",
        )

    def test_build_brands_url_with_existing_https_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp)
            brands_dir = source_dir / 'data' / 'brands'
            brands_dir.mkdir(parents=True)
            brands_file = brands_dir / 'brands.csv'
            brands_file.write_text(
                'Name,Website\nFAG,https://www.fag.de\n',
                encoding='utf-8',
            )
            result = build_brands(source_dir)
        fag = next((b for b in result if b.name == 'FAG'), None)
        self.assertIsNotNone(fag)
        self.assertEqual(fag.search_url, 'https://www.fag.de')

    def test_build_brands_skips_missing_files_silently(self):
        """When none of the brand files exist, build_brands returns empty list."""
        with tempfile.TemporaryDirectory() as tmp:
            result = build_brands(Path(tmp))
        self.assertEqual(result, [])

    def test_build_brands_deduplicates_by_name(self):
        """If the same brand appears in multiple files, last file wins."""
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp)
            data_dir = source_dir / 'data'
            data_dir.mkdir(parents=True)
            # brands.csv (first file checked)
            (data_dir / 'brands.csv').write_text(
                'Name,Website\nSKF,https://old.skf.com\n',
                encoding='utf-8',
            )
            # data/brands/brands.csv (second file checked — overwrites)
            brands_sub = data_dir / 'brands'
            brands_sub.mkdir()
            (brands_sub / 'brands.csv').write_text(
                'Name,Website\nSKF,https://new.skf.com\n',
                encoding='utf-8',
            )
            result = build_brands(source_dir)
        skf_entries = [b for b in result if b.name == 'SKF']
        self.assertEqual(len(skf_entries), 1, "Duplicate brand should be deduplicated")
        self.assertEqual(skf_entries[0].search_url, 'https://new.skf.com')


if __name__ == '__main__':
    unittest.main()

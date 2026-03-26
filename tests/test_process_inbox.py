import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "inbox"
SCRIPT = ROOT / "scripts" / "process_inbox.py"
SCHEMA = ROOT / "schema.sql"


class ProcessInboxTests(unittest.TestCase):
    def run_script(self, inbox: Path, output: Path, *, source_repo: str | None = None) -> None:
        cmd = ["python", str(SCRIPT), "--inbox", str(inbox), "--output", str(output)]
        if source_repo:
            cmd += ["--source-repo", source_repo]
        subprocess.run(cmd, check=True, cwd=ROOT)

    def prepare_db(self, seed_sql: Path) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.executescript(SCHEMA.read_text(encoding="utf-8"))
        conn.executescript(seed_sql.read_text(encoding="utf-8"))
        return conn

    # ── Markdown docs ─────────────────────────────────────────────────────────

    def test_docs_imported_to_kb_documents(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            count = cur.execute("SELECT COUNT(*) FROM kb_documents").fetchone()[0]
            self.assertEqual(count, 2)

    def test_doc_frontmatter_title_and_tags(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT title, is_canonical FROM kb_documents WHERE slug = 'podshipnik-6205'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "Подшипник 6205 — технические характеристики")
            self.assertEqual(row[1], 1)

            tags = cur.execute(
                "SELECT t.name FROM kb_tags t "
                "JOIN kb_document_tags dt ON dt.tag_id = t.id "
                "JOIN kb_documents d ON d.id = dt.document_id "
                "WHERE d.slug = 'podshipnik-6205'"
            ).fetchall()
            tag_names = {r[0] for r in tags}
            self.assertIn("подшипники", tag_names)
            self.assertIn("серия 62", tag_names)

    def test_doc_chunks_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            chunks = cur.execute(
                "SELECT COUNT(*) FROM kb_chunks c "
                "JOIN kb_documents d ON d.id = c.document_id "
                "WHERE d.slug = 'podshipnik-6205'"
            ).fetchone()[0]
            self.assertGreater(chunks, 1)

    def test_doc_internal_links_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            link = cur.execute(
                "SELECT target_path FROM kb_links "
                "JOIN kb_documents d ON d.id = kb_links.document_id "
                "WHERE d.slug = 'podshipnik-6205'"
            ).fetchone()
            self.assertIsNotNone(link)
            self.assertIn("analogs", link[0])

    def test_doc_canonical_article_written_to_knowledge(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT COUNT(*) FROM knowledge WHERE title = 'Подшипник 6205 — технические характеристики'"
            ).fetchone()[0]
            self.assertEqual(row, 1)

    def test_doc_section_path_for_subdir(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT section_path FROM kb_documents WHERE slug = 'gost-520'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "subdir")

    def test_fts_index_populated(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            rows = cur.execute(
                "SELECT d.title FROM kb_chunks_fts "
                "JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid "
                "JOIN kb_documents d ON d.id = c.document_id "
                "WHERE kb_chunks_fts MATCH 'монтаж'"
            ).fetchall()
            titles = {r[0] for r in rows}
            self.assertIn("Подшипник 6205 — технические характеристики", titles)

    # ── Catalog CSV ───────────────────────────────────────────────────────────

    def test_catalog_rows_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            count = cur.execute("SELECT COUNT(*) FROM catalog").fetchone()[0]
            # test_catalog.csv has 3 rows, latin_headers.csv has 1 row
            self.assertEqual(count, 4)

    def test_catalog_dimensions_parsed(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT d_mm, big_d_mm, b_mm, mass_kg FROM catalog WHERE item_id = '6205'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], 25.0)
            self.assertEqual(row[1], 52.0)
            self.assertEqual(row[2], 15.0)
            self.assertAlmostEqual(row[3], 0.128)

    def test_catalog_stock_flag_parsed(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            in_stock = cur.execute(
                "SELECT stock_flag FROM catalog WHERE item_id = '6205'"
            ).fetchone()[0]
            self.assertEqual(in_stock, 1)

            out_stock = cur.execute(
                "SELECT stock_flag FROM catalog WHERE item_id = '6000'"
            ).fetchone()[0]
            self.assertEqual(out_stock, 0)

    def test_catalog_gost_and_iso_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT gost_ref, iso_ref FROM catalog WHERE item_id = '6205'"
            ).fetchone()
            self.assertEqual(row[0], "207 (6205)")
            self.assertEqual(row[1], "6205")

    def test_catalog_latin_headers_d_D_B(self):
        """Catalog CSV with bare d/D/B column names must be parsed correctly."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT d_mm, big_d_mm, b_mm FROM catalog WHERE item_id = 'NU205'"
            ).fetchone()
            self.assertIsNotNone(row, "NU205 not found — latin_headers d/D/B detection failed")
            self.assertEqual(row[0], 25.0)
            self.assertEqual(row[1], 52.0)
            self.assertEqual(row[2], 15.0)

    # ── Analogs CSV ───────────────────────────────────────────────────────────

    def test_analogs_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            count = cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0]
            self.assertEqual(count, 4)

    def test_analogs_factory_is_file_stem(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            factories = {
                r[0] for r in cur.execute("SELECT DISTINCT factory FROM analogs").fetchall()
            }
            self.assertEqual(factories, {"gost_iso"})

    def test_analogs_delete_by_stem_on_reimport(self):
        """Re-importing the same analogs file replaces only that file's rows."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            conn.executescript(seed.read_text(encoding="utf-8"))
            cur = conn.cursor()
            count = cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0]
            self.assertEqual(count, 4)

    # ── Brands CSV ────────────────────────────────────────────────────────────

    def test_brands_imported(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            count = cur.execute("SELECT COUNT(*) FROM brands").fetchone()[0]
            self.assertEqual(count, 3)

    def test_brands_description_populated(self):
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT description FROM brands WHERE name = 'SKF'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertIn("Шведский", row[0])

    def test_brands_upsert_on_reimport(self):
        """Importing brands twice must not create duplicates."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            conn.executescript(seed.read_text(encoding="utf-8"))
            cur = conn.cursor()
            count = cur.execute("SELECT COUNT(*) FROM brands").fetchone()[0]
            self.assertEqual(count, 3)

    # ── Full idempotency ──────────────────────────────────────────────────────

    def test_full_idempotency(self):
        """Running the full seed twice must leave all counts unchanged."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed)
            conn = self.prepare_db(seed)
            conn.executescript(seed.read_text(encoding="utf-8"))
            cur = conn.cursor()

            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents").fetchone()[0], 2)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM catalog").fetchone()[0], 4)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0], 4)
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM brands").fetchone()[0], 3)

    def test_source_repo_cli_arg(self):
        """--source-repo value should appear in kb_documents.source_repo."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed, source_repo="my-fork/bitrix24bot")
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            repos = {
                r[0] for r in cur.execute("SELECT DISTINCT source_repo FROM kb_documents").fetchall()
            }
            self.assertEqual(repos, {"my-fork/bitrix24bot"})

    def test_comma_separated_analogs(self):
        """Analogs CSV with comma separators should parse correctly."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "analogs").mkdir(parents=True)
            csv = inbox / "analogs" / "comma.csv"
            csv.write_text(
                "brand,designation,analog,manufacturer\n"
                "ГОСТ,305,6305,ISO\n"
                "ISO,6305,305,ГОСТ\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0], 2)

    def test_catalog_missing_item_id_uses_deterministic_key(self):
        """Rows without an id column get a deterministic 'stem:N' key."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv = inbox / "catalog" / "noid.csv"
            csv.write_text(
                "Обозначение;Производитель;Внутр.диаметр;Наруж.диаметр;Ширина\n"
                "6205;SKF;25;52;15\n"
                "6305;FAG;25;62;17\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            keys = {r[0] for r in cur.execute("SELECT item_id FROM catalog").fetchall()}
            self.assertIn("noid:1", keys)
            self.assertIn("noid:2", keys)
            # Re-import must not grow count (idempotent via INSERT OR REPLACE)
            conn.executescript(seed.read_text(encoding="utf-8"))
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM catalog").fetchone()[0], 2)

    def test_ingest_run_recorded(self):
        """process_inbox.py must write an audit record to kb_ingest_runs."""
        with tempfile.TemporaryDirectory() as tmp:
            seed = Path(tmp) / "inbox.sql"
            self.run_script(FIXTURE, seed, source_repo="my-org/bitrix24bot")
            conn = self.prepare_db(seed)
            cur = conn.cursor()

            row = cur.execute(
                "SELECT source_snapshot, files_seen, files_loaded, files_skipped, notes "
                "FROM kb_ingest_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()
            self.assertIsNotNone(row, "kb_ingest_runs should have at least one record")
            source_snapshot, files_seen, files_loaded, files_skipped, notes = row
            self.assertEqual(source_snapshot, "my-org/bitrix24bot")
            self.assertGreater(files_seen, 0)
            self.assertEqual(files_loaded, files_seen)
            self.assertEqual(files_skipped, 0)
            import json
            notes_obj = json.loads(notes)
            self.assertIn("docs", notes_obj)
            self.assertIn("catalog", notes_obj)
            self.assertIn("analogs", notes_obj)
            self.assertIn("brands", notes_obj)

    def test_empty_inbox_produces_valid_sql(self):
        """An empty inbox directory should still generate valid (no-op) SQL."""
        with tempfile.TemporaryDirectory() as tmp:
            empty_inbox = Path(tmp) / "empty_inbox"
            empty_inbox.mkdir()
            seed = Path(tmp) / "inbox.sql"
            self.run_script(empty_inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(cur.execute("SELECT COUNT(*) FROM kb_documents").fetchone()[0], 0)

    # ── CSV edge cases ────────────────────────────────────────────────────────

    def test_catalog_csv_with_utf8_bom(self):
        """Catalog CSVs with a UTF-8 BOM must parse the header correctly."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv_file = inbox / "catalog" / "bom.csv"
            # Write file with an explicit leading BOM
            bom_text = "\ufeffid;Обозначение\nnu205;NU205\n"
            csv_file.write_bytes(bom_text.encode("utf-8"))
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT item_id FROM catalog WHERE item_id = 'nu205'"
            ).fetchone()
            self.assertIsNotNone(row, "BOM caused item_id column to be misread")

    def test_catalog_header_only_csv_imports_no_rows(self):
        """A CSV that contains only a header row must import zero catalog rows."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv_file = inbox / "catalog" / "empty.csv"
            csv_file.write_text("id;Обозначение;Производитель\n", encoding="utf-8")
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(
                cur.execute("SELECT COUNT(*) FROM catalog").fetchone()[0], 0
            )

    def test_catalog_stock_flag_truthy_and_falsy_values(self):
        """stock_flag must be 1 for '1','да','yes','true' and 0 for everything else."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv_file = inbox / "catalog" / "stock.csv"
            csv_file.write_text(
                "id;Обозначение;Наличие\n"
                "s1;S1;1\n"
                "s2;S2;да\n"
                "s3;S3;yes\n"
                "s4;S4;true\n"
                "s5;S5;0\n"
                "s6;S6;нет\n"
                "s7;S7;no\n"
                "s8;S8;false\n"
                "s9;S9;\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            in_stock = {
                r[0]
                for r in cur.execute(
                    "SELECT item_id FROM catalog WHERE stock_flag = 1"
                ).fetchall()
            }
            out_stock = {
                r[0]
                for r in cur.execute(
                    "SELECT item_id FROM catalog WHERE stock_flag = 0"
                ).fetchall()
            }
            self.assertSetEqual(in_stock, {"s1", "s2", "s3", "s4"})
            self.assertSetEqual(out_stock, {"s5", "s6", "s7", "s8", "s9"})

    def test_catalog_whitespace_only_rows_skipped(self):
        """Rows that are all whitespace or empty must not create catalog entries."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv_file = inbox / "catalog" / "ws.csv"
            csv_file.write_text(
                "id;Обозначение\n"
                "6205;6205\n"
                "  ;  \n"
                "   \n"
                "6305;6305\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(
                cur.execute("SELECT COUNT(*) FROM catalog").fetchone()[0], 2
            )

    def test_catalog_comma_decimal_in_dimensions(self):
        """Dimension values written with a comma decimal separator must parse correctly."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "catalog").mkdir(parents=True)
            csv_file = inbox / "catalog" / "comma_dims.csv"
            csv_file.write_text(
                "id;Обозначение;Внутр.диаметр;Наруж.диаметр;Ширина;Масса_кг\n"
                "abc;ABC;25;52;15;0,128\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT d_mm, mass_kg FROM catalog WHERE item_id = 'abc'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertAlmostEqual(row[0], 25.0)
            self.assertAlmostEqual(row[1], 0.128)

    def test_analogs_empty_csv_imports_no_rows(self):
        """An analogs CSV with only a header must import zero analog rows."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "analogs").mkdir(parents=True)
            csv_file = inbox / "analogs" / "empty.csv"
            csv_file.write_text(
                "brand;designation;analog_designation;analog_brand\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(
                cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0], 0
            )

    def test_analogs_rows_missing_both_designations_skipped(self):
        """Rows where BOTH designation and analog_designation are empty must be skipped.

        The guard condition in process_analogs is:
          if not desig and not adesig: continue
        So a row is imported as long as at least one of the two fields is non-empty.
        """
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "analogs").mkdir(parents=True)
            csv_file = inbox / "analogs" / "partial.csv"
            csv_file.write_text(
                "brand;designation;analog_designation;analog_brand\n"
                "ГОСТ;6205;180205;ISO\n"  # both present — imported
                "ГОСТ;;;\n"               # both empty — skipped
                "ISO;;6205;ГОСТ\n",       # only analog_designation present — imported
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            # Row 1 and row 3 are imported; row 2 (both empty) is skipped
            self.assertEqual(
                cur.execute("SELECT COUNT(*) FROM analogs").fetchone()[0], 2
            )

    def test_brands_empty_csv_imports_no_rows(self):
        """A brands CSV with only a header must import zero brand rows."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "brands").mkdir(parents=True)
            csv_file = inbox / "brands" / "empty.csv"
            csv_file.write_text("name;description;logo_url;search_url\n", encoding="utf-8")
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            self.assertEqual(
                cur.execute("SELECT COUNT(*) FROM brands").fetchone()[0], 0
            )

    def test_doc_without_frontmatter_uses_h1_as_title(self):
        """A Markdown doc without frontmatter must infer its title from the H1 heading."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "docs").mkdir(parents=True)
            md_file = inbox / "docs" / "no-fm.md"
            md_file.write_text("# Заголовок из H1\n\nТекст статьи.\n", encoding="utf-8")
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT title FROM kb_documents WHERE slug = 'no-fm'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "Заголовок из H1")

    def test_doc_type_from_frontmatter_sets_is_canonical(self):
        """Docs with type != 'article' in frontmatter must have is_canonical = 0."""
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            (inbox / "docs").mkdir(parents=True)
            md_file = inbox / "docs" / "prompt-doc.md"
            md_file.write_text(
                "---\ntitle: Test Prompt\ntype: prompt\n---\nContent.\n",
                encoding="utf-8",
            )
            seed = Path(tmp) / "seed.sql"
            self.run_script(inbox, seed)
            conn = self.prepare_db(seed)
            cur = conn.cursor()
            row = cur.execute(
                "SELECT is_canonical FROM kb_documents WHERE slug = 'prompt-doc'"
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], 0)


if __name__ == "__main__":
    unittest.main()

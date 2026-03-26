"""Unit tests for shared Python utility functions.

These test the building blocks that every seed/inbox script depends on:
  build_bearings_seed  → sql_quote, sql_value, parse_float, parse_int,
                         normalized_text
  build_kb_seed        → sql_quote (duplicate), parse_frontmatter, infer_title
  process_inbox        → _sha256, _detect_sep, _read_csv, _find, _find_exact,
                         _get, _getnum
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_bearings_seed import (  # noqa: E402
    normalized_text,
    parse_float,
    parse_int,
    sql_quote as bbs_sql_quote,
    sql_value,
)
from build_kb_seed import infer_title, parse_frontmatter  # noqa: E402
from build_kb_seed import sql_quote as kb_sql_quote  # noqa: E402
from process_inbox import (  # noqa: E402
    _detect_sep,
    _find,
    _find_exact,
    _get,
    _getnum,
    _read_csv,
    _sha256,
)


# ── sql_quote ─────────────────────────────────────────────────────────────────


class SqlQuoteTests(unittest.TestCase):
    """sql_quote() is the primary SQL injection defence — must be thorough."""

    def test_normal_string(self):
        self.assertEqual(bbs_sql_quote("hello"), "'hello'")

    def test_single_quote_escaped(self):
        self.assertEqual(bbs_sql_quote("it's"), "'it''s'")

    def test_multiple_single_quotes_escaped(self):
        self.assertEqual(bbs_sql_quote("O'Brien's"), "'O''Brien''s'")

    def test_empty_string(self):
        self.assertEqual(bbs_sql_quote(""), "''")

    def test_cyrillic(self):
        self.assertEqual(bbs_sql_quote("подшипник"), "'подшипник'")

    def test_string_with_semicolon(self):
        # Semicolons must not break the SQL — they should just be quoted
        result = bbs_sql_quote("val;ue")
        self.assertTrue(result.startswith("'"))
        self.assertTrue(result.endswith("'"))
        self.assertIn(";", result)

    def test_kb_and_bbs_implementations_are_identical(self):
        """Both modules copy the same function — verify they match."""
        samples = ["", "hello", "it's", "O'Brien's", "подшипник", "a''b"]
        for s in samples:
            self.assertEqual(
                bbs_sql_quote(s),
                kb_sql_quote(s),
                f"sql_quote mismatch for {s!r}",
            )


# ── sql_value ─────────────────────────────────────────────────────────────────


class SqlValueTests(unittest.TestCase):
    def test_none_returns_null(self):
        self.assertEqual(sql_value(None), "NULL")

    def test_true_returns_1(self):
        self.assertEqual(sql_value(True), "1")

    def test_false_returns_0(self):
        self.assertEqual(sql_value(False), "0")

    def test_zero_int(self):
        self.assertEqual(sql_value(0), "0")

    def test_positive_int(self):
        self.assertEqual(sql_value(42), "42")

    def test_negative_int(self):
        self.assertEqual(sql_value(-7), "-7")

    def test_float(self):
        self.assertEqual(sql_value(3.14), "3.14")

    def test_float_zero(self):
        self.assertEqual(sql_value(0.0), "0.0")

    def test_string_is_quoted(self):
        self.assertEqual(sql_value("hello"), "'hello'")

    def test_string_with_quote_is_escaped(self):
        self.assertEqual(sql_value("it's"), "'it''s'")

    def test_bool_is_not_treated_as_int(self):
        # True/False must map to 1/0, not to the string "True"/"False"
        self.assertNotEqual(sql_value(True), "'True'")
        self.assertNotEqual(sql_value(False), "'False'")


# ── parse_float ───────────────────────────────────────────────────────────────


class ParseFloatTests(unittest.TestCase):
    def test_none_returns_none(self):
        self.assertIsNone(parse_float(None))

    def test_empty_string_returns_none(self):
        self.assertIsNone(parse_float(""))

    def test_whitespace_only_returns_none(self):
        self.assertIsNone(parse_float("   "))

    def test_integer_string(self):
        self.assertEqual(parse_float("25"), 25.0)

    def test_decimal_period(self):
        self.assertAlmostEqual(parse_float("3.14"), 3.14)

    def test_comma_decimal_separator(self):
        """Russian-locale comma separator must be converted to a period."""
        self.assertAlmostEqual(parse_float("3,14"), 3.14)

    def test_leading_trailing_whitespace_stripped(self):
        self.assertAlmostEqual(parse_float("  25.5  "), 25.5)

    def test_zero_string(self):
        self.assertEqual(parse_float("0"), 0.0)

    def test_negative_value(self):
        self.assertAlmostEqual(parse_float("-1.5"), -1.5)

    def test_large_value(self):
        self.assertAlmostEqual(parse_float("9999.99"), 9999.99)


# ── parse_int ─────────────────────────────────────────────────────────────────


class ParseIntTests(unittest.TestCase):
    def test_none_returns_none(self):
        self.assertIsNone(parse_int(None))

    def test_empty_returns_none(self):
        self.assertIsNone(parse_int(""))

    def test_integer_string(self):
        self.assertEqual(parse_int("25"), 25)

    def test_float_string_truncated(self):
        """Float is parsed then truncated (not rounded) via int()."""
        self.assertEqual(parse_int("3.9"), 3)

    def test_zero(self):
        self.assertEqual(parse_int("0"), 0)

    def test_comma_decimal_truncated(self):
        self.assertEqual(parse_int("3,9"), 3)


# ── normalized_text ───────────────────────────────────────────────────────────


class NormalizedTextTests(unittest.TestCase):
    def test_joins_parts_with_space(self):
        self.assertEqual(normalized_text("a", "b", "c"), "a b c")

    def test_skips_none_parts(self):
        self.assertEqual(normalized_text(None, "b", None), "b")

    def test_strips_whitespace_from_parts(self):
        self.assertEqual(normalized_text("  a  ", "  b  "), "a b")

    def test_no_arguments(self):
        self.assertEqual(normalized_text(), "")

    def test_all_none(self):
        self.assertEqual(normalized_text(None, None), "")

    def test_empty_strings_skipped(self):
        self.assertEqual(normalized_text("", "b", ""), "b")

    def test_whitespace_only_strings_skipped(self):
        self.assertEqual(normalized_text("   ", "b"), "b")


# ── parse_frontmatter ─────────────────────────────────────────────────────────


class ParseFrontmatterTests(unittest.TestCase):
    def test_no_frontmatter_returns_empty_meta(self):
        meta, body = parse_frontmatter("# Title\n\nsome text")
        self.assertEqual(meta, {})
        self.assertIn("# Title", body)

    def test_simple_key_value_parsed(self):
        text = "---\ntitle: My Title\n---\n# Body"
        meta, body = parse_frontmatter(text)
        self.assertEqual(meta.get("title"), "My Title")
        self.assertIn("# Body", body)

    def test_tags_list_parsed(self):
        text = "---\ntags: [подшипники, серия 62]\n---\ntext"
        meta, _ = parse_frontmatter(text)
        self.assertIsInstance(meta.get("tags"), list)
        self.assertIn("подшипники", meta["tags"])
        self.assertIn("серия 62", meta["tags"])

    def test_tags_single_string_stays_string(self):
        text = "---\ntags: одиночный-тег\n---\ntext"
        meta, _ = parse_frontmatter(text)
        self.assertEqual(meta.get("tags"), "одиночный-тег")

    def test_double_quoted_value_unquoted(self):
        text = '---\ntitle: "Quoted Title"\n---\ntext'
        meta, _ = parse_frontmatter(text)
        self.assertEqual(meta.get("title"), "Quoted Title")

    def test_single_quoted_value_unquoted(self):
        text = "---\ntitle: 'Single Quoted'\n---\ntext"
        meta, _ = parse_frontmatter(text)
        self.assertEqual(meta.get("title"), "Single Quoted")

    def test_missing_closing_delimiter_not_parsed(self):
        """Frontmatter without a closing '---' must not be extracted."""
        text = "---\ntitle: No Close\ntext continues here without closing"
        meta, body = parse_frontmatter(text)
        self.assertEqual(meta, {})

    def test_multiple_fields(self):
        text = "---\ntitle: Article\nlang: ru\ntype: article\n---\nbody"
        meta, _ = parse_frontmatter(text)
        self.assertEqual(meta.get("title"), "Article")
        self.assertEqual(meta.get("lang"), "ru")
        self.assertEqual(meta.get("type"), "article")

    def test_body_does_not_include_frontmatter(self):
        text = "---\ntitle: X\n---\nActual body text"
        _, body = parse_frontmatter(text)
        self.assertNotIn("---", body)
        self.assertNotIn("title:", body)
        self.assertIn("Actual body text", body)


# ── infer_title ───────────────────────────────────────────────────────────────


class InferTitleTests(unittest.TestCase):
    def test_extracts_h1(self):
        self.assertEqual(infer_title("# My Title\n\ntext", "fallback"), "My Title")

    def test_prefers_first_h1_over_h2(self):
        # H2 appears before H1 — must still use H1
        self.assertEqual(infer_title("## H2\n\n# H1\n\ntext", "fallback"), "H1")

    def test_fallback_used_when_no_h1(self):
        result = infer_title("## H2\n\ntext", "my-fallback-slug")
        self.assertEqual(result, "my fallback slug")

    def test_fallback_replaces_underscores(self):
        result = infer_title("## H2\n\ntext", "my_file_name")
        self.assertEqual(result, "my file name")

    def test_h1_whitespace_stripped(self):
        self.assertEqual(infer_title("#   Spaced Title   \n\ntext", "fb"), "Spaced Title")

    def test_empty_body_uses_fallback(self):
        result = infer_title("", "my-slug")
        self.assertEqual(result, "my slug")


# ── _sha256 ───────────────────────────────────────────────────────────────────


class Sha256Tests(unittest.TestCase):
    def test_is_deterministic(self):
        self.assertEqual(_sha256("hello"), _sha256("hello"))

    def test_different_inputs_produce_different_hashes(self):
        self.assertNotEqual(_sha256("hello"), _sha256("world"))

    def test_returns_64_char_hex_string(self):
        result = _sha256("test")
        self.assertRegex(result, r"^[0-9a-f]{64}$")

    def test_empty_string_has_known_hash(self):
        # sha256("") is a well-known constant
        expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        self.assertEqual(_sha256(""), expected)


# ── _detect_sep ───────────────────────────────────────────────────────────────


class DetectSepTests(unittest.TestCase):
    def test_detects_comma(self):
        csv = "a,b,c\n1,2,3\n4,5,6"
        self.assertEqual(_detect_sep(csv), ",")

    def test_detects_semicolon(self):
        csv = "a;b;c\n1;2;3\n4;5;6"
        self.assertEqual(_detect_sep(csv), ";")

    def test_fallback_for_ambiguous_content(self):
        # Single column, no delimiters → Sniffer raises Error → fallback ";"
        result = _detect_sep("just a single value\nno delimiters here\nonly words")
        self.assertEqual(result, ";")

    def test_uses_only_first_five_lines_as_sample(self):
        # If the first 5 lines are semicolon-delimited, that's what we detect
        csv = "a;b\n1;2\n3;4\n5;6\n7;8\na,b,c"  # comma only appears on line 6
        self.assertEqual(_detect_sep(csv), ";")


# ── _read_csv ─────────────────────────────────────────────────────────────────


class ReadCsvTests(unittest.TestCase):
    def test_normal_semicolon_csv(self):
        text = "name;value\nfoo;bar\nbaz;qux"
        header, rows = _read_csv(text, ";")
        self.assertEqual(header, ["name", "value"])
        self.assertEqual(rows[0], ["foo", "bar"])
        self.assertEqual(len(rows), 2)

    def test_bom_stripped(self):
        """Leading BOM (U+FEFF) must be stripped from the first header column."""
        bom = "\ufeff"
        text = f"{bom}name;value\nfoo;bar"
        header, rows = _read_csv(text, ";")
        self.assertEqual(header[0], "name")  # must not be "\ufeffname"

    def test_empty_text_returns_empty(self):
        header, rows = _read_csv("", ";")
        self.assertEqual(header, [])
        self.assertEqual(rows, [])

    def test_header_only_no_data_rows(self):
        text = "name;value"
        header, rows = _read_csv(text, ";")
        self.assertEqual(header, ["name", "value"])
        self.assertEqual(rows, [])

    def test_comma_delimiter(self):
        text = "a,b,c\n1,2,3"
        header, rows = _read_csv(text, ",")
        self.assertEqual(header, ["a", "b", "c"])
        self.assertEqual(rows[0], ["1", "2", "3"])

    def test_header_whitespace_stripped(self):
        text = " name ; value \nfoo;bar"
        header, _ = _read_csv(text, ";")
        self.assertEqual(header, ["name", "value"])


# ── _find ─────────────────────────────────────────────────────────────────────


class FindTests(unittest.TestCase):
    def test_finds_by_keyword_substring(self):
        headers = ["id", "обозначение", "наименование"]
        self.assertEqual(_find(headers, "обознач"), 1)

    def test_returns_minus_one_when_not_found(self):
        headers = ["id", "name"]
        self.assertEqual(_find(headers, "цена", "price"), -1)

    def test_first_matching_column_wins(self):
        # "бренд" matches index 1; "марка" matches index 2 — should return 1
        headers = ["id", "бренд", "марка"]
        self.assertEqual(_find(headers, "бренд", "марка"), 1)

    def test_second_keyword_used_when_first_absent(self):
        headers = ["id", "остаток", "цена"]
        # "кол" not present; "остат" matches "остаток" at index 1
        self.assertEqual(_find(headers, "кол", "остат"), 1)

    def test_empty_header_list(self):
        self.assertEqual(_find([], "цена"), -1)


# ── _find_exact ───────────────────────────────────────────────────────────────


class FindExactTests(unittest.TestCase):
    def test_finds_exact_match(self):
        headers = ["d", "D", "B"]
        self.assertEqual(_find_exact(headers, "d"), 0)
        self.assertEqual(_find_exact(headers, "D"), 1)
        self.assertEqual(_find_exact(headers, "B"), 2)

    def test_case_sensitive_d_vs_D(self):
        headers = ["d", "D"]
        self.assertEqual(_find_exact(headers, "D"), 1)
        self.assertNotEqual(_find_exact(headers, "D"), 0)

    def test_not_found_returns_minus_one(self):
        headers = ["a", "b"]
        self.assertEqual(_find_exact(headers, "c"), -1)

    def test_strips_header_whitespace_before_matching(self):
        headers = [" d ", " D ", " B "]
        self.assertEqual(_find_exact(headers, "d"), 0)
        self.assertEqual(_find_exact(headers, "D"), 1)

    def test_multiple_candidates_first_wins(self):
        headers = ["T", "t", "T"]
        # First "T" is at index 0
        self.assertEqual(_find_exact(headers, "T"), 0)


# ── _get ──────────────────────────────────────────────────────────────────────


class GetTests(unittest.TestCase):
    def test_valid_index_returns_value(self):
        row = ["foo", "bar", "baz"]
        self.assertEqual(_get(row, 0), "foo")
        self.assertEqual(_get(row, 2), "baz")

    def test_negative_index_returns_empty(self):
        row = ["foo", "bar"]
        self.assertEqual(_get(row, -1), "")

    def test_out_of_bounds_returns_empty(self):
        row = ["foo"]
        self.assertEqual(_get(row, 5), "")

    def test_strips_whitespace(self):
        row = ["  hello  "]
        self.assertEqual(_get(row, 0), "hello")

    def test_empty_cell_returns_empty(self):
        row = ["", "val"]
        self.assertEqual(_get(row, 0), "")


# ── _getnum ───────────────────────────────────────────────────────────────────


class GetnumTests(unittest.TestCase):
    def test_valid_float(self):
        self.assertAlmostEqual(_getnum(["25.5"], 0), 25.5)

    def test_comma_decimal_separator(self):
        """Russian-locale comma decimal must be treated as period."""
        self.assertAlmostEqual(_getnum(["25,5"], 0), 25.5)

    def test_integer_string(self):
        self.assertAlmostEqual(_getnum(["25"], 0), 25.0)

    def test_invalid_string_returns_none(self):
        self.assertIsNone(_getnum(["abc"], 0))

    def test_empty_string_returns_none(self):
        self.assertIsNone(_getnum([""], 0))

    def test_out_of_bounds_returns_none(self):
        self.assertIsNone(_getnum(["25"], 5))

    def test_zero(self):
        self.assertAlmostEqual(_getnum(["0"], 0), 0.0)

    def test_whitespace_value_returns_none(self):
        self.assertIsNone(_getnum(["   "], 0))


if __name__ == "__main__":
    unittest.main()

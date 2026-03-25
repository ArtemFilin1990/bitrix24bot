"""Unit tests for the classify() function in build_kb_seed.py.

classify() is the gatekeeper that decides which repository paths are
imported into the knowledge base and which are silently skipped.  Every
skip rule and every include rule has its own test here.
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_kb_seed import classify  # noqa: E402


class SkipPatternTests(unittest.TestCase):
    """Paths that must always be ignored (classify returns None)."""

    def test_inbox_prefix_skipped(self):
        self.assertIsNone(classify("inbox/docs/my-doc.md"))

    def test_inbox_nested_skipped(self):
        self.assertIsNone(classify("inbox/catalog/items.csv"))

    def test_scripts_prefix_skipped(self):
        self.assertIsNone(classify("scripts/build_kb_seed.py"))

    def test_tests_prefix_skipped(self):
        self.assertIsNone(classify("tests/test_something.py"))

    def test_tests_fixtures_skipped(self):
        self.assertIsNone(classify("tests/fixtures/inbox/draft.md"))

    def test_github_workflows_skipped(self):
        self.assertIsNone(classify(".github/workflows/deploy.yml"))

    def test_vscode_settings_skipped(self):
        self.assertIsNone(classify(".vscode/settings.json"))

    def test_unknown_path_not_in_any_rule_skipped(self):
        self.assertIsNone(classify("random/path/file.md"))

    def test_root_readme_skipped(self):
        # A top-level README.md doesn't match any include pattern
        self.assertIsNone(classify("README.md"))

    def test_root_markdown_file_skipped(self):
        self.assertIsNone(classify("CONTRIBUTING.md"))


class ArticlePatternTests(unittest.TestCase):
    """kb/ru/**/{README.md,INDEX.md} → ('article', is_canonical=1, 'ru')."""

    def test_readme_under_kb_ru_is_article(self):
        result = classify("kb/ru/bearings/6205/README.md")
        self.assertIsNotNone(result)
        source_type, is_canonical, lang = result
        self.assertEqual(source_type, "article")
        self.assertEqual(is_canonical, 1)
        self.assertEqual(lang, "ru")

    def test_index_under_kb_ru_is_article(self):
        result = classify("kb/ru/standards/INDEX.md")
        self.assertIsNotNone(result)
        source_type, is_canonical, lang = result
        self.assertEqual(source_type, "article")
        self.assertEqual(is_canonical, 1)
        self.assertEqual(lang, "ru")

    def test_readme_directly_under_kb_ru_is_article(self):
        result = classify("kb/ru/README.md")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "article")

    def test_non_readme_under_kb_ru_is_skipped(self):
        # Only README.md and INDEX.md match; other filenames don't
        self.assertIsNone(classify("kb/ru/bearings/6205/details.md"))

    def test_non_md_readme_under_kb_ru_skipped(self):
        self.assertIsNone(classify("kb/ru/bearings/README.txt"))


class PromptPatternTests(unittest.TestCase):
    """prompts/**/*.md → ('prompt', is_canonical=0, 'ru')."""

    def test_prompt_md_classified(self):
        result = classify("prompts/sales/script.md")
        self.assertIsNotNone(result)
        source_type, is_canonical, lang = result
        self.assertEqual(source_type, "prompt")
        self.assertEqual(is_canonical, 0)
        self.assertEqual(lang, "ru")

    def test_prompt_nested_deep_classified(self):
        result = classify("prompts/a/b/c/deep.md")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "prompt")

    def test_prompt_non_md_skipped(self):
        self.assertIsNone(classify("prompts/sales/script.txt"))

    def test_prompt_non_md_json_skipped(self):
        self.assertIsNone(classify("prompts/config.json"))


class TemplatePatternTests(unittest.TestCase):
    """_templates/**/*.md → ('template', is_canonical=0, 'ru')."""

    def test_template_md_classified(self):
        result = classify("_templates/article/template.md")
        self.assertIsNotNone(result)
        source_type, is_canonical, lang = result
        self.assertEqual(source_type, "template")
        self.assertEqual(is_canonical, 0)
        self.assertEqual(lang, "ru")

    def test_template_non_md_skipped(self):
        self.assertIsNone(classify("_templates/article/template.docx"))


class MetaPatternTests(unittest.TestCase):
    """_meta/**/*.{md,json} → ('meta', is_canonical=0, 'ru')."""

    def test_meta_md_classified(self):
        result = classify("_meta/owners.md")
        self.assertIsNotNone(result)
        source_type, is_canonical, lang = result
        self.assertEqual(source_type, "meta")
        self.assertEqual(is_canonical, 0)
        self.assertEqual(lang, "ru")

    def test_meta_json_classified(self):
        result = classify("_meta/topics.json")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "meta")

    def test_meta_csv_skipped(self):
        self.assertIsNone(classify("_meta/data.csv"))

    def test_meta_nested_md_classified(self):
        result = classify("_meta/subdir/config.md")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "meta")


class BackslashNormalisationTests(unittest.TestCase):
    """Windows-style paths (backslashes) must be normalised before matching."""

    def test_backslash_inbox_still_skipped(self):
        self.assertIsNone(classify("inbox\\docs\\my-doc.md"))

    def test_backslash_kb_ru_readme_is_article(self):
        result = classify("kb\\ru\\bearings\\6205\\README.md")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "article")

    def test_backslash_meta_json_is_meta(self):
        result = classify("_meta\\topics.json")
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "meta")


if __name__ == "__main__":
    unittest.main()

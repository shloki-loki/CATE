"""Checks for the dashboard UI (web/) that run with the Python suite, so CI covers them too.

- The composer's list-continuation helper is unit-tested with Node's built-in test runner
  (skipped when Node is not installed).
- Static checks keep the T0012 design requirements from regressing: the theme (brightness) button
  lives in the shared top bar, the "show archived projects" switch is gone, and the models page has
  its "Add a model or API" section.
"""

import shutil
import subprocess
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def read(rel):
    return (WEB / rel).read_text(encoding="utf-8")


class ListContinuationTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_node_unit_tests_pass(self):
        tests = sorted(str(p) for p in (WEB / "tests").glob("*.test.mjs"))
        self.assertTrue(tests, "no web/tests/*.test.mjs files found")
        run = subprocess.run(["node", "--test", *tests], cwd=WEB, capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_composer_uses_helper_on_shift_enter(self):
        chat = read("components/Chat.js")
        self.assertIn("continueList(", chat)
        self.assertIn("onKeyDown={onKeyDown}", chat)
        self.assertIn("isComposing", chat)


class LayoutTest(unittest.TestCase):
    def test_theme_button_is_in_the_top_bar(self):
        frame = read("components/AppFrame.js")
        top_bar = frame[frame.index("export function TopBar"):]
        self.assertIn("<ThemeButton />", top_bar)
        self.assertNotIn("side-foot", frame)
        for page in ("components/Chat.js", "app/(app)/models/page.js", "app/(app)/logs/page.js"):
            self.assertIn("<TopBar", read(page), page)

    def test_show_archived_switch_removed(self):
        frame = read("components/AppFrame.js")
        self.assertNotIn("Show archived", frame)
        self.assertNotIn("setArchived", frame)

    def test_models_page_has_add_section(self):
        panel = read("components/ModelsPanel.js")
        page = read("app/(app)/models/page.js")
        self.assertIn('id="add"', panel)
        self.assertIn("Add a model or API", panel)
        self.assertIn('href="#add"', page)
        self.assertIn("How to add a model or API", page)


if __name__ == "__main__":
    unittest.main()

"""Checks for the dashboard UI (web/) that run with the Python suite, so CI covers them too.

- The composer's key handling is unit-tested with Node's built-in test runner (skipped when Node
  is not installed): Enter sends, Shift+Enter inserts a plain newline with no list numbering.
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


class ComposerTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is not installed")
    def test_node_unit_tests_pass(self):
        """web/tests/composerKeys.test.mjs: Shift+Enter after numbered/bulleted items is a plain newline."""
        tests = sorted(str(p) for p in (WEB / "tests").glob("*.test.mjs"))
        self.assertTrue(tests, "no web/tests/*.test.mjs files found")
        run = subprocess.run(["node", "--test", *tests], cwd=WEB, capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_shift_enter_is_left_to_the_browser(self):
        chat = read("components/Chat.js")
        self.assertIn("onKeyDown={onKeyDown}", chat)
        handler = chat[chat.index("const onKeyDown"):]
        handler = handler[: handler.index("};") + 2]
        # The only cancelled keypress is the one that sends (Enter without Shift).
        self.assertEqual(handler.count("preventDefault"), 1, handler)
        self.assertIn("action === 'send'", handler)
        self.assertNotIn("updateText", handler)
        # No list continuation anywhere, and no saved preference can switch it back on.
        self.assertFalse((WEB / "lib" / "listContinue.mjs").exists())
        for needle in ("continueList", "autoLists", "Auto lists"):
            self.assertNotIn(needle, chat)
        self.assertIn("removeItem(LEGACY_AUTO_LIST_KEY)", chat)
        self.assertNotIn("getItem(LEGACY_AUTO_LIST_KEY)", chat)


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

    def test_get_a_key_link_is_not_inside_the_radio(self):
        """Enter on "Get a key" must open the link, not be swallowed by the provider radio."""
        panel = read("components/ModelsPanel.js")
        block = panel[panel.index('aria-label="API"'):]
        block = block[: block.index("</fieldset>")]
        radio = block[block.index('role="radio"'):]
        radio = radio[: radio.index("</button>")]
        self.assertNotIn("<a ", radio)
        self.assertNotIn("onKeyDown", block)
        self.assertIn("Get a key", block)

    def test_models_page_has_add_section(self):
        panel = read("components/ModelsPanel.js")
        page = read("app/(app)/models/page.js")
        self.assertIn('id="add"', panel)
        self.assertIn("Add a model or API", panel)
        self.assertIn('href="#add"', page)
        self.assertIn("How to add a model or API", page)


if __name__ == "__main__":
    unittest.main()

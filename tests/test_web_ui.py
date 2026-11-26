"""Checks for the dashboard UI (web/) that run with the Python suite, so CI covers them too.

- The composer's key handling is unit-tested with Node's built-in test runner (skipped when Node
  is not installed): Enter sends, Shift+Enter inserts a plain newline with no list numbering.
- Static checks keep the T0012 design requirements from regressing: the theme (brightness) button
  lives in the shared top bar, the "show archived projects" switch is gone, and the models page has
  its "Add a model or API" section with native radio groups and honest free/paid labels.
- web/tests/addDefaults.test.mjs checks the form's placeholder names (no "(free)" on paid APIs).
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

    def _add_form(self):
        panel = read("components/ModelsPanel.js")
        form = panel[panel.index("function AddConnection"):]
        return form[: form.index("export function AddSection")]

    def test_add_form_choices_are_native_radio_groups(self):
        """Type and API choices are labelled native radios, so the browser gives Tab/arrow-key navigation."""
        form = self._add_form()
        self.assertNotIn('role="radio"', form)
        self.assertNotIn('role="radiogroup"', form)
        self.assertRegex(form, r'<label key=\{t\.runner\} className=\{`option[^>]*>\s*<input type="radio" className="option-input" name="runner"')
        self.assertRegex(form, r'<label className="option">\s*<input type="radio" className="option-input" name="preset"')
        for name in ("runner", "preset"):
            # the radios carry the value the server action reads; no hidden duplicate
            self.assertNotIn('type="hidden" name="%s"' % name, form)
        # the radio inputs are hidden only visually, never with display:none (that would drop keyboard focus)
        css = read("app/globals.css")
        rule = css[css.index(".option-input {"):]
        rule = rule[: rule.index("}")]
        self.assertNotIn("display: none", rule)
        self.assertIn(".option:has(.option-input:focus-visible)", css)

    def test_get_a_key_link_is_its_own_tab_stop(self):
        """Each "Get a key" link sits outside its provider's label, so Enter opens it and never selects the radio."""
        form = self._add_form()
        block = form[form.index('name="preset"'):]
        label_end = block.index("</label>")
        self.assertNotIn("<a ", block[:label_end])
        self.assertIn("Get a key", block[label_end: block.index("</fieldset>")])

    def test_paid_presets_are_not_labelled_free(self):
        data = read("lib/data.js")
        deepseek = data[data.index("  deepseek:"):]
        deepseek = deepseek[: deepseek.index("\n")]
        self.assertIn("paid: true", deepseek)
        form = self._add_form()
        self.assertNotIn("(free)", form)
        self.assertIn("connectionPlaceholders(", form)

    def test_composer_toolbar_fits_phones(self):
        """At phone widths Compare becomes icon-only and the model label may shrink, so Send stays on screen."""
        chat = read("components/Chat.js")
        self.assertIn('aria-label="Compare"', chat)
        self.assertIn('<span className="tool-label wide-only">Compare</span>', chat)
        self.assertIn('className="pop-anchor shrink"', chat)
        css = read("app/globals.css")
        phone = css[css.index("@media (max-width: 560px)"):]
        phone = phone[: phone.index("\n}")]
        self.assertIn(".tool-label.wide-only { display: none; }", phone)
        self.assertIn(".composer-bar > .spacer, .composer-bar > .shrink { flex: 0 1 auto; min-width: 0; }", css)

    def test_models_page_has_add_section(self):
        panel = read("components/ModelsPanel.js")
        page = read("app/(app)/models/page.js")
        self.assertIn('id="add"', panel)
        self.assertIn("Add a model or API", panel)
        self.assertIn('href="#add"', page)
        self.assertIn("How to add a model or API", page)


if __name__ == "__main__":
    unittest.main()

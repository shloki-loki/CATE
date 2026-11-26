import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from cate.audit import report
from cate.util import ROOT


class AuditTests(unittest.TestCase):
    def test_module_prints_chat_report(self):
        run = subprocess.run([sys.executable, "-m", "cate.audit"], cwd=ROOT,
                             capture_output=True, text=True, check=True)
        self.assertEqual(run.stderr, "")
        headings = [line for line in run.stdout.splitlines() if line.startswith("## ")]
        self.assertEqual(headings, ["## Feature Checklist", "## Bug Summary", "## Competitor Analysis"])
        self.assertIn("- [x] ", run.stdout)
        comparison = run.stdout.split("## Competitor Analysis")[1]
        for platform in ("OpenAI ChatGPT", "Google Gemini", "Anthropic Claude"):
            self.assertIn(f"### {platform}", comparison)

    def test_scan_reports_defects_and_recognizes_valid_code(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                "cate/sample.py": "from .missing import feature\ndef f(x):\n    return json.dumps(x)\n",
                "cate/broken.py": "def (",
                "web/app/(app)/c/[id]/page.js": "",
                "web/app/api/state/route.js": "",
                "web/next.config.mjs": "{ source: '/old/:id', destination: '/c/1' }",
                "web/public/logo.png": "",
                "web/components/Nav.js": """
                    const good = setInterval(poll, 10);
                    clearInterval(good);
                    const stale = setInterval(poll, 20);
                    router.push('/c/1');
                    router.push('/old/1');
                    fetch(`/api/state?chat=${id}`);
                    redirect('/gone');
                    const logo = <a href="/logo.png"/>;
                """,
                "web/lib/cache.js": "const entries = new Map();\nentries.set(key, value);",
                "data/uploads/private.py": "import private_chat_content",
            }
            for relative, contents in files.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents, encoding="utf-8")

            result = report(root)
            self.assertIn("- [ ] Project chat and attachments", result)
            self.assertIn("Python syntax error", result)
            self.assertIn("Check import `cate.missing`", result)
            self.assertIn("unresolved name `json`", result)
            self.assertEqual(result.count("unresolved name"), 1)
            self.assertIn("Check dead route `/gone`", result)
            self.assertEqual(result.count("Check dead route"), 1)
            self.assertEqual(result.count("Check interval cleanup"), 1)
            self.assertIn("Module cache `entries` retains entries", result)
            self.assertNotIn("private_chat_content", result)

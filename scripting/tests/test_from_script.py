import io
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from pipeline import from_script, one_minute
from pipeline.models import load, save
from tests.fixtures import SCRIPT, fake_completion


class FakeClient:
    def __init__(self, short_first_scenes: bool = False):
        self.prompts: list[str] = []
        self.short_first_scenes = short_first_scenes

    def complete(self, prompt, max_tokens=7000, temperature=0):
        self.prompts.append(prompt)
        short = self.short_first_scenes and sum('{"scenes"' in p for p in self.prompts) == 1
        return fake_completion(prompt, short_scenes=short)


class FromScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch.object(one_minute, "PROJECTS_ROOT", Path(self.tmp.name))
        patcher.start(); self.addCleanup(patcher.stop)
        mock.patch.object(from_script, "PROJECTS_ROOT", Path(self.tmp.name)).start()
        self.addCleanup(mock.patch.stopall)

    def run_build(self, client, script=SCRIPT, **kwargs):
        with mock.patch.object(from_script, "ScriptClient", return_value=client), redirect_stdout(io.StringIO()) as out:
            path = from_script.build("demo", script, "आख़िरी बस", **kwargs)
        return path, out.getvalue()

    def test_user_script_skips_story_and_yields_twelve_validated_scenes(self):
        client = FakeClient()
        path, out = self.run_build(client)
        project = load(path)
        self.assertEqual(project["script"]["raw_text"], SCRIPT.strip())
        self.assertEqual(project["idea"]["selected"]["title"], "आख़िरी बस")
        self.assertEqual(len(project["scenes"]), 12)
        self.assertTrue(all(s["status"] == "pending" and s["animation_prompt_NARRATOR_ONLY"] for s in project["scenes"]))
        self.assertIn("मत बैठना", project["scenes"][2]["animation_prompt_WITH_lipsync"])
        self.assertEqual(len(client.prompts), 3, "only characters, backgrounds and scenes are generated")
        self.assertFalse(any("expert horror scriptwriter" in p for p in client.prompts))
        self.assertTrue(all("LOCKED SCRIPT" in p for p in client.prompts[:2]))
        self.assertIn('"event": "script_ready"', out)

    def test_resume_keeps_saved_flow_state_and_makes_no_calls(self):
        path, _ = self.run_build(FakeClient())
        project = load(path)
        project["scenes"][0]["status"] = "done"
        save(path, project)
        again = FakeClient()
        self.run_build(again)
        self.assertEqual(again.prompts, [])
        self.assertEqual(load(path)["scenes"][0]["status"], "done")

    def test_different_script_for_existing_project_is_refused(self):
        self.run_build(FakeClient())
        with self.assertRaisesRegex(ValueError, "different script"):
            self.run_build(FakeClient(), script="कोई दूसरी कहानी")

    def test_wrong_scene_count_is_retried_then_validated(self):
        client = FakeClient(short_first_scenes=True)
        path, out = self.run_build(client)
        self.assertEqual(len(load(path)["scenes"]), 12)
        self.assertIn("script_stage_retry", out)
        with self.assertRaisesRegex(ValueError, "Expected 12 scenes"):
            with mock.patch.object(from_script, "ScriptClient", return_value=FakeClient(short_first_scenes=True)), redirect_stdout(io.StringIO()):
                from_script.build("single-attempt", SCRIPT, "t", attempts=1)

    def test_missing_groq_key_is_reported(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "GROQ_API_KEY"):
                from_script.ScriptClient()


if __name__ == "__main__":
    unittest.main()

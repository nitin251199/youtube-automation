"""Build a validated 12-scene project from a user-supplied finished script."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .anthropic_client import ScriptClient
from .models import load, new_project, save, utc_now
from .one_minute import PROJECTS_ROOT, extract_plan
from .prompts import STYLE_LOCK


def emit(event: str, **data):
    print(json.dumps({"at": utc_now(), "event": event, **data}, ensure_ascii=False), flush=True)


def prepare(path: Path, project_id: str, script: str, title: str, concept: str | None) -> dict:
    """Create the project with the script locked in, or reopen it for resume."""
    if path.exists():
        project = load(path)
        if project["script"]["raw_text"] != script:
            raise ValueError(f"{path} already holds a different script. Use a new project id for a new video.")
        return project
    project = new_project(project_id, "S", concept or title, 1)
    project["style_reference"] = STYLE_LOCK
    project["flow_project_name"] = f"YouTube Automation - {title[:48]}"
    # A selected idea satisfies the stage guard; a filled raw_text skips story generation.
    selected = {"index": 1, "title": title, "hook": concept or script.strip().splitlines()[0][:200], "entity_archetype": "Pret-aatma"}
    project["idea"].update(status="done", items=[selected], selected_index=1, selected=selected,
                           raw_output="Finished script supplied by the user; idea and story generation skipped.")
    project["script"].update(status="done", language="Hindi", duration_minutes=1, word_count=len(script.split()),
                             monster=None, raw_text=script, raw_output=None, source="user")
    save(path, project)
    return project


def build(project_id: str, script: str, title: str, concept: str | None = None, model: str | None = None, attempts: int = 3) -> Path:
    script, title = script.strip(), title.strip()
    if not script:
        raise ValueError("The script is empty.")
    if not title:
        raise ValueError("A title is required.")
    path = PROJECTS_ROOT / project_id / "pipeline.json"
    project = prepare(path, project_id, script, title, concept)
    emit("script_locked", project_file=str(path.resolve()), words=project["script"]["word_count"])
    client = ScriptClient(model=model)
    extract_plan(client, path, project, progress=lambda stage, count: emit("script_stage_done", stage=stage, count=count), attempts=attempts)
    emit("script_ready", project_file=str(path.resolve()), characters=len(project["characters"]),
         backgrounds=len(project["backgrounds"]), scenes=len(project["scenes"]))
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--script-file", required=True, type=Path, help="UTF-8 text file containing the finished script.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--concept", default=None, help="Optional one-line premise stored with the project.")
    parser.add_argument("--model", default=None, help="Optional Groq model override.")
    args = parser.parse_args()
    print(build(args.project_id, args.script_file.read_text(encoding="utf-8"), args.title, args.concept, args.model))

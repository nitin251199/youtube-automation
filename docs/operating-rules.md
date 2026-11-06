# Operating rules

These rules keep runs safe with real Google Flow credits and a real YouTube channel. The web backend and the CLI already enforce them; they are written down here for anyone operating or changing the pipeline.

## Scripting

- Keep the literal templates in `scripting/prompts/` intact; only the `{{...}}` input fields may change.
- Every project is a one-minute Hindi folk-horror video with exactly 12 validated scenes, in the locked style: flat, semi-realistic 2D Indian animation with natural adult human proportions.
- Groq is the only writing model. Keys live only in the Git-ignored `scripting/.env`.

## Google Flow

- Run Flow only through the persistent automation Chrome profile (`production/chrome-profile`). Create characters, then backgrounds, then scenes, and download every completed scene.
- Never force six-second clips; Flow chooses the natural duration for each action and spoken line.
- Characters are saved as named Flow characters and attached to scenes as ingredients; never submit a scene whose characters or background are missing.
- Resume a failed run from its saved `pipeline.json` (Resume in the web app, or `node start-video.mjs --project <pipeline.json>`). Never create a replacement project for a failed step.
- Never click Generate to recover a completed or queued item, never use an unrelated project-wide Download, never bypass Google's verification, and never treat an old queue message as the current state.
- An item stopped exactly at submission (`flow_generation.phase` is `prepared`) must be checked in Flow before its marker is cleared; retrying automatically could spend credits twice.

### Recovering an old completed Flow result

For a scene submitted by an older runner that saved no media reference:

1. In the automation browser, find the result whose scene and prompt match. Do not pick the first video in the gallery.
2. Save an ignored JSON file in `production/outputs` with `project_file`, `scene_number`, `flow_url` and the exact `media_source` from that scene's video element.
3. Run `npm run recover-scene -- --reference /absolute/path/reference.json` in `production`, then resume. Never print signed URLs or invent the reference. If no result clearly matches, stop and report that.

## Narration

- Every narrator scene gets its own Google AI Studio audio file in one fixed narrator voice. Never continue a narrator scene silently.
- The runner presses Run twice. If AI Studio still produces nothing, it asks: "Hey, when I open Google AI Studio, just click on the Run button so I can proceed." The web app shows this as an attention banner.

## Editing

Read `docs/editor.md`. Character scenes keep only their native synchronized dialogue; narrator scenes use their AI Studio file and drop accidental Flow voices; `none` without narration text is music only. Music stays continuous at -20.9 LUFS and ducks under speech, and narration targets -14 LUFS. Speaking scenes are joined with cuts so voices never overlap. The title fades in over scene 1, and the logo sits lower right (at 1280x720: 76 px high, 72 px from the right, 75 px from the bottom). A successful render is not proof of lip sync or visual consistency; review the edit report and the video before approving.

## Approval and upload

After the final render, the project records `awaiting_approval`, and one question is asked: "Is this video good enough to upload to YouTube?" Approval uploads that exact file (checked by SHA-256) through Zernio without a second confirmation; rejection uploads nothing. Until Zernio is configured, approval is only recorded, and the approved file is uploaded later with the web app's Upload button or `npm run review -- upload`. Never bypass review, and never resubmit a project whose upload already started; check the Zernio dashboard first.

Never commit API keys, `.env` files, browser profiles, downloaded media, project outputs or private intro/logo files.

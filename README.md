# Hindi Folk-Horror YouTube Automation Pipeline

> **New here?** Please provide your channel logo image (PNG or JPG) and intro
> video (MP4, at least 5 seconds long, with audio). Right after cloning, run
> `node welcome.mjs` on Mac or Windows. It creates your private `.env` template and
> tells you where to put those two file paths. See [WELCOME.md](WELCOME.md).

This repository contains a two-half pipeline and a self-hosted web app:

- `scripting/`: Groq API orchestration for idea -> script -> assets -> scenes -> publishing metadata, or for a finished script you supply.
- `production/`: Playwright browser automation for Google Flow using a persistent Chrome profile.
- `web/`: Next.js UI + Express API + MongoDB. Paste a script, watch progress live, answer browser prompts, preview the MP4 and approve the YouTube upload.

## Web app: paste a script, approve the upload

Requirements: Node 22.19+, Python 3.10+, MongoDB running locally (or any `MONGO_URL`), and an FFmpeg build with libass (the title render uses the `subtitles` filter). On macOS, Homebrew's default `ffmpeg` no longer includes libass; run `brew install ffmpeg-full`. The web backend uses `/opt/homebrew/opt/ffmpeg-full/bin` automatically, or set `FFMPEG_DIR`.

```sh
node welcome.mjs                                   # creates scripting/.env (never overwrites)
python3 -m venv scripting/.venv && scripting/.venv/bin/python -m pip install -r scripting/requirements.txt
npm --prefix production install
npm --prefix web run setup                         # backend + frontend dependencies
npm --prefix web run dev                           # UI http://localhost:3000, API http://localhost:4000
```

On Windows use `scripting\.venv\Scripts\python.exe`. For a long-running install, build once with `npm --prefix web run build` and run `npm --prefix web start`.

Fill `scripting/.env` (`GROQ_API_KEY`, Freesound, channel logo/intro, optional `MONGO_URL`, and optional Zernio). The home page shows a setup checklist that never displays secret values. Then:

1. **New video**: paste the finished script, a title and an optional concept. Choose the channel logo/intro from `.env`, or upload a logo (PNG/JPG) and intro (MP4, at least 5 s, with audio) for this video only. Per-video files are kept in the video's output folder and never replace the channel's copies. Optionally tick *check the 12-scene plan first* to approve Groq's scene split before Flow spends credits.
2. **Progress**: Groq builds characters, backgrounds and exactly 12 scenes from your script (story generation is skipped), then the unchanged `start-video.mjs` workflow runs Flow, AI Studio narration, Freesound music, the speaker-aware mix and the intro/title/logo render. The page updates live over SSE.
3. **Attention banner**: when the automation Chrome window needs you (Google sign-in or verification, or AI Studio's *Run* button), a banner says exactly what to do. The run continues by itself once you act.
4. **Review**: watch the final MP4 and answer *Is this video good enough to upload to YouTube?* Approve uploads that exact file through Zernio with no second confirmation; Reject uploads nothing. Zernio is optional: without its settings, Approve only records your decision, and the video waits with an **Upload to YouTube** button that works once you add `ZERNIO_API_KEY` and `ZERNIO_YOUTUBE_ACCOUNT_ID`.

Only one video runs at a time: Flow uses one signed-in browser profile and real credits, so further videos wait in a queue. **Stop** ends a run (including its Chrome window) with progress saved; **Resume** continues from `pipeline.json` and never resubmits finished or already-submitted Flow items. If the backend restarts mid-run, that video is marked stopped and waits for you to resume it.

API (all JSON, under `/api`): `POST /videos` (multipart: `title`, `script`, `concept`, `assetMode=channel|video`, `logo`, `intro`, `pauseAfterScript`), `GET /videos`, `GET /videos/:id`, `GET /videos/:id/stream` (SSE: `job`, `history`, `event`), `GET /videos/:id/events`, `GET /videos/:id/file` (MP4 with range support), `POST /videos/:id/start | resume | cancel | approve | reject | upload`, `GET /system/status`. Jobs live in the Mongo `jobs` collection and their activity in `job_events`. The backend reads the pipeline's existing stdout (JSON events, narration messages, `video_ready`/`delivery.json`) rather than a separate logging system.

The API and UI are meant for a trusted local machine or private network: there is no login yet. Jobs already record `ownerId` and `flowProfile`, and the queue runs one job per Flow profile, so multiple users or accounts can be added later. To use the UI from another device, set `WEB_ORIGIN` in `scripting/.env` and `NEXT_PUBLIC_API_URL` in `web/frontend/.env.local`, then rebuild.

Tests: `npm --prefix web test` (backend; uses a throwaway local MongoDB database), `scripting/.venv/bin/python -m unittest discover -s scripting/tests -t scripting`, and `npm test` in `production`.

## Command line: from a finished script

```sh
cd scripting
.venv/bin/python -m pipeline.from_script --project-id my-video --script-file my-script.txt --title "आख़िरी बस"
cd .. && node start-video.mjs --project scripting/projects/my-video/pipeline.json
```

`from_script` locks your text as the project's script, asks Groq only for characters, backgrounds and the 12 validated scenes, and prints JSON progress lines. Rerunning it with the same id and script resumes without new calls; a different script for an existing id is refused.

## Fastest local workflow: give one title

The editor now checks the project's speaker assignments before mixing: character dialogue stays with its original picture, narrator files are limited to narrator scenes, and music covers non-speaking shots. New exports include an edit report. See [audio timing and continuity editing](docs/editor.md) for re-editing existing videos, measured lip-sync repairs, voice settings, and source-review limits.

### One command on Mac and Windows

From the repository root, after installing Node 22.19+, FFmpeg and Python dependencies:

```sh
npm --prefix production install
node welcome.mjs
node start-video.mjs --title "Aakhri Local"
```

Fill the existing local `scripting/.env` once. Python can be selected with `PYTHON`; the launcher automatically uses `scripting/.venv` when present. On Mac, the Python command is `python3`. The Node launcher uses argument arrays rather than shell strings and requires no PowerShell.

The command generates the script, Flow assets and scene downloads, AI Studio narration downloads, music, the mixed story, and the intro/logo export. It saves `final.mp4` and `delivery.json` in the project's output folder, then records `awaiting_approval`. The web app shows that MP4 and asks for approval; from a terminal run `npm --prefix production run review -- prompt --project <pipeline.json>`. Login/Google verification may still require you to act in the browser.

Resume the existing Mac project with this command from the repository root (no new script or project is created):

```sh
node start-video.mjs --project scripting/projects/youtube-automation-aakhri-local-20261006-165125/pipeline.json
```

Install Python requirements once using your virtual environment's Python: `python3 -m pip install -r scripting/requirements.txt` (Windows: `python -m pip ...`). FFmpeg/ffprobe must be available in PATH. If Playwright's bundled browser is missing, installed Chrome is used; if neither browser exists, the matching Playwright Chromium is downloaded. Close only another window using the same automation profile if it is locked; the launcher does not kill browsers or delete profile locks.

Flow submissions are saved before generating. On resume they are checked without submitting again; current media takes precedence over old queue text. Downloads target the matching new media card. If a prior locally modified runner submitted a scene without saving its reference, first identify that existing result in the browser and recover it (see [operating rules](docs/operating-rules.md)). Blind regeneration is refused.

Browser integration tests cover the failure cases against local fixtures. Real Google pages can change, and the Mac/Google session in the error report has not been available for a live end-to-end test here. If controls change, the saved result is retained and the failing Flow screenshot is saved locally in `flow-error.png` for inspection.

Run `npm test` and `npm run typecheck` in `production` to verify locally. A Mac/Windows/Linux GitHub Actions template is saved at `docs/automation-tests.yml`; enabling it requires moving it to `.github/workflows` with GitHub workflow permission. It is not active automatically.

### Existing Windows launcher

This is a local-only project. Nothing requires Railway or a cloud browser session. Copy `scripting/.env.example` to `scripting/.env`, add your Groq key, ensure Chrome is logged into Google Flow, then run:

```powershell
.\start-video.ps1 -Title "आख़िरी बस की तीसरी सीट" -Concept "बरसाती रात में तीसरी सीट पर बैठी प्रेत-आत्मा"
```

The launcher creates a fresh one-minute project with exactly 12 structured scenes, then opens the persistent local Chrome profile and runs Flow in this order: characters → backgrounds → scenes → downloads. Flow itself decides every scene's natural duration; no scene is forced to six seconds.

### Writing-model selection

Groq is the only writing-model provider for every scripting stage (idea, story, characters, backgrounds, scenes, and publishing metadata). Set `GROQ_API_KEY` in `scripting/.env`; the default model is `openai/gpt-oss-120b`, and `GROQ_MODEL` overrides it. A response cut off at the token limit is reported as an error instead of being parsed. Keys are never committed; `.env` is ignored by Git.

The older PowerShell launcher prints narration and finishing commands for compatibility. Use `start-video.mjs` for automatic continuation through those stages. Character scenes retain their Flow audio. Narrator scenes use AI Studio audio with scene ambience/SFX beneath it.

## Important prompt-template contract

The prompt bodies from `HORROR PROMPTS.pdf` are now installed in `scripting/prompts/`. They remain stage-local and are rendered with only the named input substitutions. The supplied reference image is captured in `scripting/style_reference.md` and is appended as a locked style constraint for character, background, and scene generation.

If the templates are replaced or updated, keep the literal prompt wording intact and only change the `{{...}}` input fields:

```text
scripting/prompts/1- IDEA GENERATION.txt
scripting/prompts/3- STORY.txt
scripting/prompts/4- CHARACTER IMAGE PROMPTS.txt
scripting/prompts/5- IMAGE PROMPTS.txt
scripting/prompts/6- ANIMATION PROMPTS.txt
scripting/prompts/7- UPLOADING.txt
```

The runner refuses to start if a template is missing or still contains the old scaffold marker.

## Half A: scripting

```powershell
cd scripting
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:GROQ_API_KEY = "your key"
python -m pipeline.cli new --project-id village-well --method B --concept "एक सूखे कुएँ में लौटती चूड़ैल" --ideas 5
python -m pipeline.cli choose --project projects\village-well\pipeline.json --index 2
python -m pipeline.cli run --project projects\village-well\pipeline.json --language Hindi --duration 8 --monster "चुड़ैल"
```

For the one-minute, exactly 12-scene haunted-bus project in this workspace, run
`python -m pipeline.one_minute --project-id youtube-automation-last-bus` from
`scripting/` with `GROQ_API_KEY` set. This creates a fresh project file; do not
rerun it over a project whose Flow assets are already in progress.

`choose` is the only intentional Half A human checkpoint. `run` resumes completed stages and preserves the raw Stage 2 script as the source of truth. The generated project JSON follows `scripting/schema/pipeline.schema.json`.

Stage outputs may be JSON, fenced JSON, or the PDF's labeled text format. Parsers retain raw output and validate tags, minimum scene count, speakers, and the narrator/lip-sync split.

## Half B: production

Install Playwright and its browser once:

```powershell
cd production
npm install
npx playwright install chrome
npm run flow -- --project ..\scripting\projects\village-well\pipeline.json --user-data-dir .\chrome-profile --output-dir .\outputs
```

The runner uses a persistent Chromium profile. On first use, complete Google login in the opened browser, then rerun. UI labels/selectors are centralized in `production/src/selectors.ts` and can be updated when Flow changes. It waits on DOM state and download events, not fixed render sleeps. It drives Flow's current agent composer and waits up to 30 seconds for it; if the composer never appears (for example behind a sign-in or welcome dialog), the run stops before submitting anything. The older classic-editor path runs only with `FLOW_CLASSIC_UI=1`. Flow's agent cannot create characters, so after the character images the runner saves each one in Flow's **Characters** section under its tag (for example `@CHAR-02-DRIVER`), with a built-in Flow voice chosen from its description and its look and voice notes as character info; a character that already exists with that name is reused, never duplicated. Each scene then attaches its characters and its background image as prompt ingredients before it is submitted; if any of them is missing, that scene is not submitted. Results are tracked by Flow's media ID, because Flow's image addresses change over time. Each scene clip is taken from Flow's chat reply to that scene's own request (never from other media on the page), opened in Flow's editor to record its ID, and downloaded with **Download media → Original size**; the upscaled options are never chosen. If Flow answers a request with an error card, that scene is submitted once more automatically. Set Flow's output count to 1x in the composer's settings: the default 2x doubles credits, and two results arriving at the same moment are refused as ambiguous. The runner skips `done`, retries each `failed` item once, logs structured errors, and continues with later items.

The runner watches current media for up to 30 minutes after a saved submission, even when the chat contains an old high-demand message. It does not submit a duplicate request on resume. Set `FLOW_QUEUE_WAIT_MINUTES` to a value from 1 to 120 for a different wait period. If there is still no matching result, the item stays `pending` for resume. A run interrupted exactly during submission is flagged for inspection rather than guessed or resubmitted.

This automation is intentionally conservative: it does not call a Flow API, create accounts, acquire credits, or clone voices.

### Final edit with natural clip lengths and fades

Flow clips are never trimmed to a fixed duration. After downloading the completed `scene-####.mp4` files, preserve every clip in full and assemble them with short audio/video fades:

```powershell
cd production
npm run edit -- --input-dir .\outputs\youtube-automation-last-bus --output .\outputs\youtube-automation-last-bus\final-with-fades.mp4 --transition 0.35
```

The editor probes each clip's actual duration, keeps its full performance (including dialogue), then overlaps adjacent clips by the selected fade duration. The final runtime is content-driven, not fixed to one minute.

### Google AI Studio narration mix

Use the text and voice direction in `production/outputs/<project>/narration-manifest.json` to generate one narration file per listed scene in Google AI Studio. Download each as `narration-000N.wav` (or `.mp3`) into `production/outputs/<project>/narration/`.

```powershell
cd production
npm run mix-narration -- --input-dir .\outputs\youtube-automation-last-bus --narration-dir .\outputs\youtube-automation-last-bus\narration --bgm .\outputs\youtube-automation-last-bus\background-music.mp3 --narration-makeup-db 12 --bgm-lufs -20.9 --output .\outputs\youtube-automation-last-bus\final-narrated.mp4 --transition 0.35
```

Pass `--project /path/to/pipeline.json` to enforce speaker ownership. Narration uses a -14 LUFS target; character scenes retain native dialogue. Music is continuous at -20.9 LUFS and ducks under speech. Narrator and music-only shots discard Flow audio to avoid accidental duplicate voices. Cuts protect dialogue at scene boundaries. Source durations are retained; long narration holds the last frame instead of changing a speaking character's timing. See `docs/editor.md` for measured corrections and compatibility with the legacy commands.

### Channel intro, music, and subtitle policy

Every final export starts with the first five seconds of the private channel intro at `production/assets/channel-intro.mp4`, then cross-fades into the titled story. Put a channel logo image (`channel-logo.png`, `.jpg`, or `.jpeg`) beside it. The logo is rendered on every final video in the lower-right reference position, inset from the edges (at 1280x720: 76px high, 72px from the right, 75px from the bottom). Both private assets are intentionally not committed; each clone must supply its own licensed copies.

The finishing commands printed by `start-video.ps1` download a Creative Commons Zero Freesound horror music bed and loop it continuously beneath the story at -20.9 LUFS. Narration is held around -14 LUFS after compression, which keeps it clearly intelligible. A 0 LUFS narration target is intentionally not used because it would clip speech. Set these local-only values in `scripting/.env` before the audio step:

```text
FREESOUND_CLIENT_ID=
FREESOUND_CLIENT_SECRET=
FREESOUND_REFRESH_TOKEN=
```

The music downloader saves a license record beside the downloaded file. Final FFmpeg exports map only video and audio, so soft subtitle streams are not carried into the completed video. The pipeline does not add subtitles. Burned-in captions or third-party watermarks must be avoided by obtaining a clean source export; they are not removed or concealed by this project.

### First-run setup and approval uploads

Requires Node.js 22+, Python, FFmpeg and the existing production dependencies.
Copy `scripting/.env.example` to `scripting/.env` once, then fill in your values there. This single file holds writing-model keys, music credentials, optional Zernio upload settings and logo/intro file paths. Zernio is optional: leave both Zernio values empty to produce and review videos without uploading, and upload approved videos once you add them. Never overwrite an existing `.env` containing credentials.

```dotenv
ZERNIO_API_KEY=your_zernio_key
ZERNIO_YOUTUBE_ACCOUNT_ID=your_connected_account_id
YOUTUBE_VISIBILITY=private
CHANNEL_LOGO_PATH=C:/Users/you/Pictures/logo.png
CHANNEL_INTRO_PATH=C:/Users/you/Videos/intro.mp4
```

Use the connected account ID from Zernio, not the YouTube channel ID. Connect your channel in Zernio first. Paths may be absolute or relative to the repository root. Files stay on disk; only their paths go in `.env`. Visibility defaults to private; set public when ready.

Run `npm install` then `npm run setup` from `production` to validate settings and copy channel assets. `start-video.ps1` also runs this check automatically. Credentials are read from the same Git-ignored `scripting/.env` on each run, with environment variables taking precedence. The earlier `.env.upload.json` is no longer used; move any saved values into `.env`.

The existing Flow and Google AI Studio narration workflow remains in place. The final `add-title --project ...` command renders the intro and logo, records the exact video hash, and in an interactive terminal asks one question: **Is this video good enough to upload to YouTube?** It shows the video path, account and visibility. Yes uploads the local MP4 through Zernio immediately; no records rejection without uploading. No second publishing confirmation is needed.

For a noninteractive run (the web app's Approve and Reject buttons call the same commands), use:

```powershell
npm run review -- prompt --project <pipeline.json>
# Or record the user's explicit decision:
npm run review -- approve --project <pipeline.json>
npm run review -- reject --project <pipeline.json>
# Upload an approved video later, once Zernio is configured:
npm run review -- upload --project <pipeline.json>
```

Approval is tied to the rendered file hash. Modified videos require a fresh review. Concurrent uploads are locked. Once a post request starts, repeat submissions are blocked even if the network response is lost; check the Zernio dashboard to reconcile before taking further action. A stale `.upload.lock` after a process crash must be inspected before manual removal. Pre-submission failures can be retried with `npm run review -- upload --project <pipeline.json>` (`retry` is an alias).

A submitted post is not reported as published until Zernio returns a published platform status. Pending submissions can be followed in the Zernio dashboard. `review status` shows the locally recorded response, not a live poll.

API references: https://docs.zernio.com/guides/media-uploads and https://docs.zernio.com/platforms/youtube.

Validation: `npm run typecheck` and `npm test` in `production`. Tests mock all network calls; they never upload to YouTube.

### Welcome message for new users

`node welcome.mjs` creates `scripting/.env` from the template and asks for exactly two assets:

> Welcome to YouTube Automation! Please provide your channel logo image (PNG or JPG) and intro video (MP4, at least 5 seconds long, with audio).

All other settings come from `scripting/.env`. `npm run setup` in `production` creates this file if missing, preserves existing values, and shows the same asset-only welcome when configuration is incomplete. Git clone alone cannot execute a message.

### Freesound credentials

Follow [the Freesound setup steps](docs/freesound-onboarding.md) to register an API app, authorize it once and save `FREESOUND_CLIENT_ID`, `FREESOUND_CLIENT_SECRET` and `FREESOUND_REFRESH_TOKEN` in `scripting/.env`. Validate with `npm run freesound -- --auth-only` in `production`. Refresh tokens are saved after rotation; temporary authorization codes are removed after a successful exchange. Never share these values.

# Freesound setup

The music step downloads one Creative Commons 0 horror bed from Freesound with your own OAuth credentials. Do this once per machine.

1. Sign in at https://freesound.org and open https://freesound.org/apiv2/apply/. Reuse your existing API app if you have one; otherwise create one with truthful details. Creating credentials and accepting Freesound's API terms are your decisions to make.
2. Copy the app's client ID and client secret into `scripting/.env` as `FREESOUND_CLIENT_ID` and `FREESOUND_CLIENT_SECRET`. Keep every other line of the file as it is.
3. If you already have a refresh token, save it as `FREESOUND_REFRESH_TOKEN` and skip to step 5.
4. Otherwise open `https://freesound.org/apiv2/oauth2/authorize/?client_id=YOUR_CLIENT_ID&response_type=code`, approve access, and save the code you receive as `FREESOUND_AUTHORIZATION_CODE` in `scripting/.env`. Codes expire quickly; if it fails, authorize again rather than guessing. See https://freesound.org/docs/api/authentication.html.
5. In `production`, run `npm run freesound -- --auth-only`. It exchanges the code (or validates the refresh token), saves the new `FREESOUND_REFRESH_TOKEN` and removes the temporary code. It downloads no music. Only a successful response confirms the setup.

Freesound rotates refresh tokens, so every successful refresh saves the replacement in `scripting/.env`. Never paste these values into chats, screenshots, Google Sheets or Git.

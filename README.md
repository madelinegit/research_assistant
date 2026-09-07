# ModelsLab Chatbot (single-user)

A personal Expo (React Native + TypeScript) chatbot for the ModelsLab Uncensored
Chat API. One user, one device, local storage. Full-context memory: every request
resends the entire conversation verbatim — no sliding window, no summarization.
You screenshot, then wipe.

## Run it locally

```bash
npm install
npm run dev
```

Then press `w` for the browser preview, or `i` / `a` for an iOS/Android simulator,
or scan the QR code with the Expo Go app on your phone.

> `npm start` now runs the **production** server (see Deploy). Use `npm run dev`
> for the Expo dev server.

## Deploy to Railway

The app ships as a static web export served by [`server.js`](server.js), a small
Express process that puts the whole site behind a password.

```bash
npm run build     # static export -> dist/, then verifies no API key leaked
npm run serve     # run the production server locally (reads .env.local)
```

### One-time Railway setup

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo** in
   Railway. [`railway.json`](railway.json) supplies the build and start commands,
   so there is nothing to configure there.
   - Dependency install is left to Nixpacks. Don't add `npm ci` to the build
     command: Nixpacks mounts a build cache inside `node_modules/`, and `npm ci`
     wipes `node_modules` — it then can't remove the live mount point and the
     build dies with `EBUSY`.
   - `.nvmrc` pins Node 22. Railway otherwise defaults to Node 18, which is below
     the `>=20.19.4` that Expo 57 / React Native 0.86 require.
2. In the service's **Variables** tab, add:

   | Variable | Value |
   |----------|-------|
   | `AUTH_USER` | your login email |
   | `AUTH_PASS` | your password |

   `PORT` is injected by Railway. **Do not** set `EXPO_PUBLIC_MODELSLAB_KEY` —
   see Security below.
3. **Settings → Networking → Generate Domain** to get your URL.

If `AUTH_USER` or `AUTH_PASS` is missing the server exits instead of booting, so
a misconfigured deploy fails loudly rather than serving the app to the open
internet.

### First load on your phone

1. Open the URL in Safari and sign in. The session cookie lasts 30 days, so you
   won't be asked again on every launch.
2. Open **Settings** (⚙️) and paste your **ModelsLab API key** → Save.
3. **Share → Add to Home Screen.** It installs as a standalone app — no browser
   chrome, its own icon, and near-zero device storage compared with a native
   build. Changing `AUTH_PASS` later signs every device out.

## Security

- **The API key never enters the bundle.** `EXPO_PUBLIC_*` values are inlined by
  Metro at build time, and ModelsLab replies with `access-control-allow-origin: *`,
  so a key shipped to the browser would be usable by anyone from any origin. The
  `.env.local` fallback in `src/store.tsx` is therefore gated on `__DEV__`,
  `npm run build` blanks the variable, and `scripts/verify-no-secrets.js` then
  greps `dist/` and **fails the build** if the key appears anywhere. On the
  deployed app the key is entered in Settings and stays in that browser only.
- **The password gate is server-side.** The gate sits above `express.static`, so
  an unauthenticated request never receives the app's HTML or JS — unlike a
  client-side gate, which anyone could bypass from devtools. Credentials are
  compared in constant time and failed logins are delayed by a second.
- A cookie session is used rather than HTTP Basic Auth because iOS re-prompts for
  Basic credentials inside an installed PWA on every cold launch.
- App icons and `manifest.json` are served *before* the gate: the manifest is
  fetched with credentials omitted per spec, so gating it breaks "Add to Home
  Screen". They expose nothing but the app's name, colors, and icon.

## First-time setup (in the app)

1. Open **Settings** (⚙️ top-right of the Chat screen).
2. Paste your **ModelsLab API key** → Save. (Stored in the device keychain via
   expo-secure-store; on the web preview it falls back to localStorage.)
3. The **model**, **endpoint**, and **persona** ship with working defaults — edit
   any of them if you like. The persona (system prompt) is your curation lever.

Get an API key from your ModelsLab dashboard. Default model:
`ModelsLab/Llama-3.1-8b-Uncensored-Dare` at the OpenAI-compatible endpoint
`https://modelslab.com/api/uncensored-chat/v1/chat/completions`.

## How the memory works

- Every message (yours and the bot's) is written to on-device SQLite immediately.
- On launch, the whole table reloads — the thread continues where it left off.
- Each send builds the payload as `[system prompt] + [all prior messages] + [new
  message]` and sends the entire thing. Nothing is dropped or summarized.
- The header **context meter** estimates how full the model's context window is
  (chars ÷ 4). Past 85% you get a "getting full" banner. If the API rejects the
  request for length, you get a clear "screenshot then wipe" message — never a
  silent trim.
- **Wipe** (🗑) clears the conversation after a confirm. It does **not** touch
  your API key or persona.

## Project layout

| Path | Role |
|------|------|
| `app/_layout.tsx` | Router + providers |
| `app/index.tsx` | Chat screen (header meter, list, input, banners) |
| `app/settings.tsx` | Settings (API key, persona, model, params) |
| `src/store.tsx` | App-wide state; owns send/wipe + full-context payload |
| `src/db.ts` / `src/db.web.ts` | Message store: native SQLite / web localStorage |
| `src/secure.ts` | API key + settings in secure storage |
| `src/api.ts` | ModelsLab client (OpenAI-compatible + community shapes) |
| `src/tokens.ts` | Context-meter token estimate |
| `src/constants.ts` | Defaults (persona, endpoint, model, context window) |
| `src/useKeyboardInset.ts` | Web keyboard avoidance (see below) |
| `app/+html.tsx` | HTML shell: PWA manifest, safe areas, dvh sizing |
| `server.js` | Production server: password gate + static hosting |
| `scripts/verify-no-secrets.js` | Build guard: fails if the API key reached `dist/` |

## Notes on the web target

Web is now the **ship target** (it's what Railway serves); iOS/Android still
build from the same source with no rewrite.

- **Storage.** `expo-sqlite` and `expo-secure-store` don't run on web without
  extra WASM/COOP-COEP setup, so web falls back to `localStorage` (see
  `db.web.ts` and `secure.ts`). Two consequences worth knowing:
  - `initDb` calls `navigator.storage.persist()`, which iOS grants automatically
    to an installed (Add to Home Screen) PWA. Without installing, Safari may
    evict the conversation *and* the saved API key after ~7 days of not opening
    the site. **Install it to the home screen.**
  - `localStorage` caps an origin at roughly 5 MB. Full-context replay means a
    long thread can reach that. A failed write is no longer swallowed — you get a
    "storage is full, export then wipe" banner rather than silently losing turns.
- **Keyboard.** `<KeyboardAvoidingView>` is inert on web: its `behavior` prop is
  gated on `Platform.OS === 'ios' | 'android'` and a web build reports `'web'`.
  Mobile Safari also shrinks only the *visual* viewport when the keyboard opens,
  not the layout viewport, so the composer would sit behind the keyboard.
  `src/useKeyboardInset.ts` measures the occluded strip via `visualViewport` and
  the Chat screen pads by it.
- **Storing the key in `localStorage` is not the keychain.** It's scoped to your
  browser on your device, behind the password gate, which is the right trade for
  a single-user app — but it is a real downgrade from native's `SecureStore`.

## Typecheck

```bash
npx tsc --noEmit
```

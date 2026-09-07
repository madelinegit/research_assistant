/**
 * Production web server for Railway.
 *
 * Serves the static Expo web export (`dist/`, produced by `npm run build`)
 * behind a password gate.
 *
 * Why a cookie session instead of HTTP Basic Auth: the gate has to survive
 * "Add to Home Screen". iOS re-prompts for Basic Auth credentials inside the
 * standalone PWA webview and doesn't reliably carry them over from Safari, so
 * a Basic-Auth-protected app would ask for a password on every cold launch.
 * A signed HttpOnly cookie persists across launches and is still enforced
 * server-side — the app's JS and HTML are never sent to an unauthenticated
 * request, which a client-side gate could not promise.
 *
 * Config (Railway → Variables):
 *   AUTH_USER  required  login email
 *   AUTH_PASS  required  password
 *   PORT       provided by Railway
 *
 * There is no fallback password on purpose: if AUTH_PASS is unset the server
 * refuses to boot rather than quietly serving the app to the open internet.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const PORT = process.env.PORT || 8080;
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const DIST = path.join(__dirname, 'dist');

// --- Fail closed -----------------------------------------------------------
if (!AUTH_USER || !AUTH_PASS) {
  console.error(
    '[fatal] AUTH_USER and AUTH_PASS must both be set. Refusing to start ' +
      'rather than serve the app unprotected.\n' +
      '        Railway: Variables tab. Local: put them in .env.local and run ' +
      '`npm run serve`.'
  );
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(
    `[fatal] No build found at ${DIST}. Run \`npm run build\` first ` +
      '(Railway does this automatically via the build command).'
  );
  process.exit(1);
}

// --- Session cookie --------------------------------------------------------
const COOKIE = 'mlab_session';
const SESSION_DAYS = 30;

// Derived from the password so sessions stay valid across restarts/redeploys
// without another env var to manage — and so changing AUTH_PASS immediately
// invalidates every existing session, which is the behaviour you want from a
// password change.
const SECRET = crypto
  .createHash('sha256')
  .update(`mlab-session:${AUTH_USER}:${AUTH_PASS}`)
  .digest();

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function issueToken() {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return `${expires}.${sign(String(expires))}`;
}

function tokenIsValid(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const expires = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  return safeEqual(mac, sign(expires));
}

/** Constant-time compare. Hashing first keeps both sides a fixed 32 bytes, so
 *  this leaks nothing about length either. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const app = express();
// Railway terminates TLS at its edge; trust the proxy so req.protocol reflects
// the client's real scheme and the Secure cookie flag gets set correctly.
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));

function isSecureRequest(req) {
  return req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
}

// --- Login -----------------------------------------------------------------
app.get('/login', (req, res) => {
  if (tokenIsValid(parseCookies(req.headers.cookie)[COOKIE])) {
    return res.redirect('/');
  }
  res.set('Cache-Control', 'no-store').type('html').send(loginPage(false));
});

app.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const ok = safeEqual(username.trim(), AUTH_USER) && safeEqual(password, AUTH_PASS);

  if (!ok) {
    // Blunt throttle: a fixed delay on failure makes online brute-forcing of a
    // weak password impractical without needing any shared rate-limit state.
    return setTimeout(() => {
      res.status(401).set('Cache-Control', 'no-store').type('html').send(loginPage(true));
    }, 1000);
  }

  res.cookie(COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.redirect('/login');
});

// --- Public PWA chrome -----------------------------------------------------
// These must be reachable *before* the gate. The spec fetches a web app
// manifest with credentials omitted unless the <link> opts in, so a gated
// manifest makes "Add to Home Screen" fail outright; and the login page itself
// references the touch icon. Nothing here is sensitive — app name, colours and
// icons only. No app code or data is exposed.
app.use('/icons', express.static(path.join(DIST, 'icons'), { maxAge: '7d' }));
for (const file of ['/manifest.json', '/favicon.ico']) {
  app.get(file, (req, res) => {
    res.set('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(DIST, file));
  });
}

// --- Gate ------------------------------------------------------------------
// Everything below this line requires a valid session. Because it sits above
// express.static, an unauthenticated request never receives the app bundle.
app.use((req, res, next) => {
  if (tokenIsValid(parseCookies(req.headers.cookie)[COOKIE])) return next();
  // Don't bounce asset requests through the login page — they'd get HTML.
  if (req.method !== 'GET' || path.extname(req.path)) {
    return res.status(401).type('txt').send('Unauthorized');
  }
  res.redirect('/login');
});

// --- Static app ------------------------------------------------------------
app.use(
  express.static(DIST, {
    extensions: ['html'], // /settings -> dist/settings.html
    setHeaders(res, filePath) {
      // Expo emits content-hashed filenames under _expo/static, so those are
      // safe to cache forever. HTML must always be revalidated or a redeploy
      // would keep serving the previous build from cache.
      if (/\.html$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// Client-side routes that were never pre-rendered still resolve to the app.
app.use((req, res) => {
  res.set('Cache-Control', 'no-cache').sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`mlab-llm listening on :${PORT} (login required)`);
});

/** Self-contained login page — no bundle, no dependencies, mobile-first. */
function loginPage(failed) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f7" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1c1c1e" />
<link rel="apple-touch-icon" href="/icons/icon-180.png" />
<title>Sign in</title>
<style>
  :root {
    --bg:#fff; --surface:#f5f5f7; --text:#111114; --subtle:#6b6b70;
    --border:#e2e2e6; --accent:#0a84ff; --errBg:#ffe0e0; --errText:#8a1f1f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#000; --surface:#1c1c1e; --text:#f2f2f7; --subtle:#9a9aa0;
      --border:#2c2c2e; --accent:#0a84ff; --errBg:#3a1414; --errText:#ff9a9a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin:0; min-height:100dvh; display:flex; align-items:center;
    justify-content:center; padding:24px calc(24px + env(safe-area-inset-right))
      calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));
    background:var(--bg); color:var(--text);
    font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  form { width:100%; max-width:360px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-0.01em; }
  p.sub { margin:0 0 24px; color:var(--subtle); font-size:14px; }
  label { display:block; font-size:13px; color:var(--subtle); margin:0 0 6px; }
  /* 16px font-size is load-bearing: anything smaller makes iOS Safari zoom in
     when the field takes focus. */
  input {
    width:100%; font-size:16px; padding:12px 14px; margin:0 0 16px;
    color:var(--text); background:var(--surface);
    border:1px solid var(--border); border-radius:12px; appearance:none;
  }
  input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  button {
    width:100%; font-size:16px; font-weight:600; padding:13px 14px;
    color:#fff; background:var(--accent); border:0; border-radius:12px;
    cursor:pointer; -webkit-tap-highlight-color:transparent;
  }
  button:active { opacity:.85; }
  .err {
    background:var(--errBg); color:var(--errText); font-size:14px;
    padding:10px 14px; border-radius:10px; margin:0 0 20px;
  }
</style>
</head>
<body>
  <form method="post" action="/login">
    <h1>ModelsLab Chat</h1>
    <p class="sub">This app is private. Sign in to continue.</p>
    ${failed ? '<div class="err" role="alert">Wrong email or password.</div>' : ''}
    <label for="username">Email</label>
    <input id="username" name="username" type="email" autocomplete="username"
           autocapitalize="none" autocorrect="off" required autofocus />
    <label for="password">Password</label>
    <input id="password" name="password" type="password"
           autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

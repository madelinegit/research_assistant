/**
 * Post-build safety net: fail the build if the ModelsLab API key ended up in
 * the shipped bundle.
 *
 * `npm run build` blanks EXPO_PUBLIC_MODELSLAB_KEY and src/store.tsx gates the
 * env fallback on __DEV__, so the key should never reach dist/. But those are
 * both "should" arguments about a build tool's behaviour, and the cost of being
 * wrong is a live credential published to anyone who loads the page. So we go
 * and check the actual bytes.
 *
 * Reads the real key straight from .env.local (which the production build
 * deliberately does not load). On Railway that file doesn't exist, there is no
 * key to leak, and this exits cleanly.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ENV_FILE = path.join(ROOT, '.env.local');

/** Minimal .env parser — enough for KEY=value lines with # comments. */
function readEnvValue(file, name) {
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    return trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const secret = readEnvValue(ENV_FILE, 'EXPO_PUBLIC_MODELSLAB_KEY');

if (!secret) {
  console.log('[verify] No local API key on this machine — nothing to check.');
  process.exit(0);
}
if (!fs.existsSync(DIST)) {
  console.error('[verify] dist/ not found. Did the export step fail?');
  process.exit(1);
}

// Scan every text-ish file, not just .js — the key could land in a source map
// or a prerendered HTML payload just as easily.
const SKIP = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.ttf', '.otf', '.woff', '.woff2', '.mp4']);
const offenders = walk(DIST).filter((file) => {
  if (SKIP.has(path.extname(file).toLowerCase())) return false;
  return fs.readFileSync(file, 'utf8').includes(secret);
});

if (offenders.length > 0) {
  console.error(
    '\n[verify] FAILED — the ModelsLab API key is present in the build output:\n' +
      offenders.map((f) => `  ${path.relative(ROOT, f)}`).join('\n') +
      '\n\nDo NOT deploy this. Anyone loading the site could read the key.\n'
  );
  process.exit(1);
}

console.log('[verify] OK — API key is not present anywhere in dist/.');

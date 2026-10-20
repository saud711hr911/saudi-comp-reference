// Builds the static site into dist/: the app, engine.js (the single engine source), the dummy fixture for the
// in-app Excel match, config.js and security headers. No bundler and no dependencies.
//   node tools/build.cjs --url <supabase url> --anon <publishable/anon key>
//   (or SUPABASE_URL and SUPABASE_ANON_KEY in the environment, as on the static host)
// Only the public key may go into the site. The build refuses a secret/service key.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), DIST = path.join(ROOT, "dist");
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const url = arg("--url") || process.env.SUPABASE_URL, anon = arg("--anon") || process.env.SUPABASE_ANON_KEY;
if (!url || !anon) { console.error("missing --url/--anon (or SUPABASE_URL/SUPABASE_ANON_KEY)"); process.exit(2); }

function keyRole(k) {
  if (k.startsWith("sb_secret_")) return "secret";
  if (k.startsWith("sb_publishable_")) return "anon";
  try { return JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString()).role; } catch (e) { return "unknown"; }
}
if (keyRole(anon) !== "anon") { console.error("refusing to build: the key is not the public anon/publishable key"); process.exit(3); }
const u = new URL(url);
if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "app.test"].includes(u.hostname)) { console.error("refusing to build: Supabase URL must be https"); process.exit(3); }

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "app"), DIST, { recursive: true });
fs.copyFileSync(path.join(ROOT, "engine.js"), path.join(DIST, "engine.js"));
fs.copyFileSync(path.join(ROOT, "fixture.json"), path.join(DIST, "fixture.json"));
fs.writeFileSync(path.join(DIST, "config.js"), "window.APP_CONFIG = " + JSON.stringify({ url: url.replace(/\/$/, ""), anonKey: anon }) + ";\n");

// Security headers for the static host (Cloudflare Pages reads _headers; tools/gateway.cjs applies the same file locally).
const api = u.origin;
const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
  "img-src 'self' data:", "connect-src 'self' " + api, "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"].join("; ");
fs.writeFileSync(path.join(DIST, "_headers"), ["/*",
  "  Content-Security-Policy: " + csp,
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  X-Frame-Options: DENY",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
  "  Strict-Transport-Security: max-age=31536000", ""].join("\n"));

// Last check: nothing in dist may carry a secret key.
for (const f of fs.readdirSync(DIST, { recursive: true })) {
  const p = path.join(DIST, f); if (fs.statSync(p).isDirectory()) continue;
  const s = fs.readFileSync(p, "utf8");
  for (const m of s.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|sb_secret_\w+/g) || [])
    if (keyRole(m) !== "anon") { console.error("refusing to build: secret key found in " + f); fs.rmSync(DIST, { recursive: true, force: true }); process.exit(3); }
}
console.log("built dist/ for " + api);

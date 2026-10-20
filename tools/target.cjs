// Connection to the test target (a Supabase project, or the local stack) shared by live-tests.cjs and e2e.cjs.
// Supabase: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (keys are fetched from the Management API, never stored).
// Local:    the env file written by tools/local-stack.sh (SB_URL, SB_ANON_KEY, SB_SERVICE_KEY, SB_PSQL).
const crypto = require("crypto"), { execFileSync } = require("child_process");
const T = {};
async function connect() {
  if (process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF) {
    const ref = process.env.SUPABASE_PROJECT_REF, tok = process.env.SUPABASE_ACCESS_TOKEN;
    const mgmt = async (method, p, body) => {
      const r = await fetch("https://api.supabase.com/v1/projects/" + ref + p, { method, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body && JSON.stringify(body) });
      const t = await r.text(); if (!r.ok) throw new Error("management API " + p + ": " + r.status + " " + t); return t ? JSON.parse(t) : null;
    };
    const keys = await mgmt("GET", "/api-keys?reveal=true");
    const pick = (...names) => (keys.find(k => names.includes(k.name) || names.includes(k.type)) || {}).api_key;
    T.url = "https://" + ref + ".supabase.co"; T.anon = pick("anon", "publishable"); T.service = pick("service_role", "secret");
    T.sql = async q => mgmt("POST", "/database/query", { query: q });
    T.target = "Supabase (" + ref + ")";
  } else if (process.env.SB_URL) {
    T.url = process.env.SB_URL; T.anon = process.env.SB_ANON_KEY; T.service = process.env.SB_SERVICE_KEY;
    const argv = process.env.SB_PSQL.split(" ");
    T.sql = async q => {
      const out = execFileSync(argv[0], [...argv.slice(1), "-At", "-c", "select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (" + q + ") t"], { encoding: "utf8", env: process.env });
      return JSON.parse(out.trim().split("\n").pop());
    };
    T.sql.exec = async q => execFileSync(argv[0], [...argv.slice(1), "-c", q], { encoding: "utf8", env: process.env });
    T.target = "المجموعة المحلية (PostgreSQL + Supabase Auth + PostgREST)";
  } else { console.error("set SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF, or the local stack env"); process.exit(2); }
  if (!T.sql.exec) T.sql.exec = T.sql;
  return T;
}

// ---------- HTTP
async function call(method, p, { token, body, prefer, key = T.anon, headers = {} } = {}) {
  const h = { apikey: key, "content-type": "application/json", "accept-profile": "app", "content-profile": "app", ...headers };
  if (token) h.authorization = "Bearer " + token;
  if (prefer) h.prefer = prefer;
  const r = await fetch(T.url + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch (e) { json = t; }
  return { status: r.status, json };
}
const rest = (tok, method, p, body) => call(method, "/rest/v1/" + p, { token: tok, body, prefer: method === "GET" ? undefined : "return=representation" });
async function login(email, password) {
  const r = await call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  if (r.status !== 200) throw new Error("login failed for " + email + ": " + r.status + " " + JSON.stringify(r.json));
  return r.json;
}


// Creates confirmed users with random passwords (example.com addresses: no mail is sent).
async function makeUsers(roles, run) {
  const U = {};
  for (const r of roles) {
    const email = `qa-${r.toLowerCase()}-${run}@example.com`, password = crypto.randomBytes(18).toString("base64url");
    const c = await call("POST", "/auth/v1/admin/users", { key: T.service, token: T.service, body: { email, password, email_confirm: true } });
    if (c.status !== 200) throw new Error("create user: " + c.status + " " + JSON.stringify(c.json));
    U[r] = { id: c.json.id, email, password };
  }
  return U;
}
async function dropUsers(U, run) {
  const ids = Object.values(U).map(u => `'${u.id}'`).join(",") || "null";
  await T.sql.exec(`delete from app.memberships where user_id in (${ids}); delete from app.admins where user_id in (${ids});
    delete from app.employees where code like 'Q_${run}'; delete from app.imports where file_name = 'qa-${run}.xlsx'; delete from app.companies where code like 'Q_${run}';`);
  for (const u of Object.values(U)) await call("DELETE", "/auth/v1/admin/users/" + u.id, { key: T.service, token: T.service });
  return (await T.sql(`select id from auth.users where email like 'qa-%-${run}@example.com'`)).length;
}
module.exports = { T, connect, call, rest, login, makeUsers, dropUsers };

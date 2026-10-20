// Sets up and checks the Supabase project through the Management API. Needs SUPABASE_ACCESS_TOKEN and
// SUPABASE_PROJECT_REF in the environment (never in the repository).
//   node tools/supabase.cjs setup [site url]   schema + dummy data (first run only), API exposure, sign-in settings
//   node tools/supabase.cjs grant-admin <email> make an existing user the system owner
//   node tools/supabase.cjs status             what is configured
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const { seed } = require(path.join(ROOT, "قاعدة-البيانات", "dummy.cjs"));
const ref = process.env.SUPABASE_PROJECT_REF, tok = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !tok) { console.error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required"); process.exit(2); }

async function api(method, p, body) {
  const r = await fetch("https://api.supabase.com/v1/projects/" + ref + p, { method, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) throw new Error(method + " " + p + ": " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}
const sql = q => api("POST", "/database/query", { query: q });

async function setup(site) {
  const has = await sql("select 1 from information_schema.schemata where schema_name = 'app'");
  if (!has.length) {
    await sql(fs.readFileSync(path.join(ROOT, "قاعدة-البيانات", "schema.sql"), "utf8"));
    await sql(seed(false));
    console.log("schema applied and dummy data seeded");
  } else console.log("schema app exists: left unchanged");
  const pg = await api("GET", "/postgrest");
  const schemas = new Set(String(pg.db_schema || "public").split(",").map(s => s.trim()).filter(Boolean)); schemas.add("app");
  await api("PATCH", "/postgrest", { db_schema: [...schemas].join(",") });
  const auth = { disable_signup: true, password_min_length: 12, external_anonymous_users_enabled: false };
  if (site) Object.assign(auth, { site_url: site, uri_allow_list: site });
  await api("PATCH", "/config/auth", auth);
  console.log("API exposes: " + [...schemas].join(",") + "; sign-up disabled; password minimum 12" + (site ? "; site " + site : ""));
}

async function status() {
  const auth = await api("GET", "/config/auth"), pg = await api("GET", "/postgrest");
  const n = await sql("select (select count(*) from app.companies) companies, (select count(*) from app.employees) employees, (select count(*) from app.companies where not is_dummy) real_companies, (select count(*) from app.admins) owners");
  console.log(JSON.stringify({ signup_disabled: auth.disable_signup, password_min_length: auth.password_min_length, site_url: auth.site_url, exposed_schemas: pg.db_schema, ...n[0] }, null, 2));
}

(async () => {
  const [cmd, a] = process.argv.slice(2);
  if (cmd === "setup") await setup(a);
  else if (cmd === "grant-admin") {
    if (!/^[^@\s']+@[^@\s']+$/.test(a || "")) throw new Error("usage: grant-admin <email>");
    const r = await sql(`insert into app.admins select id from auth.users where lower(email) = lower('${a}') on conflict do nothing returning user_id`);
    console.log(r.length ? "system owner: " + a : "no new owner (user not found, or already an owner)");
  } else if (cmd === "status") await status();
  else { console.error("usage: setup [site url] | grant-admin <email> | status"); process.exit(2); }
})().catch(e => { console.error(e.message); process.exit(1); });

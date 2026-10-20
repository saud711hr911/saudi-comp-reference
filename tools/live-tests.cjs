// Security and accuracy tests through real sign-in, against a running Supabase project or the local stack.
// Every attempt goes through the public API exactly as the browser app does (Auth + REST with the user's token);
// only setup and cleanup (test users, their memberships) use admin access.
//
//   local:    bash tools/local-stack.sh start && set -a && . /tmp/saudi-comp-stack/env && set +a && node tools/live-tests.cjs [out.txt]
//   Supabase: SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node tools/live-tests.cjs [out.txt]   (keys are fetched, never stored)
//
// Test users are created for the run with random passwords and deleted at the end. Dummy data only.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { T: TG, connect, call, rest, login, makeUsers, dropUsers } = require("./target.cjs");
const ROOT = path.join(__dirname, "..");
const { seed, fromDb } = require(path.join(ROOT, "قاعدة-البيانات", "dummy.cjs"));
const { check } = require(path.join(ROOT, "match.cjs"));
const OUT = process.argv[2];

// ---------- results
const lines = []; let pass = 0, fail = 0;
function rec(ok, label, detail) { ok ? pass++ : fail++; lines.push((ok ? "PASS" : "FAIL") + " | " + label + (detail ? " (" + detail + ")" : "")); }
const section = s => lines.push("== " + s);
async function rows(label, r, expected) { const n = Array.isArray(r.json) ? r.json.length : -1; rec(r.status === 200 && n === expected, label, "المتوقع " + expected + "، الفعلي " + (n < 0 ? "خطأ " + r.status : n)); return r; }
async function denied(label, r) { const ok = r.status === 401 || r.status === 403; rec(ok, label, "رُفض: " + r.status + (r.json && r.json.code ? " " + r.json.code : "")); return r; }
async function made(label, r, n = 1) { const ok = (r.status === 200 || r.status === 201) && Array.isArray(r.json) && r.json.length === n; rec(ok, label, "المتوقع " + n + "، الفعلي " + (Array.isArray(r.json) ? r.json.length : "خطأ " + r.status)); return r; }
async function violates(label, r, code) { const ok = r.status >= 400 && r.json && r.json.code === code; rec(ok, label, "رُفض: " + r.status + " " + (r.json && r.json.code)); return r; }

(async () => {
  await connect();
  const sql = TG.sql;
  const run = crypto.randomBytes(4).toString("hex");
  const U = {}; const ROLES = ["admin", "mgrA", "edA", "viewA", "mgrB", "outsider"];
  let A, B, ea, eb, na, nb, nall, ncos;
  try {
    // ---------- setup: dummy data (once), and test users for this run
    if ((await sql("select 1 from app.companies limit 1")).length === 0) await sql.exec(seed(false));
    Object.assign(U, await makeUsers(ROLES, run));
    const co = await sql("select id, code from app.companies where code in ('NEWCO','DEMO')");
    A = co.find(x => x.code === "NEWCO").id; B = co.find(x => x.code === "DEMO").id;
    ea = (await sql(`select id from app.employees where company_id = '${A}' order by code limit 1`))[0].id;
    eb = (await sql(`select id from app.employees where company_id = '${B}' order by code limit 1`))[0].id;
    na = (await sql(`select id from app.employees where company_id = '${A}'`)).length;
    nb = (await sql(`select id from app.employees where company_id = '${B}'`)).length;
    nall = (await sql("select id from app.employees")).length; ncos = (await sql("select id from app.companies")).length;
    await sql.exec(`insert into app.admins values ('${U.admin.id}');
      insert into app.memberships values ('${A}','${U.mgrA.id}','manager'), ('${A}','${U.edA.id}','editor'), ('${A}','${U.viewA.id}','viewer'), ('${B}','${U.mgrB.id}','manager');`);

    // ---------- sign-in
    section("تسجيل الدخول");
    const su = await call("POST", "/auth/v1/signup", { body: { email: `qa-signup-${run}@example.com`, password: crypto.randomBytes(18).toString("base64url") } });
    rec(su.status >= 400 && /signup_disabled/.test(JSON.stringify(su.json)), "التسجيل الذاتي مغلق: لا يُنشئ أحد حسابًا لنفسه", "رُفض: " + su.status);
    const wrong = await call("POST", "/auth/v1/token?grant_type=password", { body: { email: U.viewA.email, password: "wrong-" + run } });
    rec(wrong.status === 400, "كلمة مرور خاطئة تُرفض", "رُفض: " + wrong.status);
    const T = {};
    for (const r of ROLES) { const s = await login(U[r].email, U[r].password); T[r] = s.access_token; U[r].refresh = s.refresh_token; }
    rec(Object.keys(T).length === ROLES.length, "دخول ناجح لستة مستخدمين بأدوار مختلفة", ROLES.length + " مستخدمين");
    await denied("دون تسجيل دخول: لا قراءة للمنشآت", await rest(null, "GET", "companies?select=id"));
    await denied("دون تسجيل دخول: لا قراءة للموظفين", await rest(null, "GET", "employees?select=id"));
    const [h, p, s] = T.viewA.split(".");
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    const forged = h + "." + Buffer.from(JSON.stringify({ ...claims, sub: U.admin.id })).toString("base64url") + "." + s;
    await denied("رمز دخول مزوّر (هوية مالك النظام بتوقيع المطّلع) يُرفض", await rest(forged, "GET", "companies?select=id"));
    const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") + "." + Buffer.from(JSON.stringify({ ...claims, sub: U.admin.id })).toString("base64url") + ".";
    await denied("رمز دون توقيع يُرفض", await rest(none, "GET", "companies?select=id"));
    const hh = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), pp = Buffer.from(JSON.stringify({ ...claims, sub: U.admin.id })).toString("base64url");
    await denied("رمز موقّع بمفتاح غير مفتاح المشروع يُرفض", await rest(hh + "." + pp + "." + crypto.createHmac("sha256", "not-the-secret").update(hh + "." + pp).digest("base64url"), "GET", "companies?select=id"));
    await denied("مفتاح عام غير صحيح يُرفض", await call("GET", "/rest/v1/companies?select=id", { key: "wrong-key", token: T.viewA }));

    // ---------- isolation
    section("مستخدم مسجل بلا عضوية");
    await rows("لا يرى أي منشأة", await rest(T.outsider, "GET", "companies?select=id"), 0);
    await rows("لا يرى أي موظف", await rest(T.outsider, "GET", "employees?select=id"), 0);
    await rows("لا يرى موظفًا ولو عرف معرّفه", await rest(T.outsider, "GET", "employees?select=id&id=eq." + ea), 0);
    await denied("لا يضيف نفسه عضوًا في منشأة", await rest(T.outsider, "POST", "memberships", { company_id: A, user_id: U.outsider.id, role: "manager" }));
    await denied("لا ينشئ منشأة", await rest(T.outsider, "POST", "companies", { code: "QA" + run, name: "x", calc_date: "2026-10-20" }));
    await rows("لا يرى سجل التعديلات", await rest(T.outsider, "GET", "audit_log?select=id"), 0);

    section("مطّلع المنشأة (أ)");
    await rows("يرى منشأته فقط", await rest(T.viewA, "GET", "companies?select=id"), 1);
    await rows("يرى موظفي منشأته كلهم", await rest(T.viewA, "GET", "employees?select=id&company_id=eq." + A), na);
    await rows("لا يرى موظفي المنشأة (ب)", await rest(T.viewA, "GET", "employees?select=id&company_id=eq." + B), 0);
    await rows("لا يصل إلى (ب) عبر الربط بين الجداول", await rest(T.viewA, "GET", "companies?select=id,employees(id)&id=eq." + B), 0);
    await rows("لا يعدّل موظفًا في منشأته", await rest(T.viewA, "PATCH", "employees?id=eq." + ea, { basic: 1 }), 0);
    await rows("لا يحذف موظفًا في منشأته", await rest(T.viewA, "DELETE", "employees?id=eq." + ea), 0);
    await denied("لا يضيف موظفًا", await rest(T.viewA, "POST", "employees", { company_id: A, code: "QV" + run, name: "x", cat: "سعودي" }));
    await rows("لا يرفع دوره إلى مدير", await rest(T.viewA, "PATCH", "memberships?user_id=eq." + U.viewA.id, { role: "manager" }), 0);
    await rows("لا يرى سجل التعديلات", await rest(T.viewA, "GET", "audit_log?select=id"), 0);

    section("محرر المنشأة (أ)");
    await made("يعدّل موظفًا في منشأته", await rest(T.edA, "PATCH", "employees?id=eq." + ea + "&select=id", { updated_at: new Date().toISOString() }));
    await made("يضيف موظفًا في منشأته", await rest(T.edA, "POST", "employees?select=id", { company_id: A, code: "QE" + run, name: "موظف اختبار", cat: "سعودي" }));
    await made("يحذف الموظف الذي أضافه", await rest(T.edA, "DELETE", `employees?company_id=eq.${A}&code=eq.QE${run}&select=id`));
    await denied("لا يضيف موظفًا في المنشأة (ب)", await rest(T.edA, "POST", "employees", { company_id: B, code: "QB" + run, name: "x", cat: "سعودي" }));
    await rows("لا يعدّل موظفًا في (ب) ولو عرف معرّفه", await rest(T.edA, "PATCH", "employees?id=eq." + eb, { basic: 1 }), 0);
    await rows("لا يحذف موظفًا في (ب)", await rest(T.edA, "DELETE", "employees?id=eq." + eb), 0);
    await denied("لا ينقل موظفًا من منشأته إلى (ب)", await rest(T.edA, "PATCH", "employees?id=eq." + ea, { company_id: B }));
    await denied("لا يضيف استيرادًا في (ب)", await rest(T.edA, "POST", "imports", { company_id: B, kind: "gosi" }));
    await made("يضيف استيرادًا (معاينة) في منشأته", await rest(T.edA, "POST", "imports?select=id", { company_id: A, kind: "gosi", file_name: "qa-" + run + ".xlsx" }));
    await denied("لا يضيف عضوًا", await rest(T.edA, "POST", "memberships", { company_id: A, user_id: U.outsider.id, role: "viewer" }));
    await rows("لا يعدّل بيانات المنشأة", await rest(T.edA, "PATCH", "companies?id=eq." + A, { name: "x" }), 0);
    const hr = await rest(T.edA, "POST", "rpc/has_role", { cid: B, roles: ["manager", "editor", "viewer"] });
    rec(hr.status === 200 && hr.json === false, "دالة الصلاحية: لا دور له في (ب)", String(hr.json));
    const ia = await rest(T.edA, "POST", "rpc/is_admin", {});
    rec(ia.status === 200 && ia.json === false, "دالة الصلاحية: ليس مالكًا للنظام", String(ia.json));

    section("مدير المنشأة (أ)");
    await rows("يرى منشأته فقط", await rest(T.mgrA, "GET", "companies?select=id"), 1);
    await rows("يرى أعضاء منشأته", await rest(T.mgrA, "GET", "memberships?select=user_id&company_id=eq." + A), 3);
    await made("يدعو مطّلعًا إلى منشأته", await rest(T.mgrA, "POST", "memberships?select=user_id", { company_id: A, user_id: U.outsider.id, role: "viewer" }));
    await made("يزيل العضو الذي دعاه", await rest(T.mgrA, "DELETE", `memberships?company_id=eq.${A}&user_id=eq.${U.outsider.id}&select=user_id`));
    await denied("لا يضيف عضوًا في (ب)", await rest(T.mgrA, "POST", "memberships", { company_id: B, user_id: U.mgrA.id, role: "manager" }));
    await denied("لا ينقل عضوية من منشأته إلى (ب)", await rest(T.mgrA, "PATCH", "memberships?user_id=eq." + U.viewA.id, { company_id: B }));
    await rows("لا يغيّر دوره بنفسه", await rest(T.mgrA, "PATCH", "memberships?user_id=eq." + U.mgrA.id, { role: "viewer" }), 0);
    const act = (await rest(T.mgrA, "GET", "companies?select=activity&id=eq." + A)).json[0].activity;
    await made("يعدّل بيانات منشأته", await rest(T.mgrA, "PATCH", "companies?id=eq." + A + "&select=id", { activity: act }));
    await rows("لا يعدّل بيانات (ب)", await rest(T.mgrA, "PATCH", "companies?id=eq." + B, { name: "x" }), 0);
    await rows("لا يحذف منشأته", await rest(T.mgrA, "DELETE", "companies?id=eq." + A), 0);
    const aud = await rest(T.mgrA, "GET", "audit_log?select=actor&company_id=eq." + A);
    rec(aud.status === 200 && aud.json.some(x => x.actor === U.edA.id) && aud.json.some(x => x.actor === U.mgrA.id), "سجل التعديلات يحفظ من عدّل (المحرر والمدير)", (aud.json || []).length + " سطرًا");
    await rows("لا يرى سجل تعديلات (ب)", await rest(T.mgrA, "GET", "audit_log?select=id&company_id=neq." + A), 0);
    await denied("لا يعدّل سجل التعديلات", await rest(T.mgrA, "PATCH", "audit_log?company_id=eq." + A, { action: "x" }));
    await denied("لا يحذف من سجل التعديلات", await rest(T.mgrA, "DELETE", "audit_log?company_id=eq." + A));
    await denied("لا يكتب في سجل التعديلات مباشرة", await rest(T.mgrA, "POST", "audit_log", { company_id: A, table_name: "x", row_id: "x", action: "x" }));
    await denied("لا يضيف نفسه مالكًا للنظام", await rest(T.mgrA, "POST", "admins", { user_id: U.mgrA.id }));

    section("مدير المنشأة (ب)");
    await rows("يرى منشأته فقط", await rest(T.mgrB, "GET", "companies?select=id"), 1);
    await rows("يرى موظفي منشأته فقط", await rest(T.mgrB, "GET", "employees?select=id"), nb);
    await rows("لا يرى استيراد (أ)", await rest(T.mgrB, "GET", "imports?select=id"), 0);
    await rows("لا يرى أعضاء (أ)", await rest(T.mgrB, "GET", "memberships?select=user_id&company_id=eq." + A), 0);

    section("مالك النظام");
    await rows("يرى كل المنشآت", await rest(T.admin, "GET", "companies?select=id"), ncos);
    await rows("يرى كل الموظفين", await rest(T.admin, "GET", "employees?select=id"), nall);
    await violates("حارس البيانات الوهمية: لا تُضاف منشأة حقيقية", await rest(T.admin, "POST", "companies", { code: "QR" + run, name: "x", calc_date: "2026-10-20", is_dummy: false }), "23514");
    await violates("حارس البيانات الوهمية: لا تتحول منشأة وهمية إلى حقيقية", await rest(T.admin, "PATCH", "companies?id=eq." + A, { is_dummy: false }), "23514");

    section("انتهاء الجلسة");
    const lo = await call("POST", "/auth/v1/logout", { token: T.viewA });
    const rf = await call("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: U.viewA.refresh } });
    rec(lo.status === 204 && rf.status >= 400, "بعد تسجيل الخروج لا تُجدَّد الجلسة", "خروج " + lo.status + "، تجديد " + rf.status);

    // ---------- accuracy through the API
    section("المحرك على البيانات المقروءة عبر الواجهة البرمجية مقابل Excel");
    for (const [r, label] of [["admin", "مالك النظام"], ["mgrA", "مدير (أ)"], ["mgrB", "مدير (ب)"]]) {
      const got = await rest(T[r], "GET", "companies?select=*,employees(*)&order=code");
      got.json.forEach(c => c.employees.sort((a, b) => a.code < b.code ? -1 : 1));
      const m = check(fromDb(got.json));
      rec(m.bad === 0 && m.ok > 0, label + ": " + got.json.length + " منشآت", m.ok + " قيمة مطابقة، " + m.bad + " اختلاف");
    }
  } catch (e) {
    rec(false, "توقف الاختبار بخطأ", e.message);
  } finally {
    // ---------- cleanup: this run's users, their rows, and anything they added
    try {
      const left = await dropUsers(U, run);
      rec(left === 0, "تنظيف: حُذف مستخدمو الاختبار", "المتبقي " + left);
    } catch (e) { rec(false, "تنظيف", e.message); }
  }
  const head = ["اختبارات الأمان والدقة عبر تسجيل الدخول الفعلي — " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", "الهدف: " + TG.target, ""];
  const text = head.concat(lines, ["", "النتيجة: " + pass + " نجح، " + fail + " أخفق"]).join("\n");
  if (OUT) fs.writeFileSync(OUT, text + "\n");
  console.log(text);
  process.exit(fail ? 1 : 0);
})();

// البيانات الوهمية في قاعدة البيانات، واختبار أن المحرك يعطي قيم Excel نفسها بعد الحفظ والقراءة منها.
// node dummy.cjs seed [--no-users]  يطبع SQL المنشآت والموظفين الوهميين (من fixture.json)، ومعها مستخدمو الاختبار المحلي ما لم يُطلب --no-users
// node dummy.cjs check <json>   يطابق المنشآت المقروءة من القاعدة مع قيم Excel
const fs = require("fs"), path = require("path");
const WEB = path.join(__dirname, "..");
const FIX = require(path.join(WEB, "fixture.json"));
const { check } = require(path.join(WEB, "match.cjs"));
const FIELDS = ["code", "name", "cat", "nat", "title", "occ", "grade", "contract", "relied", "docqiwa", "hire", "scheme", "basic", "hcash", "hkind",
  "tcash", "tkind", "other", "comm", "commx", "commprev", "bonus", "gosiw"];

// مستخدمون تجريبيون. NEWCO = المنشأة (أ)، DEMO = المنشأة (ب).
const USERS = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  mgrA: "00000000-0000-0000-0000-0000000000b1", edA: "00000000-0000-0000-0000-0000000000b2", viewA: "00000000-0000-0000-0000-0000000000b3",
  mgrB: "00000000-0000-0000-0000-0000000000c1", outsider: "00000000-0000-0000-0000-0000000000d1",
};
const q = v => v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

function seed(withUsers = true) {
  const out = ["begin;"];
  if (withUsers) out.push(`insert into app.admins values (${q(USERS.admin)});`);
  for (const c of FIX.companies) {
    out.push(`insert into app.companies (code, name, activity, calc_date, industrial, small_exempt, exempt_count, policy_from, policy, test_only) values (` +
      [c.id, c.name, c.activity, c.calc, c.industrial, c.smallExempt, c.exemptCount, c.policyFrom, JSON.stringify(c.policy), !!c.testOnly].map(q).join(", ") + ");");
    for (const e of c.employees)
      out.push(`insert into app.employees (company_id, ${FIELDS.join(", ")}) select id, ${FIELDS.map(f => q(e[f])).join(", ")} from app.companies where code = ${q(c.id)};`);
  }
  const mem = [["NEWCO", "mgrA", "manager"], ["NEWCO", "edA", "editor"], ["NEWCO", "viewA", "viewer"], ["DEMO", "mgrB", "manager"]];
  if (withUsers) for (const [co, u, r] of mem) out.push(`insert into app.memberships select id, ${q(USERS[u])}, ${q(r)} from app.companies where code = ${q(co)};`);
  out.push("commit;");
  return out.join("\n");
}

// يعيد بناء شكل المنشأة الذي يقرؤه المحرك من صفوف القاعدة كما وصلت (JSON من PostgreSQL).
function fromDb(rows) {
  return rows.map(c => ({
    id: c.code, name: c.name, activity: c.activity, calc: c.calc_date, industrial: c.industrial, smallExempt: c.small_exempt,
    exemptCount: c.exempt_count, policyFrom: c.policy_from, policy: c.policy, ...(c.test_only ? { testOnly: true } : {}),
    employees: (c.employees || []).map(e => {
      const o = Object.fromEntries(FIELDS.map(f => [f, e[f]]));
      if (e.gcc_er !== null && e.gcc_er !== undefined) o.gccEr = e.gcc_er;
      if (e.gcc_ee !== null && e.gcc_ee !== undefined) o.gccEe = e.gcc_ee;
      return o;
    }),
  }));
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === "seed") console.log(seed(!process.argv.includes("--no-users")));
  else if (cmd === "check") {
    const rows = JSON.parse(fs.readFileSync(process.argv[3], "utf8")) || [];
    const cos = fromDb(rows);
    // الحقول كما في fixture.json حرفيًا (النص الفارغ مقابل null، والتواريخ، والأرقام)
    let fieldDiff = 0;
    for (const c of cos) {
      const f = FIX.companies.find(x => x.id === c.id);
      for (const e of c.employees) {
        const fe = f.employees.find(x => x.code === e.code);
        for (const k of FIELDS) if (JSON.stringify(e[k]) !== JSON.stringify(fe[k])) { fieldDiff++; console.log(`✗ حقل ${c.id} ${e.code} ${k}: ملف=${JSON.stringify(fe[k])} قاعدة=${JSON.stringify(e[k])}`); }
      }
    }
    const r = check(cos);
    console.log(`${cos.length} منشآت، ${cos.reduce((s, c) => s + c.employees.length, 0)} موظفًا؛ حقول مختلفة عن الملف: ${fieldDiff}؛ مطابقة Excel: ${r.ok} قيمة، ${r.bad} اختلاف`);
    if (r.bad) console.log(r.lines.filter(l => l.startsWith("✗")).join("\n"));
    process.exit(r.bad || fieldDiff ? 1 : 0);
  } else { console.error("الاستخدام: node dummy.cjs seed | check <json>"); process.exit(2); }
}
module.exports = { USERS, FIELDS, seed, fromDb };

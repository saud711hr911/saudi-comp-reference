// يطابق محرك الويب (engine.js) مع القيم المحسوبة في Excel لكل موظف وهمي.
// engine.js هو المصدر الوحيد للمحرك؛ النسخة المضمّنة في النموذج يجب أن تطابقه حرفيًا.
// الاستخدام: node match.cjs            المطابقة مع Excel وفحص تطابق النسخة المضمّنة
//            node match.cjs --embed    ينسخ engine.js إلى النموذج بعد تعديل المحرك
const fs = require("fs"), path = require("path");
const HTML = path.join(__dirname, "النموذج.html"), ENGINE_FILE = path.join(__dirname, "engine.js");
const A = "/*ENGINE-START*/", B = "/*ENGINE-END*/";
const engineSrc = fs.readFileSync(ENGINE_FILE, "utf8");
const ENGINE = require(ENGINE_FILE);

// يقارن نتيجة computeCompany بالقيم المتوقعة من Excel. companies بالشكل نفسه في fixture.json.
function check(companies, compute = ENGINE.computeCompany) {
  let ok = 0, bad = 0; const lines = [];
  const expectedOf = new Map(require("./fixture.json").companies.map(c => [c.id, c]));
  for (const co of companies) {
    const exp0 = expectedOf.get(co.id);
    const r = compute(JSON.parse(JSON.stringify(co)));
    for (const [code, exp] of Object.entries(exp0.expected)) {
      for (const [k, v] of Object.entries(exp)) {
        const got = r.emps[code] ? r.emps[code][k] : undefined;
        const tol = Math.abs(v) < 2 && !Number.isInteger(v) ? 1e-9 : 0.011;
        if (typeof got === "number" && Math.abs(got - v) <= tol) ok++;
        else { bad++; lines.push(`✗ ${co.id} ${code} ${k}: Excel=${v} ويب=${got}`); }
      }
    }
    for (const [k, v] of Object.entries(exp0.expectedDash || {})) {
      const got = r.dash[k], tol = Math.abs(v) < 1 ? 1e-9 : 0.011;
      if (typeof got === "number" && Math.abs(got - v) <= tol) ok++;
      else { bad++; lines.push(`✗ ${co.id} لوحة ${k}: Excel=${v} ويب=${got}`); }
    }
    lines.push(`${co.name}: ${Object.keys(exp0.expected).length} موظفين، الإجمالي الشهري ${r.dash.total.toFixed(2)}`);
  }
  return { ok, bad, lines };
}
module.exports = { check, ENGINE };

if (require.main === module) {
  let html = fs.readFileSync(HTML, "utf8");
  const inline = () => html.slice(html.indexOf(A) + A.length, html.indexOf(B));
  if (process.argv.includes("--embed")) {
    html = html.slice(0, html.indexOf(A) + A.length) + "\n" + engineSrc + html.slice(html.indexOf(B));
    fs.writeFileSync(HTML, html);
    console.log("نُسخ engine.js إلى النموذج.");
  }
  const lines = [];
  const same = inline() === "\n" + engineSrc;
  lines.push(same ? "المحرك المضمّن في النموذج = engine.js حرفيًا" : "✗ المحرك المضمّن في النموذج يختلف عن engine.js (شغّل node match.cjs --embed)");
  const seed = new Function(html.slice(html.indexOf("/*SEED-START*/") + 14, html.indexOf("/*SEED-END*/")) + "\nreturn SEED;")();
  const r = check(seed.companies);
  lines.push(...r.lines, `النتيجة: ${r.ok} قيمة مطابقة، ${r.bad} اختلاف`);
  console.log(lines.join("\n"));
  process.exit(r.bad || !same ? 1 : 0);
}

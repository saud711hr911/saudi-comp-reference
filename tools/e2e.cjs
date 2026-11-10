// Browser acceptance test of the app: sign-in, company isolation as the user sees it, saving and reloading,
// calculation shown on screen vs the Excel values, roles, phone and desktop layout, Arabic font, security headers.
//   node tools/e2e.cjs <site url> [screenshots dir]     (target env as for live-tests.cjs)
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execSync } = require("child_process");
const { T, connect, call, makeUsers, dropUsers } = require("./target.cjs");
const ENGINE = require("../engine.js"), FIX = require("../fixture.json");
let pw; try { pw = require("playwright"); } catch (e) { pw = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }
const SITE = process.argv[2], SHOTS = process.argv[3];
const lines = []; let pass = 0, fail = 0;
function rec(ok, label, detail) { ok ? pass++ : fail++; lines.push((ok ? "PASS" : "FAIL") + " | " + label + (detail ? " (" + detail + ")" : "")); }

(async () => {
  await connect();
  const run = crypto.randomBytes(4).toString("hex");
  let U = {}, browser;
  const newco = FIX.companies.find(c => c.id === "NEWCO"), first = newco.employees[0];
  try {
    U = await makeUsers(["mgrA", "viewA", "outsider"], run);
    const A = (await T.sql("select id from app.companies where code = 'NEWCO'"))[0].id;
    await T.sql.exec(`insert into app.memberships values ('${A}','${U.mgrA.id}','manager'), ('${A}','${U.viewA.id}','viewer');`);
    // Local runs use the name app.test for the local gateway, so the browser can reach it directly while external
    // assets (the Arabic web font) go through this machine's proxy.
    const local = new URL(SITE).hostname === "app.test";
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: local ? "app.test" : "" } : undefined;
    browser = await pw.chromium.launch({ proxy, args: local ? ["--host-resolver-rules=MAP app.test 127.0.0.1"] : [] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA", ignoreHTTPSErrors: !!proxy });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: false }); } };
    const signIn = async (p, u) => { await p.fill("#email", u.email); await p.fill("#password", u.password); await p.click("#loginBtn"); };

    // headers and sign-in page
    const resp = await page.goto(SITE, { waitUntil: "networkidle" });
    const csp = resp.headers()["content-security-policy"] || "";
    rec(/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp), "رؤوس الأمان مفعّلة في الصفحة (CSP ومنع التضمين)", csp ? "موجودة" : "غير موجودة");
    rec(await page.isVisible("#authView"), "تظهر صفحة الدخول لمن لم يسجل دخوله");
    const html = await page.content();
    rec(!/service_role|sb_secret_/.test(html + (await page.evaluate(() => fetch("config.js").then(r => r.text())))), "لا مفتاح سري في الواجهة", "config.js والصفحة");
    await shot(page, "1-دخول");
    await page.fill("#email", U.mgrA.email); await page.fill("#password", "wrong-password"); await page.click("#loginBtn");
    await page.waitForSelector("#loginErr:not([hidden])");
    rec((await page.textContent("#loginErr")).includes("غير صحيحة"), "كلمة مرور خاطئة: رسالة عربية واضحة", await page.textContent("#loginErr"));

    // manager of company A
    await signIn(page, U.mgrA);
    await page.waitForSelector("#empList button");
    const opts = await page.$$eval("#co option", o => o.map(x => x.textContent));
    rec(opts.length === 1 && opts[0] === newco.name, "مدير (أ) يرى منشأته فقط في الاختيار", opts.join("، "));
    await page.waitForFunction(() => /مطابق لـExcel: \d+/.test(document.getElementById("matchBtn").textContent), null, { timeout: 15000 }).catch(() => { });
    const badge = await page.textContent("#matchBtn");
    rec(/مطابق لـExcel: 3384 قيمة/.test(badge), "شارة المطابقة مع Excel في رأس الصفحة", badge);
    const n = await page.$$eval("#empList button", b => b.length);
    rec(n === newco.employees.length, "قائمة الموظفين محمّلة من قاعدة البيانات", n + " موظفًا");
    const expected = ENGINE.fmt(newco.expected[first.code].total);
    const shown = (await page.textContent("#resultPanel .summary .big")).trim();
    rec(shown === expected, "التكلفة المعروضة للموظف الأول = قيمة Excel", "الشاشة " + shown + "، Excel " + expected);
    await shot(page, "2-الموظف");

    // save, reload, restore
    await page.fill("#f_basic", String(first.basic + 100));
    await page.waitForFunction(() => document.getElementById("saveState").textContent === "محفوظ", null, { timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#f_basic");
    rec(await page.inputValue("#f_basic") === String(first.basic + 100), "التعديل محفوظ في قاعدة البيانات بعد إعادة تحميل الصفحة", await page.inputValue("#f_basic"));
    const changed = (await page.textContent("#resultPanel .summary .big")).trim();
    rec(changed !== expected, "التكلفة تتغير مع الأجر", changed);
    await page.fill("#f_basic", String(first.basic));
    await page.waitForFunction(() => document.getElementById("saveState").textContent === "محفوظ", null, { timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#f_basic");
    rec((await page.textContent("#resultPanel .summary .big")).trim() === expected, "إعادة القيمة الأصلية تعيد قيمة Excel", expected);

    // add and delete an employee
    await page.click("#addEmp"); await page.waitForSelector('#formPanel h2:has-text("موظف جديد")');
    await page.fill("#f_name", "موظف اختبار " + run);
    await page.waitForFunction(() => document.getElementById("saveState").textContent === "محفوظ", null, { timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#empList button");
    rec((await page.textContent("#empList")).includes("موظف اختبار " + run), "إضافة موظف وهمي وحفظه");
    await page.click(`#empList button:has-text("موظف اختبار ${run}")`);
    await page.click("#delEmp"); await page.click("#delEmp");
    await page.waitForFunction(r => !document.getElementById("empList").textContent.includes(r), "موظف اختبار " + run);
    await page.reload({ waitUntil: "networkidle" }); await page.waitForSelector("#empList button");
    rec(!(await page.textContent("#empList")).includes("موظف اختبار " + run), "حذف الموظف بعد التأكيد");

    // dashboard and rules
    await page.click("#t-dash"); await page.waitForSelector(".kpi");
    const dashTotal = await page.$$eval(".kpi .val", v => v[1].textContent.trim());
    rec(dashTotal === ENGINE.fmt(newco.expectedDash.total), "إجمالي لوحة المنشأة = قيمة Excel", dashTotal);
    await shot(page, "3-اللوحة");
    await page.click("#t-rules"); await page.waitForSelector("#ruleBody tr");
    const links = await page.$$eval("#ruleBody a", a => a.length);
    rec(links > 10, "صفحة الأحكام تعرض مصادرها الرسمية", links + " رابطًا");
    const font = await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans Arabic"') && getComputedStyle(document.body).fontFamily);
    rec(!!font && /IBM Plex Sans Arabic/.test(font), "الخط العربي IBM Plex Sans Arabic محمّل", String(font));
    await page.click("#logoutBtn"); await page.waitForSelector("#authView:not([hidden])");
    rec(true, "تسجيل الخروج يعيد إلى صفحة الدخول");

    // viewer
    await signIn(page, U.viewA); await page.waitForSelector("#formPanel input");
    const dis = await page.$$eval("#formPanel input, #formPanel select", e => e.every(x => x.disabled));
    rec(dis && await page.isHidden("#addEmp") && !(await page.$("#delEmp")), "المطّلع: الحقول للقراءة فقط، ولا إضافة ولا حذف");
    await page.click("#logoutBtn"); await page.waitForSelector("#authView:not([hidden])");

    // outsider
    await signIn(page, U.outsider); await page.waitForSelector("#noCompany:not([hidden])");
    rec(true, "مستخدم بلا عضوية: «لا توجد منشأة مرتبطة بحسابك»");
    await page.click("#logoutBtn");

    // phone
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ar-SA", ignoreHTTPSErrors: !!proxy });
    const m = await ph.newPage(); m.on("pageerror", e => errors.push(e.message));
    await m.goto(SITE, { waitUntil: "networkidle" }); await signIn(m, U.mgrA); await m.waitForSelector(".mstep button");
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    rec(over <= 0 && await m.isVisible(".mstep"), "الجوال: خطوات ثلاث ولا تمرير أفقي", "الزيادة " + over + "px");
    await shot(m, "4-جوال-البيانات");
    await m.click('.mstep button[data-step="result"]'); await shot(m, "5-جوال-النتيجة");
    await m.click("#themeBtn"); await shot(m, "6-جوال-داكن");
    rec(errors.length === 0, "لا أخطاء برمجية في المتصفح", errors.join(" | ").slice(0, 200));
  } catch (e) {
    rec(false, "توقف الاختبار بخطأ", e.message.split("\n")[0]);
  } finally {
    if (browser) await browser.close();
    try { const left = await dropUsers(U, run); rec(left === 0, "تنظيف: حُذف مستخدمو الاختبار", "المتبقي " + left); } catch (e) { rec(false, "تنظيف", e.message); }
  }
  console.log(["اختبار الواجهة في المتصفح — " + SITE, ...lines, "النتيجة: " + pass + " نجح، " + fail + " أخفق"].join("\n"));
  process.exit(fail ? 1 : 0);
})();

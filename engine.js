// Calculation engine: a port of the reference workbook's independent model (محرك/verify.py), which the workbook's tests match.
var ENGINE = (function () {
  var ST = { CONF: "مؤكد رسميًا", PART: "مؤكد جزئيًا", SEC: "مرجّح – مصدر ثانوي", PEND: "بانتظار التحقق الرسمي", NEED: "يحتاج تحقق" };
  var SRC = {
    S01: ["رفع الحد الأدنى لاحتساب أجور السعوديين في نطاقات", "وزارة الموارد البشرية", "https://www.hrsd.gov.sa/media-center/news/777585"],
    S07: ["إعفاء المنشآت الصغيرة من المقابل المالي (نقلًا عن قوى)", "مصدر مساند", "https://wazeftysa.com/blog/will-the-small-business-work-permit-exemption-be-extended-past-2027"],
    S08: ["منصة قوى – بيانات المنشأة ونطاقات ورموز المهن", "وزارة الموارد البشرية", "https://www.qiwa.sa"],
    S23: ["رحلة المنشأة في نظام التأمينات الاجتماعية الجديد", "التأمينات الاجتماعية", "https://awareness.gosi.gov.sa/businessJourney.html"],
    S24: ["المرسوم الملكي م/273 – نظام التأمينات الاجتماعية الجديد", "أم القرى", "https://uqn.gov.sa/details?p=25238"],
    S25: ["احتساب نسب التوطين من العقود الموثقة في قوى من 15 أبريل 2026", "وزارة الموارد البشرية", "https://www.hrsd.gov.sa/node/5580136"],
    S26: ["نظام العمل – الإشعار والمكافأة والاستقالة", "وزارة الموارد البشرية", "https://www.hrsd.gov.sa/node/5576001"],
    S27: ["نظام العمل – التعريفات (الأجر الأساسي والفعلي)", "وزارة الموارد البشرية", "https://www.hrsd.gov.sa/node/5575978"],
    S28: ["دليل برنامج نطاقات المطوّر 2026", "وزارة الموارد البشرية", "https://www.hrsd.gov.sa/sites/default/files/2026-03/ntaqat-almtwr.pdf"],
    S29: ["إلغاء المقابل المالي عن المنشآت الصناعية المرخصة", "مصدر مساند", "https://www.eyeofriyadh.com"],
    S32: ["المشتركون السعوديون ومد الحماية التأمينية لمواطني دول المجلس", "التأمينات الاجتماعية", "https://www.gosi.gov.sa/GOSIOnline/Saudi_Workers"],
    S34: ["الأسئلة الشائعة لأصحاب العمل (س72: أجر العمولة = متوسط السنة السابقة)", "التأمينات الاجتماعية", "https://www.gosi.gov.sa/GOSIOnline/FAQ_Employer"],
    S35: ["ما هو برنامج نطاقات وكيف يتم حسابه؟ (صفحة قوى، آخر تعديل 2026-10-09)", "قوى", "https://www.qiwa.sa"],
    S36: ["الإعفاء من المقابل المالي للفئات الخاصة (قائمة الوزارة 2018 وحاسبة قوى)", "مصادر مساندة نقلًا عن الوزارة وقوى", ""]
  };
  // id: [title, value or null, unit, status, source, reference, domain]
  var RULES = {
    "NIT-FULL": ["حد احتساب السعودي عاملًا كاملًا (الأجر المسجل)", 4000, "ريال/شهر", ST.CONF, "S01", "قرار وزاري 1442", "نطاقات"],
    "NIT-HALF": ["حد احتساب السعودي نصف عامل", 3000, "ريال/شهر", ST.CONF, "S01", "قرار وزاري 1442", "نطاقات"],
    "NIT-PT": ["وزن السعودي بدوام جزئي (بأجر 3,000 فأكثر)", 0.5, "عامل", ST.SEC, "S01", "قواعد نطاقات", "نطاقات"],
    "NIT-QIWA-DOC": ["لا يُحتسب السعودي إلا بعقد موثق في قوى (من 2026-04-15)", null, "", ST.CONF, "S25", "قرار مجلس الوزراء 195", "نطاقات"],
    "DEF-NIT-SPOUSE": ["زوج المواطنة وزوجة المواطن محايدان مؤقتًا (النص يقول «زوج أو زوجة الوافد»)؛ ومن كان منهما من أبناء مواطنة يُحتسب 1 (نص صريح)", null, "", ST.PEND, "S35", "صفحة قوى", "نطاقات"],
    "NIT-SPEC-CAP-CAT": ["حد كل فئة خاصة تُحتسب كسعودي", 0.10, "من إجمالي السعوديين بالكيان", ST.CONF, "S35", "صفحة قوى", "نطاقات"],
    "NIT-SPEC-CAP-ALL": ["حد مجموع الفئات الخاصة", 0.15, "من إجمالي السعوديين بالكيان", ST.CONF, "S35", "صفحة قوى", "نطاقات"],
    "NIT-SPEC-METHOD": ["طريقة تطبيق الحد (الأساس والتقريب) غير منصوص عليها: تُعرض النسبة بين حد أدنى وأعلى", null, "", ST.PEND, "S35", "صفحة قوى", "نطاقات"],
    "NIT-QUARTER-EXP": ["الفلسطيني بجواز مصري والبلوشي = 0.25 وافد", 0.25, "وافد", ST.CONF, "S35", "صفحة قوى", "نطاقات"],
    "NIT-QUARTER-LIMIT": ["شرط الربع: ألا تتجاوز الفئة 50% من إجمالي الموظفين (المعاملة عند التجاوز بانتظار التحقق الرسمي)", 0.5, "من الموظفين", ST.CONF, "S35", "صفحة قوى", "نطاقات"],
    "NIT-BURMESE": ["البرماوي: 1 وافد داخل مكة والمدينة، 0 خارجهما", null, "", ST.CONF, "S35", "صفحة قوى", "نطاقات"],
    "DEF-NIT-GCC": ["مواطنو دول المجلس ليسوا وافدين في نطاقات", null, "", ST.CONF, "S28", "دليل نطاقات", "نطاقات"],
    "GOSI-OLD-ANN": ["المعاشات – المشترك قبل 2024-07-03 (لكل طرف)", 0.09, "", ST.CONF, "S23", "نظام التأمينات", "التأمينات"],
    "GOSI-NEW-ANN": ["المعاشات – النظام الجديد م/273 (لكل طرف، تتدرج 0.5 نقطة سنويًا حتى 11%)", null, "", ST.CONF, "S23", "م/273", "التأمينات"],
    "GOSI-SANED": ["ساند – لكل طرف", 0.0075, "", ST.CONF, "S24", "م/273", "التأمينات"],
    "GOSI-OHI": ["الأخطار المهنية – على صاحب العمل لكل العاملين", 0.02, "", ST.CONF, "S23", "نظام التأمينات", "التأمينات"],
    "GOSI-MAX": ["الحد الأعلى للأجر الخاضع", 45000, "ريال/شهر", ST.CONF, "S23", "نظام التأمينات", "التأمينات"],
    "GOSI-INKIND": ["قيمة السكن العيني في الأجر الخاضع", 2, "أجر شهرين سنويًا", ST.CONF, "S23", "نظام التأمينات", "التأمينات"],
    "GOSI-COMM": ["العمولة تدخل الأجر الخاضع بمتوسط السنة السابقة (من 2024-07-03)", null, "", ST.CONF, "S34", "س72", "التأمينات"],
    "GCC-PEN": ["الخليجي: المعاشات وفق نظام دولة الموطن (مد الحماية) + الأخطار المهنية في المملكة", null, "", ST.CONF, "S32", "م/63", "التأمينات"],
    "LEVY": ["المقابل المالي: 800 إذا زاد الوافدون على السعوديين، وإلا 700", 800, "ريال/شهر", ST.SEC, "S07", "", "الرسوم"],
    "LEVY-SMALL": ["إعفاء المنشأة الصغيرة (9 عمال فأقل) حتى 2027-01-21 لعدد من الوافدين", null, "", ST.SEC, "S07", "", "الرسوم"],
    "LEVY-IND": ["إلغاء المقابل المالي عن المنشأة الصناعية المرخصة (من 2025-12-18)", null, "", ST.SEC, "S29", "", "الرسوم"],
    "LEVY-EXEMPT-SPECIAL": ["إعفاء الزوجين وابن المواطنة والإقامة المميزة والفلسطيني بوثيقة مصرية من المقابل المالي: غير مثبت، فالمقابل محمّل والوفر معروض منفصلًا", null, "", ST.PEND, "S36", "", "الرسوم"],
    "IQAMA": ["رسوم الإقامة 650 + رخصة العمل 100 سنويًا", 750, "ريال/سنة", ST.NEED, "S08", "", "الرسوم"],
    "EOS": ["مكافأة نهاية الخدمة: نصف أجر شهر عن كل سنة من الخمس الأولى، وأجر شهر بعدها", null, "", ST.CONF, "S26", "نظام العمل م/84", "نظام العمل"],
    "EOS-86": ["يجوز الاتفاق كتابةً على استبعاد العمولات من أجر المكافأة", null, "", ST.CONF, "S26", "نظام العمل م/86", "نظام العمل"],
    "EOS-WAGE": ["أساس المكافأة = الأجر الفعلي (الأساسي والبدلات والعمولات)", null, "", ST.CONF, "S27", "م/2 وم/84", "نظام العمل"],
    "LEAVE": ["الإجازة السنوية 21 يومًا، و30 بعد خمس سنوات", null, "", ST.SEC, "S26", "نظام العمل م/109", "نظام العمل"],
    "POLICY": ["سياسة المنشأة (طبي، سكن ونقل عيني، تذكرة، إجازة في التكلفة)", null, "", "سياسة المنشأة", "", "إعدادات المنشأة", "سياسة المنشأة"]
  };
  // name: ann, saned, ohi, nitaqat treatment, levy, iqama, scenario weight, expat weight, conservative expat weight, status, nitaqat text, Saudi-only jobs, rules
  var CATS = [
    ["سعودي", 1, 1, 1, "w", 0, 0, 0, 0, 0, ST.CONF, "يُحتسب بحسب الأجر المسجل وتوثيق العقد", "مسموح", ["NIT-FULL", "NIT-HALF", "NIT-QIWA-DOC"]],
    ["مقيم", 0, 0, 1, "x", 1, 1, 0, 1, 1, ST.CONF, "وافد (1)", "غير مسموح", ["DEF-NIT-GCC"]],
    ["زوجة مواطن", 0, 0, 1, "n", 1, 1, 0, 0, 1, ST.PEND, "محايدة مؤقتًا؛ وافدة في السيناريو المتحفظ", "غير مسموح", ["DEF-NIT-SPOUSE", "LEVY-EXEMPT-SPECIAL"]],
    ["زوج مواطنة", 0, 0, 1, "n", 1, 1, 0, 0, 1, ST.PEND, "محايد مؤقتًا؛ وافد في السيناريو المتحفظ", "غير مسموح", ["DEF-NIT-SPOUSE", "LEVY-EXEMPT-SPECIAL"]],
    ["ابن/ابنة مواطنة", 0, 0, 1, "c", 1, 1, 1, 0, 0, ST.CONF, "1 كسعودي ضمن حد الفئات الخاصة", "مسموح (بشرط نقل الكفالة على الأم – مرجّح)", ["NIT-SPEC-CAP-CAT", "NIT-SPEC-CAP-ALL", "NIT-SPEC-METHOD", "LEVY-EXEMPT-SPECIAL"]],
    ["أم/أرملة مواطن", 0, 0, 1, "c", 1, 1, 1, 0, 0, ST.CONF, "1 كسعودي ضمن حد الفئات الخاصة", "غير مؤكد (المصادر متعارضة)", ["NIT-SPEC-CAP-CAT", "NIT-SPEC-CAP-ALL", "NIT-SPEC-METHOD"]],
    ["مواطن خليجي", 0, 0, 1, "c", 0, 0, 1, 0, 0, ST.CONF, "1 كسعودي ضمن حد الفئات الخاصة", "لم يُعثر على نص", ["NIT-SPEC-CAP-CAT", "NIT-SPEC-CAP-ALL", "NIT-SPEC-METHOD", "GCC-PEN"]],
    ["فلسطيني بوثيقة مصرية / بلوشي", 0, 0, 1, "q", 1, 1, 0, 0.25, 0.25, ST.CONF, "ربع وافد (0.25) بشرط 50%", "غير مسموح", ["NIT-QUARTER-EXP", "NIT-QUARTER-LIMIT", "LEVY-EXEMPT-SPECIAL"]],
    ["برماوي – خارج مكة والمدينة", 0, 0, 1, "z", 1, 1, 0, 0, 0, ST.CONF, "لا يُحتسب (0)", "غير مسموح", ["NIT-BURMESE"]],
    ["برماوي – داخل مكة والمدينة", 0, 0, 1, "x", 1, 1, 0, 1, 1, ST.CONF, "وافد (1)", "غير مسموح", ["NIT-BURMESE"]],
    ["إقامة مميزة", 0, 0, 1, "x", 1, 1, 0, 1, 1, ST.PEND, "وافد احتياطًا (لم تثبت معاملته)", "غير مسموح", ["LEVY-EXEMPT-SPECIAL"]]
  ];
  var LEVY_PENDING = ["زوجة مواطن", "زوج مواطنة", "ابن/ابنة مواطنة", "فلسطيني بوثيقة مصرية / بلوشي", "إقامة مميزة"];
  var QTR = "فلسطيني بوثيقة مصرية / بلوشي";
  var CAT = {};
  CATS.forEach(function (c) { CAT[c[0]] = { ann: c[1], saned: c[2], ohi: c[3], tr: c[4], levy: c[5], iq: c[6], opt: c[7], xb: c[8], xc: c[9], st: c[10], nitText: c[11], jobs: c[12], rules: c[13] }; });
  var DEFAULT_POLICY = { hl: 0, hh: 0, tk: 0, m1: 3000, m2: 5000, m3: 9000, leave: 0, ticket: 0, commx: 0 };

  function rules(calc) {
    var nw = 0.09;
    [["2025-07-01", 0.095], ["2026-07-01", 0.10], ["2027-07-01", 0.105], ["2028-07-01", 0.11]].forEach(function (s) { if (calc >= s[0]) nw = s[1]; });
    return { NEW: nw, OLD: 0.09, SAN: 0.0075, OHI: 0.02, MAX: 45000, INK: 2, LH: 800, LL: 700, IQ: 650, WP: 100, CAP_CAT: 0.10, CAP_ALL: 0.15, QW: 0.25, QL: 0.5,
      DOC: calc >= "2026-04-15" ? 1 : 0, COMM: calc >= "2024-07-03" ? 1 : 0, IND: calc >= "2025-12-18" ? 1 : 0 };
  }
  function n(x) { return (x === null || x === undefined || x === "" || isNaN(+x)) ? 0 : +x; }
  function blank(x) { return x === null || x === undefined || x === ""; }
  function round2(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function round2y(x) { return Math.round(x * 100) / 100; }
  function nitw(wage, contract) {
    if (contract === "دوام جزئي") return wage >= 3000 ? 0.5 : 0;
    return wage >= 4000 ? 1 : wage >= 3000 ? 0.5 : 0;
  }
  function days(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  // Qiwa caps (S35): each category, then all together; whole=true rounds each cap down to whole persons (lower bound)
  function capped(perCat, base, R, whole) {
    function cap(r) { return whole ? Math.floor(r * base + 1e-9) : r * base; }
    var s = 0; Object.keys(perCat).forEach(function (k) { s += Math.min(perCat[k], cap(R.CAP_CAT)); });
    return Math.min(cap(R.CAP_ALL), s);
  }

  function computeCompany(co) {
    var R = rules(co.calc);
    var p = co.calc >= (co.policyFrom || "0000") ? Object.assign({}, DEFAULT_POLICY, co.policy || {}) : DEFAULT_POLICY;
    var es = co.employees.filter(function (d) { return CAT[d.cat]; });
    var sa = es.filter(function (d) { return d.cat === "سعودي"; }).length;
    var lc = es.reduce(function (s, d) { return s + CAT[d.cat].levy; }, 0);
    var ind = co.industrial && R.IND === 1;
    var rate = ind ? 0 : (lc > sa ? R.LH : R.LL);
    var exActive = co.smallExempt && co.calc < "2027-01-21" && es.length <= 9;
    var exShare = exActive && lc ? Math.min(n(co.exemptCount), lc) / lc : 0;
    var qtr = es.filter(function (d) { return d.cat === QTR; }).length;
    var qOver = qtr > R.QL * es.length;
    var out = {}, perCat = {}, sum = {};
    function add(k, v) { sum[k] = (sum[k] || 0) + v; }
    es.forEach(function (d) {
      var c = CAT[d.cat], a = c.ann, s = c.saned, o = c.ohi;
      var basic = n(d.basic), h = n(d.hcash), t = n(d.tcash), comm = n(d.comm), bonus = n(d.bonus), other = n(d.other);
      var cash = basic + h + t + other;
      var hkind = d.hkind === "نعم", tkind = d.tkind === "نعم";
      var commBase = blank(d.commprev) ? comm : n(d.commprev);
      var expc = Math.min(R.MAX, basic + (hkind ? basic * R.INK / 12 : h) + commBase * R.COMM);
      var contrib = n(d.gosiw) ? Math.min(n(d.gosiw), R.MAX) : expc;
      var isGcc = d.cat === "مواطن خليجي";
      var gEr = isGcc ? (blank(d.gccEr) ? null : n(d.gccEr)) : 0, gEe = isGcc ? (blank(d.gccEe) ? null : n(d.gccEe)) : 0;
      var fGcc = isGcc && gEr === null ? 1 : 0;
      var annRate = d.scheme === "جديد" ? R.NEW : R.OLD;
      var err = a * annRate + s * R.SAN + o * R.OHI + (gEr || 0);
      var eer = a * annRate + s * R.SAN + (gEe || 0);
      var er = round2(contrib * err), ee = round2(contrib * eer);
      var levy = round2(c.levy * rate * (1 - exShare));
      var gov = round2(c.iq * (R.IQ + R.WP) / 12);
      var gn = d.grade ? parseInt(String(d.grade).replace(/\D/g, ""), 10) || 0 : 0;
      var medY = gn <= 5 ? p.m1 : gn <= 8 ? p.m2 : p.m3, med = round2(medY / 12);
      var hk = hkind ? (gn <= 2 ? p.hl : p.hh) : 0;
      var tk = tkind ? p.tk : 0;
      var yrs = Math.max(0, round2y(days(d.hire || co.calc, co.calc) / 365));
      var commx = blank(d.commx) ? p.commx : n(d.commx);
      var eosb = cash + comm * (1 - commx);
      var eos = round2(eosb * (yrs < 5 ? 0.5 : 1) / 12);
      var leaveDays = yrs >= 5 ? 30 : 21;
      var leave = round2((cash + comm) * leaveDays / 30 / 12 * p.leave);
      var ticket = a === 0 ? p.ticket / 12 : 0;
      var commgap = (n(d.gosiw) && comm) ? Math.max(0, round2(expc - Math.min(n(d.gosiw), expc))) : 0;
      var eosbal = round2(eosb * (0.5 * Math.min(yrs, 5) + Math.max(0, yrs - 5)));
      var total = cash + comm + bonus + er + levy + gov + med + hk + tk + eos + leave + ticket;
      var unc = levy + gov + med + hk + tk + ticket;
      var w = (c.tr === "w" && d.relied === "نعم") ? nitw(contrib, d.contract) : 0;
      var docf = d.docqiwa === "نعم" ? 1 : (R.DOC === 1 ? 0 : 1);
      var nit = w * docf;
      var pend = (docf === 0 && d.docqiwa !== "لا") ? w : 0;
      var nopt = nit + pend + (d.relied !== "لا" ? c.opt * nitw(contrib, d.contract) : 0);
      var nspec = (c.tr === "c" && d.relied !== "لا") ? nitw(contrib, d.contract) : 0;
      if (nspec) perCat[d.cat] = (perCat[d.cat] || 0) + nspec;
      var r = { contrib: contrib, expc: expc, er: er, ee: ee, levy: levy, gov: gov, med: med, hk: hk, tk: tk, eosb: eosb, eos: eos, eosbal: eosbal, leave: leave,
        ticket: ticket, total: total, unc: unc, nitw: w, nit: nit, nitpend: pend, nitno: w - nit - pend, nitspec: nspec, nitopt: nopt, expn: c.xb, expcons: c.xc,
        commgap: commgap, f_gcc: fGcc, cash: cash, comm: comm, bonus: bonus, yrs: yrs, err: err, eer: eer, annRate: annRate, rate: rate, exShare: exShare,
        medY: medY, gn: gn, commx: commx, leaveDays: leaveDays, docf: docf, levyPending: LEVY_PENDING.indexOf(d.cat) >= 0 };
      r.status = status(d, c, r, R, qOver);
      r.lines = lines(d, c, r, R, p);
      r.alerts = alerts(d, c, r, R, qOver);
      out[d.code] = r;
      ["cash", "comm", "bonus", "er", "levy", "gov", "med", "hk", "tk", "eos", "leave", "ticket", "total", "unc", "eosbal", "nit", "nitpend", "nitno", "nitopt", "expcons"].forEach(function (k) { add(k, r[k]); });
      add("exp", c.xb);
      if (r.levyPending) add("levy_saving", levy);
    });
    var nitS = sum.nit || 0, pendS = sum.nitpend || 0, expS = sum.exp || 0;
    var spec = capped(perCat, nitS, R, true), specHi = capped(perCat, sa, R, false);
    var expLo = expS + (qOver ? qtr * (1 - R.QW) : 0);
    function div(a, b) { return b ? a / b : 0; }
    var dash = {
      hc: es.length, sa: sa, res: es.filter(function (d) { return d.cat === "مقيم"; }).length, rate: rate, exShare: exShare, ind: ind,
      nit: nitS, pend: pendS, no: sum.nitno || 0, exp: expS, exp_lo: expLo, spec: spec, spec_hi: specHi, qtr: qtr, qOver: qOver,
      specRaw: Object.keys(perCat).reduce(function (s, k) { return s + perCat[k]; }, 0),
      ratio_lo: div(nitS + spec, nitS + spec + expLo),
      ratio_hi: div(nitS + pendS + specHi, nitS + pendS + specHi + expS),
      ratio_opt: div(sum.nitopt || 0, (sum.nitopt || 0) + expS),
      ratio_cons: div(nitS, nitS + (sum.expcons || 0) + expLo - expS),
      cash: sum.cash || 0, comm: sum.comm || 0, er: sum.er || 0, gov: (sum.levy || 0) + (sum.gov || 0), ben: (sum.med || 0) + (sum.hk || 0) + (sum.tk || 0) + (sum.ticket || 0),
      prov: (sum.eos || 0) + (sum.leave || 0), total: sum.total || 0, unc: sum.unc || 0, eosbal: sum.eosbal || 0, levy_saving: sum.levy_saving || 0,
      gccInc: es.filter(function (d) { return out[d.code].f_gcc; }).length
    };
    var why = [];
    if (pendS > 0) why.push("توثيق عقود غير معروف: " + fmtN(pendS));
    if (Math.abs(specHi - spec) > 1e-9) why.push("طريقة حد الفئات الخاصة بانتظار التحقق الرسمي");
    if (qOver) why.push("تجاوز شرط 50% للفلسطينيين/البلوش");
    dash.ratioWhy = why;
    return { emps: out, dash: dash, R: R, policy: p };
  }

  function status(d, c, r, R, qOver) {
    var gosi = c.ann ? ("سعودي: معاشات " + pct(r.annRate) + (d.scheme === "جديد" ? " (النظام الجديد)" : " (النظام السابق)") + " + ساند 0.75% + أخطار 2%")
      : d.cat === "مواطن خليجي" ? (r.f_gcc ? "أخطار 2% في المملكة + معاشات دولة الموطن (النسبة غير مدخلة)" : "أخطار 2% + معاشات دولة الموطن")
      : "غير سعودي: الأخطار المهنية 2% فقط";
    var nit, nitSt = c.st;
    if (c.tr === "w") {
      nitSt = ST.CONF;
      if (d.relied !== "نعم") nit = d.relied === "لا" ? "غير معتمد للمنشأة" : "يحتاج تأكيد الاعتماد عليه";
      else if (r.nitw === 0) nit = "غير محتسب: الأجر المسجل أقل من 3,000";
      else if (r.docf === 0) nit = d.docqiwa === "لا" ? "لا يُحتسب: العقد غير موثق في قوى" : "غير محدد: توثيق العقد غير معروف (" + r.nitw + ")";
      else nit = (d.contract === "دوام جزئي" ? "دوام جزئي: " : "") + "يُحتسب " + r.nitw;
    } else if (c.tr === "c") { nit = r.nitspec ? "يُحتسب " + r.nitspec + " كسعودي قبل الحد (10% للفئة، 15% مجتمعة)" : "لا يُحتسب: الأجر المسجل أقل من الحد"; nitSt = ST.PEND; }
    else if (c.tr === "n") nit = "محايد مؤقتًا: لا يؤثر في النسبة؛ وافد في السيناريو المتحفظ";
    else if (c.tr === "q") { nit = qOver ? "الفئة تتجاوز 50% من الموظفين: المعاملة بانتظار التحقق الرسمي" : "ربع وافد (0.25)"; nitSt = qOver ? ST.PEND : ST.CONF; }
    else nit = c.nitText;
    var levy, levySt = ST.SEC;
    if (r.levyPending) { levy = "محمّل: " + fmt(r.levy) + " شهريًا (الإعفاء غير مثبت)"; levySt = ST.PEND; }
    else if (c.levy) levy = r.levy ? "محمّل: " + fmt(r.levy) + " شهريًا" : "لا يُحمّل (إعفاء أو ترخيص صناعي)";
    else { levy = d.cat === "سعودي" ? "لا ينطبق" : "لا ينطبق (لا إقامة)"; levySt = ST.CONF; }
    return { gosi: gosi, nit: nit, nitSt: nitSt, levy: levy, levySt: levySt, jobs: c.jobs };
  }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1) + "%"; }
  function fmt(x) { return (Math.round(x * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtN(x) { return (Math.round(x * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }); }

  function lines(d, c, r, R, p) {
    var L = [];
    function L1(label, v, kind, how, rl) { L.push({ label: label, v: v, kind: kind, how: how, rules: rl }); }
    L1("الأجر النقدي الثابت", r.cash, "فعلي", "الأساسي + بدل السكن النقدي + بدل النقل النقدي + البدلات الأخرى", ["EOS-WAGE"]);
    if (r.comm) L1("العمولات (متوسط شهري)", r.comm, "فعلي", "كما أُدخلت", ["GOSI-COMM"]);
    if (r.bonus) L1("حوافز أخرى", r.bonus, "فعلي", "كما أُدخلت", []);
    L1("اشتراك التأمينات على المنشأة", r.er, "محسوب", "الأجر الخاضع " + fmt(r.contrib) + " × " + pct(r.err) + (n(d.gosiw) ? " (الأجر المسجل في الكشف)" : " (أجر متوقع: الأساسي + السكن" + (d.hkind === "نعم" ? " العيني بأجر شهرين" : "") + " + العمولة)"),
      c.ann ? ["GOSI-OLD-ANN", "GOSI-NEW-ANN", "GOSI-SANED", "GOSI-OHI", "GOSI-MAX"] : d.cat === "مواطن خليجي" ? ["GCC-PEN", "GOSI-OHI"] : ["GOSI-OHI", "GOSI-MAX"]);
    if (c.levy || r.levy) L1("المقابل المالي", r.levy, "تقديري", (r.rate ? fmt(r.rate) + " شهريًا" + (r.exShare ? " × (1 − نسبة الإعفاء " + pct(r.exShare) + ")" : "") : "صفر: ترخيص صناعي") + (r.levyPending ? "؛ محمّل لأن إعفاء هذه الفئة غير مثبت" : ""),
      ["LEVY", "LEVY-SMALL", "LEVY-IND"].concat(r.levyPending ? ["LEVY-EXEMPT-SPECIAL"] : []));
    if (r.gov) L1("الإقامة ورخصة العمل", r.gov, "تقديري", "(650 + 100) ÷ 12", ["IQAMA"]);
    L1("التأمين الطبي", r.med, "تقديري", fmt(r.medY) + " سنويًا ÷ 12 (فئة الدرجة " + (r.gn || "—") + ")", ["POLICY"]);
    if (r.hk) L1("السكن العيني", r.hk, "تقديري", "تكلفة الفرد في سياسة المنشأة", ["POLICY"]);
    if (r.tk) L1("النقل العيني", r.tk, "تقديري", "تكلفة الفرد في سياسة المنشأة", ["POLICY"]);
    L1("مخصص نهاية الخدمة", r.eos, "محسوب", "أساس " + fmt(r.eosb) + " × " + (r.yrs < 5 ? "نصف شهر" : "شهر") + " ÷ 12 (خدمة " + r.yrs + " سنة" + (r.commx ? "، العمولات مستبعدة " + pct(r.commx) + " باتفاق" : "") + ")", ["EOS", "EOS-WAGE", "EOS-86"]);
    if (r.leave) L1("مخصص الإجازة", r.leave, "محسوب", "الأجر الفعلي × " + r.leaveDays + " يومًا ÷ 30 ÷ 12", ["LEAVE"]);
    if (r.ticket) L1("التذكرة", r.ticket, "تقديري", fmt(p.ticket) + " سنويًا ÷ 12", ["POLICY"]);
    return L;
  }
  function alerts(d, c, r, R, qOver) {
    var A = [];
    if (r.f_gcc) A.push(["bad", "تكلفة غير مكتملة: أدخل نسبة معاشات دولة الموطن للخليجي"]);
    if (c.tr === "w" && d.relied === "نعم" && d.contract !== "دوام جزئي" && r.contrib < 4000) A.push(["bad", "سعودي يُعتمد عليه بأجر مسجل أقل من 4,000: لا يُحتسب كاملًا"]);
    if (c.tr === "w" && d.relied !== "لا" && d.docqiwa === "لا" && R.DOC) A.push(["bad", "العقد غير موثق في قوى: لا يُحتسب"]);
    if (c.tr === "w" && d.relied !== "لا" && d.docqiwa !== "نعم" && d.docqiwa !== "لا" && R.DOC) A.push(["warn", "توثيق العقد في قوى غير معروف: النسبة غير محددة"]);
    if (c.st === ST.PEND) A.push(["pend", "معاملة هذه الفئة في نطاقات بانتظار التحقق الرسمي"]);
    if (c.tr === "c") A.push(["pend", "يُحتسب كسعودي بحد 10% للفئة و15% مجتمعة؛ طريقة تطبيق الحد بانتظار التحقق الرسمي"]);
    if (c.tr === "q" && qOver) A.push(["pend", "الفئة تتجاوز 50% من الموظفين: المعاملة بانتظار التحقق الرسمي"]);
    if (r.levyPending && r.levy) A.push(["info", "إعفاء المقابل المالي غير مثبت: محمّل (" + fmt(r.levy) + ")، والوفر المحتمل معروض في لوحة المنشأة"]);
    if (r.commgap) A.push(["info", "عمولة لا تظهر في الأجر المسجل: تُراجع عند تعديل الأجر (" + fmt(r.commgap) + ")"]);
    if (!d.hire) A.push(["warn", "تاريخ الالتحاق: يحتاج تحديد"]);
    if (!n(d.gosiw)) A.push(["warn", "الأجر المسجل في التأمينات: يحتاج تحديد (استُخدم الأجر المتوقع)"]);
    if (c.tr === "w" && (blank(d.contract) || d.contract === "يحتاج تحديد")) A.push(["warn", "نوع الدوام: يحتاج تحديد"]);
    return A;
  }
  return { ST: ST, SRC: SRC, RULES: RULES, CAT: CAT, CATS: CATS, LEVY_PENDING: LEVY_PENDING, computeCompany: computeCompany, fmt: fmt, fmtN: fmtN, pct: pct, DEFAULT_POLICY: DEFAULT_POLICY };
})();
if (typeof module !== "undefined") module.exports = ENGINE;

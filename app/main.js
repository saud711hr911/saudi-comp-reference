// Operational app UI. The screens and wording follow the approved prototype (النموذج.html); the calculation is engine.js
// unchanged; storage and sign-in go through data.js, where the database's row-level security decides access.
(function () {
  var E = ENGINE, THEME = "saudi-ref-theme";
  var state = { companies: [], coIdx: 0, empIdx: 0, tab: "emp", step: "form" };
  var ui = { q: "", alertFilter: "all", ruleQ: "", ruleDom: "الكل", ruleSt: "الكل", open: {} };
  var me = null, roles = { admin: false, byCompany: {} }, FIX = null, RO = true;
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function V(s) { return '<span class="v">' + s + "</span>"; }
  function money(x) { return V(E.fmt(x)); }
  function co() { return state.companies[state.coIdx]; }
  function emp() { return co().employees[state.empIdx]; }
  var KIND = { "فعلي": "b-ok", "محسوب": "b-info", "تقديري": "b-warn" };
  var SEV = { bad: ["مهم", 0], pend: ["بانتظار التحقق", 1], warn: ["بيانات ناقصة", 2], info: ["معلومة", 3] };
  function stClass(s) { return s === E.ST.CONF ? "b-ok" : s === E.ST.SEC || s === E.ST.PART ? "b-warn" : s === E.ST.PEND ? "b-pend" : s === E.ST.NEED ? "b-bad" : "b-mute"; }
  function stBadge(s) { return '<span class="badge ' + stClass(s) + '">' + esc(s) + "</span>"; }

  // ---------- roles: shown in the screens; enforced by the database
  var ROLE_AR = { owner: "مالك النظام", manager: "مدير المنشأة", editor: "محرر", viewer: "مطّلع" };
  function roleOf(c) { return roles.admin ? "owner" : roles.byCompany[c._id] || "viewer"; }
  function canEdit(c) { var r = roleOf(c); return r === "owner" || r === "manager" || r === "editor"; }
  function canManage(c) { var r = roleOf(c); return r === "owner" || r === "manager"; }

  // ---------- saving: each change is written shortly after typing stops; the badge shows the state
  var pending = {}, inflight = 0, lastErr = "";
  function saveBadge() {
    var el = $("saveState"), n = Object.keys(pending).length + inflight;
    el.className = "save" + (lastErr ? " bad" : n ? " busy" : " ok");
    el.textContent = lastErr ? "تعذّر الحفظ: " + lastErr : n ? "جارٍ الحفظ…" : "محفوظ";
  }
  function queue(key, fn) {
    clearTimeout(pending[key]);
    pending[key] = setTimeout(function () { delete pending[key]; run(fn); }, 700);
    saveBadge();
  }
  async function run(fn) {
    inflight++; saveBadge();
    try { await fn(); lastErr = ""; } catch (e) { lastErr = msg(e); }
    inflight--; saveBadge();
  }
  function msg(e) {
    var m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return "البريد أو كلمة المرور غير صحيحة";
    if (/Email not confirmed/i.test(m)) return "البريد غير مؤكد";
    if (/row-level security|permission denied/i.test(m)) return "لا تملك صلاحية هذا الإجراء";
    if (/companies_dummy_only/.test(m)) return "هذه المرحلة للبيانات الوهمية فقط";
    if (/duplicate key/.test(m)) return "الرمز مستخدم من قبل";
    if (/Failed to fetch|NetworkError/i.test(m)) return "تعذّر الاتصال بالخادم";
    return m;
  }
  window.addEventListener("beforeunload", function (e) { if (Object.keys(pending).length || inflight) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- theme
  function applyTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  function curTheme() { var t = document.documentElement.getAttribute("data-theme"); return t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  function themeLabel() { var d = curTheme() === "dark"; $("themeBtn").textContent = d ? "☀ فاتح" : "☾ داكن"; $("themeBtn").setAttribute("aria-label", d ? "التحويل إلى الوضع الفاتح" : "التحويل إلى الوضع الداكن"); }
  $("themeBtn").addEventListener("click", function () { var t = curTheme() === "dark" ? "light" : "dark"; applyTheme(t); try { localStorage.setItem(THEME, t); } catch (e) { } themeLabel(); });

  // ---------- sign-in
  function show(view) { ["authView", "resetView", "appView"].forEach(function (v) { $(v).hidden = v !== view; }); }
  function note(id, text) { $(id).textContent = text || ""; $(id).hidden = !text; }
  $("loginForm").addEventListener("submit", async function (ev) {
    ev.preventDefault(); note("loginErr"); note("loginOk");
    var email = $("email").value.trim(), pw = $("password").value;
    if (!email || !pw) { note("loginErr", "أدخل البريد وكلمة المرور"); return; }
    $("loginBtn").disabled = true;
    try { await DATA.signIn(email, pw); $("password").value = ""; await enter(); }
    catch (e) { note("loginErr", msg(e)); }
    $("loginBtn").disabled = false;
  });
  $("forgotBtn").addEventListener("click", async function () {
    note("loginErr"); note("loginOk");
    var email = $("email").value.trim();
    if (!email) { note("loginErr", "اكتب بريدك أولًا، ثم اضغط «نسيت كلمة المرور»"); return; }
    try { await DATA.sendReset(email); } catch (e) { }
    note("loginOk", "إن كان البريد مسجلًا فستصلك رسالة لتعيين كلمة المرور.");
  });
  $("resetForm").addEventListener("submit", async function (ev) {
    ev.preventDefault(); note("resetErr");
    var pw = $("newPw").value;
    if (pw.length < 12) { note("resetErr", "كلمة المرور قصيرة: 12 حرفًا على الأقل"); return; }
    try { await DATA.setPassword(pw); $("newPw").value = ""; await enter(); } catch (e) { note("resetErr", msg(e)); }
  });
  $("logoutBtn").addEventListener("click", async function () { await DATA.signOut(); state.companies = []; show("authView"); });
  DATA.onAuth(function (ev) {
    if (ev === "PASSWORD_RECOVERY") show("resetView");
    if (ev === "SIGNED_OUT") { state.companies = []; show("authView"); }
  });

  async function enter() {
    var s = await DATA.session();
    if (!s) { show("authView"); return; }
    me = s.user; show("appView");
    $("loading").hidden = false; $("noCompany").hidden = true;
    ["emp", "dash", "set", "rules", "check"].forEach(function (t) { $("p-" + t).hidden = true; });
    try {
      roles = await DATA.roles(me.id);
      state.companies = await DATA.loadCompanies();
    } catch (e) { $("loading").textContent = "تعذّر تحميل البيانات: " + msg(e); return; }
    $("loading").hidden = true;
    $("whoEmail").textContent = me.email || "";
    DATA.loadFixture().then(function (f) { FIX = f; checkCache = null; if (state.companies.length) renderHeader(); if (state.tab === "check") renderCheck(); });
    if (!state.companies.length && !roles.admin) { $("noCompany").hidden = false; return; }
    state.coIdx = 0; state.empIdx = 0; state.tab = "emp"; state.step = "form"; ui.q = ""; ui.open = {}; $("empSearch").value = ""; render();
  }

  // ---------- header
  function renderHeader() {
    var c = co();
    $("co").innerHTML = state.companies.map(function (x, i) { return '<option value="' + i + '"' + (i === state.coIdx ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") +
      (roles.admin ? '<option value="new">+ منشأة تجريبية جديدة</option>' : "");
    $("calcInfo").innerHTML = c ? "تاريخ الاحتساب " + V(esc(c.calc)) : "";
    $("whoRole").textContent = c ? ROLE_AR[roleOf(c)] : roles.admin ? ROLE_AR.owner : "";
    var m = runCheck();
    $("matchBtn").className = "match" + (m.bad.length ? " bad" : "");
    $("matchBtn").textContent = m.pending ? "مطابقة Excel…" : m.bad.length ? "اختلاف مع Excel: " + m.bad.length : "مطابق لـExcel: " + m.cells + " قيمة";
    themeLabel(); saveBadge();
    document.documentElement.style.setProperty("--hh", ($("hdr").offsetHeight + 12) + "px");
  }
  $("co").addEventListener("change", async function (e) {
    if (e.target.value === "new") {
      try { var c = await DATA.createCompany("منشأة تجريبية جديدة"); state.companies.push(c); state.coIdx = state.companies.length - 1; state.tab = "set"; }
      catch (err) { lastErr = msg(err); saveBadge(); e.target.value = String(state.coIdx); return; }
    } else state.coIdx = +e.target.value;
    state.empIdx = 0; render();
  });
  $("matchBtn").addEventListener("click", function () { state.tab = "check"; render(); });
  document.querySelectorAll("nav.tabs button").forEach(function (b) { b.addEventListener("click", function () { state.tab = b.dataset.tab; render(); }); });
  function renderTabs() {
    ["emp", "dash", "set", "rules", "check"].forEach(function (t) {
      $("p-" + t).hidden = state.tab !== t;
      var b = $("t-" + t); if (b) b.setAttribute("aria-selected", state.tab === t ? "true" : "false");
    });
  }

  // ---------- employee tab
  document.querySelectorAll(".mstep button").forEach(function (b) { b.addEventListener("click", function () { state.step = b.dataset.step; renderStep(); }); });
  function renderStep() {
    $("empGrid").dataset.step = state.step || "form";
    document.querySelectorAll(".mstep button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.step === state.step ? "true" : "false"); });
  }
  $("empSearch").addEventListener("input", function (e) { ui.q = e.target.value.trim(); renderEmpList(lastRes); });
  function renderEmpList(res) {
    var c = co(), q = ui.q;
    var items = c.employees.map(function (d, i) { return [d, i]; }).filter(function (x) { return !q || (x[0].name || "").indexOf(q) >= 0 || (x[0].cat || "").indexOf(q) >= 0 || (x[0].code || "").indexOf(q) >= 0; });
    if (!c.employees.length) { $("empList").innerHTML = '<p class="empty">لا موظفين بعد.' + (canEdit(c) ? " أضف أول موظف." : "") + "</p>"; return; }
    if (!items.length) { $("empList").innerHTML = '<p class="empty">لا نتائج للبحث.</p>'; return; }
    $("empList").innerHTML = items.map(function (x) {
      var d = x[0], i = x[1], r = res.emps[d.code];
      return '<button type="button" data-i="' + i + '" aria-current="' + (i === state.empIdx) + '"><span class="nm">' + esc(d.name || d.code) + '</span><span class="c">' + esc(d.cat) + '</span><span class="t">' + (r ? money(r.total) : "") + "</span></button>";
    }).join("");
    $("empList").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { state.empIdx = +b.dataset.i; state.step = "form"; renderAll(); }); });
  }
  $("addEmp").addEventListener("click", async function () {
    var c = co(), k = c.employees.length + 1, code = "E" + String(k).padStart(2, "0");
    while (c.employees.some(function (d) { return d.code === code; })) code = "E" + String(++k).padStart(2, "0");
    var d = { code: code, name: "موظف جديد", cat: "سعودي", nat: "السعودية", title: "", occ: "", grade: "", contract: "دوام كامل", relied: "نعم", docqiwa: "غير معروف", hire: "", scheme: "جديد",
      basic: null, hcash: null, hkind: "لا", tcash: null, tkind: "", other: null, comm: null, commx: null, commprev: null, bonus: null, gosiw: null };
    // Clear the form while the new row is created, so typing cannot land on the previously selected employee.
    $("addEmp").disabled = true; $("formPanel").innerHTML = '<p class="empty">جارٍ إضافة موظف جديد…</p>';
    try { var saved = await DATA.createEmployee(c, d); saved.hire = saved.hire || ""; c.employees.push(saved); lastErr = ""; }
    catch (e) { lastErr = msg(e); saveBadge(); $("addEmp").disabled = false; renderAll(); return; }
    $("addEmp").disabled = false;
    state.empIdx = c.employees.length - 1; state.step = "form"; ui.q = ""; $("empSearch").value = "";
    renderAll();
    var f = $("f_name"); if (f) { f.focus(); f.select(); }
  });

  // [key, label, type, options, hint, needed when empty]
  var BASIC = [
    ["الهوية والفئة", [["name", "الاسم", "text"], ["cat", "الفئة النظامية", "select", E.CATS.map(function (c) { return c[0]; }), "تحدد التأمينات ونطاقات والمقابل المالي"],
      ["nat", "الجنسية", "text"], ["title", "المسمى الفعلي", "text"], ["grade", "الدرجة", "select", [""].concat(Array.from({ length: 11 }, function (_, i) { return "G" + (i + 1); })), "تحدد فئة التأمين الطبي", true]]],
    ["العقد والتسجيل", [["contract", "نوع الدوام", "select", ["دوام كامل", "دوام جزئي", "يحتاج تحديد"]], ["relied", "يُحتسب لهذه المنشأة في نطاقات؟", "select", ["نعم", "لا", "يحتاج تحقق", ""], "«لا» إذا كان مسجلًا لدى منشأة أخرى"],
      ["docqiwa", "العقد موثق في قوى؟", "select", ["نعم", "لا", "غير معروف", ""], "شرط لاحتساب السعودي من 2026-04-15"], ["hire", "تاريخ الالتحاق", "date", null, "بصيغة سنة-شهر-يوم، مثل 2024-03-01", true],
      ["scheme", "نظام التأمينات", "select", ["قديم", "جديد"], "جديد = لا اشتراك له قبل 2024-07-03"], ["gosiw", "الأجر المسجل في التأمينات", "number", null, "من كشف التأمينات", true]]],
    ["الأجر الشهري", [["basic", "الأساسي", "number", null, "", true], ["hcash", "بدل السكن النقدي", "number"], ["hkind", "سكن تؤمّنه المنشأة؟", "select", ["لا", "نعم"]], ["tcash", "بدل النقل النقدي", "number"],
      ["tkind", "نقل تؤمّنه المنشأة؟", "select", ["", "نعم"]], ["other", "بدلات أخرى", "number"]]]
  ];
  var ADV = [["comm", "متوسط العمولات الشهرية", "number"], ["commprev", "متوسط عمولة السنة السابقة", "number", null, "تُستخدم في الأجر الخاضع للتأمينات"],
    ["commx", "نسبة العمولات المستبعدة من المكافأة", "number", null, "باتفاق مكتوب (م/86)، من 0 إلى 1"], ["bonus", "حوافز أخرى", "number"]];
  var GCC = [["gccEr", "معاشات دولة الموطن – حصة المنشأة", "number", null, "مثل 0.11"], ["gccEe", "معاشات دولة الموطن – حصة الموظف", "number", null, "مثل 0.07"]];
  function field(d, f) {
    var id = "f_" + f[0], v = d[f[0]], empty = v === null || v === undefined || v === "";
    var h = '<label class="f" for="' + id + '"><span class="lt">' + f[1] + (f[5] && empty ? '<span class="need">يحتاج تحديد</span>' : "") + "</span>";
    if (f[2] === "select") h += '<select id="' + id + '" data-k="' + f[0] + '"' + (RO ? " disabled" : "") + '>' + f[3].map(function (o) { return '<option value="' + esc(o) + '"' + (String(empty ? "" : v) === o ? " selected" : "") + ">" + (o === "" ? "—" : esc(o)) + "</option>"; }).join("") + "</select>";
    else if (f[2] === "date") h += '<input id="' + id + '" data-k="' + f[0] + '" data-t="date"' + (RO ? " disabled" : "") + ' class="date" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" value="' + esc(empty ? "" : v) + '">';
    else if (f[2] === "number") h += '<input id="' + id + '" data-k="' + f[0] + '" data-t="number"' + (RO ? " disabled" : "") + ' class="num" type="text" inputmode="decimal" placeholder="—" value="' + esc(empty ? "" : v) + '">';
    else h += '<input id="' + id + '" data-k="' + f[0] + '" data-t="text"' + (RO ? " disabled" : "") + ' type="text" value="' + esc(empty ? "" : v) + '">';
    if (f[4]) h += "<small>" + esc(f[4]) + "</small>";
    return h + "</label>";
  }
  function renderForm() {
    var d = emp(), p = $("formPanel"), c = co();
    if (!d) { p.innerHTML = '<p class="empty">' + (canEdit(c) ? "اختر موظفًا أو أضف موظفًا جديدًا." : "اختر موظفًا.") + "</p>"; return; }
    var h = '<div class="row between" style="margin-bottom:14px"><h2>' + esc(d.name || "موظف جديد") + '</h2><span class="hint">' + V(esc(d.code)) + "</span></div>";
    if (RO) h += '<p class="hint" style="margin:0 0 14px">للاطلاع فقط: دورك في هذه المنشأة لا يسمح بالتعديل.</p>';
    BASIC.forEach(function (g) { h += "<fieldset><legend>" + g[0] + '</legend><div class="fields">' + g[1].map(function (f) { return field(d, f); }).join("") + "</div></fieldset>"; });
    if (d.cat === "مواطن خليجي") h += "<fieldset><legend>المواطن الخليجي</legend><div class=\"fields\">" + GCC.map(function (f) { return field(d, f); }).join("") + "</div></fieldset>";
    var advOpen = ui.open.adv || ["comm", "commprev", "commx", "bonus"].some(function (k) { return d[k] !== null && d[k] !== undefined && d[k] !== ""; });
    h += '<details class="adv" id="advBox"' + (advOpen ? " open" : "") + '><summary>بيانات متقدمة: العمولات والحوافز</summary><div class="fields">' + ADV.map(function (f) { return field(d, f); }).join("") + "</div></details>";
    h += '<div class="row between">' + (RO ? "<span></span>" : '<button class="btn danger" id="delEmp" type="button">حذف الموظف</button>') + '<button class="btn primary mob" id="toResult" type="button">عرض النتيجة</button></div>';
    p.innerHTML = h;
    $("advBox").addEventListener("toggle", function () { ui.open.adv = $("advBox").open; });
    if (!RO) p.querySelectorAll("[data-k]").forEach(function (el) {
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", function () {
        var k = el.dataset.k, v = el.value.trim(), t = el.dataset.t;
        if (t === "number") {
          var num = v.replace(/,/g, "");
          if (num !== "" && isNaN(+num)) { el.classList.add("invalid"); return; }
          el.classList.remove("invalid"); d[k] = num === "" ? null : +num;
        } else if (t === "date") {
          if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.classList.add("invalid"); return; }
          if (v !== "" && isNaN(Date.parse(v + "T00:00:00Z"))) { el.classList.add("invalid"); return; }
          el.classList.remove("invalid"); d[k] = v;
        } else d[k] = v;
        queue("e:" + d._id, function () { return DATA.updateEmployee(d); });
        if (k === "cat") { renderAll(); return; }
        renderLive();
      });
    });
    var del = $("delEmp");
    if (del) del.addEventListener("click", async function () {
      if (del.classList.contains("armed")) {
        del.disabled = true;
        clearTimeout(pending["e:" + d._id]); delete pending["e:" + d._id];
        try { await DATA.deleteEmployee(d); } catch (e) { lastErr = msg(e); saveBadge(); del.disabled = false; return; }
        co().employees.splice(state.empIdx, 1); state.empIdx = Math.max(0, state.empIdx - 1); renderAll();
      }
      else { del.classList.add("armed"); del.textContent = "تأكيد الحذف نهائيًا"; setTimeout(function () { if (document.body.contains(del)) { del.classList.remove("armed"); del.textContent = "حذف الموظف"; } }, 5000); }
    });
    $("toResult").addEventListener("click", function () { state.step = "result"; renderStep(); window.scrollTo(0, 0); });
  }
  function srcHtml(ids) {
    return ids.map(function (id) {
      var r = E.RULES[id]; if (!r) return "";
      var s = E.SRC[r[4]];
      return '<div class="srcline">' + stBadge(r[3]) + "<span>" + esc(r[0]) + (r[5] ? " – " + esc(r[5]) : "") + "</span>" +
        (s ? '<span class="hint">المصدر: ' + (s[2] ? '<a href="' + esc(s[2]) + '" target="_blank" rel="noopener">' + esc(s[0]) + "</a>" : esc(s[0])) + " (" + esc(s[1]) + ")</span>" : "") + "</div>";
    }).join("");
  }
  function alertList(list, clickable) {
    return '<ul class="alerts">' + list.map(function (a) {
      var inner = '<span class="badge b-' + a[0] + '">' + SEV[a[0]][0] + "</span><span>" + esc(a[1]) + "</span>";
      return "<li>" + (clickable && a[2] !== undefined ? '<button type="button" class="go" data-emp="' + a[2] + '">' + inner + "</button>" : inner) + "</li>";
    }).join("") + "</ul>";
  }
  function renderResult(res) {
    var d = emp(), p = $("resultPanel");
    if (!d) { p.innerHTML = ""; return; }
    var r = res.emps[d.code];
    if (!r) { p.innerHTML = '<p class="empty">الفئة غير معرّفة.</p>'; return; }
    var c = E.CAT[d.cat];
    var h = '<div class="row between" style="margin-bottom:12px"><h2>النتيجة</h2><button class="btn mob" id="backForm" type="button">رجوع للبيانات</button></div>';
    h += '<div class="summary"><div class="box"><div class="k">التكلفة الشهرية على المنشأة</div><div class="big">' + money(r.total) + '</div></div>' +
      '<div class="box"><div class="k">منها تقديري</div><div class="mid">' + money(r.unc) + '</div></div><div class="box"><div class="k">السنوية</div><div class="mid">' + money(r.total * 12) + "</div></div></div>";
    var al = r.alerts.slice().sort(function (a, b) { return SEV[a[0]][1] - SEV[b[0]][1]; });
    h += '<h3 class="sec">تنبيهات</h3>' + (al.length ? alertList(al, false) : '<p class="hint">لا تنبيهات.</p>');
    h += '<h3 class="sec">الوضع النظامي</h3><div class="status">' +
      stat("التأمينات الاجتماعية", r.status.gosi, E.ST.CONF, c.ann ? ["GOSI-OLD-ANN", "GOSI-NEW-ANN", "GOSI-SANED", "GOSI-OHI"] : d.cat === "مواطن خليجي" ? ["GCC-PEN", "GOSI-OHI"] : ["GOSI-OHI"]) +
      stat("نطاقات", r.status.nit, r.status.nitSt, c.rules.filter(function (x) { return x.indexOf("NIT") === 0 || x.indexOf("DEF-NIT") === 0; })) +
      stat("المقابل المالي", r.status.levy, r.status.levySt, c.levy ? ["LEVY", "LEVY-SMALL", "LEVY-IND"].concat(r.levyPending ? ["LEVY-EXEMPT-SPECIAL"] : []) : []) +
      stat("المهن المقصورة على السعوديين", r.status.jobs, null, []) + "</div>";
    h += '<h3 class="sec">تفصيل التكلفة الشهرية</h3><div class="tbl"><table><thead><tr><th>البند</th><th class="n">ريال</th><th>الطبيعة</th></tr></thead><tbody>';
    r.lines.forEach(function (l, i) {
      var key = d.code + ":" + i, open = !!ui.open[key];
      h += "<tr><td>" + esc(l.label) + ' <button type="button" class="why" data-key="' + key + '" aria-expanded="' + open + '">' + (open ? "إخفاء" : "كيف حُسب؟") + "</button></td>" +
        '<td class="n">' + money(l.v) + '</td><td><span class="badge ' + KIND[l.kind] + '">' + l.kind + "</span></td></tr>";
      if (open) h += '<tr class="detail"><td colspan="3"><div class="srcbox"><div>' + esc(l.how) + "</div>" + srcHtml(l.rules) + "</div></td></tr>";
    });
    h += '<tr class="total"><td>الإجمالي الشهري</td><td class="n">' + money(r.total) + "</td><td></td></tr>";
    h += '<tr class="sub"><td>استقطاع الموظف للتأمينات</td><td class="n">' + money(r.ee) + '</td><td></td></tr><tr class="sub"><td>التزام نهاية الخدمة المتراكم</td><td class="n">' + money(r.eosbal) + "</td><td></td></tr>";
    h += "</tbody></table></div>";
    p.innerHTML = h;
    p.querySelectorAll(".why").forEach(function (b) { b.addEventListener("click", function () { ui.open[b.dataset.key] = !ui.open[b.dataset.key]; renderResult(lastRes); }); });
    $("backForm").addEventListener("click", function () { state.step = "form"; renderStep(); window.scrollTo(0, 0); });
  }
  function stat(k, v, st, ids) {
    return '<div class="stat"><div class="row between"><span class="k">' + k + "</span>" + (st ? stBadge(st) : "") + '</div><div class="val">' + esc(v) + "</div>" +
      (ids.length ? '<details><summary class="hint" style="cursor:pointer">الحكم والمصدر</summary><div class="srcbox" style="margin-top:8px">' + srcHtml(ids) + "</div></details>" : "") + "</div>";
  }
  // ---------- establishment board
  function renderDash(res) {
    var c = co(), D = res.dash, p = $("p-dash");
    var range = Math.abs(D.ratio_hi - D.ratio_lo) > 1e-9;
    var h = '<div class="kpis">' +
      kpi("العدد الفعلي", V(D.hc), D.sa + " سعوديون، " + D.res + " مقيمون، " + (D.hc - D.sa - D.res) + " من فئات خاصة") +
      kpi("التكلفة الشهرية", money(D.total), "السنوية " + E.fmt(D.total * 12) + " ريال") +
      kpi("نسبة نطاقات (تقدير)", range ? V(E.pct(D.ratio_lo) + " – " + E.pct(D.ratio_hi)) : V(E.pct(D.ratio_lo)), range ? "نطاق لا رقم: " + D.ratioWhy.join("؛ ") : "محسوبة من بيانات مكتملة. قوى هي المرجع النهائي") +
      kpi("الجزء التقديري", money(D.unc), (D.total ? E.pct(D.unc / D.total) : "0.0%") + " من التكلفة؛ يُستبدل بالفواتير") + "</div>";
    h += '<div class="cols2"><div class="panel"><h2>نطاقات</h2><div class="tbl"><table><tbody>' +
      tr("سعوديون محتسبون (عقد موثق)", E.fmtN(D.nit)) + tr("سعوديون توثيقهم غير معروف", E.fmtN(D.pend)) + tr("سعوديون عقودهم غير موثقة", E.fmtN(D.no)) +
      tr("فئات خاصة قبل الحد", E.fmtN(D.specRaw)) + tr("فئات خاصة بعد الحد – الأدنى (أشخاص كاملون)", E.fmtN(D.spec)) + tr("فئات خاصة بعد الحد – الأعلى (كسور من العدد الفعلي)", E.fmtN(D.spec_hi)) +
      tr("الوافدون المؤثرون", E.fmtN(D.exp)) + (D.qtr ? tr("فلسطينيون بوثيقة مصرية / بلوش", D.qtr + " من " + D.hc + (D.qOver ? " (تتجاوز 50%)" : "")) : "") +
      tr("الحد الأدنى للنسبة", E.pct(D.ratio_lo)) + tr("الحد الأعلى للنسبة", E.pct(D.ratio_hi)) +
      tr("سيناريو: الفئات الخاصة دون حد", E.pct(D.ratio_opt)) + tr("سيناريو متحفظ: الفئات الخاصة لا تُحتسب، والزوجان وافدان", E.pct(D.ratio_cons)) + "</tbody></table></div>" +
      '<p class="note">قوى هي المرجع النهائي وتحسب بالمتوسطات؛ هذه لقطة في تاريخ الاحتساب. ما لم يُنص عليه صراحة يُعرض نطاقًا، وتفصيله في «الأحكام والمصادر».</p></div>';
    h += '<div class="panel"><h2>التكلفة الشهرية</h2><div class="tbl"><table><tbody>' +
      tr("الأجر النقدي الثابت", E.fmt(D.cash)) + tr("العمولات", E.fmt(D.comm)) + tr("اشتراكات التأمينات على المنشأة", E.fmt(D.er)) + tr("الرسوم الحكومية (تقديري)", E.fmt(D.gov)) +
      tr("المزايا: طبي وسكن ونقل عيني وتذاكر (تقديري)", E.fmt(D.ben)) + tr("المخصصات: نهاية الخدمة والإجازة", E.fmt(D.prov)) +
      '<tr class="total"><td>الإجمالي</td><td class="n">' + money(D.total) + "</td></tr>" +
      tr("وفر محتمل إذا ثبت إعفاء الفئات الخاصة (غير مخصوم)", E.fmt(D.levy_saving)) + tr("التزام نهاية الخدمة المتراكم", E.fmt(D.eosbal)) +
      tr("فئة المقابل المالي المطبقة", D.rate ? E.fmt(D.rate) + " شهريًا" + (D.exShare ? " (إعفاء " + E.pct(D.exShare) + ")" : "") : "صفر") + "</tbody></table></div></div></div>";
    var all = [];
    c.employees.forEach(function (d, i) { var r = res.emps[d.code]; if (r) r.alerts.forEach(function (a) { all.push([a[0], (d.name || d.code) + ": " + a[1], i]); }); });
    all.sort(function (a, b) { return SEV[a[0]][1] - SEV[b[0]][1]; });
    var counts = {}; all.forEach(function (a) { counts[a[0]] = (counts[a[0]] || 0) + 1; });
    var shown = ui.alertFilter === "all" ? all : all.filter(function (a) { return a[0] === ui.alertFilter; });
    h += '<div class="panel"><h2>ما يحتاج انتباهًا</h2><div class="chips" role="group" aria-label="تصفية التنبيهات">' +
      chip("all", "الكل (" + all.length + ")") + ["bad", "pend", "warn", "info"].filter(function (k) { return counts[k]; }).map(function (k) { return chip(k, SEV[k][0] + " (" + counts[k] + ")"); }).join("") + "</div>" +
      (shown.length ? alertList(shown, true) : '<p class="hint">لا تنبيهات.</p>') + '<p class="note">اضغط على التنبيه لفتح الموظف.</p></div>';
    p.innerHTML = h;
    p.querySelectorAll(".chips button").forEach(function (b) { b.addEventListener("click", function () { ui.alertFilter = b.dataset.f; renderDash(res); }); });
    p.querySelectorAll("button.go").forEach(function (b) { b.addEventListener("click", function () { state.empIdx = +b.dataset.emp; state.tab = "emp"; state.step = "result"; render(); window.scrollTo(0, 0); }); });
  }
  function chip(k, l) { return '<button type="button" data-f="' + k + '" aria-pressed="' + (ui.alertFilter === k) + '">' + esc(l) + "</button>"; }
  function kpi(k, v, s) { return '<div class="kpi"><div class="k">' + k + '</div><div class="val">' + v + '</div><div class="s">' + esc(s) + "</div></div>"; }
  function tr(k, v) { return "<tr><td>" + esc(k) + '</td><td class="n">' + V(esc(v)) + "</td></tr>"; }
  // ---------- establishment settings
  function renderSettings() {
    var c = co(), p = $("p-set"), ro = !canManage(c);
    function inp(id, l, t, v, hint) { return '<label class="f" for="' + id + '"><span class="lt">' + l + '</span><input id="' + id + '" type="text"' + (ro ? " disabled" : "") + (t === "number" ? ' class="num" inputmode="decimal"' : t === "date" ? ' class="date" inputmode="numeric" placeholder="YYYY-MM-DD"' : "") + ' value="' + esc(v) + '">' + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</label>"; }
    function sel(id, l, o, v, hint) { return '<label class="f" for="' + id + '"><span class="lt">' + l + '</span><select id="' + id + '"' + (ro ? " disabled" : "") + ">" + o.map(function (x) { return "<option" + (x === v ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select>" + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</label>"; }
    var h = '<div class="panel"><h2>إعدادات المنشأة</h2><p class="hint">أي تعديل هنا يغيّر هذه المنشأة فقط. السياسة سارية من ' + V(esc(c.policyFrom)) + "." + (ro ? " التعديل لمدير المنشأة ومالك النظام." : "") + "</p>" +
      "<fieldset><legend>بيانات المنشأة</legend><div class=\"fields\">" + inp("c_name", "اسم المنشأة", "text", c.name) + inp("c_calc", "تاريخ الاحتساب", "date", c.calc, "سنة-شهر-يوم") +
      sel("c_ind", "ترخيص صناعي؟", ["لا", "نعم"], c.industrial ? "نعم" : "لا") + sel("c_small", "مؤهلة لإعفاء المنشآت الصغيرة؟", ["لا", "نعم"], c.smallExempt ? "نعم" : "لا", "9 عمال فأقل") +
      inp("c_excnt", "عدد الوافدين المعفيين (من قوى)", "number", c.exemptCount) + "</div></fieldset>" +
      "<fieldset><legend>سياسة المزايا</legend><div class=\"fields\">" +
      inp("c_m1", "التأمين الطبي السنوي – الدرجات 1–5", "number", c.policy.m1) + inp("c_m2", "التأمين الطبي السنوي – الدرجات 6–8", "number", c.policy.m2) + inp("c_m3", "التأمين الطبي السنوي – الدرجة 9 فأعلى", "number", c.policy.m3) +
      inp("c_hl", "السكن العيني الشهري – الدرجتان 1–2", "number", c.policy.hl) + inp("c_hh", "السكن العيني الشهري – الدرجة 3 فأعلى", "number", c.policy.hh) +
      inp("c_tk", "النقل العيني الشهري", "number", c.policy.tk) + inp("c_ticket", "التذكرة السنوية للوافد", "number", c.policy.ticket) +
      sel("c_leave", "مخصص الإجازة ضمن التكلفة؟", ["لا", "نعم"], c.policy.leave ? "نعم" : "لا") + inp("c_commx", "نسبة العمولات المستبعدة من المكافأة افتراضيًا", "number", c.policy.commx, "باتفاق مكتوب (م/86)، من 0 إلى 1") +
      "</div></fieldset></div>";
    p.innerHTML = h;
    if (ro) return;
    var map = { c_name: ["name"], c_calc: ["calc", "d"], c_ind: ["industrial", "b"], c_small: ["smallExempt", "b"], c_excnt: ["exemptCount", "n"], c_m1: ["m1", "p"], c_m2: ["m2", "p"], c_m3: ["m3", "p"],
      c_hl: ["hl", "p"], c_hh: ["hh", "p"], c_tk: ["tk", "p"], c_ticket: ["ticket", "p"], c_leave: ["leave", "pb"], c_commx: ["commx", "p"] };
    Object.keys(map).forEach(function (id) {
      var el = $(id), m = map[id];
      el.addEventListener("change", function () {
        var v = el.value.trim();
        if ((m[1] === "n" || m[1] === "p") && v !== "" && isNaN(+v.replace(/,/g, ""))) { el.classList.add("invalid"); return; }
        if (m[1] === "d" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.classList.add("invalid"); return; }
        el.classList.remove("invalid");
        if (m[1] === "b") c[m[0]] = v === "نعم"; else if (m[1] === "n") c[m[0]] = +v.replace(/,/g, "") || 0; else if (m[1] === "p") c.policy[m[0]] = +v.replace(/,/g, "") || 0;
        else if (m[1] === "pb") c.policy[m[0]] = v === "نعم" ? 1 : 0; else c[m[0]] = v;
        queue("c:" + c._id, function () { return DATA.updateCompany(c); });
        renderHeader();
      });
    });
  }

  // ---------- rules
  var DOMS = ["الكل", "نطاقات", "التأمينات", "الرسوم", "نظام العمل"];
  var STS = ["الكل", E.ST.CONF, E.ST.SEC, E.ST.PEND, E.ST.NEED];
  function renderRules() {
    var p = $("p-rules"), d = state.tab === "rules" && co().employees[state.empIdx], selCat = d ? d.cat : "";
    var h = '<div class="panel"><h2>الأحكام التي يطبقها النموذج</h2><p class="hint">«مؤكد رسميًا» من نص رسمي صريح، و«مرجّح» من مصدر ثانوي، و«بانتظار التحقق الرسمي» استنتاج أو تفصيل لم يُنص عليه فيُعرض أثره نطاقًا أو سيناريو، و«يحتاج تحقق» قيمة لم تُطابق بمصدر رسمي.</p>' +
      '<div class="tools"><input class="search" id="ruleQ" type="search" placeholder="بحث في الأحكام" value="' + esc(ui.ruleQ) + '" aria-label="بحث في الأحكام"></div>' +
      '<div class="chips" role="group" aria-label="المجال">' + DOMS.map(function (x) { return '<button type="button" data-d="' + x + '" aria-pressed="' + (ui.ruleDom === x) + '">' + x + "</button>"; }).join("") + "</div>" +
      '<div class="chips" role="group" aria-label="الحالة">' + STS.map(function (x) { return '<button type="button" data-s="' + x + '" aria-pressed="' + (ui.ruleSt === x) + '">' + x + "</button>"; }).join("") + "</div>" +
      '<div class="tbl"><table><thead><tr><th>الحكم</th><th class="n">القيمة</th><th>الحالة</th><th>المصدر</th><th>الرمز</th></tr></thead><tbody id="ruleBody"></tbody></table></div></div>';
    h += '<div class="panel" style="margin-top:18px"><h2>الفئات النظامية</h2>' + (selCat ? '<p class="hint">السطر المظلل فئة الموظف المختار: ' + esc(selCat) + "</p>" : "") +
      '<div class="tbl"><table><thead><tr><th>الفئة</th><th>الحالة</th><th>التأمينات</th><th>نطاقات</th><th>المقابل المالي</th><th>المهن المقصورة على السعوديين</th></tr></thead><tbody>';
    E.CATS.forEach(function (c) {
      var lv = c[5] ? (E.LEVY_PENDING.indexOf(c[0]) >= 0 ? "محمّل (الإعفاء غير مثبت)" : "محمّل") : c[0] === "سعودي" ? "لا ينطبق" : "لا ينطبق (لا إقامة)";
      h += '<tr class="' + (c[0] === selCat ? "hl" : "") + '"><td>' + esc(c[0]) + "</td><td>" + stBadge(c[10]) + "</td><td>" + (c[1] ? "معاشات + ساند + أخطار" : c[0] === "مواطن خليجي" ? "دولة الموطن + أخطار" : "أخطار 2%") + "</td><td>" + esc(c[11]) + "</td><td>" + lv + "</td><td>" + esc(c[12]) + "</td></tr>";
    });
    p.innerHTML = h + "</tbody></table></div></div>";
    $("ruleQ").addEventListener("input", function (e) { ui.ruleQ = e.target.value.trim(); ruleRows(); });
    p.querySelectorAll("[data-d]").forEach(function (b) { b.addEventListener("click", function () { ui.ruleDom = b.dataset.d; renderRules(); }); });
    p.querySelectorAll("[data-s]").forEach(function (b) { b.addEventListener("click", function () { ui.ruleSt = b.dataset.s; renderRules(); }); });
    ruleRows();
  }
  function ruleRows() {
    var q = ui.ruleQ, rows = Object.keys(E.RULES).filter(function (id) {
      var r = E.RULES[id];
      return (ui.ruleDom === "الكل" || r[6] === ui.ruleDom) && (ui.ruleSt === "الكل" || r[3] === ui.ruleSt) && (!q || r[0].indexOf(q) >= 0 || id.indexOf(q.toUpperCase()) >= 0);
    });
    $("ruleBody").innerHTML = rows.length ? rows.map(function (id) {
      var r = E.RULES[id], s = E.SRC[r[4]];
      return '<tr><td class="rule">' + esc(r[0]) + '</td><td class="n">' + (r[1] === null ? "—" : V(String(r[1])) + " " + esc(r[2])) + "</td><td>" + stBadge(r[3]) + '</td><td class="src">' +
        (s ? (s[2] ? '<a href="' + esc(s[2]) + '" target="_blank" rel="noopener">' + esc(s[0]) + "</a>" : esc(s[0])) : "سياسة المنشأة") + '</td><td class="code">' + id + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty">لا أحكام مطابقة.</td></tr>';
  }
  // ---------- Excel match
  var FIELDS = { contrib: "الأجر الخاضع", er: "اشتراك المنشأة", ee: "استقطاع الموظف", levy: "المقابل المالي", gov: "الإقامة والرخصة", med: "الطبي", hk: "السكن العيني", tk: "النقل العيني",
    eosb: "أساس المكافأة", eos: "مخصص المكافأة", eosbal: "الالتزام المتراكم", leave: "مخصص الإجازة", ticket: "التذكرة", total: "إجمالي التكلفة", unc: "منها تقديري", nitw: "وزن نطاقات",
    nit: "محتسب مؤكد", nitpend: "توثيق غير معروف", nitno: "غير موثق", nitspec: "فئة خاصة قبل الحد", nitopt: "سيناريو دون حد", expn: "وافد مؤثر", commgap: "فرق العمولة", f_gcc: "خليجي غير مكتمل" };
  var DFIELDS = { total: "إجمالي التكلفة", unc: "منها تقديري", nit: "سعوديون محتسبون", spec: "فئات خاصة – الأدنى", spec_hi: "فئات خاصة – الأعلى", exp: "الوافدون المؤثرون",
    exp_lo: "الوافدون – الحد الأدنى", ratio_lo: "النسبة الدنيا", ratio_hi: "النسبة العليا", ratio_opt: "سيناريو دون حد", ratio_cons: "السيناريو المتحفظ", levy_saving: "وفر المقابل المالي المحتمل" };
  var checkCache = null;
  function runCheck() {
    if (checkCache) return checkCache;
    var rows = [], cells = 0, bad = [];
    if (!FIX) return { rows: [], cells: 0, bad: [], pending: true };
    FIX.companies.forEach(function (c0) {
      var res = E.computeCompany(clone(c0)), n = 0, b = 0, dn = 0, db = 0;
      Object.keys(c0.expected).forEach(function (code) {
        var ex = c0.expected[code], got = res.emps[code];
        Object.keys(FIELDS).forEach(function (k) {
          if (ex[k] === null || ex[k] === undefined) return;
          n++; var g = got ? got[k] : NaN;
          if (!(Math.abs((g || 0) - (ex[k] || 0)) <= 0.011)) { b++; bad.push([c0.name, code, FIELDS[k], g, ex[k]]); }
        });
      });
      if (c0.expectedDash) Object.keys(DFIELDS).forEach(function (k) {
        if (c0.expectedDash[k] === undefined) return;
        dn++; var g = res.dash[k], ex = c0.expectedDash[k];
        if (!(Math.abs(g - ex) <= (k.indexOf("ratio") === 0 || k.indexOf("spec") === 0 || k.indexOf("exp") === 0 ? 1e-9 : 0.011))) { db++; bad.push([c0.name, "اللوحة", DFIELDS[k], g, ex]); }
      });
      cells += n + dn;
      rows.push([c0.name, Object.keys(c0.expected).length, n, b, dn, db, c0.testOnly]);
    });
    checkCache = { rows: rows, cells: cells, bad: bad };
    return checkCache;
  }
  function renderCheck() {
    var r = runCheck(), ok = !r.bad.length;
    var h = '<div class="panel"><div class="row between"><h2>مطابقة نتائج الويب مع ملف Excel</h2><span class="badge ' + (ok ? "b-ok" : "b-bad") + '">' + (ok ? "مطابق: " + r.cells + " قيمة" : r.bad.length + " فرق") + "</span></div>" +
      '<p class="hint">يعيد المتصفح حساب البيانات الوهمية الأصلية (fixture.json) بمحرك التطبيق نفسه، ويقارن كل قيمة بما حسبه ملف Excel بعد إعادة الحساب. الفرق المسموح أقل من هللة في المبالغ، وصفر في النسب والأعداد. منشآت «اختبار أحجام» لا تظهر في الشاشات؛ وُضعت لاختبار حدود الفئات الخاصة على أحجام مختلفة. هذه المقارنة لا تقرأ قاعدة البيانات، فتعديلاتك لا تدخلها.</p>' +
      '<div class="tbl"><table><thead><tr><th>المنشأة</th><th class="n">الموظفون</th><th class="n">قيم الموظفين</th><th class="n">فروق</th><th class="n">قيم اللوحة</th><th class="n">فروق</th></tr></thead><tbody>' +
      r.rows.map(function (x) { return "<tr><td>" + esc(x[0]) + '</td><td class="n">' + V(x[1]) + '</td><td class="n">' + V(x[2]) + '</td><td class="n ' + (x[3] ? "bad" : "ok") + '">' + V(x[3]) + '</td><td class="n">' + (x[4] ? V(x[4]) : "لا تُقارن*") + '</td><td class="n ' + (x[5] ? "bad" : "ok") + '">' + (x[4] ? V(x[5]) : "—") + "</td></tr>"; }).join("") +
      '</tbody></table></div><p class="note">* لوحة «متاجر الواحة» لا تُقارن: ملف Excel المحسوب يعرض لوحة منشأة أخرى، فلم تُستخرج قيم لوحتها. قيم موظفيها كلها مقارنة.</p>';
    if (r.bad.length) h += '<h3 class="sec">الفروق</h3><div class="tbl"><table><thead><tr><th>المنشأة</th><th>الموظف</th><th>الحقل</th><th class="n">الويب</th><th class="n">Excel</th></tr></thead><tbody>' + r.bad.map(function (x) { return "<tr><td>" + esc(x[0]) + "</td><td>" + esc(x[1]) + "</td><td>" + esc(x[2]) + '</td><td class="n">' + V(x[3]) + '</td><td class="n">' + V(x[4]) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    $("p-check").innerHTML = h + '<div class="row" style="margin-top:14px"><button class="btn" id="backFromCheck" type="button">رجوع</button></div></div>';
    $("backFromCheck").addEventListener("click", function () { state.tab = "dash"; render(); });
  }
  // ---------- render
  var lastRes = null;
  function renderLive() { lastRes = E.computeCompany(co()); renderEmpList(lastRes); renderResult(lastRes); }
  function renderAll() {
    RO = !canEdit(co()); $("appView").classList.toggle("ro", RO); $("addEmp").hidden = RO;
    lastRes = E.computeCompany(co()); renderEmpList(lastRes); renderForm(); renderResult(lastRes); renderStep();
  }
  function render() {
    if (!state.companies.length) { $("noCompany").hidden = false; renderTabs(); ["emp", "dash", "set", "rules", "check"].forEach(function (t) { $("p-" + t).hidden = true; }); return; }
    $("noCompany").hidden = true;
    if (state.coIdx >= state.companies.length) state.coIdx = 0;
    $("dummyNotice").hidden = !co().isDummy;
    renderHeader(); renderTabs();
    if (state.tab === "emp") renderAll();
    else if (state.tab === "dash") renderDash(E.computeCompany(co()));
    else if (state.tab === "set") renderSettings();
    else if (state.tab === "rules") renderRules();
    else renderCheck();
  }
  window.addEventListener("resize", function () { if (!$("appView").hidden) document.documentElement.style.setProperty("--hh", ($("hdr").offsetHeight + 12) + "px"); });
  if (!window.APP_CONFIG || !window.APP_CONFIG.url) { show("authView"); note("loginErr", "إعدادات الاتصال غير موجودة (config.js)"); return; }
  enter();
})();

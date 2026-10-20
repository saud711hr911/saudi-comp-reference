// Data layer: sign-in and storage through Supabase. Access control is not done here — the database's row-level
// security decides what each user can read and change; this file only maps rows to the shape engine.js reads.
var DATA = (function () {
  var cfg = window.APP_CONFIG || {};
  var sb = supabase.createClient(cfg.url, cfg.anonKey, { db: { schema: "app" }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  var FIELDS = ["code", "name", "cat", "nat", "title", "occ", "grade", "contract", "relied", "docqiwa", "hire", "scheme", "basic", "hcash", "hkind",
    "tcash", "tkind", "other", "comm", "commx", "commprev", "bonus", "gosiw"];
  var CAMEL = { gcc_er: "gccEr", gcc_ee: "gccEe" };

  function fail(error) { if (error) throw error; }
  function toEmp(r) {
    var o = { _id: r.id };
    FIELDS.forEach(function (f) { o[f] = r[f]; });
    Object.keys(CAMEL).forEach(function (k) { if (r[k] !== null && r[k] !== undefined) o[CAMEL[k]] = r[k]; });
    ["basic", "hcash", "tcash", "other", "comm", "commx", "commprev", "bonus", "gosiw", "gccEr", "gccEe"].forEach(function (k) { if (o[k] !== null && o[k] !== undefined) o[k] = +o[k]; });
    return o;
  }
  function fromEmp(e) {
    var r = {};
    FIELDS.forEach(function (f) { r[f] = e[f] === undefined ? null : e[f]; });
    if (r.hire === "") r.hire = null;
    r.gcc_er = e.gccEr === undefined ? null : e.gccEr; r.gcc_ee = e.gccEe === undefined ? null : e.gccEe;
    return r;
  }
  function toCo(c) {
    return { _id: c.id, id: c.code, name: c.name, activity: c.activity, calc: c.calc_date, industrial: c.industrial, smallExempt: c.small_exempt,
      exemptCount: c.exempt_count, policyFrom: c.policy_from, policy: c.policy, isDummy: c.is_dummy,
      employees: (c.employees || []).map(toEmp).sort(function (a, b) { return a.code < b.code ? -1 : 1; }) };
  }

  return {
    client: sb,
    onAuth: function (fn) { sb.auth.onAuthStateChange(function (ev, session) { fn(ev, session); }); },
    session: async function () { var r = await sb.auth.getSession(); fail(r.error); return r.data.session; },
    signIn: async function (email, password) { var r = await sb.auth.signInWithPassword({ email: email, password: password }); fail(r.error); return r.data.session; },
    signOut: async function () { await sb.auth.signOut(); },
    sendReset: async function (email) { var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); fail(r.error); },
    setPassword: async function (pw) { var r = await sb.auth.updateUser({ password: pw }); fail(r.error); },

    // Companies the database lets this user see (test-only size companies are for the Excel match, not the screens), with their employees.
    loadCompanies: async function () {
      var r = await sb.from("companies").select("*, employees(*)").eq("test_only", false).order("code");
      fail(r.error); return r.data.map(toCo);
    },
    // This user's role per company, and whether they are the system owner.
    roles: async function (userId) {
      var m = await sb.from("memberships").select("company_id, role").eq("user_id", userId); fail(m.error);
      var a = await sb.rpc("is_admin"); fail(a.error);
      var out = {}; m.data.forEach(function (x) { out[x.company_id] = x.role; });
      return { admin: !!a.data, byCompany: out };
    },
    createCompany: async function (name) {
      var r = await sb.from("companies").insert({ code: "CO" + Date.now().toString(36).toUpperCase(), name: name, calc_date: new Date().toISOString().slice(0, 10),
        policy_from: "2000-01-01", policy: ENGINE.DEFAULT_POLICY }).select("*, employees(*)").single();
      fail(r.error); return toCo(r.data);
    },
    updateCompany: async function (c) {
      var r = await sb.from("companies").update({ name: c.name, activity: c.activity, calc_date: c.calc, industrial: c.industrial, small_exempt: c.smallExempt,
        exempt_count: c.exemptCount, policy: c.policy }).eq("id", c._id).select("id");
      fail(r.error); if (!r.data.length) throw new Error("لا تملك صلاحية تعديل هذه المنشأة");
    },
    createEmployee: async function (c, e) {
      var row = fromEmp(e); row.company_id = c._id;
      var r = await sb.from("employees").insert(row).select().single(); fail(r.error); return toEmp(r.data);
    },
    updateEmployee: async function (e) {
      var r = await sb.from("employees").update(fromEmp(e)).eq("id", e._id).select("id");
      fail(r.error); if (!r.data.length) throw new Error("لا تملك صلاحية تعديل هذا الموظف");
    },
    deleteEmployee: async function (e) {
      var r = await sb.from("employees").delete().eq("id", e._id).select("id");
      fail(r.error); if (!r.data.length) throw new Error("لا تملك صلاحية حذف هذا الموظف");
    },
    // Dummy companies with the values the Excel workbook computed for them (fixture.json), for the in-app match check.
    loadFixture: async function () { var r = await fetch("fixture.json", { cache: "no-store" }); return r.ok ? r.json() : null; }
  };
})();

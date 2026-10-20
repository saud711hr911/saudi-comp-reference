# -*- coding: utf-8 -*-
"""Builds the web prototype's dummy data and the Excel results it must match.
Inputs: the engine data (محرك/companies.py, verify.py T5 rows) and recalculated Excel workbooks from verify.py.
Usage: python3 make_fixture.py <engine dir> <calc workbook with DEMO> <verify work dir> <out.json>
The five company-size tests (T10) are added as test-only companies: they feed the Excel match, not the screens."""
import sys, json, datetime as dt
ENG, RAW, WORK, OUT = sys.argv[1:5]
T5 = WORK + "/calc_t5_newco/t5_newco.xlsx"
sys.path.insert(0, ENG); sys.argv = ["verify.py", RAW, "/tmp/_unused"]
import openpyxl
from companies import EMPLOYEES, E_COLS
src = open(ENG + "/verify.py", encoding="utf-8").read()
ns = {}
exec(src[src.index("NEWCO_CALC ="):src.index("NEW_BANDS =")], {"date": dt.date, **__import__("datetime").__dict__}, ns)
NEW_EMPS = ns["NEW_EMPS"]
FIELDS = ["code", "name", "cat", "nat", "title", "occ", "grade", "contract", "relied", "docqiwa", "hire", "scheme", "basic", "hcash", "hkind",
          "tcash", "tkind", "other", "comm", "commx", "commprev", "bonus", "gosiw"]
def emp(e):
    d = dict(zip(E_COLS, e)); o = {}
    for f in FIELDS:
        v = d[f]
        if isinstance(v, (dt.date, dt.datetime)): v = v.isoformat()[:10]
        o[f] = v
    return o
KEYS = {"contrib": "الأجر الخاضع المعتمد (الكشف أولًا)", "er": "اشتراك المنشأة الشهري", "ee": "استقطاع الموظف", "levy": "المقابل المالي الشهري (تقديري)",
        "gov": "الإقامة ورخصة العمل (شهري، تقديري)", "med": "التأمين الطبي (شهري، تقديري)", "hk": "تكلفة السكن العيني (تقديري)", "tk": "تكلفة النقل العيني (تقديري)",
        "eosb": "أساس نهاية الخدمة (الأجر الفعلي بعد م/86)", "eos": "مخصص نهاية الخدمة الشهري", "eosbal": "التزام نهاية الخدمة المتراكم (أساس الإنهاء)",
        "leave": "مخصص الإجازة الشهري", "ticket": "التذكرة (شهري)", "total": "إجمالي التكلفة الشهرية", "unc": "منها بنود تقديرية",
        "nitw": "وزن نطاقات قبل شرط التوثيق", "nit": "المحتسب في نطاقات (عقد موثق مؤكد)", "nitpend": "توثيق العقد غير معروف", "nitno": "عقد غير موثق (مؤكد)",
        "nitspec": "فئة خاصة تُحتسب كسعودي (قبل الحد)", "nitopt": "المحتسب – سيناريو دون حد الفئات الخاصة", "expn": "وافد مؤثر (أساسي)",
        "commgap": "عمولة لا تظهر في الأجر المسجل (معلومة)", "f_gcc": "تنبيه: تكلفة غير مكتملة (معاشات دولة الموطن)"}
def excel(path, co):
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True)["13 الموظفون"]
    rows = list(ws.iter_rows(min_row=4, values_only=True)); col = {h: i for i, h in enumerate(rows[0])}
    return {r[1]: {k: r[col[h]] for k, h in KEYS.items()} for r in rows[1:] if r[0] == co}
def dash(path, labels):
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True)["01 لوحة المنشأة"]
    out = {}
    for row in ws.iter_rows(min_row=5, max_row=40, values_only=True):
        for i in (1, 4):
            if row[i] in labels: out[labels[row[i]]] = row[i + 1]
    return out
DL = {"إجمالي التكلفة الشهرية": "total", "منها تقديري (رسوم حكومية، طبي، سكن ونقل عيني، تذاكر)": "unc", "سعوديون محتسبون – عقد موثق مؤكد": "nit",
      "فئات خاصة كسعوديين بعد الحد – الأدنى (أشخاص كاملون من المحتسبين)": "spec", "فئات خاصة كسعوديين بعد الحد – الأعلى (كسور من العدد الفعلي)": "spec_hi",
      "الوافدون المؤثرون": "exp", "الوافدون المؤثرون – الحد الأدنى للنسبة": "exp_lo", "نسبة التوطين – الحد الأدنى (المؤكد فقط)": "ratio_lo",
      "نسبة التوطين – الحد الأعلى (إذا ثبت غير المعروف والتفسير الأوسع)": "ratio_hi", "سيناريو متفائل (الفئات الخاصة دون حد)": "ratio_opt",
      "سيناريو متحفظ (الفئات الخاصة لا تُحتسب، والزوجان وافدان)": "ratio_cons", "وفر محتمل إذا ثبت إعفاء الفئات الخاصة من المقابل المالي (غير مخصوم)": "levy_saving"}
NAMES = {"N01": "جيرالد سانتوس", "N02": "مارك ريّيس", "N03": "جون باوتيستا", "N04": "رافائيل كروز", "N05": "دانيال أوتينو", "N06": "فهد العتيبي", "N07": "محمود عبدالعال",
         "N08": "كريم السيد", "N09": "ريم القحطاني", "N10": "سلطان الحربي", "N11": "علي الدوسري (بحريني)", "N12": "سلمى بنعلي", "N13": "عمران خان", "N14": "نواف الشمري",
         "N15": "عبدالله المطيري", "N16": "تركي السبيعي", "D01": "خالد الزهراني", "D02": "أنيل كومار", "D03": "منى الغامدي", "D04": "شريف حسن", "D05": "بدر القرني",
         "D06": "هند العنزي", "D07": "ماريا جوزيف"}
def named(e):
    o = emp(e); o["name"] = NAMES.get(o["code"], o["name"]); return o
def size_cases():
    src_ = open(ENG + "/verify.py", encoding="utf-8").read()
    names = [l.split('("', 1)[1].split('"', 1)[0] for l in src_[src_.index("SIZES = ["):src_.index("for k_, (nm, mix, ex)")].splitlines() if l.strip().startswith('("')]
    out = []
    for k, nm in enumerate(names):
        path = f"{WORK}/calc_t10_size{k}/t10_size{k}.xlsx"
        ws = openpyxl.load_workbook(path, data_only=True, read_only=True)["13 الموظفون"]
        rows = [r[:len(E_COLS)] for r in ws.iter_rows(min_row=5, values_only=True) if r[0] == "SZ"]
        out.append({"id": f"SIZE{k}", "name": "اختبار أحجام: " + nm, "testOnly": True, "activity": "اختبار", "calc": "2026-10-18", "industrial": False, "smallExempt": False,
                    "exemptCount": 0, "policyFrom": "2026-01-01", "policy": {"hl": 0, "hh": 0, "tk": 0, "m1": 3000, "m2": 5000, "m3": 9000, "leave": 0, "ticket": 0, "commx": 0},
                    "employees": [emp(tuple(r)) for r in rows], "expected": excel(path, "SZ"), "expectedDash": dash(path, DL)})
    return out
fx = {"note": "بيانات وهمية بالكامل. القيم المتوقعة مأخوذة من ملف Excel بعد إعادة الحساب.",
      "companies": [
        {"id": "NEWCO", "name": "نوادي الريم الرياضية (تجريبية)", "activity": "مراكز وصالات رياضية", "calc": "2026-12-01", "industrial": False, "smallExempt": False, "exemptCount": 0,
         "policyFrom": "2026-01-01", "policy": {"hl": 600, "hh": 900, "tk": 150, "m1": 4000, "m2": 6000, "m3": 10000, "leave": 1, "ticket": 1200, "commx": 1.0},
         "employees": [named(e) for e in NEW_EMPS], "expected": excel(T5, "NEWCO"), "expectedDash": dash(T5, DL)},
        {"id": "DEMO", "name": "متاجر الواحة (تجريبية)", "activity": "تجارة تجزئة", "calc": "2026-10-18", "industrial": False, "smallExempt": True, "exemptCount": 2,
         "policyFrom": "2026-01-01", "policy": {"hl": 400, "hh": 0, "tk": 0, "m1": 2500, "m2": 5000, "m3": 9000, "leave": 0, "ticket": 0, "commx": 0},
         "employees": [named(e) for e in EMPLOYEES if e[0] == "DEMO"], "expected": excel(RAW, "DEMO"), "expectedDash": None}] + size_cases()}
json.dump(fx, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
print("companies:", len(fx["companies"]), "employees:", sum(len(c["employees"]) for c in fx["companies"]),
      "dash values:", sum(len(c["expectedDash"] or {}) for c in fx["companies"]))

#!/usr/bin/env bash
# يشغّل اختبارات قاعدة البيانات محليًا على PostgreSQL مؤقت (لا خدمة خارجية، ولا بيانات حقيقية):
#   1) يبني القاعدة: محاكاة Supabase ثم schema.sql ثم البيانات الوهمية.
#   2) اختبارات العزل والصلاحيات (isolation-tests.sql).
#   3) يقرأ المنشآت من القاعدة بصلاحية كل مستخدم ويطابقها مع Excel عبر المحرك نفسه (engine.js).
# الاستخدام: bash run-tests.sh [ملف النتيجة]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/نتيجة-اختبارات-القاعدة.txt}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$PGBIN/postgres" ] || { echo "PostgreSQL غير مثبت"; exit 2; }
TMP="$(mktemp -d)"; chmod 777 "$TMP"
AS=""; [ "$(id -u)" = 0 ] && AS="runuser -u postgres --"
cleanup() { $AS "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
[ -n "${KEEP:-}" ] || trap cleanup EXIT
$AS "$PGBIN/initdb" -D "$TMP/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
$AS "$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses='' -p 54329" -l "$TMP/log" -w start >/dev/null
PSQL=(psql -h "$TMP" -p 54329 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

cp "$HERE"/*.sql "$TMP/"; chmod 644 "$TMP"/*.sql
node "$HERE/dummy.cjs" seed > "$TMP/seed.sql"
"${PSQL[@]}" -f "$TMP/supabase-local.sql"
"${PSQL[@]}" -f "$TMP/schema.sql"
"${PSQL[@]}" -f "$TMP/seed.sql"

{
  echo "اختبارات قاعدة البيانات — $(date -u +%Y-%m-%d) — PostgreSQL $("$PGBIN/postgres" --version | awk '{print $3}') محليًا، بيانات وهمية"
  echo
  echo "## 1) العزل والصلاحيات"
  "${PSQL[@]}" -f "$TMP/isolation-tests.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //' | grep -v '^ *$' | grep -v '^ *test\.\|^-\|^(1 row)\|^ *login\|^ *sees\|^ *changes\|^ *refused'
} > "$TMP/iso.txt" || true
PASS=$(grep -c '^PASS' "$TMP/iso.txt" || true); FAIL=$(grep -c '^FAIL' "$TMP/iso.txt" || true)

# المطابقة بعد الحفظ في القاعدة: يقرأ كل مستخدم ما تسمح له الصلاحيات برؤيته فقط.
read_as() {
  "${PSQL[@]}" -At -c "set role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$1')::text, false);
    select coalesce(jsonb_agg(to_jsonb(c) order by c.code), '[]') from (
      select co.*, (select jsonb_agg(to_jsonb(e) order by e.code) from app.employees e where e.company_id = co.id) employees
      from app.companies co) c;" | tail -1 > "$TMP/$2.json"
}
{
  cat "$TMP/iso.txt"
  echo "اختبارات العزل: $PASS نجح، $FAIL أخفق"
  echo
  echo "## 2) المحرك على البيانات المقروءة من القاعدة مقابل Excel"
  RT=0
  for u in "admin:00000000-0000-0000-0000-0000000000a1:مالك النظام (كل المنشآت)" "mgrA:00000000-0000-0000-0000-0000000000b1:مدير (أ)" "mgrB:00000000-0000-0000-0000-0000000000c1:مدير (ب)"; do
    IFS=: read -r key id label <<< "$u"
    read_as "$id" "$key"
    echo "- $label: $(node "$HERE/dummy.cjs" check "$TMP/$key.json" | tr '\n' ' ')" || RT=1
    node "$HERE/dummy.cjs" check "$TMP/$key.json" >/dev/null || RT=1
  done
  echo
  [ "$FAIL" = 0 ] && [ "$PASS" -gt 0 ] && [ "$RT" = 0 ] && echo "النتيجة: ناجحة" || echo "النتيجة: فيها إخفاق"
} > "$OUT"
cat "$OUT"
grep -q '^النتيجة: ناجحة' "$OUT"

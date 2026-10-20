-- قاعدة بيانات تطبيق المرجع السعودي للأجور (PostgreSQL، متوافقة مع Supabase).
-- العزل بين المنشآت مفروض بسياسات الصفوف (RLS) داخل القاعدة، لا بفلترة الشاشات.
-- auth.uid() والدوران anon وauthenticated يوفرها Supabase؛ محليًا يوفرها supabase-local.sql.
-- المرحلة 0: بيانات وهمية فقط. القيد companies_dummy_only يرفض أي منشأة حقيقية حتى الموافقة 3.

create schema if not exists app;

-- ===== الجداول =====

-- مالك النظام: يرى كل المنشآت ويضيفها ويدير مستخدميها.
create table app.admins (
  user_id uuid primary key
);

create table app.companies (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,            -- رمز داخلي (مثل NEWCO)
  name          text not null,
  activity      text,
  calc_date     date not null,                   -- تاريخ الاحتساب
  industrial    boolean not null default false,
  small_exempt  boolean not null default false,  -- إعفاء المنشأة الصغيرة من المقابل المالي
  exempt_count  integer not null default 0,
  policy_from   date,
  policy        jsonb not null default '{}',     -- سياسة المزايا (السكن والنقل والطبي والإجازة والتذكرة والعمولة)
  test_only     boolean not null default false,  -- منشآت اختبار الأحجام: للمطابقة فقط، لا تظهر في الشاشات
  is_dummy      boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  constraint companies_dummy_only check (is_dummy)  -- يُزال عند الموافقة 3 فقط
);

create table app.memberships (
  company_id  uuid not null references app.companies(id) on delete cascade,
  user_id     uuid not null,
  role        text not null check (role in ('manager', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- الموظف: الحقول نفسها التي يقرؤها المحرك (engine.js). النص الفارغ يختلف عن null عند المحرك، فيُحفظ كما هو.
create table app.employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references app.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  cat         text not null,   -- الفئة النظامية: سعودي، مقيم، خليجي، ابن مواطنة...
  nat         text,
  title       text,
  occ         text,            -- المهنة في قوى
  grade       text,
  contract    text,            -- نوع الدوام
  relied      text,            -- معتمد في نطاقات المنشأة
  docqiwa     text,            -- العقد موثق في قوى
  hire        date,
  scheme      text,            -- نظام التأمينات: قديم أو جديد
  basic       numeric(12,2),
  hcash       numeric(12,2),
  hkind       text,
  tcash       numeric(12,2),
  tkind       text,
  other       numeric(12,2),
  comm        numeric(12,2),
  commx       numeric(12,2),
  commprev    numeric(12,2),
  bonus       numeric(12,2),
  gosiw       numeric(12,2),   -- الأجر المسجل في التأمينات (المصدر الأول)
  gcc_er      numeric(8,4),    -- المواطن الخليجي: نسبة معاشات دولة الموطن على المنشأة
  gcc_ee      numeric(8,4),    -- وعلى الموظف
  source      text not null default 'manual' check (source in ('gosi', 'qiwa', 'manual')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  unique (company_id, code)
);

-- كل استيراد يمر بمعاينة قبل الحفظ.
create table app.imports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references app.companies(id) on delete cascade,
  kind        text not null check (kind in ('gosi', 'qiwa')),
  file_name   text,
  row_count   integer,
  status      text not null default 'preview' check (status in ('preview', 'applied', 'discarded')),
  summary     jsonb,          -- الجديد والمتغير والمفقود
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- سجل التعديلات: يكتبه المشغّل وحده، ولا يُعدَّل ولا يُحذف.
create table app.audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null,
  table_name  text not null,
  row_id      text not null,
  action      text not null,
  before      jsonb,
  after       jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);

create index on app.memberships (user_id);
create index on app.employees (company_id);
create index on app.imports (company_id);
create index on app.audit_log (company_id, at);

-- ===== دوال الصلاحية =====
-- security definer: تقرأ العضويات دون أن تمر بسياساتها (يمنع الحلقة)، ومسار البحث ثابت.

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.admins where user_id = auth.uid());
$$;

create function app.has_role(cid uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin() or exists (
    select 1 from app.memberships m
    where m.company_id = cid and m.user_id = auth.uid() and m.role = any (roles));
$$;

create function app.write_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  cid uuid := coalesce(n->>'company_id', o->>'company_id', n->>'id', o->>'id')::uuid;
begin
  insert into app.audit_log (company_id, table_name, row_id, action, before, after, actor)
  values (cid, tg_table_name, coalesce(n->>'id', o->>'id', (n->>'company_id') || ':' || (n->>'user_id'), (o->>'company_id') || ':' || (o->>'user_id')),
          lower(tg_op), o, n, auth.uid());
  return coalesce(new, old);
end $$;

create function app.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;

create trigger employees_touch before update on app.employees for each row execute function app.touch();
create trigger companies_audit   after insert or update or delete on app.companies   for each row execute function app.write_audit();
create trigger memberships_audit after insert or update or delete on app.memberships for each row execute function app.write_audit();
create trigger employees_audit   after insert or update or delete on app.employees   for each row execute function app.write_audit();
create trigger imports_audit     after insert or update or delete on app.imports     for each row execute function app.write_audit();

-- ===== الصلاحيات وسياسات الصفوف =====

alter table app.admins      enable row level security;
alter table app.companies   enable row level security;
alter table app.memberships enable row level security;
alter table app.employees   enable row level security;
alter table app.imports     enable row level security;
alter table app.audit_log   enable row level security;

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon;
grant usage on schema app to authenticated;
grant execute on function app.is_admin(), app.has_role(uuid, text[]) to authenticated;
grant select, insert, update, delete on app.companies, app.memberships, app.employees, app.imports to authenticated;
grant select on app.audit_log, app.admins to authenticated;

-- مالك النظام: يرى نفسه فقط، ولا تُعدَّل القائمة إلا من قاعدة البيانات مباشرة.
create policy admins_self on app.admins for select to authenticated using (user_id = auth.uid());

-- المنشآت: يراها أعضاؤها، ويعدّلها مديرها، وينشئها ويحذفها مالك النظام.
create policy companies_read   on app.companies for select to authenticated using (app.has_role(id, array['manager','editor','viewer']));
create policy companies_insert on app.companies for insert to authenticated with check (app.is_admin());
create policy companies_update on app.companies for update to authenticated using (app.has_role(id, array['manager'])) with check (app.has_role(id, array['manager']));
create policy companies_delete on app.companies for delete to authenticated using (app.is_admin());

-- العضويات: يرى المستخدم عضويته، ويرى المدير أعضاء منشأته ويديرهم. لا يغيّر أحد دوره بنفسه إلا مالك النظام.
create policy memberships_read   on app.memberships for select to authenticated using (user_id = auth.uid() or app.has_role(company_id, array['manager']));
create policy memberships_insert on app.memberships for insert to authenticated with check (app.has_role(company_id, array['manager']) and (user_id <> auth.uid() or app.is_admin()));
create policy memberships_update on app.memberships for update to authenticated
  using (app.has_role(company_id, array['manager']) and (user_id <> auth.uid() or app.is_admin()))
  with check (app.has_role(company_id, array['manager']) and (user_id <> auth.uid() or app.is_admin()));
create policy memberships_delete on app.memberships for delete to authenticated using (app.has_role(company_id, array['manager']) and (user_id <> auth.uid() or app.is_admin()));

-- الموظفون والاستيراد: القراءة لكل أعضاء المنشأة، والكتابة للمدير والمحرر. شرط with check يمنع نقل صف إلى منشأة أخرى.
create policy employees_read   on app.employees for select to authenticated using (app.has_role(company_id, array['manager','editor','viewer']));
create policy employees_insert on app.employees for insert to authenticated with check (app.has_role(company_id, array['manager','editor']));
create policy employees_update on app.employees for update to authenticated using (app.has_role(company_id, array['manager','editor'])) with check (app.has_role(company_id, array['manager','editor']));
create policy employees_delete on app.employees for delete to authenticated using (app.has_role(company_id, array['manager','editor']));

create policy imports_read   on app.imports for select to authenticated using (app.has_role(company_id, array['manager','editor','viewer']));
create policy imports_insert on app.imports for insert to authenticated with check (app.has_role(company_id, array['manager','editor']));
create policy imports_update on app.imports for update to authenticated using (app.has_role(company_id, array['manager','editor'])) with check (app.has_role(company_id, array['manager','editor']));
create policy imports_delete on app.imports for delete to authenticated using (app.has_role(company_id, array['manager','editor']));

-- سجل التعديلات: قراءة لمدير المنشأة ومالك النظام فقط. لا سياسة كتابة، فلا يكتب فيه إلا المشغّل.
create policy audit_read on app.audit_log for select to authenticated using (app.has_role(company_id, array['manager']));

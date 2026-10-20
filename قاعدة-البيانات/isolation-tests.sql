-- اختبارات عزل المنشآت والصلاحيات. كل اختبار يطبع سطرًا يبدأ بـ PASS أو FAIL.
-- المنشأة (أ) = NEWCO ولها مدير ومحرر ومطّلع. المنشأة (ب) = DEMO ولها مدير. ومستخدم بلا عضوية، وزائر دون دخول.
-- كل محاولة تُنفَّذ بدور authenticated أو anon كما يفعل Supabase، لا بصلاحية المشرف.
\set QUIET on
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema test;
grant usage on schema test to anon, authenticated;

-- الدخول بمستخدم: يضع رمز الدخول كما يضعه Supabase لكل طلب.
create function test.login(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); $$;
-- عدد الصفوف التي يراها المستخدم من استعلام.
create function test.sees(label text, query text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', query) into n;
  raise notice '% | % (المتوقع %، الفعلي %)', case when n = expected then 'PASS' else 'FAIL' end, label, expected, n;
exception when others then raise notice 'FAIL | % (خطأ غير متوقع: % %)', label, sqlstate, sqlerrm;
end $$;
-- عدد الصفوف التي يغيّرها أمر تعديل أو حذف (0 = لم يصل إلى الصف).
create function test.changes(label text, stmt text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  raise notice '% | % (المتوقع %، الفعلي %)', case when n = expected then 'PASS' else 'FAIL' end, label, expected, n;
exception when others then raise notice 'FAIL | % (خطأ غير متوقع: % %)', label, sqlstate, sqlerrm;
end $$;
-- أمر يجب أن يُرفض بخطأ محدد: 42501 رفض صلاحية أو سياسة صفوف، 23514 مخالفة قيد.
create function test.refused(label text, stmt text, state text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL | % (نُفّذ ولم يُرفض)', label;
exception when others then
  raise notice '% | % (رُفض: %)', case when sqlstate = state then 'PASS' else 'FAIL' end, label, sqlstate;
end $$;
grant execute on all functions in schema test to anon, authenticated;

-- معرّفات المنشأتين وموظف من كل منهما، تُقرأ بصلاحية المشرف قبل الاختبار (كأن المهاجم يعرفها).
select id as a from app.companies where code = 'NEWCO' \gset
select id as b from app.companies where code = 'DEMO' \gset
select id as ea from app.employees where company_id = :'a' order by code limit 1 \gset
select id as eb from app.employees where company_id = :'b' order by code limit 1 \gset
select count(*) as na from app.employees where company_id = :'a' \gset
select count(*) as nb from app.employees where company_id = :'b' \gset
select count(*) as nall from app.employees \gset
select count(*) as ncos from app.companies \gset

\echo '== زائر دون تسجيل دخول'
set role anon;
select test.refused('الزائر لا يقرأ المنشآت', 'select * from app.companies', '42501');
select test.refused('الزائر لا يقرأ الموظفين', 'select * from app.employees', '42501');
select test.refused('الزائر لا يضيف موظفًا', $$insert into app.employees (company_id, code, name, cat) values ('$$ || :'a' || $$', 'X1', 'س', 'سعودي')$$, '42501');
reset role;

\echo '== مستخدم مسجل بلا عضوية'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000d1');
select test.sees('لا يرى أي منشأة', 'select * from app.companies', 0);
select test.sees('لا يرى أي موظف', 'select * from app.employees', 0);
select test.sees('لا يرى موظفًا ولو عرف معرّفه', $$select * from app.employees where id = '$$ || :'ea' || $$'$$, 0);
select test.refused('لا يضيف نفسه عضوًا في منشأة', $$insert into app.memberships values ('$$ || :'a' || $$', '00000000-0000-0000-0000-0000000000d1', 'manager')$$, '42501');
select test.refused('لا ينشئ منشأة', $$insert into app.companies (code, name, calc_date) values ('ZZ', 'منشأة', '2026-10-20')$$, '42501');
select test.sees('لا يرى سجل التعديلات', 'select * from app.audit_log', 0);
reset role;

\echo '== مطّلع المنشأة (أ)'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000b3');
select test.sees('يرى منشأته فقط', 'select * from app.companies', 1);
select test.sees('يرى موظفي منشأته كلهم', $$select * from app.employees where company_id = '$$ || :'a' || $$'$$, :na);
select test.sees('لا يرى موظفي المنشأة (ب)', $$select * from app.employees where company_id = '$$ || :'b' || $$'$$, 0);
select test.changes('لا يعدّل موظفًا في منشأته', $$update app.employees set basic = 1 where id = '$$ || :'ea' || $$'$$, 0);
select test.changes('لا يحذف موظفًا في منشأته', $$delete from app.employees where id = '$$ || :'ea' || $$'$$, 0);
select test.refused('لا يضيف موظفًا', $$insert into app.employees (company_id, code, name, cat) values ('$$ || :'a' || $$', 'X2', 'س', 'سعودي')$$, '42501');
select test.changes('لا يرفع دوره إلى مدير', $$update app.memberships set role = 'manager' where user_id = '00000000-0000-0000-0000-0000000000b3'$$, 0);
select test.sees('لا يرى سجل التعديلات', 'select * from app.audit_log', 0);
reset role;

\echo '== محرر المنشأة (أ)'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000b2');
select test.changes('يعدّل موظفًا في منشأته', $$update app.employees set title = title where id = '$$ || :'ea' || $$'$$, 1);
select test.changes('يضيف موظفًا في منشأته', $$insert into app.employees (company_id, code, name, cat) values ('$$ || :'a' || $$', 'X3', 'موظف تجريبي', 'سعودي')$$, 1);
select test.changes('يحذف الموظف الذي أضافه', $$delete from app.employees where company_id = '$$ || :'a' || $$' and code = 'X3'$$, 1);
select test.refused('لا يضيف موظفًا في المنشأة (ب)', $$insert into app.employees (company_id, code, name, cat) values ('$$ || :'b' || $$', 'X4', 'س', 'سعودي')$$, '42501');
select test.changes('لا يعدّل موظفًا في (ب) ولو عرف معرّفه', $$update app.employees set basic = 1 where id = '$$ || :'eb' || $$'$$, 0);
select test.changes('لا يحذف موظفًا في (ب)', $$delete from app.employees where id = '$$ || :'eb' || $$'$$, 0);
select test.refused('لا ينقل موظفًا من منشأته إلى (ب)', $$update app.employees set company_id = '$$ || :'b' || $$' where id = '$$ || :'ea' || $$'$$, '42501');
select test.refused('لا يضيف استيرادًا في (ب)', $$insert into app.imports (company_id, kind) values ('$$ || :'b' || $$', 'gosi')$$, '42501');
select test.changes('يضيف استيرادًا (معاينة) في منشأته', $$insert into app.imports (company_id, kind, file_name) values ('$$ || :'a' || $$', 'gosi', 'كشف-وهمي.xlsx')$$, 1);
select test.refused('لا يضيف عضوًا', $$insert into app.memberships values ('$$ || :'a' || $$', '00000000-0000-0000-0000-0000000000d1', 'viewer')$$, '42501');
select test.changes('لا يعدّل بيانات المنشأة', $$update app.companies set name = 'تغيير' where id = '$$ || :'a' || $$'$$, 0);
reset role;

\echo '== مدير المنشأة (أ)'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000b1');
select test.sees('يرى منشأته فقط', 'select * from app.companies', 1);
select test.sees('يرى أعضاء منشأته', 'select * from app.memberships', 3);
select test.changes('يدعو مطّلعًا إلى منشأته', $$insert into app.memberships values ('$$ || :'a' || $$', '00000000-0000-0000-0000-0000000000d1', 'viewer')$$, 1);
select test.changes('يزيل العضو الذي دعاه', $$delete from app.memberships where company_id = '$$ || :'a' || $$' and user_id = '00000000-0000-0000-0000-0000000000d1'$$, 1);
select test.refused('لا يضيف عضوًا في (ب)', $$insert into app.memberships values ('$$ || :'b' || $$', '00000000-0000-0000-0000-0000000000b1', 'manager')$$, '42501');
select test.refused('لا ينقل عضوية من منشأته إلى (ب)', $$update app.memberships set company_id = '$$ || :'b' || $$' where user_id = '00000000-0000-0000-0000-0000000000b3'$$, '42501');
select test.changes('لا يغيّر دوره بنفسه', $$update app.memberships set role = 'viewer' where user_id = '00000000-0000-0000-0000-0000000000b1'$$, 0);
select test.changes('يعدّل بيانات منشأته', $$update app.companies set activity = activity where id = '$$ || :'a' || $$'$$, 1);
select test.changes('لا يعدّل بيانات (ب)', $$update app.companies set name = 'تغيير' where id = '$$ || :'b' || $$'$$, 0);
select test.changes('لا يحذف منشأته', $$delete from app.companies where id = '$$ || :'a' || $$'$$, 0);
reset role; select count(*) as auda from app.audit_log where company_id = :'a' \gset
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000b1');
select test.sees('يرى سجل تعديلات منشأته كاملًا', $$select * from app.audit_log where company_id = '$$ || :'a' || $$'$$, :auda);
select test.sees('السجل يحفظ من عدّل ومتى (تعديلات المحرر)', $$select * from app.audit_log where company_id = '$$ || :'a' || $$' and actor = '00000000-0000-0000-0000-0000000000b2'$$, 4);
select test.sees('لا يرى سجل تعديلات (ب)', $$select * from app.audit_log where company_id <> '$$ || :'a' || $$'$$, 0);
select test.refused('لا يعدّل سجل التعديلات', 'update app.audit_log set action = $$x$$', '42501');
select test.refused('لا يحذف من سجل التعديلات', 'delete from app.audit_log', '42501');
select test.refused('لا يكتب في سجل التعديلات مباشرة', $$insert into app.audit_log (company_id, table_name, row_id, action) values ('$$ || :'a' || $$', 'x', 'x', 'x')$$, '42501');
select test.refused('لا يضيف نفسه مالكًا للنظام', $$insert into app.admins values ('00000000-0000-0000-0000-0000000000b1')$$, '42501');
reset role;

\echo '== مدير المنشأة (ب)'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000c1');
select test.sees('يرى منشأته فقط', 'select * from app.companies', 1);
select test.sees('يرى موظفي منشأته فقط', 'select * from app.employees', :nb);
select test.sees('لا يرى استيراد (أ)', 'select * from app.imports', 0);
select test.sees('لا يرى أعضاء (أ)', $$select * from app.memberships where company_id = '$$ || :'a' || $$'$$, 0);
reset role;

\echo '== مالك النظام'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000a1');
select test.sees('يرى كل المنشآت', 'select * from app.companies', :ncos);
select test.sees('يرى كل الموظفين', 'select * from app.employees', :nall);
select test.refused('حارس البيانات الوهمية: لا تُضاف منشأة حقيقية في هذه المرحلة', $$insert into app.companies (code, name, calc_date, is_dummy) values ('REAL', 'منشأة حقيقية', '2026-10-20', false)$$, '23514');
select test.refused('حارس البيانات الوهمية: لا تتحول منشأة وهمية إلى حقيقية', $$update app.companies set is_dummy = false where id = '$$ || :'a' || $$'$$, '23514');
reset role;

\echo '== دوال الصلاحية لا تُخدع'
set role authenticated; select test.login('00000000-0000-0000-0000-0000000000b2');
select test.sees('has_role لمحرر (أ) على (ب) = لا', $$select 1 where app.has_role('$$ || :'b' || $$', array['manager','editor','viewer'])$$, 0);
select test.sees('is_admin لمحرر (أ) = لا', 'select 1 where app.is_admin()', 0);
select test.refused('لا يستدعي مشغّل السجل مباشرة', 'select app.write_audit()', '42501');
reset role;

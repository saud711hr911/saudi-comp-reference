-- محاكاة محلية لما يوفره Supabase: الدوران anon وauthenticated، وauth.uid() من رمز الدخول.
-- للاختبار المحلي فقط؛ لا يُشغَّل على Supabase نفسه لأنه يوفرها.
-- تعريف auth.uid() هنا هو تعريف Supabase نفسه: يقرأ sub من request.jwt.claims.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

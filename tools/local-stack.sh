#!/usr/bin/env bash
# A local Supabase-like stack for development and rehearsal tests, made of the same components Supabase runs:
# PostgreSQL + Supabase Auth (GoTrue) + PostgREST, behind a small gateway (tools/gateway.cjs) that also serves dist/.
# Dummy data only. Nothing leaves this machine.
#
#   bash tools/local-stack.sh start    start the stack, apply the schema and seed dummy data; writes $STATE/env
#   bash tools/local-stack.sh stop
#
# Binaries are pinned and checked by SHA-256 before use.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${CACHE:-$HOME/.cache/saudi-comp-stack}"
STATE="${STATE:-/tmp/saudi-comp-stack}"
PG_PORT=54329 AUTH_PORT=9999 REST_PORT=3000 GW_PORT="${GW_PORT:-54321}"
PGRST_URL=https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
PGRST_SHA=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c
AUTH_URL=https://github.com/supabase/auth/releases/download/v2.195.0/auth-v2.195.0-x86.tar.gz
AUTH_SHA=26256174b8f30ddcecadd41e392cb73132b837226ec764f8a7b45f7d78a1c8d5
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
AS=""; [ "$(id -u)" = 0 ] && AS="runuser -u postgres --"

fetch() { # url sha out
  [ -f "$3" ] && echo "$2  $3" | sha256sum -c --status && return 0
  curl -sSL -o "$3.part" "$1"
  echo "$2  $3.part" | sha256sum -c --status || { echo "checksum mismatch: $1"; rm -f "$3.part"; exit 1; }
  mv "$3.part" "$3"
}

stop() {
  [ -d "$STATE" ] || return 0
  for p in gateway auth rest; do [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null || true; done
  [ -d "$STATE/pg" ] && $AS "$PGBIN/pg_ctl" -D "$STATE/pg" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$STATE"
}

start() {
  stop
  mkdir -p "$CACHE" "$STATE"; chmod 777 "$STATE"
  fetch "$PGRST_URL" "$PGRST_SHA" "$CACHE/postgrest.tar.xz"
  fetch "$AUTH_URL" "$AUTH_SHA" "$CACHE/auth.tar.gz"
  [ -x "$CACHE/postgrest" ] || tar xJf "$CACHE/postgrest.tar.xz" -C "$CACHE"
  [ -x "$CACHE/auth/auth" ] || { mkdir -p "$CACHE/auth"; tar xzf "$CACHE/auth.tar.gz" -C "$CACHE/auth"; }

  local secret dbpw; secret="$(head -c 32 /dev/urandom | base64 | tr -d '/+=')"; dbpw="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
  echo "$dbpw" > "$STATE/pw"; chmod 644 "$STATE/pw"
  $AS "$PGBIN/initdb" -D "$STATE/pg" -U postgres -E UTF8 --locale=C.UTF-8 -A scram-sha-256 --pwfile="$STATE/pw" >/dev/null
  rm -f "$STATE/pw"
  $AS "$PGBIN/pg_ctl" -D "$STATE/pg" -o "-k $STATE -c listen_addresses=127.0.0.1 -p $PG_PORT" -l "$STATE/pg.log" -w start >/dev/null
  export PGPASSWORD="$dbpw"
  local PSQL=(psql -h 127.0.0.1 -p $PG_PORT -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

  # Roles as Supabase defines them.
  "${PSQL[@]}" <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password '$dbpw';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password '$dbpw';
create schema auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;
grant create on database postgres to supabase_auth_admin;
SQL

  # Supabase Auth: runs its own migrations, creating auth.users and auth.uid().
  ( cd "$CACHE/auth" && env -i PATH="$PATH" HOME="$HOME" \
      GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:$dbpw@127.0.0.1:$PG_PORT/postgres?search_path=auth" \
      GOTRUE_DB_MIGRATIONS_PATH="$CACHE/auth/migrations" GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT \
      API_EXTERNAL_URL="http://127.0.0.1:$GW_PORT/auth/v1" GOTRUE_SITE_URL="http://127.0.0.1:$GW_PORT" \
      GOTRUE_JWT_SECRET="$secret" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
      GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_LOG_LEVEL=warn \
      nohup ./auth > "$STATE/auth.log" 2>&1 & echo $! > "$STATE/auth.pid" )
  for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null && break; sleep 0.5; done
  curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null || { cat "$STATE/auth.log"; exit 1; }

  "${PSQL[@]}" -f "$ROOT/قاعدة-البيانات/schema.sql"
  node "$ROOT/قاعدة-البيانات/dummy.cjs" seed --no-users | "${PSQL[@]}"

  cat > "$STATE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$dbpw@127.0.0.1:$PG_PORT/postgres"
db-schemas = "app"
db-anon-role = "anon"
jwt-secret = "$secret"
jwt-aud = "authenticated"
server-host = "127.0.0.1"
server-port = $REST_PORT
log-level = "warn"
CONF
  nohup "$CACHE/postgrest" "$STATE/postgrest.conf" > "$STATE/rest.log" 2>&1 & echo $! > "$STATE/rest.pid"
  for i in $(seq 1 40); do curl -s "http://127.0.0.1:$REST_PORT/" >/dev/null && break; sleep 0.25; done

  local keys; keys="$(node -e '
    const c=require("crypto"),s=process.argv[1],b=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
    const t=r=>{const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"local",iat:1700000000,exp:2000000000});return h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url")};
    console.log(t("anon")+" "+t("service_role"))' "$secret")"
  cat > "$STATE/env" <<ENV
SB_URL=http://127.0.0.1:$GW_PORT
SB_ANON_KEY=${keys% *}
SB_SERVICE_KEY=${keys#* }
SB_JWT_SECRET=$secret
SB_TARGET=local
PGPASSWORD=$dbpw
SB_PSQL="psql -h 127.0.0.1 -p $PG_PORT -U postgres -d postgres -X -q -v ON_ERROR_STOP=1"
ENV
  chmod 600 "$STATE/env"
  node "$ROOT/tools/build.cjs" --url "http://127.0.0.1:$GW_PORT" --anon "${keys% *}" >/dev/null
  nohup node "$ROOT/tools/gateway.cjs" "$GW_PORT" "$AUTH_PORT" "$REST_PORT" "$ROOT/dist" "${keys% *}" "${keys#* }" > "$STATE/gateway.log" 2>&1 & echo $! > "$STATE/gateway.pid"
  for i in $(seq 1 40); do curl -sf "http://127.0.0.1:$GW_PORT/" >/dev/null && break; sleep 0.25; done
  echo "local stack: http://127.0.0.1:$GW_PORT  (env: $STATE/env)"
}

case "${1:-}" in start) start ;; stop) stop ;; *) echo "usage: $0 start|stop"; exit 2 ;; esac

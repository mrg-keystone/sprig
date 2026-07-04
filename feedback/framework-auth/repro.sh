#!/usr/bin/env bash
# Repro: sprig's `?token=` stores the raw token (framework/.sprig/auth.ts seedTokenFromUrl ->
# setBearer(t), no exchange), so an opaque infra token is sent as `Authorization: Bearer <opaque>`
# and rune-3 rejects it (401). The fix is to EXCHANGE it first -- which sprig does for Firebase
# (/auth/login) but not for `?token=` (no /auth/exchange route).
#
# Drives both paths against a live rune-3 backend and prints the outcome + the shape diff.
#
#   INFRA_URL=https://infra.mrg-keystone.deno.net \
#   TOKEN=<opaque infra token> \
#   BACKEND=http://localhost:8000/api \
#   ENDPOINT=/http/create-in-flight \
#   BODY='{"name":"x","phoneNumber":"+1","startedAt":"2026-07-04T00:00:00Z"}' \
#     ./repro.sh
#
# ENDPOINT must be a NON-@Public rune endpoint (so auth is enforced). No secrets committed.
set -uo pipefail

INFRA_URL="${INFRA_URL:-https://infra.mrg-keystone.deno.net}"
TOKEN="${TOKEN:-}"
BACKEND="${BACKEND:-}"
ENDPOINT="${ENDPOINT:-/http/create-in-flight}"
BODY="${BODY:-{}}"

if [ -z "$TOKEN" ] || [ -z "$BACKEND" ]; then
  echo "set TOKEN=<opaque infra token> and BACKEND=<rune /api base>. See the header." >&2
  exit 2
fi

post_status() { # $1 = bearer
  curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND$ENDPOINT" \
    -H "content-type: application/json" -H "authorization: Bearer $1" -d "$BODY"
}
note() { [ "$1" = "401" ] && echo "   -> $2"; }

dots=$(printf '%s' "$TOKEN" | tr -cd '.' | wc -c | tr -d ' ')
echo "-- 1) what sprig does today: send the RAW ?token= value as the bearer --"
echo "   token: $(printf '%s' "$TOKEN" | cut -c1-8)...  dots=$dots  (a signed envelope has kid/signature/claims; this is an opaque handle)"
raw_code=$(post_status "$TOKEN")
echo "   POST $ENDPOINT  Bearer <raw token>  -> $raw_code"
note "$raw_code" "BUG: rune cannot verify a raw opaque token as an infra bearer"
echo

echo "-- 2) what sprig SHOULD do: exchange at infra first, then send the signed bearer --"
env_json=$(curl -s -X POST "$INFRA_URL/authz/exchange" -H "content-type: application/json" -d "{\"token\":\"$TOKEN\"}")
keys=$(printf '%s' "$env_json" | deno eval 'const j=JSON.parse(await new Response(Deno.stdin.readable).text()); console.log(Object.keys(j).sort().join(", "))' 2>/dev/null)
echo "   exchanged envelope keys: $keys"
bearer=$(printf '%s' "$env_json" | deno eval 'const s=await new Response(Deno.stdin.readable).text(); const b=new TextEncoder().encode(s); let o=""; for(const c of b)o+=String.fromCharCode(c); console.log(btoa(o).replaceAll("+","-").replaceAll("/","_").replaceAll("=",""));')
xchg_code=$(post_status "$bearer")
echo "   POST $ENDPOINT  Bearer <exchanged>  -> $xchg_code"
note "$xchg_code" "still 401 -- confirm the token carries a grant for this app"
echo
# The auth signal is 401-vs-not-401: 401 = credential rejected; anything else = credential ACCEPTED
# (a 500/422/200 is downstream app behavior on that endpoint, past the auth gate).
raw_auth=$([ "$raw_code" = "401" ] && echo REJECTED || echo accepted)
xchg_auth=$([ "$xchg_code" = "401" ] && echo rejected || echo ACCEPTED)
echo "Auth outcome:  raw token = $raw_auth ($raw_code)   |   exchanged bearer = $xchg_auth ($xchg_code)"
echo "So sprig's ?token= intake must EXCHANGE (a server /auth/exchange step) before storing —"
echo "today only /auth/login (Firebase) exchanges; ?token= stores the raw token and is rejected."

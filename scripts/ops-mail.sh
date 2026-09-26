# Shared by the ops scripts that run from root's cron (disk-alert.sh,
# restore-drill.sh, admin-token-rotator.sh). Sourced, not run; the caller
# sets APP_DIR first. POSIX sh, so both sh and bash scripts can use it.

# env_get KEY [FILE]: one value out of a dotenv file (the app's .env by
# default). The file is read, never sourced: a value holding a $ (the admin
# password hash) or a space would be expanded or run by the shell.
env_get() {
  _env_file="${2:-$APP_DIR/.env}"
  [ -r "$_env_file" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" "$_env_file" \
    | tail -n 1 | tr -d '\r' \
    | sed -e 's/^"\([^"]*\)".*$/\1/' -e t -e "s/^'\([^']*\)'.*\$/\1/" -e t -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//'
}

# json_str TEXT: TEXT as the inside of a JSON string.
json_str() {
  printf '%s' "$1" | tr -d '\r\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$(printf '\t')/\\\\t/g" \
    | awk 'NR > 1 { printf "%s", "\\n" } { printf "%s", $0 }'
}

# send_mail SUBJECT BODY: a plain-text mail to ADMIN_EMAIL from FROM_EMAIL
# through the Resend HTTP API, both addresses and RESEND_API_KEY read from
# the app's .env. Returns non-zero when something is missing or Resend does
# not accept it. The key reaches curl through a private config file and the
# body through a file, never on a command line, so neither shows up in ps,
# and nothing here prints the key.
send_mail() {
  _key="$(env_get RESEND_API_KEY)"
  _from="$(env_get FROM_EMAIL)"
  _to="$(env_get ADMIN_EMAIL)"
  if [ -z "$_key" ] || [ -z "$_from" ] || [ -z "$_to" ]; then
    echo "mail not sent: RESEND_API_KEY, FROM_EMAIL or ADMIN_EMAIL missing from $APP_DIR/.env" >&2
    return 1
  fi
  _mail_tmp="$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/justtype-mail.XXXXXX")" || return 1
  printf 'header = "Authorization: Bearer %s"\n' "$_key" > "$_mail_tmp/auth"
  printf '{"from":"%s","to":"%s","subject":"%s","text":"%s"}' \
    "$(json_str "$_from")" "$(json_str "$_to")" "$(json_str "$1")" "$(json_str "$2")" > "$_mail_tmp/body"
  _code="$(curl -sS --max-time 30 -K "$_mail_tmp/auth" -H 'Content-Type: application/json' \
    --data-binary @"$_mail_tmp/body" -o "$_mail_tmp/resp" -w '%{http_code}' \
    https://api.resend.com/emails 2>"$_mail_tmp/err")"
  case "$_code" in
    2??) _rc=0 ;;
    *)
      echo "mail not sent: resend answered ${_code:-nothing}: $(head -c 300 "$_mail_tmp/resp" 2>/dev/null)$(head -c 300 "$_mail_tmp/err" 2>/dev/null)" >&2
      _rc=1 ;;
  esac
  rm -rf "$_mail_tmp"
  unset _key _from _to _code _mail_tmp
  return "$_rc"
}

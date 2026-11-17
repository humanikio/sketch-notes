#!/bin/sh
# sketch-notes installer: adds the humanikio/sketch-notes marketplace to Claude Code and installs
# the /sketch board (sketch-notes-pane) and the skill (sketch-notes). Running it again updates them.
#
#   curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/humanikio/sketch-notes/main/install.sh | sh -s -- --uninstall
#
# options:
#   --board-only        install the board without the skill
#   --scope SCOPE       user (default), project or local
#   --uninstall         remove both plugins and the marketplace (your sketches are kept)
#   --auto-update       also turn on auto-update for this marketplace (sets "autoUpdate": true on its
#                       entry in ~/.claude/settings.json, after a backup), so new versions arrive by themselves
#   --dry-run           print what would run, change nothing
#
# all it runs is the `claude plugin` commands below; read them before you pipe this into sh.
set -eu

MARKETPLACE="humanikio/sketch-notes"
NAME="sketch-notes"
SCOPE="user"
BOARD_ONLY=0
UNINSTALL=0
AUTO=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --board-only) BOARD_ONLY=1 ;;
    --scope) shift; SCOPE="${1:-user}" ;;
    --scope=*) SCOPE="${1#--scope=}" ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRY=1 ;;
    --auto-update) AUTO=1 ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "sketch-notes: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

case "$SCOPE" in user|project|local) ;; *) echo "sketch-notes: --scope is user, project or local" >&2; exit 2 ;; esac

say() { printf '%s\n' "$*"; }
warn() { printf 'note: %s\n' "$*" >&2; }
run() {
  if [ "$DRY" -eq 1 ]; then say "would run: $*"; else "$@"; fi
}

if ! command -v claude >/dev/null 2>&1; then
  say "Claude Code is not installed (no 'claude' on your PATH)."
  say "Install it first: https://claude.com/claude-code, then run this again."
  exit 1
fi

PLUGINS="sketch-notes-pane"
[ "$BOARD_ONLY" -eq 1 ] || PLUGINS="$PLUGINS sketch-notes"

if [ "$UNINSTALL" -eq 1 ]; then
  for p in sketch-notes-pane sketch-notes; do
    if claude plugin list 2>/dev/null | grep -q "$p@$NAME"; then
      run claude plugin uninstall "$p@$NAME" --scope "$SCOPE" || run claude plugin uninstall "$p@$NAME"
    fi
  done
  run claude plugin marketplace remove "$NAME" || true
  say ""
  say "sketch-notes is uninstalled. Your sketches and boards are still in ~/.claude/sketches,"
  say "and the browser profile the board used in ~/.claude/sketch-notes: delete those folders to remove them too."
  exit 0
fi

# what the board needs: checked, never installed for you
command -v ruby >/dev/null 2>&1 || warn "ruby was not found on your PATH: the board needs it (macOS ships one)."
browser=""
if [ "$(uname -s)" = "Darwin" ]; then
  for app in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
    if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then browser="$app"; break; fi
  done
else
  for bin in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
    if command -v "$bin" >/dev/null 2>&1; then browser="$bin"; break; fi
  done
fi
[ -n "$browser" ] || warn "no Chrome, Brave, Edge or Chromium found: the board opens in your default browser, and live pages show without their components."

for p in $PLUGINS; do
  if claude plugin list 2>/dev/null | grep -q "$p@$NAME"; then
    say "Updating ${p}…"
    run claude plugin update "$p@$NAME"
  else
    say "Installing ${p}…"
    run claude plugin install "$p" --marketplace "$MARKETPLACE" --scope "$SCOPE"
  fi
done

# auto-update: off by default for marketplaces outside Anthropic's own, so only when asked
SETTINGS="$HOME/.claude/settings.json"
if [ "$AUTO" -eq 1 ]; then
  if [ "$SCOPE" != "user" ]; then
    warn "--auto-update sets your user settings; turn it on for a $SCOPE install in /plugin › Marketplaces instead."
  elif ! command -v ruby >/dev/null 2>&1; then
    warn "--auto-update needs ruby to edit $SETTINGS: turn it on in /plugin › Marketplaces › $NAME instead."
  elif [ "$DRY" -eq 1 ]; then
    say "would set \"autoUpdate\": true on extraKnownMarketplaces.$NAME in $SETTINGS (backup first)"
  else
    [ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak-sketch-notes"
    ruby -rjson -e '
      file, name, repo = ARGV
      s = File.file?(file) && !File.read(file).strip.empty? ? JSON.parse(File.read(file)) : {}
      m = (s["extraKnownMarketplaces"] ||= {})
      e = (m[name] ||= { "source" => { "source" => "github", "repo" => repo } })
      e["autoUpdate"] = true
      File.write(file, JSON.pretty_generate(s) + "\n")
    ' "$SETTINGS" "$NAME" "$MARKETPLACE"
    say "Auto-update is on: new versions install in the background and load on your next launch (or /reload-plugins)."
  fi
fi

say ""
say "Done. Start Claude Code in any folder and run /sketch."
say "  Pick a local server, a window screenshot or an image, click anything to say what should change,"
say "  then Attach to prompt. Docs: https://github.com/$MARKETPLACE"

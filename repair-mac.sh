#!/bin/bash
# Repair Sardiye Studio on a Mac in one line: stops a stuck copy, installs the latest version over the existing one
# (projects, settings and the key are kept), then starts the app and opens it in the browser.
#   curl -fsSL https://raw.githubusercontent.com/chadbrightside/overlay-studio/main/repair-mac.sh | bash
REPO="${OVERLAY_STUDIO_REPO:-chadbrightside/overlay-studio}"
BRANCH="${OVERLAY_STUDIO_BRANCH:-main}"
DEST="${OVERLAY_STUDIO_DIR:-$HOME/overlay-studio}"
export OVERLAY_STUDIO_DIR="$DEST"
echo
echo "Sardiye Studio repair"
echo

echo "1/3 Stopping any running copy"
if [ -z "$OVERLAY_STUDIO_NO_STOP" ]; then
PIDS=$(lsof -ti tcp:3777 2>/dev/null)
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null
pkill -f "node src/server.js" 2>/dev/null
sleep 2
PIDS=$(lsof -ti tcp:3777 2>/dev/null); [ -n "$PIDS" ] && kill -9 $PIDS 2>/dev/null
osascript -e 'tell application "Terminal" to close (every window whose name contains "Sardiye Studio")' >/dev/null 2>&1 || true
fi

echo "2/3 Installing the latest version (your projects and settings are kept)"
if ! curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/install-mac.sh" | bash; then
  echo
  echo "The installation did not finish. Take a photo of this window and send it to Chadi."
  exit 1
fi

[ -n "$OVERLAY_STUDIO_NO_LAUNCHER" ] && exit 0
echo "3/3 Starting Sardiye Studio"
if [ -x "$HOME/Desktop/Sardiye Studio.command" ]; then open "$HOME/Desktop/Sardiye Studio.command"; else open "$DEST/start-mac.command"; fi
echo
echo "Done. A small window opens and the app appears in your browser at http://localhost:3777 within about 20 seconds."
echo "If the browser does not open by itself, type  localhost:3777  in its address bar."
echo

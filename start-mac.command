#!/bin/bash
# Double-click to start Sardiye Studio. Keeps running until you close this window.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export OPEN_BROWSER=1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Run install-mac.sh first, or install Node from nodejs.org."
  read -r -p "Press Enter to close"; exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
while true; do
  node src/server.js
  code=$?
  if [ $code -eq 75 ]; then echo; echo "Restarting with the new version..."; echo; continue; fi
  break
done

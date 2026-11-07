#!/bin/bash
# One-line installer for macOS. Installs Node.js (without admin rights), Overlay Studio, its renderer and Whisper,
# and puts an "Overlay Studio" launcher on the Desktop.
#   curl -fsSL https://raw.githubusercontent.com/chadbrightside/overlay-studio/main/install-mac.sh | bash
set -e
REPO="${OVERLAY_STUDIO_REPO:-chadbrightside/overlay-studio}"
BRANCH="${OVERLAY_STUDIO_BRANCH:-main}"
DEST="${OVERLAY_STUDIO_DIR:-$HOME/overlay-studio}"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo
echo "Overlay Studio installer"
echo "Folder: $DEST"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "1/5 Installing Node.js (private copy in ~/.local/node)"
  ARCH=$(uname -m); if [ "$ARCH" = "arm64" ]; then NARCH=darwin-arm64; else NARCH=darwin-x64; fi
  FN=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o "node-v22[^ ]*$NARCH.tar.gz" | head -1)
  mkdir -p "$HOME/.local/node"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FN" | tar xz -C "$HOME/.local/node" --strip-components=1
else
  echo "1/5 Node.js found: $(node -v)"
fi

echo "2/5 Downloading Overlay Studio"
TMP=$(mktemp -d)
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP/app.zip"
tar -xf "$TMP/app.zip" -C "$TMP"
SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
mkdir -p "$DEST"
rsync -a --exclude data --exclude inbox --exclude node_modules "$SRC/" "$DEST/"
mkdir -p "$DEST/inbox" "$DEST/data"
rm -rf "$TMP"
cd "$DEST"

echo "3/5 Installing components (this takes a few minutes)"
npm install --no-audit --no-fund >/dev/null
npx playwright install chromium >/dev/null 2>&1 || npx playwright install chromium

echo "4/5 Installing Whisper for transcription"
if command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --user --quiet faster-whisper 2>/dev/null || echo "   (faster-whisper could not be installed now; subtitles can still be imported. See GUIDE.md.)"
else
  echo "   Python 3 was not found. Install it from python.org, then run: python3 -m pip install --user faster-whisper"
fi

echo "5/5 Creating the Desktop launcher"
chmod +x "$DEST/start-mac.command"
[ -n "$OVERLAY_STUDIO_NO_LAUNCHER" ] && { echo "Done (launcher skipped)."; exit 0; }
cat > "$HOME/Desktop/Overlay Studio.command" <<LAUNCH
#!/bin/bash
exec "$DEST/start-mac.command"
LAUNCH
chmod +x "$HOME/Desktop/Overlay Studio.command"
echo
echo "Done. Double-click 'Overlay Studio' on your Desktop to start. The app opens in your browser at http://localhost:3777"
echo

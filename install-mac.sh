#!/bin/bash
# One-line installer for macOS. Installs Node.js and Python (private copies, no admin rights), Sardiye Studio, its renderer and Whisper,
# and puts an "Sardiye Studio" launcher on the Desktop.
#   curl -fsSL https://raw.githubusercontent.com/chadbrightside/overlay-studio/main/install-mac.sh | bash
set -e
REPO="${OVERLAY_STUDIO_REPO:-chadbrightside/overlay-studio}"
BRANCH="${OVERLAY_STUDIO_BRANCH:-main}"
DEST="${OVERLAY_STUDIO_DIR:-$HOME/overlay-studio}"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
echo
echo "Sardiye Studio installer"
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

echo "2/5 Downloading Sardiye Studio"
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

echo "4/5 Installing Python and Whisper for transcription (private copy in ~/.local/python)"
PY="$HOME/.local/python/bin/python3"
if [ ! -x "$PY" ]; then
  ARCH=$(uname -m); if [ "$ARCH" = "arm64" ]; then PARCH=aarch64-apple-darwin; else PARCH=x86_64-apple-darwin; fi
  PYURL=$(curl -fsSL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest | grep -o "https://[^\"]*cpython-3\.12\.[0-9]*%2B[0-9]*-$PARCH-install_only\.tar\.gz" | head -1)
  if [ -n "$PYURL" ]; then
    mkdir -p "$HOME/.local/python"
    curl -fsSL "$PYURL" | tar xz -C "$HOME/.local/python" --strip-components=1
  else
    echo "   Could not find the Python download. Transcription will need Python 3 from python.org; subtitles can still be imported."
  fi
fi
if [ -x "$PY" ]; then
  "$PY" -m pip install --quiet --disable-pip-version-check faster-whisper "av<16" "opencv-python-headless<5" || echo "   (faster-whisper could not be installed now; subtitles can still be imported. See GUIDE.md.)"
elif command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --user --quiet faster-whisper "av<16" "opencv-python-headless<5" 2>/dev/null || echo "   (faster-whisper could not be installed now; subtitles can still be imported. See GUIDE.md.)"
fi

echo "5/5 Creating the Desktop launcher"
chmod +x "$DEST/start-mac.command"
[ -n "$OVERLAY_STUDIO_NO_LAUNCHER" ] && { echo "Done (launcher skipped)."; exit 0; }
cat > "$HOME/Desktop/Sardiye Studio.command" <<LAUNCH
#!/bin/bash
exec "$DEST/start-mac.command"
LAUNCH
chmod +x "$HOME/Desktop/Sardiye Studio.command"
echo
echo "Done. Double-click 'Sardiye Studio' on your Desktop to start. The app opens in your browser at http://localhost:3777"
echo

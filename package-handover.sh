#!/bin/bash
# Builds overlay-studio-handover.zip one folder up: the tool without node_modules, caches, videos or your API key.
set -e
cd "$(dirname "$0")"
OUT="../overlay-studio-handover.zip"
rm -f "$OUT"
zip -qr "$OUT" . -x "node_modules/*" "data/*" "inbox/*" ".claude/*" "*.DS_Store" "package-handover.sh" ".git/*"
echo "Wrote $(cd .. && pwd)/overlay-studio-handover.zip ($(du -h "$OUT" | cut -f1))"

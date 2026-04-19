#!/bin/bash
cd "$(dirname "$0")"
echo "Parsing usage data..."
node parse-usage.mjs
echo "Opening dashboard..."

if command -v open &>/dev/null; then
  open dashboard.html
elif command -v xdg-open &>/dev/null; then
  xdg-open dashboard.html
elif command -v wslview &>/dev/null; then
  wslview dashboard.html
else
  echo "Dashboard ready: $(pwd)/dashboard.html"
fi

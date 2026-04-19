#!/bin/bash
cd "$(dirname "$0")"
echo "Parsing usage data..."
node parse-usage.mjs
echo "Opening dashboard..."
open dashboard.html

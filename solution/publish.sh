#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/release-publisher.mjs" /app/publisher/release-publisher.mjs

cd /app
node publisher/release-publisher.mjs --report
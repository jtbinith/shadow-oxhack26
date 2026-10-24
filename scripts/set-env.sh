#!/usr/bin/env bash
# Usage: ./scripts/set-env.sh NAME
# Prompts for the value without echoing it (keeps secrets out of shell history)
# and writes or updates NAME=value in .env, readable by you only.
set -euo pipefail
cd "$(dirname "$0")/.."
name="${1:?usage: ./scripts/set-env.sh NAME}"
[[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "invalid name: $name" >&2; exit 1; }
[ -f .env ] || { cp .env.example .env; }
chmod 600 .env
read -rsp "$name: " value; echo
grep -v "^${name}=" .env > .env.tmp || true
printf '%s=%s\n' "$name" "$value" >> .env.tmp
mv .env.tmp .env && chmod 600 .env
echo "saved $name (${#value} chars)"

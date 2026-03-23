#!/usr/bin/env bash
set -euo pipefail

# Determine directories
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(dirname "$script_dir")"

# Source .env from configs/ (one level up from scripts)
env_file="$repo_root/configs/.env"
if [ -f "$env_file" ]; then
	set -a
	. "$env_file"
	set +a
else
	echo "Warning: $env_file not found — proceeding without sourcing .env"
fi

echo "Running renovate (LOG_LEVEL=${LOG_LEVEL}) from repo root: $repo_root"

cd "$repo_root"
npx renovate "$@"
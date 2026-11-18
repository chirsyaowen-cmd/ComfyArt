#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec "${PYTHON:-$root/.venv/bin/python}" "$root/startup.py" "$@"

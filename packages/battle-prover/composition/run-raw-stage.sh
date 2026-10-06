#!/bin/sh
# Historical stage0 receipt only. Resumption now requires strict pipeline approvals.
set -eu
cd "$(dirname "$0")/.."
echo "Use the strict settlement pipeline runner; raw-v1 evidence is immutable." >&2
exit 2

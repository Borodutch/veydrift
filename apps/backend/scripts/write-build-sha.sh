#!/bin/sh

set -eu

if [ -n "${GIT_SHA:-}" ]; then
  build_sha=$GIT_SHA
  build_sha_source=GIT_SHA
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  build_sha=$(git rev-parse HEAD)
  build_sha_source="local Git"
else
  echo "Unable to determine backend build SHA: GIT_SHA is unset and local Git metadata is unavailable." >&2
  exit 1
fi

case "$build_sha" in
  *[!0-9a-fA-F]*) valid_build_sha=false ;;
  *) valid_build_sha=true ;;
esac

if [ "$valid_build_sha" != true ] || [ "${#build_sha}" -ne 40 ]; then
  echo "Invalid backend build SHA from $build_sha_source: expected a full 40-character hexadecimal commit SHA." >&2
  exit 1
fi

if [ ! -d apps/backend ]; then
  echo "Unable to write backend build SHA: run this script from the repository root." >&2
  exit 1
fi

printf '%s\n' "$build_sha" | tee \
  .veydrift-backend-build-sha \
  apps/backend/.veydrift-backend-build-sha \
  >/dev/null

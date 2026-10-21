#!/bin/sh
# Installs plain <version> (https://getplain.org) into <dir> from its GitHub release, after checking the
# download against the release's SHA256SUMS. GitHub-hosted CI runners run this on every job; the Mac
# runners get it once, at ~/.plain/versions/<version> (see .github/workflows/ci.yml).
#   scripts/install-plain.sh 0.4.0 ~/.plain/versions/0.4.0
set -eu

version="$1"
dir="$2"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) target=aarch64-apple-darwin ;;
  Darwin/x86_64) target=x86_64-apple-darwin ;;
  Linux/x86_64) target=x86_64-unknown-linux-gnu ;;
  *) echo "plain has no release binary for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
base="https://github.com/backmeupplz/plain/releases/download/v$version"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/plain.tar.gz" "$base/plain-$target.tar.gz"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
want="$(grep " plain-$target.tar.gz\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
got="$( (sha256sum "$tmp/plain.tar.gz" 2>/dev/null || shasum -a 256 "$tmp/plain.tar.gz") | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "plain-$target.tar.gz doesn't match v$version's SHA256SUMS" >&2; exit 1; }
mkdir -p "$dir"
tar -xzf "$tmp/plain.tar.gz" -C "$dir"
"$dir/plain" --version

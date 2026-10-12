#!/bin/sh
# Pre-seed a frontend media root on a deploy host (no Bun needed), so a
# container starting with a new apps/frontend/media.json does not download
# before it listens. Writes only missing blobs, at idle I/O priority and a
# bounded rate; the server builds its own symlink view at startup.
#
#   sudo sh seed-media.sh media.json /etc/easypanel/projects/veydrift/frontend/media
set -eu
manifest=$1
root=$2
rate=${SEED_MEDIA_RATE:-20M}
mkdir -p "$root/blobs"
base=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["baseUrl"])' "$manifest")
pins=$(mktemp)
trap 'rm -f "$pins"' EXIT
# Listed to a file first so a bad pin stops the script under set -e.
python3 -c '
import json, re, sys
for key, pin in json.load(open(sys.argv[1]))["files"].items():
    if pin.get("publishOnly"):
        continue
    ext = re.search(r"\.[A-Za-z0-9]+$", key)
    assert ext and re.fullmatch(r"[0-9a-f]{64}", pin["sha256"]) and pin["bytes"] > 0, key
    print(pin["sha256"] + ext.group(0), pin["sha256"], pin["bytes"])
' "$manifest" > "$pins"
while read -r name sha bytes; do
  blob="$root/blobs/$name"
  if [ -f "$blob" ] && [ "$(stat -c %s "$blob")" = "$bytes" ]; then continue; fi
  tmp="$blob.seed.$$.tmp"
  ionice -c3 nice -n 19 curl -fsSL --retry 3 --limit-rate "$rate" -o "$tmp" "$base$name"
  if [ "$(stat -c %s "$tmp")" != "$bytes" ] || [ "$(sha256sum "$tmp" | cut -d' ' -f1)" != "$sha" ]; then
    rm -f "$tmp"
    echo "pin mismatch: $name" >&2
    exit 1
  fi
  mv "$tmp" "$blob"
  echo "seeded $name $bytes"
done < "$pins"
missing=0
while read -r name sha bytes; do
  if [ ! -f "$root/blobs/$name" ] || [ "$(stat -c %s "$root/blobs/$name")" != "$bytes" ]; then missing=$((missing + 1)); fi
done < "$pins"
[ "$missing" -eq 0 ] || { echo "$missing pinned blobs missing" >&2; exit 1; }
echo "all $(wc -l < "$pins") served blobs present"

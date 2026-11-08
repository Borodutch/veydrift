#!/usr/bin/env bash
# Staged read-only probe. Failed reads emit unknown, never healthy zero.
set -uo pipefail
for name in execution l1-rpc node; do
  if value=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}' "base-node-v2-${name}-1" 2>/dev/null); then
    printf 'container_%s=%s
' "$name" "$value"
  else
    printf 'container_%s=unknown
' "$name"
  fi
done
anon_bytes=$(docker exec base-node-v2-execution-1 awk '$1 == "anon" {print $2}' /sys/fs/cgroup/memory.stat 2>/dev/null) || anon_bytes=
limit_bytes=$(docker exec base-node-v2-execution-1 cat /sys/fs/cgroup/memory.max 2>/dev/null) || limit_bytes=
psi_avg10=$(docker exec base-node-v2-execution-1 awk '$1 == "some" {sub(/^avg10=/,"",$2); print $2}' /sys/fs/cgroup/memory.pressure 2>/dev/null) || psi_avg10=
if [[ $anon_bytes =~ ^[0-9]+$ && $limit_bytes =~ ^[1-9][0-9]*$ ]]; then
  value=$(awk -v anon="$anon_bytes" -v limit="$limit_bytes" 'BEGIN {printf "%.2f",100*anon/limit}') || value=unknown
else
  value=unknown
fi
printf 'execution_anon_pct=%s
execution_psi_avg10=%s
' "$value" "$psi_avg10"
value=$(df -P /mnt/chain 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}') || value=unknown
printf 'disk_pct=%s
' "$value"
value=$(systemctl --failed --no-legend 2>/dev/null | awk 'NF {n++} END {print n+0}') || value=unknown
printf 'failed_units=%s
' "$value"
# `docker logs --since` scans the whole unrotated json-file log (6.8 GB, ~66 s on 2026-11-08) and
# blew the 40 s remote budget, which read as "can't SSH". Read only the log tail (op-node writes
# ~25 MB/30 min at 0.2 s blocks), keep matching lines, then apply the 30-minute window per entry.
# Since 2026-11-08 the log rotates at 100 MB (x3), so include the previous file's tail too.
value=$(log=$(docker inspect -f '{{.LogPath}}' base-node-v2-node-1 2>/dev/null) && [[ -f $log ]] &&
  { [[ ! -f $log.1 ]] || tail -c 64M "$log.1"; tail -c 128M "$log"; } | { grep -aiE 'Derivation pipeline is being reset|panic|fatal' || [[ $? -eq 1 ]]; } | python3 -c 'import json,sys,datetime
since=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=30)
resets=critical=0
for raw in sys.stdin:
 try:
  entry=json.loads(raw)
  if datetime.datetime.fromisoformat(entry["time"][:19]+"+00:00") < since: continue
  line=entry["log"]
 except Exception: continue  # tail -c starts mid-line: a fragment has no time, never count it
 try: msg=str(json.loads(line).get("fields",{}).get("message",""))
 except Exception: msg=line
 if msg == "Derivation pipeline is being reset": resets+=1
 if "panic" in msg.lower() or "fatal" in msg.lower(): critical+=1
print("node_reset_events="+str(resets))
print("node_critical_errors="+str(critical))') || value=$'node_reset_events=unknown
node_critical_errors=unknown'
printf '%s
' "$value"

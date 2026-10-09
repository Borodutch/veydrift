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
value=$(docker logs --since 30m base-node-v2-node-1 2>&1 | python3 -c 'import json,sys
resets=critical=0
for line in sys.stdin:
 try: msg=str(json.loads(line).get("fields",{}).get("message",""))
 except Exception: msg=line
 if msg == "Derivation pipeline is being reset": resets+=1
 if "panic" in msg.lower() or "fatal" in msg.lower(): critical+=1
print("node_reset_events="+str(resets))
print("node_critical_errors="+str(critical))') || value=$'node_reset_events=unknown
node_critical_errors=unknown'
printf '%s
' "$value"

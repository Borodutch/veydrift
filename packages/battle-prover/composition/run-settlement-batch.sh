#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
: "${PIPELINE_RUN:?set reviewed source-frozen run namespace}"
batch=${1:?select raw, attribution, prep, combat, bridge, report, output, or final}
case "$PIPELINE_RUN" in *[!a-zA-Z0-9_-]*|"") echo "unsafe run name" >&2; exit 2;; esac
unset PIPELINE_PHASE PIPELINE_STAGE PIPELINE_ADAPTER PIPELINE_IMPORT_REVIEWED PIPELINE_VERIFY_FINAL PIPELINE_VERIFY_CHECKPOINT PIPELINE_ATTACK_FINAL || true
export GOMAXPROCS=2 GOMEMLIMIT=6GiB
base="composition/staged-public/settlement-phases-v2/$PIPELINE_RUN"
logs="composition/pipeline-runs/$PIPELINE_RUN"
mkdir -p "$logs"
record() { printf "%s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$logs/progress.txt"; }
phase_stage() {
  p=$1; s=$2
  if [ "$s" = leaf ]; then sub=stage-leaf; else sub=$(printf "stage-%02d" "$s"); fi
  dir="$base/$p/$sub"
  label="$p-$s"
  if [ -e "$dir" ]; then
    if [ ! -f "$dir/manifest.json" ]; then record "FAILED incomplete checkpoint $label"; exit 1; fi
    record "VERIFY existing $label"
    GOMEMLIMIT=2GiB PIPELINE_PHASE="$p" PIPELINE_STAGE="$s" PIPELINE_VERIFY_CHECKPOINT=1 go test ./composition -run "^TestVerifyPipelineCheckpoint$" -v -count=1 -timeout=5m >> "$logs/resume-verification.txt" 2>&1
    return
  fi
  if [ -e "$logs/$label.txt" ]; then record "FAILED refusing log overwrite $label"; exit 1; fi
  record "START $label max60m cpu2 soft6GiB constraints4M"
  if PIPELINE_PHASE="$p" PIPELINE_STAGE="$s" /usr/bin/time -l go test ./composition -run "^TestSettlementPipelineStage$" -v -count=1 -timeout=60m > "$logs/$label.txt" 2>&1; then
    record "PASS $label"
  else
    status=$?; record "FAILED $label exit=$status; no retry"; exit "$status"
  fi
}
adapter_stage() {
  a=$1; dir="$base/adapters/$a"; label="adapter-$a"
  if [ -e "$dir" ]; then
    if [ ! -f "$dir/manifest.json" ]; then record "FAILED incomplete checkpoint $label"; exit 1; fi
    record "VERIFY existing $label"
    GOMEMLIMIT=2GiB PIPELINE_ADAPTER="$a" PIPELINE_VERIFY_CHECKPOINT=1 go test ./composition -run "^TestVerifyPipelineCheckpoint$" -v -count=1 -timeout=5m >> "$logs/resume-verification.txt" 2>&1
    return
  fi
  if [ -e "$logs/$label.txt" ]; then record "FAILED refusing log overwrite $label"; exit 1; fi
  record "START $label max60m cpu2 soft6GiB constraints4M"
  if PIPELINE_ADAPTER="$a" /usr/bin/time -l go test ./composition -run "^TestSettlementAdapterStage$" -v -count=1 -timeout=60m > "$logs/$label.txt" 2>&1; then
    record "PASS $label"
  else
    status=$?; record "FAILED $label exit=$status; no retry"; exit "$status"
  fi
}
case "$batch" in
 raw) phase_stage raw leaf; phase_stage raw 0; phase_stage raw 1; phase_stage raw 2; phase_stage raw 3; adapter_stage qualification; adapter_stage raw-qualified;;
 attribution) for s in leaf 0 1 2 3 4; do phase_stage attribution "$s"; done;;
 prep) for s in leaf 0 1 2 3 4 5; do phase_stage prep "$s"; done;;
 combat) for s in leaf 0 1 2 3 4 5 6; do phase_stage combat "$s"; done;;
 bridge) for s in leaf 0 1 2 3 4; do phase_stage bridge "$s"; done;;
 report) for s in leaf 0 1 2; do phase_stage report "$s"; done;;
 output) for s in leaf 0 1 2 3 4; do phase_stage output "$s"; done;;
 final) adapter_stage prepared-combat; adapter_stage bridge-report; adapter_stage pipeline; adapter_stage output-pipeline; adapter_stage final; if [ ! -f "$base/adapters/final/attacks.json" ]; then if [ -e "$logs/final-attacks.txt" ]; then record "FAILED prior final attack attempt needs inspection"; exit 1; fi; GOMEMLIMIT=2GiB PIPELINE_ATTACK_FINAL=1 go test ./composition -run "^TestFinalSettlementAttacks$" -v -count=1 -timeout=10m > "$logs/final-attacks.txt" 2>&1; fi; GOMEMLIMIT=2GiB PIPELINE_VERIFY_FINAL=1 go test ./composition -run "^TestCompletedPipelineFinal$" -v -count=1 -timeout=5m >> "$logs/final-reverification.txt" 2>&1;;
 *) echo "unknown batch" >&2; exit 2;;
esac
record "BATCH COMPLETE $batch"

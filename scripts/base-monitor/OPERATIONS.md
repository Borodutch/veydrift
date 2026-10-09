# Base semantic monitor: delivery-custody rework (#61)

This directory versions the already-deployed collector and transport, previously
workspace artifacts. The delivery state machine and scheduled script are changed;
node/backend/signer/recovery transactions are not. No standalone bot or new job.

## Contract and limits

A proposal is committed before claim. Claim atomically fsyncs uncertain custody
before returning send authorization. Only that fresh response permits one message
call. No expiry, timeout or exception authorizes another attempt. Real numeric
receipt must match chat 76104711 and topic 4030762. The deployed message contract
was corroborated by the activation owner: ok/messageId/chatId/receipt.threadId;
a prior real failure threw at send, not at receipt parsing. Queued, suppressed,
malformed, contradictory delivered=false, wrong chat/topic all remain uncertain.

Next sample migrates an uncertain pending event, byte-for-byte, into held. Its
covered signal keys are fenced against both reminders and recovery generation,
so no new event ID disguises a retry. Unrelated signals continue through the one
proposal slot and their messages disclose degraded custody. Samples always update
active/streak state. Signal transitions during a fence coalesce; this is a current
state monitor, NOT an event history or guaranteed exactly-once delivery service.

held is capped at 32 events; each proposal has <=12 fixed signal keys and <3900
characters. State is capped at 256KiB, private, atomic, file+directory-fsynced.
At capacity, no new proposal/send is admitted; sampling and custody diagnostics
continue, evidence is never evicted. Operator reconciliation is REQUIRED to restore
capacity. One uncertain event cannot block unrelated signals; an indefinite broken
messaging transport can exhaust the finite capacity and cannot be solved by retries.

Crucially delivery uncertainty is a *degraded subsystem result*, not a failed
sampler. Every scheduled result exposes custody count, exact event IDs, capacity,
and required action, and state retains the same evidence. This avoids perpetual
error accounting and auto-disable. Real execution/persistence/invalid-result failures
still throw to preserved scheduler failure routing. No automatic second-channel
escalation is introduced (that would have its own ambiguous custody boundary).
The operator must act on custody degradation; an ok scheduler execution is NOT
proof of successful notification delivery. The live acceptance gate explicitly
requires an operator alert/receipt and reconciliation of the original uncertain
production event; green unit tests do not discharge it.

## Reconcile with sole sender stopped

1. Disable existing job through first-class scheduler and wait for its running tick
   to finish. Snapshot job and state. Inspect exact provider/tool/queue evidence.
2. A proven matching delivered receipt allows monitor.py --state STATE --ack EVENT
   --receipt REAL_NUMERIC_ID. Ack searches both pending and held, updates only that
   event's incident notification state, and removes only its custody record.
   Existing lastAck with no matching event means no further mutation is needed.
3. Authoritative NOT-delivered evidence PLUS absence of queued/in-flight custody
   allows --release-not-delivered EVENT --evidence PRIVATE_REFERENCE. A held event
   moves to pending ready only if that slot is empty. Finish the current proposal
   first otherwise. This operator assertion is never inferred by scheduled code.
4. Still unknown: leave held intact. Never delete state, reset notified flags, fake
   a receipt, or resend. Continue sampling and unrelated signals with degraded
   results. Escalate exact evidence access need through the existing operator route.

Never mutate/replay original fixture-state.json or historical synthetic recovery.
An old pending event without delivery metadata is unknown, never ready.

## Deployment (activation owner only)

Inspect/preserve existing job d08e348c-9559-4159-b019-4c37a766d881, 300s cadence and
anchor, owner, failureAlert and routing. Stop/drain before evidence reconciliation
or source switch. Stage exact reviewed base-monitor and base-node directories to
workspace artifacts/ticket61/rework-a25a/release/. Verify hashes. scheduler-patch.json
changes ONLY payload and explicit delivery; re-enable separately after readback.
No fallback/upgrade of Gateway code, no direct messaging API, no new listener.

Budget remains 210s, four tools: sample exec150s, claim exec10s, message, ack exec10s.
The message tool remains the only sender, automatic final delivery stays none.
Do not roll back to the old throwing/retrying code while held evidence exists.
A source rollback must understand held or leave sender paused; never restore an
old state snapshot over newer delivery evidence. Retain both snapshots privately.

Validate offline with node --test scripts/base-monitor.test.mjs. Then prove live
read-only collection, labeled authorized alert + real ack + duplicate suppression,
original production event reconciliation, enabled schedule and successive natural
scheduled ok runs. Report custody separately even when scheduler says ok. Live
acceptance/reconciliation remains with parent; this package performs no deployment.

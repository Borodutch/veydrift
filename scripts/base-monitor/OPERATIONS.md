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

Claim also persists a per-state sender fence spanning the asynchronous message
call and its terminal persistence. While fenced, samples update but cannot migrate
or propose another event. Success ack clears its matching fence; a returned/thrown
message completes --finish-send, clearing only sender ownership, not delivery
custody. Crash/timeout before that commit retains the fence forever: no TTL.

After terminal sender completion, the next sample migrates uncertain pending into
held. Original event identity/text/changes/delivery metadata are preserved; a
bounded escalationCreated pointer may be added. Its
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
sampler. Every successful scheduled result returns the documented state field (<16KiB),
which persists custody count, exact event IDs, capacity and required action in
the scheduler. The next run receives it as trigger.state; the collector state
remains authoritative. Do not expect arbitrary top-level result keys in history.
Operator inspection must include the saved scheduler state, not just run status. This avoids perpetual
error accounting and auto-disable. Real execution/persistence/invalid-result failures
still throw to preserved scheduler failure routing. A newly held ordinary event creates ONE distinct custody-diagnostic proposal on
the next tick, even without unrelated incidents, using the SAME original operator
route and the SAME claim/send/ack custody machinery. It references the original
event ID but does not replay its alert/recovery text. The diagnostic has no incident
changes and never recursively creates another diagnostic. Its creation pointer is
committed atomically with its proposal. An uncertain diagnostic remains held too,
without repeat or alternate-channel retries. Capacity32 includes diagnostics.
This adds at most one notification attempt per original held event, not per tick.
A diagnostic receipt proves operator-route delivery, not original-event delivery.
When the transport is unavailable, no push guarantee exists: persisted scheduler
state/collector evidence and explicit operator reconciliation remain essential.
A crashed outstanding sender also cannot send its diagnostic until the operator
proves that invocation terminal and clears only the sender fence.
The operator must act on custody degradation; an ok scheduler execution is NOT
proof of successful notification delivery. The live acceptance gate explicitly
requires an operator alert/receipt and reconciliation of the original uncertain
production event; green unit tests do not discharge it.

## Reconcile with sole sender stopped

1. Disable existing job through first-class scheduler and wait for its running tick
   to finish. Snapshot job and state. Inspect exact provider/tool/queue evidence.
2. If sender is retained after a crash, prove the exact owning invocation terminal
   and no message call outstanding, then --abandon-sender EVENT --evidence PRIVATE_REF.
   This leaves uncertain event custody intact; it is NOT release/retry permission.
   Never invoke scheduled --finish-send manually to bypass this evidence requirement.
3. A proven matching delivered receipt allows monitor.py --state STATE --ack EVENT
   --receipt REAL_NUMERIC_ID. Ack searches both pending and held, updates only that
   event's incident notification state, and removes only its custody record.
   Existing lastAck with no matching event means no further mutation is needed.
4. Authoritative NOT-delivered evidence PLUS absence of queued/in-flight custody
   allows --release-not-delivered EVENT --evidence PRIVATE_REFERENCE. A held event
   moves to pending ready only if that slot is empty. Finish the current proposal
   first otherwise. This operator assertion is never inferred by scheduled code.
5. Still unknown: leave held intact. Never delete state, reset notified flags, fake
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

## Explicit release proof limitation

Offline tests prove bounded diagnostic proposal, one attempt, receipt checks, no
recursive retry, and sender exclusivity with a deferred tool call. They do NOT
prove live diagnostic delivery or actual scheduler UI visibility. Activation owner
must verify persisted scheduler state via first-class readback and a real labeled
custody notice/receipt on topic4030762, without replaying historical held events.
The original production recovery requires its own authoritative reconciliation.
These are release gates, not cleared by successful tests or scheduler ok status.

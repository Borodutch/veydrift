#!/usr/bin/env python3
"""Staged one-shot observer. No sends, schedulers, restarts or provider rotation."""
import argparse
import contextlib
import datetime
import fcntl
import email.utils
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import ssh_rpc
import health_http

HERE = Path(__file__).resolve().parent
MAX_HELD = 32
MAX_STATE_BYTES = 262144
HOSTS = ('api.veydrift.com', 'api-test.veydrift.com')
REASONS = {'confirmed-retention-full', 'journal-storage-full', 'canonical-reconciliation-required',
           'recovery-reconciliation-required', 'signing-reservation-unresolved', 'unresolved-intent', 'active-window-full'}
SSH = ['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes',
       '-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'UserKnownHostsFile=/Users/borodutch/.openclaw/agents/main/agent/codex-home/home/.ssh/known_hosts.hetzner-213.133.101.30',
       '-i', '/Users/borodutch/.openclaw/agents/main/agent/codex-home/home/.ssh/openclaw_hetzner_20260508',
       'root@213.133.101.30', 'timeout', '40', 'bash', '-s']


def number(v):
    if isinstance(v, bool):
        raise ValueError('boolean numeric field')
    try:
        n = float(v)
    except (TypeError, ValueError, OverflowError):
        raise ValueError('invalid numeric field') from None
    if not math.isfinite(n) or n < 0:
        raise ValueError('invalid numeric field')
    return n


@contextlib.contextmanager
def deadline(seconds):
    def expired(*_):
        raise TimeoutError('probe deadline')
    old = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class RateLimited(ValueError):
    def __init__(self, retry_after):
        super().__init__('HTTP unavailable')
        self.retry_after = retry_after


def retry_seconds(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = email.utils.parsedate_to_datetime(value).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            seconds = 60
    return max(60, seconds) if math.isfinite(seconds) else 60


class ProbeHolds:
    """Fixed endpoint slots, durable wall-clock deadlines; never URLs or credentials."""
    def __init__(self, state, persist):
        self.state, self.persist = state, persist
        self.holds = state.setdefault('holds', {})

    def call(self, slot, function):
        if slot not in ('local', 'reference1', 'reference2', 'app0', 'app1'):
            raise ValueError('unknown endpoint slot')
        if self.holds.get(slot, 0) > time.time():
            raise ValueError('endpoint quota hold')
        try:
            return function()
        except Exception as error:
            delay = getattr(error, 'retry_after', 0)
            if delay:
                self.holds[slot] = max(self.holds.get(slot, 0), time.time() + retry_seconds(delay))
                self.persist(self.state)  # save BEFORE any later probe or delivery
            raise


def http_json(url, payload=None):
    # No retries, redirects, rotation or error-body logging. Hard deadline includes DNS.
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(),
                                     headers={'Content-Type': 'application/json'})
    with deadline(8):
        try:
            response = urllib.request.build_opener(NoRedirect).open(request, timeout=6)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                delay = retry_seconds(error.headers.get('Retry-After'))
                error.close()
                raise RateLimited(delay) from None
            if error.code != 503:  # public health includes useful degraded telemetry in 503
                error.close()
                raise ValueError('HTTP unavailable') from None
            response = error
        with response:
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                raise ValueError('oversized response')
            parsed = json.loads(body)
            for item in parsed if isinstance(parsed, list) else [parsed]:
                error = item.get('error') if isinstance(item, dict) else None
                if isinstance(error, dict) and error.get('code') in (429, -32005, -32016):
                    raise RateLimited(retry_seconds(response.headers.get('Retry-After')))
            return response.code, parsed


def load_health(directory):
    path = Path(directory) / 'health.py'
    spec = importlib.util.spec_from_file_location('node_health', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collect(health_dir, state=None, persist=lambda state: None):
    holds = ProbeHolds(state if state is not None else {}, persist)
    sample = {'ssh_ok': False, 'resources': {}, 'node': {'status': 'probe-unavailable'}, 'apps': {}}
    try:
        result = subprocess.run(SSH, input=(HERE / 'resources.sh').read_text(), text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=45, check=False)
        sample['ssh_ok'] = result.returncode == 0
        if sample['ssh_ok']:
            sample['resources'] = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    except (OSError, subprocess.TimeoutExpired):
        pass
    try:
        health = load_health(health_dir)
        urls = ['ssh-node-loopback', 'https://mainnet.base.org', 'https://base-rpc.publicnode.com']
        # Distinct hosts are necessary but not proof of independent operators; owner must verify.
        if len({urllib.parse.urlsplit(u).hostname for u in urls[1:]}) != 2:
            raise ValueError('independent references required')
        with deadline(55):
            # Keep the corrected sampler/classifier unchanged; wrap each endpoint phase
            # so RelayError.retry_after survives its one-shot Relay instance.
            slots = ('local', 'reference1', 'reference2')
            samples = [holds.call('local', lambda: ssh_rpc.sample(SSH, health))]
            samples += [holds.call(slot, lambda url=url: health.sample(url)) for slot, url in zip(slots[1:], urls[1:])]
            local = samples[0][0]
            canonical = [holds.call(slot, lambda reader=reader: reader(local))
                         for slot, (_, reader) in zip(slots[1:], samples[1:])]
            sample['node'] = health.classify(local, [s[0] for s in samples[1:]], canonical, int(time.time()))
    except Exception:
        pass
    for index, host in enumerate(HOSTS):
        try:
            code, body = holds.call('app' + str(index), lambda: health_http.fetch('https://' + host + '/health', retry_seconds))
            sample['apps'][host] = {'code': code, 'body': body}
        except Exception:
            sample['apps'][host] = {'code': 0}
    # eth_syncing moved from the SSH script to the same guarded local slot.
    # Thus a local 429 suppresses BOTH follow-up RPCs, including within this run.
    if sample['ssh_ok']:
        try:
            code, response = holds.call('local', lambda: ssh_rpc.request(SSH,
                {'jsonrpc': '2.0', 'id': 62, 'method': 'eth_syncing', 'params': []}))
            if code != 200 or not isinstance(response, dict) or response.get('id') != 62 or 'error' in response:
                raise ValueError('sync probe unavailable')
            sample['resources']['syncing'] = 'false' if response.get('result') is False else 'true'
        except Exception:
            sample['resources']['syncing'] = 'unknown'
    # Public health has no signer balance. Read the public resolver address, never signer secrets.
    try:
        address = sample['apps'][HOSTS[0]]['body']['missionResolution']['resolverAddress']
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}', address):
            raise ValueError('invalid public resolver address')
        code, response = holds.call('local', lambda: ssh_rpc.request(SSH,
                                  {'jsonrpc': '2.0', 'id': 61, 'method': 'eth_getBalance', 'params': [address, 'latest']}))
        if code != 200 or response.get('id') != 61 or 'error' in response or not re.fullmatch(r'0x[0-9a-fA-F]+', response['result']):
            raise ValueError('balance probe unavailable')
        sample['balanceWei'] = int(response['result'], 16)
    except Exception:
        pass
    return sample


def iso_time(value):
    if value is None:
        return None
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def signals(sample, state, now):
    """Fixed signal keys only: no upstream strings, URLs, addresses or exception bodies retained."""
    out = {}
    def add(key, bad, threshold=1):
        out[key] = (bool(bad), threshold)
    add('ssh-unavailable', not sample.get('ssh_ok'), 3)
    # None suspends prior state during blind spots, never falsely recovers it.
    if sample.get('ssh_ok'):
        m = sample.get('resources', {})
        for name in ('execution', 'l1-rpc', 'node'):
            parts = m.get('container_' + name, '').split('|')
            add('container-' + name, len(parts) != 4 or parts[:2] != ['running', 'healthy'])
            add('restarts-' + name, len(parts) != 4 or parts[2] != '0')
            add('oom-' + name, len(parts) != 4 or parts[3] != 'false')
        add('syncing', m.get('syncing') != 'false')
        for key, limit in [('disk_pct', 80), ('execution_anon_pct', 85), ('execution_psi_avg10', 10),
                           ('failed_units', 1), ('node_reset_events', 3), ('node_critical_errors', 1)]:
            try:
                bad = number(m[key]) >= limit
            except (KeyError, TypeError, ValueError):
                bad = True
            add('resource-' + key, bad)
    else:
        for key in state.get('incidents', {}):
            if key.startswith(('container-', 'restarts-', 'oom-', 'resource-')) or key == 'syncing':
                out[key] = (None, 1)
    report = sample.get('node', {})
    unavailable = report.get('status') == 'probe-unavailable' or not report.get('tags')
    add('node-probe-unavailable', unavailable, 3)
    statuses = ('provider-disagreement', 'reference-disagreement', 'local-lag', 'local-staleness', 'chainwide-lag')
    for tag in ('latest', 'safe', 'finalized'):
        for status in statuses:
            out['node-' + tag + '-' + status] = (None if unavailable else report['tags'][tag]['status'] == status, 3)
    for host in HOSTS:
        prefix = host + ':'
        app = sample.get('apps', {}).get(host, {})
        b = app.get('body')
        add(prefix + 'http', app.get('code') != 200)
        if not isinstance(b, dict):
            if host == HOSTS[0]:
                state['progress'] = {}
            for key in state.get('incidents', {}):
                if key.startswith(prefix) and key != prefix + 'http':
                    out[key] = (None, 1)
            continue
        sync = b.get('chainSync') or {}
        try:
            if any(not isinstance(b.get(field), dict) for field in ('chainSync', 'chainSyncRpc', 'randomnessReadiness')):
                raise ValueError('legacy health schema unavailable')
            rpc = urllib.parse.urlsplit((b.get('chainSyncRpc') or {}).get('activeRpcUrl', ''))
            approved = ((rpc.scheme, rpc.hostname, rpc.port) == ('http', '213.133.101.30', 8545)
                        or (rpc.scheme == 'https' and rpc.hostname == 'base-mainnet.g.alchemy.com'))
            good = (b.get('ok') is True and (b.get('randomnessReadiness') or {}).get('ready') is True
                    and sync.get('ready') is True and sync.get('connected') is True
                    and number(sync['pollBacklogBlocks']) <= 60 and sync.get('pollFailureCount') == 0
                    and sync.get('lastError') is None and approved)
        except (ValueError, TypeError, KeyError, AttributeError):
            good = False
        add(prefix + 'legacy-health', not good)
        if host != HOSTS[0]:  # preserve old test-host health; only production writer owns mission journal
            continue
        try:
            if b['backend']['worker']['role'] != 'writer':
                raise ValueError('writer required')
            m = b['missionResolution']
            a = m['admission']
            if not isinstance(a, dict) or not isinstance(m['gamePaused'], bool):
                raise ValueError('schema unavailable')
            reason = a['blockedReason']
            if reason is not None and reason not in REASONS:
                reason = 'unknown-block'
            if (m.get('sharedAdmission') or {}).get('blocked') is True and reason is None:
                reason = 'shared-admission-block'
            for known in sorted(REASONS | {'unknown-block', 'shared-admission-block'}):
                add(prefix + 'admission-' + known, reason == known, 2)
            add(prefix + 'active-capacity', number(a['active']) >= 32)
            add(prefix + 'retention-warning', number(a['retainedConfirmed']) >= 3072)
            add(prefix + 'journal-warning', number(a['journalBytes']) >= 192 * 1024 * 1024)
            add(prefix + 'counts-capped', a['countsCapped'] is not False)
            add(prefix + 'limits-changed', a['activeLimit'] != 32 or a['retainedLimit'] != 4096)
            due = 0
            for leg in ('Arrivals', 'Returns'):
                q = m['due' + leg]
                count = number(q['count'])
                due += count
                age = number(q['oldestAgeSeconds']) if count else 0
                add(prefix + 'due-' + leg.lower(), not m['gamePaused'] and age > 60, 3)
            progress = state.setdefault('progress', {})
            stamp = iso_time(a['lastCanonicalSettlementAt'])
            if stamp is not None and stamp > now + 30:
                raise ValueError('future progress timestamp')
            # No public eligible/dependency count exists. This is explicitly a due-queue candidate
            # stall, not a claim all missions are eligible. Never invent a suppression from error text.
            if due and not m['gamePaused']:
                if not progress or (stamp is not None and stamp > progress.get('stamp', 0)):
                    progress.update(since=now, stamp=stamp or 0)
                add(prefix + 'due-queue-no-settlement-120s', now - progress['since'] >= 120)
            else:
                progress.clear()
                add(prefix + 'due-queue-no-settlement-120s', False)
            add(prefix + 'mission-telemetry', False)
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            # Discard any partial mission interpretation; keep prior incidents through invalid samples.
            for key in set(out) | set(state.get('incidents', {})):
                if key.startswith(prefix) and key not in (prefix + 'http', prefix + 'legacy-health'):
                    out[key] = (None, 1)
            add(prefix + 'mission-telemetry', True, 3)
            state['progress'] = {}
    try:
        add('signer-funds-low', number(sample['balanceWei']) < 200_000_000_000_000, 3)
        add('signer-balance-unavailable', False, 3)
    except (KeyError, ValueError, TypeError):
        out['signer-funds-low'] = (None, 3)
        add('signer-balance-unavailable', True, 3)
    return out


def transition(state, sample, now):
    state.setdefault('version', 1)
    incidents = state.setdefault('incidents', {})
    observations = signals(sample, state, now)
    for key, (bad, threshold) in observations.items():
        item = incidents.setdefault(key, {'streak': 0, 'active': False, 'notified': False, 'at': 0})
        if bad is None:
            item['streak'] = 0  # blind spots cannot bridge consecutive-sample gates
            continue
        item['streak'] = min(threshold, item['streak'] + 1) if bad else 0
        item['active'] = item['streak'] >= threshold if bad else False
    # Retain uncertain attempts without blocking unrelated signal delivery.
    held = state.setdefault('held', [])
    if state.get('sender'):
        return state.get('pending')  # sampling progresses; external send still fenced
    if state.get('pending'):
        if not delivery_hold(state['pending']):
            return state['pending']
        if len(held) >= MAX_HELD:
            return state['pending']
        held.append(state.pop('pending'))
    fenced = {key for event in held for key, _ in event['changes']}
    changes = []
    for key, item in sorted(incidents.items()):
        if key in fenced:
            continue
        if observations.get(key, (None,))[0] is None:
            continue
        if item['active'] and (not item['notified'] or now - item['at'] >= 3600):
            changes.append([key, True])
        elif not item['active'] and item['notified'] and observations[key][0] is False:
            changes.append([key, False])
    # Keep one tool message safely below Telegram's 4096-character ceiling.
    # Remaining fixed-key transitions are proposed on the next existing scheduled run.
    changes = changes[:12]
    if len(held) >= MAX_HELD:
        changes = []
    escalation = next((e for e in held if not e.get('diagnostic') and not e.get('escalationCreated')), None) if len(held) < MAX_HELD else None
    if escalation:
        changes = []
    if not changes and not escalation:
        return None
    state['sequence'] = state.get('sequence', 0) + 1
    event = hashlib.sha256(json.dumps([state['sequence'], now, changes]).encode()).hexdigest()[:24]
    text = '#61 Base / resolver monitoring; event ' + event + '. ' + '; '.join(
        ('ALERT ' if active else 'RECOVERED ') + key for key, active in changes)
    if escalation:
        escalation['escalationCreated'] = event
        text = '#61 Base / resolver monitoring; event ' + event + '. DELIVERY CUSTODY UNCERTAIN for ' + escalation['eventId'] + '; inspect exact provider receipt; never resend the original event'
    state['pending'] = {'eventId': event, 'text': text + ('. Delivery custody degraded: ' + str(len(held)) + ' uncertain events retained; operator reconciliation required.' if held else '') + '. Inspect; no automatic restart or failover.', 'changes': changes,
                        'delivery': {'status': 'ready'}}
    if escalation:
        state['pending']['diagnostic'] = True
    return state['pending']


def find_event(state, event):
    pending = state.get('pending')
    if pending and pending['eventId'] == event:
        return pending
    return next((e for e in state.get('held', []) if e['eventId'] == event), None)


def acknowledge(state, event, receipt, now):
    pending = find_event(state, event)
    if not pending or not re.fullmatch(r'[0-9]{1,128}', receipt):
        raise ValueError('matching event and successful numeric delivery receipt required')
    for key, active in pending['changes']:
        state['incidents'][key].update(notified=active, at=now)
    if (state.get('sender') or {}).get('eventId') == event:
        state['sender'] = None
    state['lastAck'] = {'eventId': event, 'receipt': receipt}
    if state.get('pending') is pending:
        state['pending'] = None
    else:
        state['held'].remove(pending)


def custody(state):
    events = list(state.get('held', []))
    if state.get('pending') and delivery_hold(state['pending']):
        events.append(state['pending'])
    return {'status': 'degraded' if events else 'clear', 'heldCount': len(events),
            'sender': state.get('sender'),
            'eventIds': [e['eventId'] for e in events],
            'capacity': MAX_HELD, 'capacityReached': len(events) >= MAX_HELD,
            'action': 'Reconcile exact provider receipts; never blind resend. Covered signals are fenced; sampling continues.' if events else None}


def delivery_hold(event):
    # Pre-upgrade pending events have unknown send history, not permission to retry.
    delivery = event.get('delivery') or {}
    return delivery.get('status') != 'ready'


def held_output(event):
    return {'status': 'delivery-held', 'eventId': event['eventId'],
            'claimedAt': (event.get('delivery') or {}).get('claimedAt'),
            'action': 'Sampling continues; delivery blocked. Reconcile provider custody/receipt with sole sender stopped. '
                      'Ack only proven delivery; release only proven non-delivery with no queued/in-flight attempt. Never blind retry.'}


def claim(state, event, now):
    pending = state.get('pending')
    if not pending or pending['eventId'] != event:
        return {'status': 'not-current', 'eventId': event}
    if state.get('sender'):
        return {'status': 'sender-held', 'eventId': event}
    if delivery_hold(pending):
        return held_output(pending)
    pending['delivery'] = {'status': 'uncertain', 'claimedAt': now}
    state['sender'] = {'eventId': event, 'claimedAt': now}
    return {'status': 'claimed', 'eventId': event}


def finish_send(state, event):
    # Only after the async tool returned/threw; NOT delivery retry authorization.
    sender = state.get('sender')
    if sender and sender['eventId'] == event:
        state['sender'] = None
    elif sender:
        raise ValueError('different sender owns state')
    return {'status': 'send-finished', 'eventId': event}


def abandon_sender(state, event, evidence, now):
    # Operator stops/drains job and proves no outstanding invocation first.
    if not re.fullmatch(r'[A-Za-z0-9:_./-]{1,160}', evidence):
        raise ValueError('private terminal-run evidence required')
    if (state.get('sender') or {}).get('eventId') != event:
        raise ValueError('matching sender fence required')
    finish_send(state, event)
    state['lastSenderReconciliation'] = {'eventId': event, 'evidence': evidence, 'at': now}


def release_not_delivered(state, event, evidence, now):
    # Operator-only reconciliation, NEVER automatic from an exception or delivered=false.
    if state.get('sender'):
        raise ValueError('sender must be stopped and reconciled before releasing delivery')
    pending = find_event(state, event)
    if (not pending or not delivery_hold(pending)
            or not re.fullmatch(r'[A-Za-z0-9:_./-]{1,160}', evidence)):
        raise ValueError('held event and private non-delivery evidence reference required')
    if state.get('pending') is not pending:
        if state.get('pending'):
            raise ValueError('finish current ready proposal before releasing held event')
        state['held'].remove(pending)
        state['pending'] = pending
    pending['delivery'] = {'status': 'ready'}
    state['lastReconciliation'] = {'eventId': event, 'outcome': 'proven-not-delivered',
                                   'evidence': evidence, 'at': now}


def atomic_save(path, state):
    data = json.dumps(state, sort_keys=True).encode()
    if len(data) > MAX_STATE_BYTES:
        raise ValueError('state exceeds bound')
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', required=True, type=Path)
    p.add_argument('--health-dir')
    p.add_argument('--fixture', type=Path)
    action = p.add_mutually_exclusive_group()
    action.add_argument('--ack')
    action.add_argument('--claim')
    action.add_argument('--finish-send')
    action.add_argument('--abandon-sender')
    action.add_argument('--release-not-delivered')
    p.add_argument('--receipt')
    p.add_argument('--evidence', default='')
    args = p.parse_args()
    # No default production path: owner must explicitly authorize eventual activation.
    args.state.parent.mkdir(parents=True, exist_ok=True)
    with open(str(args.state) + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'busy'}))
            return
        state = json.loads(args.state.read_text()) if args.state.exists() else {}
        if state.get('version', 1) != 1:
            raise ValueError('state version mismatch')
        now = int(time.time())
        if args.ack:
            acknowledge(state, args.ack, args.receipt or '', now)
            output = {'status': 'acknowledged', 'eventId': args.ack}
        elif args.claim:
            output = claim(state, args.claim, now)
        elif args.finish_send:
            output = finish_send(state, args.finish_send)
        elif args.abandon_sender:
            abandon_sender(state, args.abandon_sender, args.evidence, now)
            output = {'status': 'sender-reconciled', 'eventId': args.abandon_sender}
        elif args.release_not_delivered:
            release_not_delivered(state, args.release_not_delivered, args.evidence, now)
            output = {'status': 'released', 'eventId': args.release_not_delivered}
        else:
            if not args.fixture and not args.health_dir:
                p.error('--health-dir required for live read-only probe')
            sample = json.loads(args.fixture.read_text()) if args.fixture else collect(args.health_dir, state, lambda current: atomic_save(args.state, current))
            event = transition(state, sample, now)
            state['lastObservedAt'] = now
            output = held_output(event) if event and delivery_hold(event) else {
                'status': 'proposed' if event else 'quiet', 'event': event}
        output['custody'] = custody(state)
        atomic_save(args.state, state)
        print(json.dumps(output))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'monitor-error', 'action': 'inspect privately; state commit may be uncertain; do not infer delivery'}))
        raise SystemExit(1)

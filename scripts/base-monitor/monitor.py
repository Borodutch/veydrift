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
# A held uncertain event stops fencing its signals after this age. Its delivery can no longer
# be usefully proven, and a permanent fence would silence those signals forever (#276).
STALE_HELD_SECONDS = 86400
MAX_RETIRED = 32
MAX_STATE_BYTES = 262144
HOSTS = ('api.veydrift.com', 'api-test.veydrift.com')
# A /health transport retry costs up to 10 s more (2 s pause + 8 s curl). Allow it only while
# collect() is under this many seconds. Before the apps, collect() spends at most 100 s
# (45 SSH + 55 node), and after a retried probe at most 8 s (other app) + 2x8 s (RPC) remain,
# so the worst case stays 132 s, inside job.js's 150 s exec timeout.
APP_RETRY_BUDGET_SECONDS = 90
REASONS = {'confirmed-retention-full', 'journal-storage-full', 'canonical-reconciliation-required',
           'recovery-reconciliation-required', 'signing-reservation-unresolved', 'unresolved-intent', 'active-window-full'}
# These blocks clear on the resolver's ~30s retry while missions keep settling. Alert only when one
# persists for ~20 minutes (4 samples at 300s); real stalls are caught by the due-queue impact keys.
TRANSIENT_ADMISSION = {'canonical-reconciliation-required', 'shared-admission-block'}
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
    started = time.monotonic()
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
        retry = time.monotonic() - started <= APP_RETRY_BUDGET_SECONDS
        try:
            code, body = holds.call('app' + str(index), lambda: health_http.fetch('https://' + host + '/health', retry_seconds, retry=retry))
            sample['apps'][host] = {'code': code, 'body': body}
        except Exception as error:
            sample['apps'][host] = {'code': 0}
            if state is not None:
                # Why the last app probe failed; only fixed-text HealthError messages are kept.
                reason = str(error)[:120] if isinstance(error, health_http.HealthError) else type(error).__name__
                state['lastAppError'] = {'at': int(time.time()), 'host': host, 'error': reason}
    # eth_syncing moved from the SSH script to the same guarded local slot.
    # Thus a local 429 suppresses BOTH follow-up RPCs, including within this run.
    if sample['ssh_ok']:
        probe_started = time.monotonic()
        try:
            code, response = holds.call('local', lambda: ssh_rpc.request(SSH,
                {'jsonrpc': '2.0', 'id': 62, 'method': 'eth_syncing', 'params': []}))
            if code != 200 or not isinstance(response, dict) or response.get('id') != 62 or 'error' in response:
                raise ValueError('sync probe unavailable')
            sample['resources']['syncing'] = 'false' if response.get('result') is False else 'true'
        except Exception as error:
            sample['resources']['syncing'] = 'unknown'
            if state is not None:
                # Why the sync read failed; only our own fixed-text ValueErrors are kept verbatim.
                reason = str(error)[:80] if type(error) is ValueError else type(error).__name__
                state['lastSyncError'] = {'at': int(time.time()), 'error': reason,
                                          'seconds': round(time.monotonic() - probe_started, 1)}
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
    try:
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except ValueError:
        # fromisoformat echoes the raw upstream value; lastTelemetryError must never retain it.
        raise ValueError('invalid timestamp field') from None


def signals(sample, state, now):
    """Fixed signal keys only: no upstream strings, URLs, addresses or exception bodies retained."""
    out = {}
    def add(key, bad, threshold=1):
        out[key] = (bool(bad), threshold)
    add('ssh-unavailable', not sample.get('ssh_ok'), 3)
    # None suspends prior state during blind spots, never falsely recovers it.
    if sample.get('ssh_ok'):
        m = sample.get('resources', {})
        seen = state.setdefault('restartSeen', {})
        for name in ('execution', 'l1-rpc', 'node'):
            parts = m.get('container_' + name, '').split('|')
            add('container-' + name, len(parts) != 4 or parts[:2] != ['running', 'healthy'])
            # RestartCount is cumulative: alert when it grows, recover an hour after the last restart.
            # isdigit() alone accepts '²' and other non-ASCII digits that int() rejects.
            if len(parts) == 4 and parts[2].isascii() and parts[2].isdigit():
                count, prev = int(parts[2]), seen.get(name)
                if prev is None:
                    seen[name] = {'count': count, 'at': None}
                elif count < prev['count']:
                    # Recreated: new baseline, but a restart in the last hour still recovers on its own clock.
                    seen[name] = {'count': count, 'at': prev.get('at')}
                    if 'from' in prev:  # keep the alerted counts for its OK again line
                        seen[name].update({'from': prev['from'], 'to': prev.get('to', prev['count'])})
                elif count > prev['count']:
                    seen[name] = {'count': count, 'at': now, 'from': prev['count']}
                add('restarts-' + name, seen[name]['at'] is not None and now - seen[name]['at'] < 3600)
            else:
                out['restarts-' + name] = (None, 1)
            add('oom-' + name, len(parts) != 4 or parts[3] != 'false')
        # A real "syncing" answer alerts at once; an unreadable one (a fresh SSH session that
        # timed out on a loaded host) needs 3 runs in a row, like the other probe-unavailable keys.
        # An unreadable sample never recovers an incident that is already active.
        if m.get('syncing') in ('true', 'false'):
            add('syncing', m['syncing'] == 'true')
        elif state.get('incidents', {}).get('syncing', {}).get('active'):
            out['syncing'] = (None, 3)
        else:
            add('syncing', True, 3)
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
        # Two consecutive runs: each backend deploy (stop_first) answers /health 502 for ~20-40 s
        # while the writer worker boots; a single failed sample is a deploy, not an outage.
        add(prefix + 'http', app.get('code') != 200, 2)
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
                add(prefix + 'admission-' + known, reason == known, 4 if known in TRANSIENT_ADMISSION else 2)
            # A continuous block alternating between transient reasons resets each per-reason streak.
            add(prefix + 'admission-transient-sustained', reason in TRANSIENT_ADMISSION, 4)
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
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as error:
            # Private diagnostic: which check rejected the sample (our own messages / schema key names).
            state['lastTelemetryError'] = {'at': now, 'error': (type(error).__name__ + ': ' + str(error))[:160]}
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


CONTAINERS = {'execution': 'execution client (reth)', 'l1-rpc': 'L1 relay (Alchemy)', 'node': 'op-node'}
TAG_STATUS = {
    'provider-disagreement': 'block hash differs from public Base RPCs',
    'reference-disagreement': 'public Base RPCs disagree with each other (can\'t verify)',
    'local-lag': 'our node is behind public Base RPCs',
    'local-staleness': 'our node stopped advancing while public RPCs move',
    'chainwide-lag': 'all Base RPCs (ours and public) stalled, likely Base-wide',
}
LABELS = {
    'ssh-unavailable': 'can\'t SSH into the node server',
    'syncing': 'execution client reports it is syncing',
    'node-probe-unavailable': 'can\'t read block heads from the node',
    'resource-disk_pct': 'chain disk over 80% full',
    'resource-execution_anon_pct': 'execution client memory over 85% of its limit',
    'resource-execution_psi_avg10': 'execution client under memory pressure',
    'resource-failed_units': 'failed systemd units on the node server',
    'resource-node_reset_events': 'op-node reset derivation 3+ times in 30 min',
    'resource-node_critical_errors': 'op-node logged panic/fatal errors',
    'signer-funds-low': 'Veydrift resolver signer below 0.0002 ETH',
    'signer-balance-unavailable': 'can\'t read Veydrift resolver signer balance',
    'http': '/health is not returning 200',
    'legacy-health': 'chain sync unhealthy (backlog, poll errors or unapproved RPC)',
    'admission-transient-sustained': 'mission admission blocked for 20+ min',
    'active-capacity': '32+ active missions (capacity reached)',
    'retention-warning': 'confirmed-mission retention near its limit',
    'journal-warning': 'mission journal over 192 MB',
    'counts-capped': 'mission counts capped in /health',
    'limits-changed': 'mission limits changed from 32/4096',
    'due-arrivals': 'fleet arrivals overdue by 60s+',
    'due-returns': 'fleet returns overdue by 60s+',
    'due-queue-no-settlement-120s': 'due missions not settling for 2+ min',
    'mission-telemetry': '/health is missing mission data',
}
# A resource reading that fails to parse raises the same key; the alert must not claim the threshold was crossed.
UNREADABLE = {
    'disk_pct': 'chain disk usage',
    'execution_anon_pct': 'execution client memory usage',
    'execution_psi_avg10': 'execution client memory pressure',
    'failed_units': 'systemd unit status on the node server',
    'node_reset_events': 'op-node logs (derivation resets)',
    'node_critical_errors': 'op-node logs (panic/fatal errors)',
}


def describe(key, sample, state, active=True):
    """Plain-English line for a signal key; falls back to the raw key. Never echoes raw upstream text."""
    host, _, sub = key.rpartition(':')
    if host:
        label = LABELS.get(sub) or (sub.startswith('admission-') and 'mission admission blocked: ' + sub[10:])
        return host + ': ' + (label or sub)
    res = sample.get('resources', {})
    kind, _, name = key.partition('-')
    if name in CONTAINERS and kind in ('container', 'restarts', 'oom'):
        what = CONTAINERS[name]
        if active and kind != 'restarts' and len(res.get('container_' + name, '').split('|')) != 4:
            # The same key fires when docker inspect fails: say so instead of claiming an OOM kill.
            return 'can\'t read ' + what + ' container status'
        if kind == 'container':
            return what + ' container not running/healthy'
        if kind == 'oom':
            return what + ' container was OOM-killed'
        r = state.get('restartSeen', {}).get(name, {})
        return what + ' container restarted' + (' (restart count %s → %s)' % (r['from'], r.get('to', r['count'])) if 'from' in r else '')
    if key.startswith('node-') and key.count('-') >= 2:
        tag, status = key[5:].split('-', 1)
        if status in TAG_STATUS:
            return tag + ' block: ' + TAG_STATUS[status]
    if active and key == 'syncing' and res.get('syncing') != 'true':
        return 'can\'t read execution client sync status'
    if key.startswith('resource-') and key[9:] in UNREADABLE:
        try:
            value = number(res[key[9:]])
        except (KeyError, TypeError, ValueError):
            value = None
        if active and value is None:
            return 'can\'t read ' + UNREADABLE[key[9:]]
        if key == 'resource-disk_pct' and value is not None:
            # Only the parsed number: a raw upstream string never reaches the message.
            return LABELS[key] + ' (now %g%%)' % value
    text = LABELS.get(key, key)
    if key == 'signer-funds-low' and isinstance(sample.get('balanceWei'), int):
        text += ' (now %.5f ETH)' % (sample['balanceWei'] / 1e18)
    return text


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
    # Before every early return: legacy held events must start aging even while capacity is full.
    note_held_seen(state, now)
    if state.get('sender'):
        return state.get('pending')  # sampling progresses; external send still fenced
    retire_aged(state, now)  # before the capacity check, so aged custody frees a slot
    if state.get('pending'):
        if not delivery_hold(state['pending']):
            return state['pending']
        if len(held) >= MAX_HELD:
            return state['pending']
        held.append(state.pop('pending'))
        retire_aged(state, now)  # an already-aged migration gets no separate escalation notice
    note_held_seen(state, now)
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
    # Announce each auto-retirement once, on the next proposal the slot admits.
    retired = [r for r in state.get('retired', []) if unannounced(r)]
    if len(held) >= MAX_HELD:
        retired = []
    if not changes and not escalation and not retired:
        return None
    state['sequence'] = state.get('sequence', 0) + 1
    event = hashlib.sha256(json.dumps([state['sequence'], now, changes]).encode()).hexdigest()[:24]
    head = 'Base node monitor\n'
    def line(key, active):
        if not active:
            return '🟢 OK again: ' + describe(key, sample, state, active=False)
        return ('🔴 Still: ' if incidents[key]['notified'] else '🔴 ') + describe(key, sample, state)
    text = head + '\n'.join(line(key, active) for key, active in changes)
    if escalation:
        escalation['escalationCreated'] = event
        text = head + 'Not sure alert ' + escalation['eventId'] + ' reached Telegram; check the topic, it will not be resent'
    if retired:
        # Custody diagnostic only: names the retired IDs, never replays their alert/recovery text.
        for record in retired:
            record['announcedIn'] = event
        text = (text + '\n' if changes or escalation else head) + 'Gave up on ' + str(len(retired)) + \
            ' unconfirmed alert(s) after ' + str(STALE_HELD_SECONDS // 3600) + 'h (' + \
            ', '.join(r['eventId'] for r in retired) + '); they will re-alert if still true'
    if held:
        text += '\n' + str(len(held)) + ' earlier alert(s) have unconfirmed delivery'
    # Custody notices name event IDs; this line lets the operator match them to the original message.
    text += '\nid: ' + event
    state['pending'] = {'eventId': event, 'text': text, 'changes': changes,
                        'delivery': {'status': 'ready'}}
    if escalation or not changes:
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


def note_held_seen(state, now):
    # Age anchor for held events without a claim time, kept outside the immutable custody records.
    seen = state.get('heldSeen', {})
    state['heldSeen'] = {e['eventId']: seen.get(e['eventId'], now) for e in state.get('held', [])
                         if not isinstance((e.get('delivery') or {}).get('claimedAt'), (int, float))}


def held_age(state, event, now):
    claimed = (event.get('delivery') or {}).get('claimedAt')
    if not isinstance(claimed, (int, float)):
        claimed = state.get('heldSeen', {}).get(event['eventId'], now)
    return now - claimed


def retire(state, event, outcome, evidence, now):
    # Drop custody WITHOUT a resend or fake receipt. Re-arm covered signals: an incident still
    # active alerts fresh after its normal threshold; a cleared one emits no stale RECOVERED.
    state['held'].remove(event)
    for key, _ in event['changes']:
        item = state.get('incidents', {}).get(key)
        if item:
            item.update(notified=False, streak=0, active=False)
    record = {'eventId': event['eventId'], 'outcome': outcome, 'evidence': evidence, 'at': now,
              'claimedAt': (event.get('delivery') or {}).get('claimedAt'), 'changes': event['changes']}
    if event.get('diagnostic'):
        record['diagnostic'] = True
    records = state.get('retired', []) + [record]
    while len(records) > MAX_RETIRED:  # evict settled history first, never an unannounced retirement
        records.remove(next((r for r in records if not unannounced(r)), records[0]))
    state['retired'] = records
    return record


def unannounced(record):
    # Retired diagnostics (custody/retirement notices) are never announced: that would recurse.
    return (record['outcome'] == 'retired-stale-auto' and not record.get('diagnostic')
            and 'announcedIn' not in record)


def retire_aged(state, now):
    # Scheduled path; the sender fence is already known clear. Held events carry no in-flight call.
    aged = [e for e in state.get('held', []) if held_age(state, e, now) >= STALE_HELD_SECONDS]
    for event in aged:
        retire(state, event, 'retired-stale-auto', 'age>=' + str(STALE_HELD_SECONDS) + 's', now)


def retire_stale(state, event, evidence, now):
    # Operator-only: give up proving delivery of one held event. Never a resend or an ack.
    if state.get('sender'):
        raise ValueError('sender must be stopped and reconciled before retiring custody')
    held = find_event(state, event)
    if not held or not delivery_hold(held) or not re.fullmatch(r'[A-Za-z0-9:_./-]{1,160}', evidence):
        raise ValueError('held event and private operator evidence reference required')
    if state.get('pending') is held:  # uncertain pending not yet migrated by a sample
        state.setdefault('held', []).append(state.pop('pending'))
    record = retire(state, held, 'retired-stale-unproven', evidence, now)
    state['lastReconciliation'] = {'eventId': event, 'outcome': record['outcome'], 'evidence': evidence, 'at': now}


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
    action.add_argument('--retire-stale')
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
        elif args.retire_stale:
            retire_stale(state, args.retire_stale, args.evidence, now)
            output = {'status': 'retired', 'eventId': args.retire_stale}
        else:
            if not args.fixture and not args.health_dir:
                p.error('--health-dir required for live read-only probe')
            sample = json.loads(args.fixture.read_text()) if args.fixture else collect(args.health_dir, state, lambda current: atomic_save(args.state, current))
            # Judge the sample at the time it was taken: collect() runs 25-60 s, and a settlement
            # stamped during it read as a "future progress timestamp" (> now+30) against the
            # pre-collect clock, which flapped "/health is missing mission data".
            now = int(time.time())
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

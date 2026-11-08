import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import monitor as m


def healthy():
    body = {'ok': True, 'randomnessReadiness': {'ready': True},
            'chainSync': {'ready': True, 'connected': True, 'pollBacklogBlocks': 0, 'pollFailureCount': 0, 'lastError': None},
            'chainSyncRpc': {'activeRpcUrl': 'http://213.133.101.30:8545'},
            'backend': {'worker': {'role': 'writer'}},
            'missionResolution': {'gamePaused': False, 'resolverAddress': '0x' + '1' * 40,
                'dueArrivals': {'count': 0, 'oldestAgeSeconds': None},
                'dueReturns': {'count': 0, 'oldestAgeSeconds': None},
                'admission': {'active': 0, 'retainedConfirmed': 0, 'activeLimit': 32, 'retainedLimit': 4096,
                              'journalBytes': 1024, 'countsCapped': False, 'blockedReason': None,
                              'lastCanonicalSettlementAt': None}}}
    resources = {'container_' + name: 'running|healthy|0|false' for name in ('execution', 'l1-rpc', 'node')}
    resources.update(syncing='false', disk_pct='39', execution_anon_pct='40', execution_psi_avg10='0',
                     failed_units='0', node_reset_events='0', node_critical_errors='0')
    return {'ssh_ok': True, 'resources': resources, 'balanceWei': 200_000_000_000_000,
            'node': {'status': 'observed', 'tags': {tag: {'status': 'observed'} for tag in ('latest', 'safe', 'finalized')}},
            'apps': {host: {'code': 200, 'body': copy.deepcopy(body)} for host in m.HOSTS}}


def mission(sample):
    return sample['apps'][m.HOSTS[0]]['body']['missionResolution']


class MonitorTests(unittest.TestCase):
    def test_healthy_and_three_bad(self):
        s, x = {}, healthy()
        self.assertIsNone(m.transition(s, x, 0))
        x['node']['tags']['finalized']['status'] = 'local-lag'
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIsNone(m.transition(s, x, 20))
        event = m.transition(s, x, 30)
        self.assertIn('finalized block: our node is behind public Base RPCs', event['text'])
        self.assertFalse(s['incidents']['node-finalized-local-lag']['notified'])

    def test_single_deploy_502_does_not_alert_but_two_do(self):
        s, x = {}, healthy()
        self.assertIsNone(m.transition(s, x, 0))
        down = copy.deepcopy(x)
        for host in m.HOSTS:
            down['apps'][host] = {'code': 0}
        self.assertIsNone(m.transition(s, down, 300))  # one run inside a deploy's writer boot
        self.assertIsNone(m.transition(s, x, 600))
        self.assertIsNone(m.transition(s, down, 900))
        event = m.transition(s, down, 1200)
        self.assertEqual(event['changes'], [[host + ':http', True] for host in sorted(m.HOSTS)])

    def test_two_admission_and_single_recovery(self):
        s, x = {}, healthy()
        mission(x)['admission']['blockedReason'] = 'unresolved-intent'
        self.assertIsNone(m.transition(s, x, 0))
        event = m.transition(s, x, 10)
        self.assertIn('mission admission blocked: unresolved-intent', event['text'])
        m.acknowledge(s, event['eventId'], '123', 10)
        mission(x)['admission']['blockedReason'] = None
        recovery = m.transition(s, x, 20)
        self.assertIn('OK again', recovery['text'])
        m.acknowledge(s, recovery['eventId'], '124', 20)
        self.assertIsNone(m.transition(s, x, 30))

    def test_transient_admission_flapping_does_not_alert(self):
        for reason, shared in (('canonical-reconciliation-required', False), (None, True)):
            s, x = {}, healthy()
            for i in range(24):
                blocked = i % 4 != 3  # three blocked samples, then one clear, repeatedly
                mission(x)['admission']['blockedReason'] = reason if blocked else None
                mission(x)['sharedAdmission'] = {'blocked': shared and blocked}
                self.assertIsNone(m.transition(s, x, i * 300))

    def test_transient_admission_sustained_alerts_and_recovers_once(self):
        for reason, shared, key in (('canonical-reconciliation-required', False, 'canonical-reconciliation-required'),
                                    (None, True, 'shared-admission-block')):
            s, x = {}, healthy()
            mission(x)['admission']['blockedReason'] = reason
            mission(x)['sharedAdmission'] = {'blocked': shared}
            for i in range(3):
                self.assertIsNone(m.transition(s, x, i * 300))
            event = m.transition(s, x, 900)
            self.assertEqual(event['changes'], [[m.HOSTS[0] + ':admission-' + key, True],
                                                [m.HOSTS[0] + ':admission-transient-sustained', True]])
            m.acknowledge(s, event['eventId'], '123', 900)
            for t in (1200, 1500, 1800):
                self.assertIsNone(m.transition(s, x, t))
            mission(x)['admission']['blockedReason'] = None
            mission(x)['sharedAdmission'] = {'blocked': False}
            recovery = m.transition(s, x, 2100)
            self.assertEqual(recovery['changes'], [[m.HOSTS[0] + ':admission-' + key, False],
                                                   [m.HOSTS[0] + ':admission-transient-sustained', False]])
            m.acknowledge(s, recovery['eventId'], '124', 2100)
            self.assertIsNone(m.transition(s, x, 2400))

    def test_transient_threshold_upgrade_preserves_notified_incident(self):
        # State written under the old 2-sample gate: active, notified, streak capped at 2.
        key = m.HOSTS[0] + ':admission-canonical-reconciliation-required'
        s, x = {}, healthy()
        s['incidents'] = {key: {'streak': 2, 'active': True, 'notified': True, 'at': 0}}
        mission(x)['admission']['blockedReason'] = 'canonical-reconciliation-required'
        # The block continues: no false recovery and no duplicate per-reason alert.
        for t, active in ((300, False), (600, True), (900, True)):
            self.assertIsNone(m.transition(s, x, t))
            self.assertEqual(s['incidents'][key]['active'], active)
        mission(x)['admission']['blockedReason'] = None
        recovery = m.transition(s, x, 1200)
        self.assertEqual(recovery['changes'], [[key, False]])

    def test_transient_reasons_alternating_alert_once_sustained(self):
        s, x = {}, healthy()
        combined = m.HOSTS[0] + ':admission-transient-sustained'
        for i in range(3):
            canonical = i % 2 == 0
            mission(x)['admission']['blockedReason'] = 'canonical-reconciliation-required' if canonical else None
            mission(x)['sharedAdmission'] = {'blocked': not canonical}
            self.assertIsNone(m.transition(s, x, i * 300))
        mission(x)['admission']['blockedReason'] = None
        mission(x)['sharedAdmission'] = {'blocked': True}
        event = m.transition(s, x, 900)
        self.assertEqual(event['changes'], [[combined, True]])
        m.acknowledge(s, event['eventId'], '123', 900)
        mission(x)['sharedAdmission'] = {'blocked': False}
        self.assertEqual(m.transition(s, x, 1200)['changes'], [[combined, False]])

    def test_ack_failure_retry_hour_dedup(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '80'
        event = m.transition(s, x, 100)
        with self.assertRaises(ValueError):
            m.acknowledge(s, event['eventId'], '', 100)
        self.assertEqual(event, m.transition(s, x, 200))
        with self.assertRaises(ValueError):
            m.acknowledge(s, 'wrong', '125', 200)
        m.acknowledge(s, event['eventId'], '123', 200)
        self.assertIsNone(m.transition(s, x, 3799))
        reminder = m.transition(s, x, 3800)
        self.assertNotEqual(event['eventId'], reminder['eventId'])

    def test_pending_incident_then_recovery(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '80'
        event = m.transition(s, x, 0)
        x['resources']['disk_pct'] = '39'
        self.assertEqual(event, m.transition(s, x, 10))
        m.acknowledge(s, event['eventId'], '125', 10)
        self.assertIn('OK again', m.transition(s, x, 20)['text'])

    def test_progress_120_and_pause(self):
        s, x = {}, healthy()
        mission(x)['dueArrivals'] = {'count': 1, 'oldestAgeSeconds': 30}
        self.assertIsNone(m.transition(s, x, 1000))
        self.assertIsNone(m.transition(s, x, 1119))
        event = m.transition(s, x, 1120)
        self.assertIn('due missions not settling for 2+ min', event['text'])
        m.acknowledge(s, event['eventId'], '125', 1120)
        mission(x)['admission']['lastCanonicalSettlementAt'] = '1970-01-01T00:18:41Z'
        self.assertIn('OK again', m.transition(s, x, 1121)['text'])
        s = {}
        mission(x)['gamePaused'] = True
        self.assertIsNone(m.transition(s, x, 1300))
        self.assertIsNone(m.transition(s, x, 2000))

    def test_bad_transport_not_recovery_and_three_ssh(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '80'
        e = m.transition(s, x, 0)
        m.acknowledge(s, e['eventId'], '125', 0)
        x['ssh_ok'] = False
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIsNone(m.transition(s, x, 20))
        e = m.transition(s, x, 30)
        self.assertIn("can't SSH into the node server", e['text'])
        self.assertNotIn('OK again', e['text'])

    def test_blind_spot_breaks_consecutive_samples(self):
        s, x = {}, healthy()
        mission(x)['admission']['blockedReason'] = 'unresolved-intent'
        self.assertIsNone(m.transition(s, x, 0))
        good = copy.deepcopy(x)
        del mission(x)['admission']
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIsNone(m.transition(s, good, 20))
        self.assertIn('mission admission blocked: unresolved-intent', m.transition(s, good, 30)['text'])

    def test_storage_counts_funds_and_reset_thresholds(self):
        s, x = {}, healthy()
        a = mission(x)['admission']
        a.update(retainedConfirmed=3072, journalBytes=192*1024*1024, active=32, countsCapped=True)
        x['resources']['node_reset_events'] = '3'
        x['balanceWei'] -= 1
        event = m.transition(s, x, 0)
        for key in ('confirmed-mission retention near its limit', 'mission journal over 192 MB', '32+ active missions', 'mission counts capped', 'op-node reset derivation'):
            self.assertIn(key, event['text'])
        m.acknowledge(s, event['eventId'], '125', 0)
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIn('resolver signer below 0.0002 ETH', m.transition(s, x, 20)['text'])

    def test_secret_redaction(self):
        s, x = {}, healthy()
        secret = 'https://upstream.invalid/path?token=' + 'SECRET'
        mission(x)['admission']['blockedReason'] = secret
        x['apps'][m.HOSTS[0]]['body']['chainSync']['lastError'] = secret
        x['resources']['container_node'] = secret
        m.transition(s, x, 0)
        m.transition(s, x, 10)
        self.assertNotIn('SECRET', json.dumps(s))
        self.assertNotIn('upstream.invalid', json.dumps(s))

    def test_429_never_retries_or_rotates(self):
        # Real urllib HTTP errors own a response stream. fp=None creates an
        # incomplete tempfile wrapper on Python 3.9 whose close() raises KeyError.
        body = io.BytesIO(b'SECRET upstream error body')
        error = urllib.error.HTTPError('https://example.invalid', 429, 'SECRET', {'Retry-After': '3600'}, body)
        with patch.object(m.urllib.request, 'build_opener') as factory:
            factory.return_value.open.side_effect = error
            with self.assertRaisesRegex(m.RateLimited, '^HTTP unavailable$') as raised:
                m.http_json('https://example.invalid')
            self.assertEqual(raised.exception.retry_after, 3600)
            self.assertTrue(body.closed)
            self.assertEqual(factory.return_value.open.call_count, 1)

    def test_atomicity_failed_replace_preserves_state(self):
        with tempfile.TemporaryDirectory(dir=m.HERE) as directory:
            path = Path(directory) / 'state.json'
            m.atomic_save(path, {'old': True})
            with patch.object(m.os, 'replace', side_effect=OSError('simulated')):
                with self.assertRaises(OSError):
                    m.atomic_save(path, {'new': True})
            self.assertEqual(json.loads(path.read_text()), {'old': True})
            self.assertEqual(list(Path(directory).iterdir()), [path])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            m.atomic_save(path, {'new': True})
            self.assertEqual(json.loads(path.read_text()), {'new': True})

    def test_collect_transport_failure_is_sanitized(self):
        with patch.object(m.subprocess, 'run', side_effect=OSError('SECRET')):
            with patch.object(m, 'load_health', side_effect=OSError('SECRET')):
                with patch.object(m.health_http, 'fetch', side_effect=OSError('SECRET')):
                    sample = m.collect(m.HERE.parent / 'base-node')
        self.assertFalse(sample['ssh_ok'])
        self.assertEqual(sample['node']['status'], 'probe-unavailable')
        self.assertNotIn('SECRET', json.dumps(sample))

    def test_outbox_message_bound_and_state_bound(self):
        s, x = {}, healthy()
        for key in x['resources']:
            x['resources'][key] = 'bad'
        x['node']['status'] = 'local-lag'
        for tag in x['node']['tags']:
            x['node']['tags'][tag]['status'] = 'local-lag'
        for i in range(3):
            event = m.transition(s, x, i)
        self.assertLess(len(event['text']), 4096)
        self.assertLessEqual(len(event['changes']), 12)
        self.assertLess(len(json.dumps(s)), 65536)

    def test_corrected_canonical_classification(self):
        h = m.load_health(m.HERE.parent / 'base-node')
        def heads(number, timestamp):
            return {tag: {'number': hex(number), 'timestamp': hex(timestamp), 'hash': '0x' + 'a'*64} for tag in h.TAGS}
        local = heads(10000, 5000)
        # Gaps are seconds between head timestamps (block counts went stale at 0.2s blocks).
        for gap in (900, 1000, 1800):
            report = h.classify(local, [heads(10000+gap*5, 5000+gap)]*2, [local]*2, 8000)
            self.assertEqual(report['tags']['finalized']['status'], 'local-staleness')
        report = h.classify(local, [heads(19005, 6801)]*2, [local]*2, 8000)
        self.assertEqual(report['tags']['finalized']['status'], 'local-lag')
        report = h.classify(local, [local]*2, [local]*2, 8000)
        self.assertEqual(report['tags']['finalized']['status'], 'chainwide-lag')
        bad = copy.deepcopy(local)
        bad['finalized']['hash'] = '0x' + 'b'*64
        report = h.classify(local, [local]*2, [local, bad], 8000)
        self.assertEqual(report['status'], 'provider-disagreement')

    def test_restart_alerts_on_increase_then_recovers_after_an_hour(self):
        s, x = {}, healthy()
        x['resources']['container_node'] = 'running|healthy|5|false'  # historical restarts: quiet
        self.assertIsNone(m.transition(s, x, 0))
        x['resources']['container_node'] = 'running|healthy|7|false'
        e = m.transition(s, x, 100)
        self.assertIn('🔴 op-node container restarted (restart count 5 → 7)', e['text'])
        m.acknowledge(s, e['eventId'], '1', 100)
        self.assertIsNone(m.transition(s, x, 3000))
        r = m.transition(s, x, 3700)
        self.assertIn('🟢 OK again: op-node container restarted', r['text'])
        m.acknowledge(s, r['eventId'], '2', 3700)
        x['resources']['container_node'] = 'running|healthy|0|false'  # recreated: not a restart
        self.assertIsNone(m.transition(s, x, 3800))

    def test_recreate_within_the_hour_does_not_recover_early(self):
        s, x = {}, healthy()
        x['resources']['container_node'] = 'running|healthy|5|false'
        self.assertIsNone(m.transition(s, x, 0))
        x['resources']['container_node'] = 'running|healthy|7|false'
        m.acknowledge(s, m.transition(s, x, 100)['eventId'], '1', 100)
        x['resources']['container_node'] = 'running|healthy|0|false'  # recreated 10 min after the restart
        for tick in (700, 1000, 3600):
            self.assertIsNone(m.transition(s, x, tick))
        r = m.transition(s, x, 3700)  # an hour after the last restart, not at the recreate
        self.assertIn('🟢 OK again: op-node container restarted (restart count 5 → 7)', r['text'])
        m.acknowledge(s, r['eventId'], '2', 3700)
        x['resources']['container_node'] = 'running|healthy|1|false'  # restarts count from the new baseline
        self.assertIn('🔴 op-node container restarted (restart count 0 → 1)', m.transition(s, x, 3800)['text'])

    def test_non_ascii_restart_count_is_unreadable_not_a_crash(self):
        s, x = {}, healthy()
        for count in ('²', '٣', '５'):  # str.isdigit() is True for all three, int() rejects the first
            x['resources']['container_node'] = 'running|healthy|' + count + '|false'
            self.assertIsNone(m.transition(s, x, 0))
            self.assertEqual(m.signals(x, s, 0)['restarts-node'], (None, 1))
        self.assertNotIn('node', s['restartSeen'])

    def test_every_message_carries_its_event_id(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        e = m.transition(s, x, 0)
        self.assertTrue(e['text'].startswith('Base node monitor\n'))
        self.assertTrue(e['text'].endswith('\nid: ' + e['eventId']))
        m.claim(s, e['eventId'], 0)
        m.finish_send(s, e['eventId'])
        notice = m.transition(s, x, 1)  # custody escalation names the held alert by the same id
        self.assertIn('Not sure alert ' + e['eventId'], notice['text'])
        self.assertTrue(notice['text'].startswith('Base node monitor\n'))
        self.assertTrue(notice['text'].endswith('\nid: ' + notice['eventId']))

    def test_unreadable_values_are_not_described_as_failures(self):
        s, x = {}, healthy()
        x['resources'].update(container_node='unknown', syncing='unknown', disk_pct='garbled' * 600,
                              node_critical_errors='')
        text = m.transition(s, x, 0)['text']
        for line in ("can't read op-node container status", "can't read execution client sync status",
                     "can't read chain disk usage", "can't read op-node logs (panic/fatal errors)"):
            self.assertIn(line, text)
        for wrong in ('OOM-killed', 'reports it is syncing', '80% full', 'logged panic', 'garbled'):
            self.assertNotIn(wrong, text)
        self.assertLess(len(text), 3900)

    def test_disk_value_is_the_parsed_number(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        self.assertIn('chain disk over 80% full (now 81%)', m.transition(s, x, 0)['text'])
        self.assertEqual(m.describe('resource-disk_pct', {'resources': {'disk_pct': 'x' * 5000}}, {}, active=False),
                         'chain disk over 80% full')


    def test_rejected_telemetry_records_private_reason(self):
        s, x = {}, healthy()
        mission(x)['admission']['lastCanonicalSettlementAt'] = '1970-01-01T00:01:00Z'
        m.transition(s, x, 29)
        self.assertEqual(s['lastTelemetryError'], {'at': 29, 'error': 'ValueError: future progress timestamp'})
        self.assertFalse(s['incidents'][m.HOSTS[0] + ':mission-telemetry']['active'])
        self.assertEqual(s['incidents'][m.HOSTS[0] + ':mission-telemetry']['streak'], 1)
        mission(x)['admission']['lastCanonicalSettlementAt'] = 'https://user:SECRET@upstream.invalid/'
        m.transition(s, x, 40)
        self.assertEqual(s['lastTelemetryError'], {'at': 40, 'error': 'ValueError: invalid timestamp field'})
        self.assertNotIn('SECRET', json.dumps(s))

    def test_sample_is_judged_at_collection_end(self):
        # collect() takes 25-60 s; a settlement stamped while it ran is not "from the future".
        x = healthy()
        mission(x)['admission']['lastCanonicalSettlementAt'] = '1970-01-01T00:16:40Z'  # t=1000
        clock = iter([900, 1000, 1000])  # pre-collect, post-collect, spare

        def collect(health_dir, state, persist):
            return copy.deepcopy(x)

        with tempfile.TemporaryDirectory(dir=m.HERE) as directory:
            path = Path(directory) / 'state.json'
            argv = ['monitor.py', '--state', str(path), '--health-dir', directory]
            with patch.object(m, 'collect', side_effect=collect), patch.object(m.time, 'time', lambda: next(clock)), \
                    patch('sys.argv', argv), patch('sys.stdout', new_callable=io.StringIO):
                m.main()
            state = json.loads(path.read_text())
        self.assertIsNone(state.get('lastTelemetryError'))
        self.assertEqual(state['lastObservedAt'], 1000)


if __name__ == '__main__':
    unittest.main()

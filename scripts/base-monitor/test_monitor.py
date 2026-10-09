import copy
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
        self.assertIn('finalized-local-lag', event['text'])
        self.assertFalse(s['incidents']['node-finalized-local-lag']['notified'])

    def test_two_admission_and_single_recovery(self):
        s, x = {}, healthy()
        mission(x)['admission']['blockedReason'] = 'unresolved-intent'
        self.assertIsNone(m.transition(s, x, 0))
        event = m.transition(s, x, 10)
        self.assertIn('admission-unresolved-intent', event['text'])
        m.acknowledge(s, event['eventId'], '123', 10)
        mission(x)['admission']['blockedReason'] = None
        recovery = m.transition(s, x, 20)
        self.assertIn('RECOVERED', recovery['text'])
        m.acknowledge(s, recovery['eventId'], '124', 20)
        self.assertIsNone(m.transition(s, x, 30))

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
        self.assertIn('RECOVERED', m.transition(s, x, 20)['text'])

    def test_progress_120_and_pause(self):
        s, x = {}, healthy()
        mission(x)['dueArrivals'] = {'count': 1, 'oldestAgeSeconds': 30}
        self.assertIsNone(m.transition(s, x, 1000))
        self.assertIsNone(m.transition(s, x, 1119))
        event = m.transition(s, x, 1120)
        self.assertIn('no-settlement-120s', event['text'])
        m.acknowledge(s, event['eventId'], '125', 1120)
        mission(x)['admission']['lastCanonicalSettlementAt'] = '1970-01-01T00:18:41Z'
        self.assertIn('RECOVERED', m.transition(s, x, 1121)['text'])
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
        self.assertIn('ssh-unavailable', e['text'])
        self.assertNotIn('RECOVERED', e['text'])

    def test_blind_spot_breaks_consecutive_samples(self):
        s, x = {}, healthy()
        mission(x)['admission']['blockedReason'] = 'unresolved-intent'
        self.assertIsNone(m.transition(s, x, 0))
        good = copy.deepcopy(x)
        del mission(x)['admission']
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIsNone(m.transition(s, good, 20))
        self.assertIn('admission-unresolved-intent', m.transition(s, good, 30)['text'])

    def test_storage_counts_funds_and_reset_thresholds(self):
        s, x = {}, healthy()
        a = mission(x)['admission']
        a.update(retainedConfirmed=3072, journalBytes=192*1024*1024, active=32, countsCapped=True)
        x['resources']['node_reset_events'] = '3'
        x['balanceWei'] -= 1
        event = m.transition(s, x, 0)
        for key in ('retention-warning', 'journal-warning', 'active-capacity', 'counts-capped', 'node_reset_events'):
            self.assertIn(key, event['text'])
        m.acknowledge(s, event['eventId'], '125', 0)
        self.assertIsNone(m.transition(s, x, 10))
        self.assertIn('signer-funds-low', m.transition(s, x, 20)['text'])

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
        error = urllib.error.HTTPError('https://example.invalid', 429, 'SECRET', {}, None)
        with patch.object(m.urllib.request, 'build_opener') as factory:
            factory.return_value.open.side_effect = error
            with self.assertRaisesRegex(ValueError, '^HTTP unavailable$'):
                m.http_json('https://example.invalid')
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
        for gap in (60, 61, 100, 900):
            report = h.classify(local, [heads(10000+gap, 7900)]*2, [local]*2, 8000)
            self.assertEqual(report['tags']['finalized']['status'], 'local-staleness')
        report = h.classify(local, [heads(10901, 7900)]*2, [local]*2, 8000)
        self.assertEqual(report['tags']['finalized']['status'], 'local-lag')
        report = h.classify(local, [local]*2, [local]*2, 8000)
        self.assertEqual(report['tags']['finalized']['status'], 'chainwide-lag')
        bad = copy.deepcopy(local)
        bad['finalized']['hash'] = '0x' + 'b'*64
        report = h.classify(local, [local]*2, [local, bad], 8000)
        self.assertEqual(report['status'], 'provider-disagreement')


if __name__ == '__main__':
    unittest.main()

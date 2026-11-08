import copy
import unittest

import monitor as m
from test_monitor import healthy

DAY = m.STALE_HELD_SECONDS


def held_alert(s, x, at):
    """Disk alert claimed at `at`, send outcome unknown, migrated into held with its diagnostic acked."""
    x['resources']['disk_pct'] = '81'
    e = copy.deepcopy(m.transition(s, x, at))
    m.claim(s, e['eventId'], at)
    m.finish_send(s, e['eventId'])
    notice = m.transition(s, x, at + 1)
    m.acknowledge(s, notice['eventId'], '120', at + 1)
    return e


class RetireTests(unittest.TestCase):
    def test_operator_retire_rearms_active_signal_without_resend(self):
        s, x = {}, healthy()
        e = held_alert(s, x, 0)
        with self.assertRaises(ValueError):
            m.retire_stale(s, e['eventId'], '', 5)
        with self.assertRaises(ValueError):
            m.retire_stale(s, 'f' * 24, 'ref', 5)
        s['sender'] = {'eventId': 'x', 'claimedAt': 4}
        with self.assertRaises(ValueError):
            m.retire_stale(s, e['eventId'], 'ref', 5)
        s['sender'] = None
        m.retire_stale(s, e['eventId'], 'telegram-1-operator-retire', 5)
        self.assertEqual(s['held'], [])
        self.assertEqual(s['lastReconciliation'], {'eventId': e['eventId'], 'outcome': 'retired-stale-unproven',
                                                   'evidence': 'telegram-1-operator-retire', 'at': 5})
        self.assertEqual(m.custody(s)['status'], 'clear')
        self.assertNotEqual(s['lastAck']['eventId'], e['eventId'])  # no fake receipt
        item = s['incidents']['resource-disk_pct']
        self.assertEqual((item['notified'], item['streak'], item['active']), (False, 0, False))
        # Still-active incident alerts fresh under a NEW event ID; the original is never replayed.
        fresh = m.transition(s, x, 6)
        self.assertNotEqual(fresh['eventId'], e['eventId'])
        self.assertIn('🔴 chain disk over 80% full', fresh['text'])
        self.assertNotIn('unconfirmed delivery', fresh['text'])
        self.assertNotIn('Gave up on', fresh['text'])  # operator retirement is not auto-announced

    def test_operator_retire_of_held_recovery_emits_no_stale_recovered(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        m.acknowledge(s, m.transition(s, x, 0)['eventId'], '1', 0)
        x['resources']['disk_pct'] = '39'
        e = m.transition(s, x, 1)
        m.claim(s, e['eventId'], 1)
        m.finish_send(s, e['eventId'])
        m.acknowledge(s, m.transition(s, x, 2)['eventId'], '2', 2)
        m.retire_stale(s, e['eventId'], 'ref', 3)
        for tick in range(4, 10):
            self.assertIsNone(m.transition(s, x, tick))
        x['resources']['disk_pct'] = '81'
        self.assertIn('🔴 chain disk over 80% full', m.transition(s, x, 10)['text'])

    def test_key_fenced_by_old_held_event_alerts_again(self):
        s, x = {}, healthy()
        e = held_alert(s, x, 0)
        for tick in range(2, 50):
            self.assertIsNone(m.transition(s, x, tick))
        self.assertIsNone(m.transition(s, x, DAY - 1))
        notice = m.transition(s, x, DAY)
        self.assertEqual(s['held'], [])
        self.assertEqual(s['retired'][-1]['outcome'], 'retired-stale-auto')
        self.assertTrue(notice['diagnostic'])
        self.assertEqual(notice['changes'], [])
        self.assertIn('Gave up on 1 unconfirmed alert(s) after 24h (' + e['eventId'], notice['text'])
        self.assertNotIn('disk_pct', notice['text'])  # never a resend of the original text
        m.acknowledge(s, notice['eventId'], '130', DAY)
        alert = m.transition(s, x, DAY + 300)
        self.assertNotEqual(alert['eventId'], e['eventId'])
        self.assertIn('🔴 chain disk over 80% full', alert['text'])
        self.assertNotIn('Gave up on', alert['text'])  # announced exactly once
        self.assertEqual(m.custody(s)['status'], 'clear')

    def test_retire_announcement_survives_unclaimed_ready_proposal(self):
        s, x = {}, healthy()
        e = held_alert(s, x, 0)
        x['resources']['node_critical_errors'] = '1'
        ready = m.transition(s, x, 10)  # proposed but never claimed
        self.assertIs(m.transition(s, x, DAY), ready)
        self.assertEqual(s['held'], [])
        m.acknowledge(s, ready['eventId'], '140', DAY)
        notice = m.transition(s, x, DAY + 1)
        self.assertIn(e['eventId'], notice['text'])
        self.assertIn('Gave up on 1', notice['text'])

    def test_age_unfence_frees_capacity_and_handles_legacy_events(self):
        s, x = {}, healthy()
        m.transition(s, x, 0)
        s['held'] = [{'eventId': format(i, '024x'), 'text': 'held', 'changes': [['resource-disk_pct', False]],
                      'delivery': {'status': 'uncertain', 'claimedAt': 0}} for i in range(m.MAX_HELD - 1)]
        s['held'].append({'eventId': 'a' * 24, 'text': 'legacy', 'changes': [['syncing', True]]})
        x['resources']['syncing'] = 'true'
        self.assertIsNone(m.transition(s, x, 100))
        self.assertEqual(s['heldSeen'], {'a' * 24: 100})
        self.assertTrue(m.custody(s)['capacityReached'])
        notice = m.transition(s, x, DAY)
        self.assertEqual([e['eventId'] for e in s['held']], ['a' * 24])  # legacy aged from first sighting
        self.assertIn('Gave up on ' + str(m.MAX_HELD - 1), notice['text'])
        self.assertLess(len(notice['text']), 3900)
        m.acknowledge(s, notice['eventId'], '150', DAY)
        self.assertIsNone(m.transition(s, x, DAY + 50))  # syncing still fenced by the legacy event
        m.transition(s, x, DAY + 100)
        self.assertEqual(s['held'], [])
        self.assertIn('Gave up on 1', s['pending']['text'])
        m.acknowledge(s, s['pending']['eventId'], '151', DAY + 100)
        self.assertIn('🔴 execution client reports it is syncing', m.transition(s, x, DAY + 200)['text'])
        self.assertLessEqual(len(s['retired']), m.MAX_RETIRED)

    def test_cli_retire_stale(self):
        import json, subprocess, sys, tempfile
        from pathlib import Path
        s, x = {}, healthy()
        e = held_alert(s, x, 0)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'state'
            m.atomic_save(p, s)
            run = lambda *a: subprocess.run([sys.executable, str(Path(m.__file__)), '--state', str(p), *a],
                                            capture_output=True, text=True)
            self.assertEqual(run('--retire-stale', e['eventId']).returncode, 1)  # evidence required
            r = run('--retire-stale', e['eventId'], '--evidence', 'telegram-23974-operator-retire')
            out = json.loads(r.stdout)
            self.assertEqual((out['status'], out['custody']['status']), ('retired', 'clear'))
            t = json.loads(p.read_text())
            self.assertEqual(t['lastReconciliation']['outcome'], 'retired-stale-unproven')
            self.assertEqual(t['retired'][0]['evidence'], 'telegram-23974-operator-retire')

    def test_broken_transport_attempts_stay_bounded(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        per_day = []
        for day in range(6):
            attempts = 0
            for tick in range(day * DAY, (day + 1) * DAY, 300):
                e = m.transition(s, x, tick)
                if e and m.claim(s, e['eventId'], tick)['status'] == 'claimed':
                    attempts += 1
                    m.finish_send(s, e['eventId'])  # send never proves delivery
            per_day.append(attempts)
            self.assertLessEqual(len(s['held']), 3)
        # Fresh ALERT + its escalation + one retirement notice per day; no growth, no recursion.
        self.assertLessEqual(max(per_day), 3)
        self.assertEqual(per_day[2:], [per_day[2]] * 4)
        notices = [r for r in s['retired'] if r.get('diagnostic')]
        self.assertTrue(notices)
        self.assertTrue(all('announcedIn' not in r for r in notices))

    def test_retired_history_keeps_unannounced_records(self):
        s = {'incidents': {}, 'held': []}
        s['retired'] = [{'eventId': format(i, '024x'), 'outcome': 'retired-stale-unproven', 'changes': []}
                        for i in range(m.MAX_RETIRED - 1)]
        s['retired'].insert(0, {'eventId': 'b' * 24, 'outcome': 'retired-stale-auto', 'changes': [['syncing', True]]})
        event = {'eventId': 'c' * 24, 'changes': [], 'delivery': {'status': 'uncertain', 'claimedAt': 0}}
        s['held'].append(event)
        m.retire(s, event, 'retired-stale-auto', 'age', DAY)
        ids = [r['eventId'] for r in s['retired']]
        self.assertEqual(len(ids), m.MAX_RETIRED)
        self.assertIn('b' * 24, ids)
        self.assertNotIn(format(0, '024x'), ids)

    def test_operator_retire_of_unmigrated_uncertain_pending(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        e = m.transition(s, x, 0)
        m.claim(s, e['eventId'], 0)
        with self.assertRaises(ValueError):
            m.retire_stale(s, e['eventId'], 'ref', 1)  # sender fence still active
        m.finish_send(s, e['eventId'])
        m.retire_stale(s, e['eventId'], 'ref', 2)
        self.assertIsNone(s.get('pending'))
        self.assertEqual((s['held'], m.custody(s)['status']), ([], 'clear'))
        self.assertIn('🔴 chain disk over 80% full', m.transition(s, x, 3)['text'])

    def test_ready_pending_cannot_be_retired(self):
        s, x = {}, healthy()
        x['resources']['disk_pct'] = '81'
        e = m.transition(s, x, 0)
        with self.assertRaises(ValueError):
            m.retire_stale(s, e['eventId'], 'ref', 1)

    def test_sender_fence_blocks_auto_retirement(self):
        s, x = {}, healthy()
        e = held_alert(s, x, 0)
        x['resources']['node_critical_errors'] = '1'
        other = m.transition(s, x, 10)
        m.claim(s, other['eventId'], 10)
        m.transition(s, x, DAY)
        self.assertEqual([h['eventId'] for h in s['held']], [e['eventId']])


if __name__ == '__main__':
    unittest.main()

"""Loopback-only, full HTTP regressions for v1.4.2 next-L1 polling."""
import http.client
import json
import threading
import time
import unittest
from test_relay import r, Upstream, request, receipts


def block_at(number):
    return {'number': hex(number), 'hash': '0x' + format(number, '064x'),
            'parentHash': '0x' + format(number - 1, '064x')}


class FutureBlockTests(unittest.TestCase):
    def setUp(self):
        self.a, self.b = Upstream(), Upstream()
        self.head = 32
        self.nulls = set()
        self.errors = {}
        self.latest_delay = 0
        self.latest_padding = 0
        self.a.answer = self.answer
        self.reset()
        self.server = r.Server(('127.0.0.1', 0), self.relay)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def reset(self, fallback=False, cache_size=256):
        self.relay = r.Relay([self.a.url, self.b.url] if fallback else [self.a.url],
                             timeout=2, cache_size=cache_size)
        if hasattr(self, 'server'): self.server.relay = self.relay
        self.a.calls.clear()
        self.b.calls.clear()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.a.close()
        self.b.close()

    def answer(self, q):
        method, params = q['method'], q['params']
        param = params[0] if params else None
        if q['id'] in self.errors:
            return {'jsonrpc': '2.0', 'id': q['id'],
                    'error': {'code': self.errors[q['id']], 'message': 'SYNTHETIC_SECRET'}}
        value = '0x1'
        if method == 'eth_blockNumber': value = hex(self.head)
        if method == 'eth_getBlockReceipts': value = receipts()
        if method in ('eth_getBlockByNumber', 'eth_getBlockByHash'):
            number = (16 if param == 'finalized' else self.head if param in ('latest', 'safe', 'pending')
                      else int(param, 16))
            value = block_at(number) if number <= self.head else None
            if (method, param) in self.nulls: value = None
            if param == 'latest':
                time.sleep(self.latest_delay)
                if value is not None: value['padding'] = 'x' * self.latest_padding
        return {'jsonrpc': '2.0', 'id': q['id'], 'result': value}

    def call(self, payload):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=4)
        try:
            connection.request('POST', '/', json.dumps(payload))
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def numeric(self, number, ident=10):
        return request('eth_getBlockByNumber', [hex(number), False], ident)

    def latest_calls(self):
        return sum(isinstance(q, dict) and q['method'] == 'eth_getBlockByNumber'
                   and q['params'][0] == 'latest' for q in self.a.calls)

    def assert_healthy(self):
        self.assertEqual(self.relay.blocked, [0] * len(self.relay.urls))
        self.assertEqual(self.relay.failures, [0] * len(self.relay.urls))
        self.assertEqual(self.relay.rate_hold, 0)
        self.assertIsNone(self.relay.last_error)
        self.assertFalse(self.b.calls)

    def test_next_l1_null_then_unrelated_receipts_and_later_block(self):
        for fallback in (False, True):
            with self.subTest(fallback=fallback):
                self.reset(fallback=fallback)
                self.head = 32
                status, body = self.call(self.numeric(33))
                self.assertEqual((status, body['result']), (200, None))
                self.assertEqual(self.latest_calls(), 1)
                self.assertFalse(self.relay.learned)
                self.assertEqual(self.relay.highest_block, 32)
                self.assertEqual(self.call(request('eth_getBlockReceipts', ['0x10']))[0], 200)
                self.assertEqual(self.call(request('eth_chainId'))[0], 200)
                self.assert_healthy()
                self.head = 33
                status, body = self.call(self.numeric(33))
                self.assertEqual((status, body['result']['number']), (200, '0x21'))
                self.assertEqual(self.relay.learned[block_at(33)['hash']], '0x21')
                self.assertEqual(self.latest_calls(), 1)
                self.assert_healthy()

    def test_future_claim_requires_fresh_latest_not_just_cache_miss(self):
        for number in (17, 32):
            with self.subTest(number=number):
                self.reset()
                self.nulls = {('eth_getBlockByNumber', hex(number))}
                self.assertEqual(self.call(self.numeric(number))[0], 503)
                self.assertEqual(self.latest_calls(), 1)
                self.assertGreater(self.relay.blocked[0], time.monotonic())
                self.assertFalse(self.relay.learned)
        self.reset()
        self.nulls = set()
        self.assertEqual(self.call(self.numeric(33))[0], 200)
        self.head = 34
        self.nulls = {('eth_getBlockByNumber', '0x21')}
        self.assertEqual(self.call(self.numeric(33))[0], 503)
        self.assertEqual(self.latest_calls(), 2)  # No stale cached latest exemption.

    def test_known_anchor_learned_and_evicted_past_never_become_future(self):
        self.reset(cache_size=1)
        self.assertEqual(self.call(self.numeric(32))[0], 200)
        self.assertEqual(self.call(self.numeric(17))[0], 200)  # Evict newest height.
        self.assertNotIn(block_at(32)['hash'], self.relay.learned)
        self.head = 18  # A regressed upstream must not reclassify lost history.
        for number in (16, 17, 31, 32):
            with self.subTest(number=number):
                self.relay.blocked = [0]  # Advance fixture cooldown only.
                self.nulls = {('eth_getBlockByNumber', hex(number))}
                self.assertEqual(self.call(self.numeric(number))[0], 503)
                self.assertEqual(self.latest_calls(), 0)
                self.assertEqual(self.relay.highest_block, 32)
        self.relay.blocked = [0]
        self.nulls = set()
        self.assertEqual(self.call(self.numeric(40))[0], 503)  # latest itself regressed.
        self.assertEqual(self.latest_calls(), 1)

    def test_same_batch_known_height_in_either_request_and_response_order(self):
        for method, param in (('eth_getBlockByNumber', '0x20'),
                              ('eth_getBlockByHash', block_at(32)['hash']),
                              ('eth_blockNumber', None)):
            for request_reverse in (False, True):
                for response_reverse in (False, True):
                    with self.subTest(method=method, requests=request_reverse, responses=response_reverse):
                        self.reset()
                        # Same-height numeric sibling has a distinct id/result.
                        def answer(q):
                            if q['id'] == 10:
                                return {'jsonrpc': '2.0', 'id': 10, 'result': None}
                            return self.answer(q)
                        self.a.answer = answer
                        self.a.reverse = response_reverse
                        payload = [self.numeric(32), request(method, [] if param is None else [param, False], 11)]
                        if request_reverse: payload.reverse()
                        self.assertEqual(self.call(payload)[0], 503)
                        self.assertEqual(self.latest_calls(), 0)
                        self.assertFalse(self.relay.learned)

    def test_mixed_future_batch_uses_one_bounded_latest_read_and_skips_cache(self):
        for reverse in (False, True):
            self.reset()
            self.a.reverse = reverse
            payload = [self.numeric(33 + n, n) for n in range(99)] + [self.numeric(32, 100)]
            status, body = self.call(payload)
            self.assertEqual(status, 200)
            self.assertEqual(sum(item['result'] is None for item in body), 99)
            self.assertEqual(self.latest_calls(), 1)
            self.assertEqual(dict(self.relay.learned), {block_at(32)['hash']: '0x20'})
            self.assert_healthy()

    def test_tag_hash_and_other_required_nulls_stay_fail_closed(self):
        self.assertEqual(self.call(self.numeric(32))[0], 200)
        for method, param in ([('eth_getBlockByNumber', tag) for tag in ('latest', 'safe', 'finalized', 'pending')]
                              + [('eth_getBlockByHash', block_at(32)['hash']),
                                 ('eth_getBlockByHash', block_at(40)['hash']),
                                 ('eth_getBlockReceipts', '0x21'),
                                 ('debug_getRawHeader', '0x21'), ('debug_getRawReceipts', '0x21')]):
            with self.subTest(method=method, param=param):
                self.relay.blocked = [0]
                self.a.answer = lambda q: ({'jsonrpc': '2.0', 'id': q['id'], 'result': None}
                                          if q['id'] == 10 else self.answer(q))
                self.assertEqual(self.call(request(method, [param, False], 10))[0], 503)
                self.assertGreater(self.relay.blocked[0], time.monotonic())

    def test_batch_quota_dominates_future_null_in_all_orders(self):
        for code in (429, -32005, -32016):
            for request_reverse in (False, True):
                for response_reverse in (False, True):
                    with self.subTest(code=code, requests=request_reverse, responses=response_reverse):
                        self.reset(fallback=True)
                        self.errors = {11: code}
                        self.a.reverse = response_reverse
                        payload = [self.numeric(33), request('eth_chainId', [], 11)]
                        if request_reverse: payload.reverse()
                        status, body = self.call(payload)
                        self.assertEqual(status, 503)
                        self.assertNotIn('SYNTHETIC_SECRET', json.dumps(body))
                        self.assertGreater(self.relay.rate_hold, time.monotonic() + 59)
                        self.assertEqual(self.latest_calls(), 0)
                        self.assertEqual(self.relay.failures, [0, 0])
                        self.assertEqual(self.relay.blocked, [0, 0])
                        count = len(self.a.calls)
                        self.assertEqual(self.call(request('eth_chainId'))[0], 503)
                        self.assertEqual(len(self.a.calls), count)
                        self.assertFalse(self.b.calls)

    def test_latest_proof_quota_and_invalid_proof_fail_closed_without_recursion(self):
        for mode in ('null', 'application', 'rpc429', 'http429', 'oversize', 'slow'):
            with self.subTest(mode=mode):
                self.reset(fallback=mode in ('rpc429', 'http429'))
                self.assertEqual(self.call(request('eth_chainId'))[0], 200)
                def answer(q):
                    if q['method'] == 'eth_getBlockByNumber' and q['params'][0] == 'latest':
                        if mode == 'null': return {'jsonrpc': '2.0', 'id': q['id'], 'result': None}
                        if mode in ('application', 'rpc429'):
                            return {'jsonrpc': '2.0', 'id': q['id'], 'error': {
                                'code': -32601 if mode == 'application' else -32005, 'message': 'secret'}}
                    response = self.answer(q)
                    if q['id'] == 10 and mode == 'http429': self.a.mode = '429'
                    return response
                self.a.answer = answer
                self.latest_padding = 1024*1024 if mode == 'oversize' else 0
                self.latest_delay = .3 if mode == 'slow' else 0
                self.relay.timeout = .15 if mode == 'slow' else 2
                start = time.monotonic()
                self.assertEqual(self.call(self.numeric(33))[0], 503)
                self.assertEqual(self.latest_calls(), 1)
                self.assertFalse(self.relay.lock.locked())
                self.assertFalse(self.relay.learned)
                self.assertFalse(self.b.calls)
                if mode == 'slow': self.assertLess(time.monotonic() - start, .5)
                if mode in ('rpc429', 'http429'):
                    self.assertGreater(self.relay.rate_hold, time.monotonic() + 59)
                    count = len(self.a.calls)
                    self.assertEqual(self.call(request('eth_chainId'))[0], 503)
                    self.assertEqual(len(self.a.calls), count)
                self.a.mode = 'ok'
                self.a.answer = self.answer
                self.latest_delay = self.latest_padding = 0

    def test_malformed_numeric_null_and_mismatching_sibling_fail_closed(self):
        self.assertEqual(self.call(request('eth_chainId'))[0], 200)
        for param in ('0x', '0xnope', '0x-1'):
            with self.subTest(param=param):
                self.relay.blocked = [0]
                self.a.answer = lambda q: {'jsonrpc': '2.0', 'id': q['id'], 'result': None}
                self.assertEqual(self.call(request('eth_getBlockByNumber', [param, False], 10))[0], 503)
                self.assertEqual(self.latest_calls(), 0)
        for reverse in (False, True):
            self.reset()
            self.a.reverse = reverse
            def answer(q):
                if q['id'] == 11:
                    return {'jsonrpc': '2.0', 'id': 11, 'result': block_at(31)}
                return self.answer(q)
            self.a.answer = answer
            self.assertEqual(self.call([self.numeric(33), self.numeric(32, 11)])[0], 503)
            self.assertEqual(self.latest_calls(), 0)
            self.assertFalse(self.relay.learned)

    def test_latest_identity_matches_anchor_retained_and_all_sibling_orders(self):
        for evidence in ('anchor', 'retained', 'sibling'):
            for request_reverse in (False, True):
                for response_reverse in (False, True):
                    for contradict in (False, True):
                        with self.subTest(evidence=evidence, requests=request_reverse,
                                          responses=response_reverse, contradict=contradict):
                            self.reset()
                            self.a.answer = self.answer
                            self.head = 16 if evidence == 'anchor' else 32
                            if evidence == 'retained':
                                self.assertEqual(self.call(self.numeric(self.head))[0], 200)
                            learned_before = dict(self.relay.learned)
                            def answer(q):
                                response = self.answer(q)
                                if q['method'] == 'eth_getBlockByNumber' and q['params'][0] == 'latest':
                                    response['result']['hash'] = ('0x' + 'f'*64 if contradict
                                                                  else block_at(self.head)['hash'])
                                return response
                            self.a.answer = answer
                            self.a.reverse = response_reverse
                            payload = [self.numeric(self.head + 1),
                                       self.numeric(self.head, 11) if evidence == 'sibling'
                                       else request('eth_chainId', [], 11)]
                            if request_reverse: payload.reverse()
                            status, _ = self.call(payload)
                            self.assertEqual(status, 503 if contradict else 200)
                            self.assertEqual(self.latest_calls(), 1)
                            if contradict:
                                self.assertEqual(self.relay.last_error, 'upstream latest identity disagreement')
                                self.assertEqual(dict(self.relay.learned), learned_before)
                                self.assertGreater(self.relay.blocked[0], time.monotonic())
                            else:
                                self.assert_healthy()

    def test_future_application_unavailability_is_not_whitelisted(self):
        self.errors = {10: -32002}
        self.assertEqual(self.call(self.numeric(33))[0], 503)
        self.assertEqual(self.latest_calls(), 0)
        self.assertGreater(self.relay.blocked[0], time.monotonic())


if __name__ == '__main__':
    unittest.main()

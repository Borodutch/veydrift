#!/usr/bin/env python3
"""Drop-in L1 HTTP relay. Never proxies sends; URLs/error bodies never enter diagnostics."""
import collections
import email.utils
import http.client
import json
import math
import os
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class RelayError(Exception):
    def __init__(self, reason, retry_after=0):
        super().__init__(reason)
        self.retry_after = retry_after


def quantity(value):
    if not isinstance(value, str) or not value.startswith('0x'):
        raise RelayError('malformed quantity')
    try:
        result = int(value, 16)
        if result < 0: raise ValueError()
        return result
    except ValueError:
        raise RelayError('malformed quantity') from None


def hexdata(value, size=None):
    if not isinstance(value, str) or not value.startswith('0x') or len(value) % 2 or (size is not None and len(value) != 2+size*2):
        raise RelayError('malformed hex data')
    try: bytes.fromhex(value[2:])
    except ValueError: raise RelayError('malformed hex data') from None
    return value


def block(value):
    if not isinstance(value, dict):
        raise RelayError('required block unavailable')
    for key in ('hash', 'parentHash'):
        if not isinstance(value.get(key), str) or len(value[key]) != 66 or not value[key].startswith('0x'):
            raise RelayError('malformed block identity')
        try: int(value[key][2:], 16)
        except ValueError: raise RelayError('malformed block identity') from None
    quantity(value.get('number'))
    return value


def retry_seconds(value, now=None):
    try:
        seconds = float(value)
    except (ValueError, TypeError):
        try:
            seconds = email.utils.parsedate_to_datetime(value).timestamp() - (time.time() if now is None else now)
        except (ValueError, TypeError, OverflowError):
            seconds = 60
    # Never retry earlier than a server asks; unreasonably long delays remain held.
    return max(60, seconds) if math.isfinite(seconds) else 86400


class Relay:
    METHODS = frozenset(('eth_chainId', 'net_version', 'web3_clientVersion', 'eth_blockNumber',
        'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getBlockReceipts', 'eth_getTransactionReceipt',
        'eth_getTransactionByHash', 'eth_getLogs', 'eth_call', 'eth_getCode', 'eth_getBalance',
        'eth_getTransactionCount', 'eth_getStorageAt', 'eth_feeHistory', 'eth_gasPrice',
        'debug_getRawHeader', 'debug_getRawReceipts'))
    REQUIRED = frozenset(('eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getBlockReceipts',
                          'debug_getRawHeader', 'debug_getRawReceipts'))

    def __init__(self, urls, *, max_body=16*1024*1024, timeout=12, chain_id=1, cache_size=256):
        if not urls or len(urls) > 4 or not 1024 <= max_body <= 64*1024*1024 or not 0 < timeout <= 60 or not 1 <= cache_size <= 256:
            raise ValueError('invalid bounded relay configuration')
        self.urls = [urllib.parse.urlsplit(url) for url in urls]
        if any(u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.fragment for u in self.urls):
            raise ValueError('invalid upstream URL')
        self.max_body, self.timeout, self.chain_id = max_body, timeout, chain_id
        self.preferred = 0
        self.blocked = [0.0] * len(urls)
        self.rate_hold = 0.0
        self.failures = [0] * len(urls)
        self.anchor = None
        self.highest_block = -1  # Retained even when learned identities are evicted.
        self.learned = collections.OrderedDict()
        self.cache_size = cache_size
        self.lock = threading.Lock()  # Serialize related calls AND failover validation.
        self.last_success = None
        self.last_error = None

    def _request(self, index, payload, deadline, limit=None, *, anchor=None, allow_future=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RelayError('request deadline exceeded')
        u = self.urls[index]
        cls = http.client.HTTPSConnection if u.scheme == 'https' else http.client.HTTPConnection
        connection = cls(u.hostname, u.port, timeout=remaining)
        # getresponse() detaches connection.sock for Connection: close, but its
        # HTTPResponse still owns the live socket while reading chunks/trailers.
        upstream_socket = None
        response = None
        def abort():
            sock = upstream_socket or connection.sock
            if sock:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            connection.close()
        timer = threading.Timer(remaining, abort)
        timer.daemon = True
        timer.start()
        try:
            path = (u.path or '/') + ('?' + u.query if u.query else '')
            connection.request('POST', path, json.dumps(payload).encode(),
                               {'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
            upstream_socket = connection.sock
            if time.monotonic() >= deadline:
                raise RelayError('request deadline exceeded')
            response = connection.getresponse()
            if response.status == 429:
                raise RelayError('upstream rate limited', retry_seconds(response.getheader('Retry-After')))
            if response.status != 200:
                raise RelayError('upstream HTTP failure')
            cap = self.max_body if limit is None else limit
            length = response.getheader('Content-Length')
            if length is not None and (not length.isdecimal() or int(length) > cap):
                raise RelayError('upstream body limit exceeded')
            if response.getheader('Content-Encoding', 'identity') != 'identity':
                raise RelayError('unsupported upstream encoding')
            raw = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise RelayError('request deadline exceeded')
                chunk = response.read1(min(65536, cap + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
                if len(raw) > cap:
                    raise RelayError('upstream body limit exceeded')
            if time.monotonic() >= deadline:
                raise RelayError('request deadline exceeded')
            parsed = json.loads(raw)
            if time.monotonic() >= deadline:
                raise RelayError('request deadline exceeded')
            self._validate(payload, parsed, index=index, deadline=deadline,
                           anchor=anchor, allow_future=allow_future)
            responses = parsed if isinstance(parsed, list) else [parsed]
            clean = []
            for item in responses:
                envelope = {'jsonrpc': '2.0', 'id': item['id']}
                if 'error' in item:
                    envelope['error'] = {'code': item['error']['code'], 'message': 'upstream RPC application error'}
                else:
                    envelope['result'] = item['result']
                clean.append(envelope)
            parsed = clean if isinstance(parsed, list) else clean[0]
            encoded = json.dumps(parsed, separators=(',', ':')).encode()
            if len(encoded) > cap: raise RelayError('upstream body limit exceeded')
            if time.monotonic() >= deadline: raise RelayError('request deadline exceeded')
            return encoded, parsed
        except RelayError:
            raise
        except (OSError, ValueError, http.client.HTTPException, RecursionError):
            raise RelayError('upstream transport or malformed response') from None
        finally:
            timer.cancel()
            timer.join()
            if response is not None:
                response.close()
            connection.close()

    def _validate(self, payload, parsed, *, index=None, deadline=None, anchor=None, allow_future=False):
        requests = payload if isinstance(payload, list) else [payload]
        responses = parsed if isinstance(parsed, list) else [parsed]
        # Rate-limit envelopes dominate malformed/capability siblings in any order.
        for response in responses:
            if isinstance(response, dict):
                error = response.get('error')
                if isinstance(error, dict) and error.get('code') in (429, -32005, -32016):
                    raise RelayError('upstream rate limited', 60)
        if isinstance(payload, list) != isinstance(parsed, list) or len(requests) != len(responses):
            raise RelayError('invalid RPC response shape')
        by_id = {}
        for response in responses:
            if not isinstance(response, dict) or response.get('jsonrpc') != '2.0':
                raise RelayError('invalid RPC response')
            ident = response.get('id')
            if type(ident) not in (str, int) or ident in by_id:
                raise RelayError('invalid RPC response id')
            by_id[ident] = response
        future_numbers = []
        identities = [(quantity(n), h.lower()) for h, n in self.learned.items()]
        highest = self.highest_block
        for evidence in (self.anchor, anchor):
            if evidence is not None:
                highest = max(highest, quantity(evidence['number']))
                identities.append((quantity(evidence['number']), evidence['hash'].lower()))
        for number in self.learned.values():
            highest = max(highest, quantity(number))
        for request in requests:
            response = by_id.get(request['id'])
            if response is None or ('result' in response) == ('error' in response) or ('error' in response and response['error'] is None):
                raise RelayError('missing RPC result')
            error = response.get('error')
            if error is not None:
                if not isinstance(error, dict) or type(error.get('code')) is not int or not isinstance(error.get('message'), str):
                    raise RelayError('malformed RPC error')
                code = error['code']
                # Standard internal errors and EIP-1474 resource failures are
                # provider failures, not successful application responses. Geth
                # also uses -32000 for missing historical state/required blocks.
                message = error['message'].lower()
                unavailable = any(marker in message for marker in (
                    'header not found', 'block not found', 'unknown block',
                    'missing trie node', 'state is not available', 'state unavailable',
                    'historical state unavailable', 'required data unavailable'))
                if code in (-32603, -32002) or (
                    request['method'] in self.REQUIRED and (code == -32001 or (code == -32000 and unavailable))
                ):
                    raise RelayError('upstream RPC unavailable')
                continue  # Caller/capability errors and reverts pass through.
            if request['method'] in self.REQUIRED and response['result'] is None:
                param = request['params'][0] if request['params'] else None
                if allow_future and request['method'] == 'eth_getBlockByNumber' and isinstance(param, str) and param.startswith('0x'):
                    future_numbers.append(quantity(param))
                    continue  # Deferred until ALL sibling block evidence is validated.
                raise RelayError('required result unavailable')
            if request['method'] == 'eth_getBlockReceipts':
                self._receipts(request['params'], response['result'])
            if request['method'] == 'debug_getRawHeader':
                hexdata(response['result'])
            if request['method'] == 'debug_getRawReceipts':
                if not isinstance(response['result'], list): raise RelayError('malformed raw receipts')
                for raw_receipt in response['result']: hexdata(raw_receipt)
            if request['method'] in ('eth_getBlockByNumber', 'eth_getBlockByHash'):
                b = block(response['result'])
                param = request['params'][0]
                if request['method'] == 'eth_getBlockByHash' and b['hash'].lower() != param.lower():
                    raise RelayError('requested block hash mismatch')
                if request['method'] == 'eth_getBlockByNumber' and param.startswith('0x') and quantity(b['number']) != quantity(param):
                    raise RelayError('requested block number mismatch')
                highest = max(highest, quantity(b['number']))
                identities.append((quantity(b['number']), b['hash'].lower()))
            if request['method'] == 'eth_blockNumber':
                highest = max(highest, quantity(response['result']))
        if future_numbers:
            if min(future_numbers) <= highest:
                raise RelayError('required result unavailable')
            # One fresh SAME-provider latest read per response, not per null. It
            # shares the outer deadline and has a 1MiB cap; null/error cannot recurse.
            latest = self._request(index, {'jsonrpc': '2.0', 'id': 1,
                'method': 'eth_getBlockByNumber', 'params': ['latest', False]},
                deadline, 1024*1024)[1]
            if 'error' in latest:
                raise RelayError('upstream latest proof unavailable')
            latest_block = block(latest['result'])
            head = quantity(latest_block['number'])
            if any(n == head and h != latest_block['hash'].lower() for n, h in identities):
                raise RelayError('upstream latest identity disagreement')
            if head < highest or min(future_numbers) <= head:
                raise RelayError('required result unavailable')
            highest = max(highest, head)
        # Only fully validated responses can contribute durable negative evidence.
        self.highest_block = highest

    def _receipts(self, params, receipts):
        if not params or not isinstance(params[0], str) or not isinstance(receipts, list):
            raise RelayError('malformed receipt collection')
        requested = params[0]
        expected_hash = requested.lower() if len(requested) == 66 and requested.startswith('0x') else None
        expected_number = quantity(requested) if requested.startswith('0x') and expected_hash is None else None
        if expected_hash and expected_hash in self.learned:
            expected_number = quantity(self.learned[expected_hash])
        if expected_number is not None:
            learned = [h.lower() for h, n in self.learned.items() if quantity(n) == expected_number]
            if len(set(learned)) == 1: expected_hash = learned[0]
        seen = set()
        identity = None
        for receipt in receipts:
            if not isinstance(receipt, dict): raise RelayError('malformed receipt')
            h = hexdata(receipt.get('blockHash'), 32).lower()
            n = quantity(receipt.get('blockNumber'))
            tx = hexdata(receipt.get('transactionHash'), 32).lower()
            index = quantity(receipt.get('transactionIndex'))
            if tx in seen or index != len(seen): raise RelayError('invalid receipt ordering')
            seen.add(tx)
            if identity is not None and identity != (h, n): raise RelayError('mixed receipt blocks')
            identity = (h, n)
            if (expected_hash is not None and h != expected_hash) or (expected_number is not None and n != expected_number):
                raise RelayError('receipt block identity mismatch')
            if 'status' in receipt:
                if quantity(receipt['status']) not in (0, 1): raise RelayError('malformed receipt status')
            elif 'root' in receipt: hexdata(receipt['root'], 32)
            else: raise RelayError('missing receipt status')
            for key in ('cumulativeGasUsed', 'gasUsed'): quantity(receipt.get(key))
            hexdata(receipt.get('logsBloom'), 256)
            if not isinstance(receipt.get('logs'), list): raise RelayError('malformed receipt logs')
            for log in receipt['logs']:
                if not isinstance(log, dict): raise RelayError('malformed receipt log')
                if (hexdata(log.get('blockHash'), 32).lower() != h or quantity(log.get('blockNumber')) != n
                    or hexdata(log.get('transactionHash'), 32).lower() != tx or quantity(log.get('transactionIndex')) != index):
                    raise RelayError('receipt log identity mismatch')
                quantity(log.get('logIndex'))
                hexdata(log.get('address'), 20)
                hexdata(log.get('data'))
                if not isinstance(log.get('topics'), list) or len(log['topics']) > 4: raise RelayError('malformed log topics')
                for topic in log['topics']: hexdata(topic, 32)
                if log.get('removed') is not False: raise RelayError('removed or malformed receipt log')

    def _proof(self, index, deadline):
        def rpc(method, params):
            result = self._request(index, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}, deadline, 1024*1024)[1]
            if 'error' in result: raise RelayError('upstream proof capability unavailable')
            return result['result']
        if quantity(rpc('eth_chainId', [])) != self.chain_id:
            raise RelayError('upstream chain mismatch')
        if self.anchor:
            current = block(rpc('eth_getBlockByNumber', [self.anchor['number'], False]))
            if current['hash'].lower() != self.anchor['hash'].lower():
                raise RelayError('finalized anchor disagreement')
        candidate = block(rpc('eth_getBlockByNumber', ['finalized', False]))
        if self.anchor and quantity(candidate['number']) < quantity(self.anchor['number']):
            raise RelayError('upstream finalized behind anchor')
        # Every learned recent block must be available by exact hash before switch.
        # This is deliberately strict: disagreements require operator review, not mixed derivation.
        if index != self.preferred:
            for h in self.learned:
                b = block(rpc('eth_getBlockByHash', [h, False]))
                canonical = block(rpc('eth_getBlockByNumber', [b['number'], False]))
                if canonical['hash'].lower() != h.lower():
                    raise RelayError('learned canonical block disagreement')
        return candidate

    def forward(self, body):
        if len(body) > 1024*1024:
            raise RelayError('request body limit exceeded')
        try:
            payload = json.loads(body)
            requests = payload if isinstance(payload, list) else [payload]
            if not 1 <= len(requests) <= 100:
                raise ValueError()
            ids = set()
            for r in requests:
                if not isinstance(r, dict) or r.get('jsonrpc') != '2.0' or r.get('method') not in self.METHODS or not isinstance(r.get('params'), list):
                    raise ValueError()
                if type(r.get('id')) not in (int, str) or r['id'] in ids:
                    raise ValueError()
                ids.add(r['id'])
                if r['method'] in ('eth_getBlockByHash', 'eth_getBlockByNumber') and (not r['params'] or not isinstance(r['params'][0], str)):
                    raise ValueError()
        except (ValueError, TypeError, RecursionError):
            raise RelayError('invalid read-only RPC request') from None
        deadline = time.monotonic() + self.timeout
        if not self.lock.acquire(timeout=self.timeout):
            raise RelayError('relay busy')
        try:
            now = time.monotonic()
            if self.rate_hold > now:
                raise RelayError('upstream rate limited', self.rate_hold-now)
            for index in [(self.preferred + n) % len(self.urls) for n in range(len(self.urls))]:
                if self.blocked[index] > time.monotonic():
                    continue
                try:
                    anchor = self._proof(index, deadline) if self.anchor is None or index != self.preferred else self.anchor
                    raw, parsed = self._request(index, payload, deadline, anchor=anchor, allow_future=True)
                    # Update bounded learned evidence only after the entire response validates.
                    responses = parsed if isinstance(parsed, list) else [parsed]
                    by_id = {r['id']: r['result'] for r in responses if 'result' in r}
                    for request in requests:
                        if request['id'] in by_id and request['method'] in ('eth_getBlockByHash', 'eth_getBlockByNumber'):
                            b = by_id[request['id']]
                            if b is None: continue  # Proven future absence is not a block identity.
                            self.learned[b['hash']] = b['number']
                            self.learned.move_to_end(b['hash'])
                            while len(self.learned) > self.cache_size:
                                self.learned.popitem(last=False)
                    self.anchor = anchor
                    self.preferred = index
                    self.failures[index] = 0
                    self.last_success, self.last_error = time.time(), None
                    return raw
                except RelayError as error:
                    self.last_error = str(error)
                    if error.retry_after:
                        self.rate_hold = time.monotonic() + error.retry_after
                        raise  # No other provider is attempted after 429.
                    self.failures[index] = min(self.failures[index]+1, 6)
                    self.blocked[index] = time.monotonic() + min(300, 5*2**self.failures[index])
            raise RelayError('no coherent upstream available')
        finally:
            self.lock.release()

    def health(self):
        return {'ok': True, 'upstreams': len(self.urls), 'preferredIndex': self.preferred,
                'lastSuccessAt': self.last_success, 'lastError': self.last_error,
                'rateLimited': self.rate_hold > time.monotonic(), 'learnedBlocks': len(self.learned),
                'meaning': 'relay liveness, not derivation readiness'}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8
    def __init__(self, address, relay):
        self.relay = relay
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(address, Handler)
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def setup(self):
        super().setup()
        self.connection.settimeout(self.server.relay.timeout)
        def abort():
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            self.connection.close()
        self.deadline_timer = threading.Timer(self.server.relay.timeout * 2, abort)
        self.deadline_timer.daemon = True
        self.deadline_timer.start()
    def handle(self):
        try: super().handle()
        except OSError: self.close_connection = True
    def finish(self):
        try: super().finish()
        except OSError: pass
        finally: self.deadline_timer.cancel()
    def reply(self, status, body, retry=0):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        if retry:
            self.send_header('Retry-After', str(max(1, int(retry)+1)))
        self.end_headers()
        self.close_connection = True
        self.wfile.write(body)
    def do_GET(self):
        self.reply(200 if self.path == '/healthz' else 404,
                   json.dumps(self.server.relay.health() if self.path == '/healthz' else {'error': 'not found'}).encode())
    def do_POST(self):
        try:
            length = self.headers.get('Content-Length', '')
            if len(self.headers.get_all('Content-Length', [])) != 1 or self.headers.get('Transfer-Encoding') or not length.isdecimal() or not 0 < int(length) <= 1024*1024:
                self.reply(400, b'{"error":"invalid request size"}')
                return
            body = self.rfile.read(int(length))
            if len(body) != int(length):
                raise RelayError('incomplete request')
            self.reply(200, self.server.relay.forward(body))
        except RelayError as error:
            try:
                self.reply(503, json.dumps({'error': str(error)}).encode(), error.retry_after)
            except OSError:
                self.close_connection = True
        except (OSError, ValueError):
            self.close_connection = True
    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    relay = Relay([u.strip() for u in os.environ['L1_UPSTREAMS'].split(',') if u.strip()],
                  max_body=int(os.environ.get('L1_MAX_BODY_BYTES', 16*1024*1024)),
                  timeout=float(os.environ.get('L1_UPSTREAM_TIMEOUT_SECONDS', '12')))
    Server(('0.0.0.0', 8545), relay).serve_forever()

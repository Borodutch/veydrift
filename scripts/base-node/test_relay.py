import importlib.util
import json
import pathlib
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('relay', pathlib.Path(__file__).with_name('l1-rpc-failover.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
H = '0x' + 'a'*64
P = '0x' + 'b'*64
BLOCK = {'number': '0x10', 'hash': H, 'parentHash': P, 'timestamp': '0x10'}

def receipts(large=False):
    tx='0x'+'c'*64
    log={'address':'0x'+'d'*40,'topics':['0x'+'e'*64], 'data':'0x'+'ab'*1024,
         'blockHash':H,'blockNumber':'0x10','transactionHash':tx,'transactionIndex':'0x0','removed':False}
    return [{'blockHash':H,'blockNumber':'0x10','transactionHash':tx,'transactionIndex':'0x0',
             'status':'0x1','gasUsed':'0x100','cumulativeGasUsed':'0x100','logsBloom':'0x'+'00'*256,
             'logs':[dict(log,logIndex=hex(i)) for i in range(3500 if large else 1)]}]

def request(method='eth_blockNumber', params=None, ident=1):
    return {'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params or []}

class Upstream:
    def __init__(self):
        self.mode = 'ok'
        self.calls = []
        self.rpc_errors = {}
        self.reverse = False
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.calls.append(data)
                if owner.mode == '429':
                    self.send_response(429); self.send_header('Retry-After', '120'); self.end_headers(); return
                if owner.mode == 'http':
                    self.send_response(503); self.end_headers(); return
                def answer(q):
                    method = q['method']
                    value = '0x1' if method == 'eth_chainId' else '0x10'
                    if method.startswith('eth_getBlockBy'): value = dict(BLOCK)
                    if owner.mode == 'wrong-chain' and method == 'eth_chainId': value = '0x2'
                    if owner.mode == 'wrong-hash' and method.startswith('eth_getBlockBy'): value['hash'] = P
                    if owner.mode == 'null' and method.startswith('eth_getBlockBy'): value = None
                    if method == 'eth_getBlockReceipts': value = receipts(owner.mode=='large')
                    if method == 'debug_getRawReceipts': value = ['0x01']
                    if method == 'debug_getRawHeader': value = '0x01'
                    if method == 'eth_getBlockReceipts' and owner.mode == 'receipt-hash': value[0]['blockHash']=P
                    if method == 'eth_getBlockReceipts' and owner.mode == 'receipt-number': value[0]['blockNumber']='0x99'
                    if method == 'eth_getBlockReceipts' and owner.mode == 'receipt-log': value[0]['logs'][0]['blockHash']=P
                    if method == 'eth_getBlockReceipts' and owner.mode == 'receipt-shape': value=['not a receipt']
                    if method == 'eth_getBlockReceipts' and owner.mode == 'empty': value=[]
                    if method.startswith('debug_getRaw') and owner.mode == 'raw-shape': value={'raw':'invalid'}
                    result = {'jsonrpc': '2.0', 'id': q['id'], 'result': value}
                    if owner.mode == 'rpc429': result = {'jsonrpc':'2.0','id':q['id'],'error':{'code':-32005,'message':'secret'}}
                    if owner.mode == 'id': result['id'] = 'wrong'
                    if method in ('debug_getRawReceipts','eth_call','eth_getCode') and owner.mode in ('application','mixed-rate','mixed-reverse'):
                        result={'jsonrpc':'2.0','id':q['id'],'error':{'code':{'debug_getRawReceipts':-32601,'eth_call':3,'eth_getCode':-32602}[method], 'message':'SYNTHETIC_SECRET', 'data':'SYNTHETIC_SECRET'}}
                    if owner.mode.startswith('mixed-') and q['id']==2:
                        result={'jsonrpc':'2.0','id':2,'error':{'code':-32005,'message':'quota'}}
                    if owner.mode=='mixed-malformed' and q['id']==1: result={'invalid':True}
                    if owner.mode=='extension': result['providerDebug']='SYNTHETIC_SECRET'
                    if method in owner.rpc_errors:
                        code,message=owner.rpc_errors[method]
                        result={'jsonrpc':'2.0','id':q['id'],'error':{'code':code,'message':message,'data':'SYNTHETIC_SECRET'}}
                    return result
                response = [answer(q) for q in data] if isinstance(data,list) else answer(data)
                if (owner.mode=='mixed-reverse' or owner.reverse) and isinstance(response,list): response.reverse()
                body = json.dumps(response).encode()
                if owner.mode == 'malformed': body = b'not json secret'
                self.send_response(200)
                chunked = owner.mode in ('chunk-size', 'chunk-trailer')
                if chunked:
                    self.send_header('Transfer-Encoding', 'chunked')
                    self.send_header('Connection', 'close')
                else: self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                try:
                    if chunked:
                        size = format(len(body), 'x').encode() + b'\r\n'
                        if owner.mode == 'chunk-size':
                            slow = b'0'*32 + size
                            tail = body + b'\r\n0\r\n\r\n'
                        else:
                            self.wfile.write(size + body + b'\r\n0\r\n'); self.wfile.flush()
                            slow = b'X-Slow: ' + b'x'*32 + b'\r\n'
                            tail = b'\r\n'
                        for byte in slow:
                            self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(.04)
                        self.wfile.write(tail)
                    elif owner.mode == 'slow':
                        for byte in body:
                            self.wfile.write(bytes([byte])); self.wfile.flush(); time.sleep(.04)
                    else: self.wfile.write(body)
                except OSError: pass
            def log_message(self,*_): pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = False  # close() joins every bounded fixture handler.
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port) + '/private-secret'
    def close(self): self.server.shutdown(); self.server.server_close(); self.thread.join()

class RelayTests(unittest.TestCase):
    def setUp(self):
        self.a, self.b = Upstream(), Upstream()
        self.relay = r.Relay([self.a.url, self.b.url], timeout=2)
    def tearDown(self): self.a.close(); self.b.close()
    def call(self, method='eth_blockNumber', params=None):
        return json.loads(self.relay.forward(json.dumps(request(method,params)).encode()))
    def test_sticky_and_bounded_coherent_fallback(self):
        self.call('eth_getBlockByNumber',['latest',False]); self.call()
        self.assertEqual(len(self.b.calls),0)
        self.a.mode='http'; self.call(); self.assertEqual(self.relay.preferred,1)
        count=len(self.a.calls); self.call(); self.assertEqual(len(self.a.calls),count)
        self.assertTrue(any(c['method']=='eth_getBlockByHash' for c in self.b.calls))
    def test_429_never_rotates_and_respects_retry_after(self):
        for mode in ('429','rpc429'):
            self.relay.rate_hold=0; self.a.mode=mode
            with self.assertRaises(r.RelayError) as caught: self.call()
            self.assertGreaterEqual(caught.exception.retry_after,60)
            self.assertFalse(self.b.calls)
            count=len(self.a.calls)
            with self.assertRaises(r.RelayError): self.call()
            self.assertEqual(len(self.a.calls),count)
    def test_large_receipt_and_bounded_oversize(self):
        self.a.mode='large'; self.assertGreater(len(json.dumps(self.call('eth_getBlockReceipts',['0x10']))),8388608)
        self.relay.max_body=8388608; self.b.mode='large'
        with self.assertRaises(r.RelayError): self.call('eth_getBlockReceipts',['0x10'])
        self.assertEqual(self.relay.last_error,'upstream body limit exceeded')
    def test_null_learned_and_disagreeing_fallback_fail_closed(self):
        self.call('eth_getBlockByNumber',['latest',False])
        self.a.mode='null'; self.b.mode='wrong-hash'
        with self.assertRaises(r.RelayError): self.call('eth_getBlockByHash',[H,False])
        self.assertEqual(self.relay.preferred,0)
    def test_wrong_chain_rejected(self):
        self.a.mode=self.b.mode='wrong-chain'
        with self.assertRaises(r.RelayError): self.call()
    def test_malformed_response_and_ids_rejected(self):
        for mode in ('malformed','id'):
            self.relay.blocked=[0,0]; self.a.mode=self.b.mode=mode
            with self.assertRaises(r.RelayError): self.call()
    def test_slow_trickle_wall_deadline(self):
        self.call(); self.relay.timeout=.15; self.a.mode=self.b.mode='slow'
        start=time.monotonic()
        with self.assertRaises(r.RelayError): self.call()
        self.assertLess(time.monotonic()-start, .6)
    def test_connection_close_chunk_framing_total_deadline(self):
        for mode in ('chunk-size','chunk-trailer'):
            with self.subTest(mode=mode):
                self.a.mode=mode
                start=time.monotonic()
                with self.assertRaises(r.RelayError):
                    self.relay._request(0,request(),start+.15)
                self.assertLess(time.monotonic()-start,.45)
    def test_blocked_upstreams_are_not_retried(self):
        self.a.mode=self.b.mode='http'
        with self.assertRaises(r.RelayError): self.call()
        count=len(self.a.calls)+len(self.b.calls)
        with self.assertRaises(r.RelayError): self.call()
        self.assertEqual(count,len(self.a.calls)+len(self.b.calls))
    def test_batch_and_readonly_admission(self):
        payload=[request(ident=i) for i in range(100)]
        self.assertEqual(len(json.loads(self.relay.forward(json.dumps(payload).encode()))),100)
        for invalid in (payload+[request(ident=101)],request('eth_sendRawTransaction'),{},[],[request(),request()]):
            with self.assertRaises(r.RelayError): self.relay.forward(json.dumps(invalid).encode())
    def test_http_handler_and_secret_safe_health(self):
        import http.client
        server=r.Server(('127.0.0.1',0),self.relay)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            connection.request('POST','/',json.dumps(request()))
            self.assertEqual(json.load(connection.getresponse())['result'],'0x10');connection.close()
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
            connection.request('GET','/healthz')
            health=connection.getresponse().read();connection.close()
            self.assertNotIn(b'private-secret',health);self.assertIn(b'liveness',health)
        finally:server.shutdown();server.server_close();thread.join()
    def test_ingress_connection_bound(self):
        import socket
        server=r.Server(('127.0.0.1',0),self.relay)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        sockets=[]
        try:
            for _ in range(4):
                sock=socket.create_connection(('127.0.0.1',server.server_port));sockets.append(sock)
                sock.sendall(b'POST / HTTP/1.1\r\nHost: local\r\nContent-Length: 1\r\n\r\n')
            deadline=time.monotonic()+1
            while server.slots._value and time.monotonic()<deadline: time.sleep(.01)
            self.assertEqual(server.slots._value,0)
            extra=socket.create_connection(('127.0.0.1',server.server_port));extra.settimeout(1)
            try: self.assertEqual(extra.recv(1),b'')
            finally: extra.close()
        finally:
            for sock in sockets: sock.close()
            server.shutdown();server.server_close();thread.join()
    def test_cache_bound(self):
        self.relay.cache_size=1
        self.call('eth_getBlockByNumber',['latest',False])
        self.assertEqual(len(self.relay.learned),1)

if __name__=='__main__': unittest.main()

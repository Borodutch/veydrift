import http.client
import json
import socket
import threading
import time
import unittest
from test_relay import r, Upstream, request, H

class IngressRegressions(unittest.TestCase):
    def setUp(self):
        self.a,self.b=Upstream(),Upstream()
        self.relay=r.Relay([self.a.url,self.b.url],timeout=2)
        self.server=r.Server(('127.0.0.1',0),self.relay)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.a.close();self.b.close()
    def call(self,payload=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=4)
        try:
            connection.request('POST','/',json.dumps(payload or request()))
            response=connection.getresponse()
            return response.status,json.loads(response.read())
        finally:connection.close()
    def test_application_errors_preserve_codes_without_cooldown(self):
        self.call();self.a.mode='application'
        for method,code in [('debug_getRawReceipts',-32601),('eth_call',3),('eth_getCode',-32602)]:
            status,body=self.call(request(method,[H]))
            self.assertEqual(status,200);self.assertEqual(body['error']['code'],code)
            self.assertNotIn('SYNTHETIC_SECRET',json.dumps(body))
            self.assertEqual(self.call()[0],200)
            self.assertEqual(self.relay.blocked,[0,0]);self.assertFalse(self.b.calls)
        status,body=self.call([request('debug_getRawReceipts',[H]),request(ident=2)])
        self.assertEqual(status,200);self.assertIn('error',body[0]);self.assertIn('result',body[1])
        self.a.mode='extension';self.assertNotIn('SYNTHETIC_SECRET',json.dumps(self.call()))
    def test_batch_rate_limit_dominates_all_siblings(self):
        self.call()
        for mode in ('mixed-rate','mixed-reverse','mixed-malformed'):
            self.relay.rate_hold=0;self.a.mode=mode
            status,_=self.call([request('debug_getRawReceipts',[H]),request(ident=2)])
            self.assertEqual(status,503)
            self.assertGreater(self.relay.rate_hold,time.monotonic()+59)
            self.assertFalse(self.b.calls)
            count=len(self.a.calls);self.assertEqual(self.call()[0],503);self.assertEqual(len(self.a.calls),count)
    def test_internal_required_failure_uses_coherent_sticky_fallback(self):
        for error in ((-32603,'internal SYNTHETIC_SECRET'),(-32002,'resource unavailable'),
                      (-32001,'resource not found'),(-32000,'header not found SYNTHETIC_SECRET'),
                      (-32000,'missing trie node SYNTHETIC_SECRET')):
            with self.subTest(error=error):
                self.relay=r.Relay([self.a.url,self.b.url],timeout=2);self.server.relay=self.relay
                self.a.rpc_errors={};self.b.calls.clear()
                self.assertEqual(self.call(request('eth_getBlockByHash',[H,False]))[0],200)
                self.a.rpc_errors={'eth_getBlockByHash':error}
                status,body=self.call(request('eth_getBlockByHash',[H,False]))
                self.assertEqual(status,200);self.assertEqual(body['result']['hash'],H)
                self.assertEqual(self.relay.preferred,1);self.assertEqual(self.relay.failures,[1,0])
                self.assertGreater(self.relay.blocked[0],time.monotonic())
                self.assertTrue(any(q['method']=='eth_getBlockByNumber' and q['params'][0]=='0x10' for q in self.b.calls))
                count=len(self.a.calls)
                self.assertEqual(self.call(request('eth_getBlockByHash',[H,False]))[0],200)
                self.assertEqual(len(self.a.calls),count)
                self.assertNotIn('SYNTHETIC_SECRET',json.dumps(self.relay.health()))
    def test_internal_failure_cannot_report_success_or_accept_incoherent_fallback(self):
        self.call(request('eth_getBlockByHash',[H,False]));last=self.relay.last_success
        self.a.rpc_errors={'eth_getBlockByHash':(-32603,'SYNTHETIC_SECRET')}
        self.b.mode='wrong-hash'
        self.assertEqual(self.call(request('eth_getBlockByHash',[H,False]))[0],503)
        self.assertEqual(self.relay.preferred,0);self.assertEqual(self.relay.last_success,last)
        self.assertEqual(self.relay.failures,[1,1]);self.assertIsNotNone(self.relay.last_error)
        self.assertNotIn('SYNTHETIC_SECRET',json.dumps(self.relay.health()))
        count=len(self.a.calls)+len(self.b.calls)
        self.assertEqual(self.call()[0],503)
        self.assertEqual(len(self.a.calls)+len(self.b.calls),count)
    def test_mixed_internal_errors_and_rate_limit_dominance(self):
        payload=[request('eth_call',[],1),request('eth_getBlockByHash',[H,False],2),request(ident=3)]
        for reverse in (False,True):
            for rate in (False,True):
                with self.subTest(reverse=reverse,rate=rate):
                    self.relay=r.Relay([self.a.url,self.b.url],timeout=2);self.server.relay=self.relay
                    self.a.rpc_errors={};self.b.calls.clear();self.a.reverse=reverse
                    self.call(request('eth_getBlockByHash',[H,False]))
                    self.a.rpc_errors={'eth_call':(3,'execution reverted SYNTHETIC_SECRET'),
                                       'eth_getBlockByHash':(-32603,'internal SYNTHETIC_SECRET')}
                    self.b.rpc_errors={'eth_call':(3,'execution reverted SYNTHETIC_SECRET')}
                    if rate:self.a.rpc_errors['eth_blockNumber']=(-32005,'quota SYNTHETIC_SECRET')
                    status,body=self.call(payload)
                    self.assertNotIn('SYNTHETIC_SECRET',json.dumps(body))
                    if rate:
                        self.assertEqual(status,503);self.assertFalse(self.b.calls)
                        self.assertEqual(self.relay.failures,[0,0]);self.assertEqual(self.relay.blocked,[0,0])
                        self.assertGreater(self.relay.rate_hold,time.monotonic()+59)
                        count=len(self.a.calls);self.assertEqual(self.call()[0],503)
                        self.assertEqual(len(self.a.calls),count)
                    else:
                        self.assertEqual(status,200);self.assertEqual(self.relay.preferred,1)
                        self.assertEqual(body[0]['error']['code'],3);self.assertEqual(body[1]['result']['hash'],H)
    def test_ordinary_server_caller_and_revert_errors_do_not_rotate(self):
        self.call()
        for method,error in [('eth_call',(-32000,'execution reverted')),
                             ('eth_call',(-32001,'resource not found')),
                             ('eth_getBlockByHash',(-32602,'header not found: invalid params')),
                             ('debug_getRawHeader',(-32601,'not supported')),
                             ('eth_getBlockByHash',(-32000,'invalid argument'))]:
            self.a.rpc_errors={method:error}
            status,body=self.call(request(method,[H]))
            self.assertEqual(status,200);self.assertEqual(body['error']['code'],error[0])
            self.assertEqual(self.relay.blocked,[0,0]);self.assertFalse(self.b.calls)
    def test_connection_close_chunk_framing_deadline_releases_lock_and_slots(self):
        self.call()
        self.relay.timeout=.15
        for mode in ('chunk-size','chunk-trailer'):
            with self.subTest(mode=mode):
                self.relay.blocked=[0,0];self.a.mode=mode
                start=time.monotonic()
                status,_=self.call()
                self.assertEqual(status,503)
                self.assertLess(time.monotonic()-start,.45)
                self.assertFalse(self.relay.lock.locked())
                deadline=start+.55
                while self.server.slots._value!=4 and time.monotonic()<deadline:time.sleep(.005)
                self.assertEqual(self.server.slots._value,4)
                count=len(self.a.calls)+len(self.b.calls)
                self.assertEqual(self.call()[0],503)
                self.assertEqual(len(self.a.calls)+len(self.b.calls),count)
                # Advance only the test cooldown; production retains its failure hold.
                self.relay.blocked=[0,0];self.a.mode='ok'
                self.assertEqual(self.call()[0],200)
    def test_receipt_identity_shape_empty_and_tags(self):
        self.call(request('eth_getBlockByHash',[H,False]))
        for mode in ('receipt-hash','receipt-number','receipt-log','receipt-shape'):
            self.a.mode=self.b.mode=mode;self.relay.blocked=[0,0]
            self.assertEqual(self.call(request('eth_getBlockReceipts',[H]))[0],503)
            self.relay.blocked=[0,0]
            self.assertEqual(self.call(request('eth_getBlockReceipts',['0x10']))[0],503)
        for mode in ('ok','empty'):
            self.a.mode=self.b.mode=mode;self.relay.blocked=[0,0]
            self.assertEqual(self.call(request('eth_getBlockReceipts',['latest']))[0],200)
        self.a.mode=self.b.mode='raw-shape'
        for method in ('debug_getRawHeader','debug_getRawReceipts'):
            self.relay.blocked=[0,0];self.assertEqual(self.call(request(method,[H]))[0],503)
    def test_request_line_and_header_trickles_release_slots(self):
        self.relay.timeout=.15
        for prefix in (b'POST /',b'POST / HTTP/1.1' + bytes([13,10]) + b'Host: local' + bytes([13,10]) + b'X-Slow: '):
            sockets=[socket.create_connection(self.server.server_address) for _ in range(4)]
            for sock in sockets:sock.sendall(prefix)
            start=time.monotonic()
            while time.monotonic()-start<.65:
                for sock in sockets:
                    try:sock.sendall(b'x')
                    except OSError:pass
                time.sleep(.04)
            self.assertEqual(self.server.slots._value,4)
            for sock in sockets:sock.close()
            self.assertEqual(self.call()[0],200)

if __name__=='__main__':unittest.main()

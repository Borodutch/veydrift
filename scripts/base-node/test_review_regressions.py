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

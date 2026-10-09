import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from test_health import h

class Provider:
    def __init__(self, latest=1000, age=10, final=900, final_age=100):
        self.latest,self.age,self.final,self.final_age=latest,age,final,final_age
        self.malformed=False
        self.calls=0
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.calls+=1
                q=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if q['method']=='eth_chainId':value='0x2105'
                else:
                    tag=q['params'][0]
                    n=owner.latest if tag=='latest' else owner.final if tag in ('safe','finalized') else int(tag,16)
                    age=owner.age if tag=='latest' else owner.final_age
                    value={'number':hex(n),'hash':'0x'+format(n,'064x'),'parentHash':'0x'+format(n-1,'064x'),
                           'timestamp':None if owner.malformed else hex(int(time.time())-age)}
                body=json.dumps({'jsonrpc':'2.0','id':q['id'],'result':value}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def log_message(self,*_):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join()

class HealthTransportTests(unittest.TestCase):
    def setUp(self):self.local,self.a,self.b=Provider(),Provider(),Provider()
    def tearDown(self):
        for p in (self.local,self.a,self.b):p.close()
    def observe(self):return h.observe([p.url for p in (self.local,self.a,self.b)])
    def test_fresh_references_disprove_chainwide_lag(self):
        self.local.age=130
        self.a.latest=self.b.latest=1060
        result=self.observe()
        self.assertEqual(result['tags']['latest']['status'],'local-staleness')
        self.assertTrue(all(a<20 for a in result['tags']['latest']['referenceAgesSeconds']))
    def test_all_references_must_be_stale(self):
        for p in (self.local,self.a,self.b):p.age=150
        self.assertEqual(self.observe()['tags']['latest']['status'],'chainwide-lag')
        self.b.age=1
        self.assertEqual(self.observe()['tags']['latest']['status'],'local-staleness')
    def test_malformed_reference_timestamp_rejected(self):
        self.a.malformed=True
        with self.assertRaises(h.r.RelayError):self.observe()
    def test_stale_finality_gap_boundaries_over_http(self):
        self.local.latest=self.a.latest=self.b.latest=5000
        self.local.final=1000;self.local.final_age=5000
        self.a.final_age=self.b.final_age=4800
        for gap in (60,61,100,900,901):
            with self.subTest(gap=gap):
                self.a.final=self.b.final=1000+gap
                report=self.observe()
                self.assertEqual(report['tags']['latest']['status'],'observed')
                for tag in ('safe','finalized'):
                    self.assertEqual(report['tags'][tag]['status'],'local-lag' if gap>900 else 'chainwide-lag')
                self.assertFalse(h.transition({'notifiedStatus':'local-lag'},report,10000)['recovered'])
    def test_realistic_ordered_frozen_finality(self):
        for p in (self.local,self.a,self.b):p.latest=5000
        self.local.final=1000;self.local.final_age=3000
        self.a.final=self.b.final=3000
        result=self.observe()
        self.assertEqual(result['tags']['finalized']['status'],'local-lag')
        self.assertEqual(result['tags']['latest']['status'],'observed')
        self.assertLessEqual(sum(p.calls for p in (self.local,self.a,self.b)),18)

if __name__=='__main__':unittest.main()

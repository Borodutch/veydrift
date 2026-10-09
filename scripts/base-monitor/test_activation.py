import json,sys,unittest,subprocess,tempfile
from pathlib import Path
from unittest.mock import patch
import monitor as m
import ssh_rpc,health_http
sys.path.insert(1,str(m.HERE))
from test_monitor import healthy

class Tests(unittest.TestCase):
 def test_remote_script_compile(self):
  compile(ssh_rpc.REMOTE,'remote','exec')
  self.assertIn('ProxyHandler({})',ssh_rpc.REMOTE);self.assertIn('def redirect_request(self,*args,**kwargs): return None',ssh_rpc.REMOTE)
 def test_ssh_strict_host_and_no_listener(self):
  def run(argv,**kw):
   self.assertEqual(argv[:len(m.SSH)-4],m.SSH[:-4]);self.assertIn('StrictHostKeyChecking=yes',argv);self.assertNotIn('-L',argv)
   self.assertEqual(argv[-4:-1],['7','python3','-c']);self.assertEqual(kw['timeout'],8)
   return subprocess.CompletedProcess(argv,0,json.dumps({'result':'0x2105'}))
  with patch.object(ssh_rpc.subprocess,'run',side_effect=run): self.assertEqual(ssh_rpc.request(m.SSH,{'id':1})[1]['result'],'0x2105')
 def test_ssh_hold_persist_and_shared_slot(self):
  s={};saved=[]
  with patch.object(ssh_rpc.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'{"hold":3600}')) as run:
   hold=m.ProbeHolds(s,lambda x:saved.append(json.loads(json.dumps(x))))
   with self.assertRaises(ValueError):hold.call('local',lambda:ssh_rpc.request(m.SSH,{'id':1}))
   for method in ('eth_syncing','eth_getBalance'):
    with self.assertRaises(ValueError):hold.call('local',lambda:ssh_rpc.request(m.SSH,{'method':method,'id':1}))
   self.assertEqual(run.call_count,1);self.assertTrue(saved[0]['holds']['local']);self.assertNotIn('pending',s)
 def test_curl_quota_and_cleanup(self):
  roots=[]
  def run(argv,**kw):
   self.assertEqual(argv[:2],['curl','-q']);self.assertNotIn('-k',argv);self.assertNotIn('--insecure',argv);self.assertNotIn('-L',argv);self.assertEqual(kw['timeout'],8)
   h=Path(argv[argv.index('--dump-header')+1]);roots.append(h.parent);h.write_text('HTTP/2 429\nRetry-After: 3600\n')
   return subprocess.CompletedProcess(argv,0,'429')
  with patch.object(health_http.subprocess,'run',side_effect=run):
   with self.assertRaises(ValueError) as c:health_http.fetch('https://api.veydrift.com/health',m.retry_seconds)
   self.assertEqual(c.exception.retry_after,3600)
  self.assertFalse(roots[0].exists())
 def test_collect_holds_no_transport_calls(self):
  s={'holds':{k:9999999999 for k in ('local','reference1','reference2','app0','app1')}}
  with patch.object(m.subprocess,'run',side_effect=OSError()),patch.object(ssh_rpc,'request') as rpc,patch.object(ssh_rpc,'sample') as sample,patch.object(health_http,'fetch') as fetch:
   out=m.collect(m.HERE.parent/'base-node',s)
   rpc.assert_not_called();sample.assert_not_called();fetch.assert_not_called();self.assertEqual(out['node']['status'],'probe-unavailable')
 def test_collect_valid_and_reference_slots(self):
  h=m.load_health(m.HERE.parent/'base-node');heads={tag:{'number':'0x100','timestamp':'0x100','hash':'0x'+'a'*64,'parentHash':'0x'+'b'*64} for tag in h.TAGS}
  fixture=healthy();resource='\n'.join(k+'='+v for k,v in fixture['resources'].items())
  with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,resource)),patch.object(m,'load_health',return_value=h),patch.object(ssh_rpc,'sample',return_value=(heads,None)),patch.object(h,'sample',return_value=(heads,lambda _:heads)) as refs,patch.object(health_http,'fetch',return_value=(200,fixture['apps'][m.HOSTS[0]]['body'])),patch.object(ssh_rpc,'request',side_effect=[(200,{'id':62,'result':False}),(200,{'id':61,'result':hex(200000000000000)})]):
   out=m.collect(m.HERE.parent/'base-node',{})
   self.assertIn('tags',out['node']);self.assertEqual(refs.call_count,2);self.assertEqual(out['balanceWei'],200000000000000)
 def test_ack_retry_recovery_unchanged(self):
  s={};x=healthy();x['resources']['disk_pct']='80';e=m.transition(s,x,0)
  self.assertEqual(e,m.transition(s,x,10))
  m.acknowledge(s,e['eventId'],'12345',20);self.assertIsNone(m.transition(s,x,30));x['resources']['disk_pct']='39';r=m.transition(s,x,40);self.assertIn('RECOVERED',r['text'])
  m.acknowledge(s,r['eventId'],'12346',50);self.assertIsNone(m.transition(s,x,60))
if __name__=='__main__': unittest.main()

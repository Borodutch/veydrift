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
  m.acknowledge(s,e['eventId'],'12345',20);self.assertIsNone(m.transition(s,x,30));x['resources']['disk_pct']='39';r=m.transition(s,x,40);self.assertIn('OK again',r['text'])
  m.acknowledge(s,r['eventId'],'12346',50);self.assertIsNone(m.transition(s,x,60))
 def test_curl_transport_failure_retries_once(self):
  body=json.dumps({'ok':True})
  def run_factory(results):
   def run(argv,**kw):
    rc=results.pop(0)
    if rc=='timeout':raise subprocess.TimeoutExpired(argv,8)
    if rc==0:Path(argv[argv.index('--output')+1]).write_text(body)
    return subprocess.CompletedProcess(argv,rc,'200' if rc==0 else '000')
   return run
  with patch.object(health_http.subprocess,'run',side_effect=run_factory([56,0])) as run:
   self.assertEqual(health_http.fetch('https://api-test.veydrift.com/health',m.retry_seconds,retry_delay=0),(200,{'ok':True}))
   self.assertEqual(run.call_count,2)
  with patch.object(health_http.subprocess,'run',side_effect=run_factory(['timeout',28])) as run:
   with self.assertRaises(health_http.TransportError) as c:health_http.fetch('https://api-test.veydrift.com/health',m.retry_seconds,retry_delay=0)
   self.assertIn('curl exit 28',str(c.exception));self.assertEqual(run.call_count,2)
  with patch.object(health_http.subprocess,'run',side_effect=run_factory([7,0])),patch.object(health_http.time,'sleep') as sleep:
   health_http.fetch('https://api-test.veydrift.com/health',m.retry_seconds,retry_delay=3);sleep.assert_called_once_with(3)
  with patch.object(health_http.subprocess,'run',side_effect=run_factory([7,0])) as run:
   with self.assertRaises(health_http.TransportError):health_http.fetch('https://api-test.veydrift.com/health',m.retry_seconds,retry=False)
   self.assertEqual(run.call_count,1)
 def test_curl_http_status_failure_not_retried(self):
  with patch.object(health_http.subprocess,'run',return_value=subprocess.CompletedProcess([],0,'502')) as run,patch.object(health_http.time,'sleep') as sleep:
   with self.assertRaises(health_http.HealthError) as c:health_http.fetch('https://api.veydrift.com/health',m.retry_seconds)
   self.assertEqual(str(c.exception),'health HTTP 502');self.assertEqual(run.call_count,1);sleep.assert_not_called()
 def test_collect_skips_app_retry_when_late(self):
  calls=[]
  def fetch(url,_,retry=True):calls.append(retry);raise health_http.TransportError('x')
  def run(*a,**kw):clock[0]+=m.APP_RETRY_BUDGET_SECONDS+1;raise OSError()
  clock=[1000.0]
  with patch.object(m.time,'monotonic',side_effect=lambda:clock[0]),patch.object(m.subprocess,'run',side_effect=run),patch.object(m,'load_health',side_effect=OSError()),patch.object(health_http,'fetch',side_effect=fetch):
   m.collect(m.HERE.parent/'base-node',{})
  self.assertEqual(calls,[False,False])
  calls.clear()
  with patch.object(m.subprocess,'run',side_effect=OSError()),patch.object(m,'load_health',side_effect=OSError()),patch.object(health_http,'fetch',side_effect=fetch):
   m.collect(m.HERE.parent/'base-node',{})
  self.assertEqual(calls,[True,True])
 def test_collect_records_app_error_without_secrets(self):
  def fetch(url,_,retry=True):
   if 'api-test' in url:raise health_http.TransportError('health transport unavailable (curl exit 7 after 0s)')
   raise OSError('SECRET')
  s={}
  with patch.object(m.subprocess,'run',side_effect=OSError('SECRET')),patch.object(m,'load_health',side_effect=OSError('SECRET')),patch.object(health_http,'fetch',side_effect=fetch):
   out=m.collect(m.HERE.parent/'base-node',s)
  self.assertEqual({h:a['code'] for h,a in out['apps'].items()},{h:0 for h in m.HOSTS})
  self.assertEqual(s['lastAppError']['host'],'api-test.veydrift.com');self.assertIn('curl exit 7',s['lastAppError']['error'])
  s2={}
  with patch.object(m.subprocess,'run',side_effect=OSError('SECRET')),patch.object(m,'load_health',side_effect=OSError('SECRET')),patch.object(health_http,'fetch',side_effect=OSError('SECRET')):
   m.collect(m.HERE.parent/'base-node',s2)
  self.assertEqual(s2['lastAppError']['error'],'OSError');self.assertNotIn('SECRET',json.dumps(s2))
if __name__=='__main__': unittest.main()

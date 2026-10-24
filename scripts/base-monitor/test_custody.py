import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import monitor as m
from test_monitor import healthy

class CustodyTests(unittest.TestCase):
 def test_held_signal_fenced_unrelated_progress_and_exact_ack(self):
  s={};x=healthy();x['resources']['disk_pct']='81'
  e=copy.deepcopy(m.transition(s,x,1));m.claim(s,e['eventId'],2);m.finish_send(s,e['eventId'])
  notice=m.transition(s,x,2);m.acknowledge(s,notice['eventId'],'120',2)
  held=copy.deepcopy(s['held'][0])
  for tick in range(3,18): self.assertIsNone(m.transition(s,x,tick))
  self.assertEqual(s['held'],[held]);self.assertEqual(m.custody(s)['heldCount'],1)
  x['resources']['node_critical_errors']='1';new=m.transition(s,x,19)
  self.assertNotEqual(new['eventId'],e['eventId']);self.assertNotIn('disk_pct',new['text'])
  self.assertIn('custody degraded',new['text']);m.acknowledge(s,new['eventId'],'123',20)
  x['resources']['disk_pct']='39';self.assertIsNone(m.transition(s,x,21))
  m.acknowledge(s,e['eventId'],'124',22)
  recovery=m.transition(s,x,23);self.assertIn('RECOVERED resource-disk_pct',recovery['text'])
 def test_uncertain_recovery_never_recreated(self):
  s={};x=healthy();x['resources']['disk_pct']='81';e=m.transition(s,x,0);m.acknowledge(s,e['eventId'],'123',1)
  x['resources']['disk_pct']='39';e=m.transition(s,x,2);m.claim(s,e['eventId'],3);m.finish_send(s,e['eventId'])
  notice=m.transition(s,x,3);m.acknowledge(s,notice['eventId'],'120',3)
  for tick in range(4,30): self.assertIsNone(m.transition(s,x,tick))
  self.assertEqual(len(s['held']),1);self.assertEqual(s['sequence'],3)
 def test_legacy_and_release_custody(self):
  s={};x=healthy();x['resources']['disk_pct']='81';e=m.transition(s,x,0);del e['delivery']
  notice=m.transition(s,x,1);m.acknowledge(s,notice['eventId'],'120',1);self.assertTrue(m.delivery_hold(s['held'][0]))
  with self.assertRaises(ValueError):m.release_not_delivered(s,e['eventId'],'',2)
  m.release_not_delivered(s,e['eventId'],'private/evidence',3)
  self.assertEqual(s['pending']['eventId'],e['eventId']);self.assertEqual(s['held'],[])
  self.assertEqual(m.claim(s,e['eventId'],4)['status'],'claimed')
  self.assertEqual(m.claim(s,e['eventId'],5)['status'],'sender-held')
 def test_saturation_is_bounded_and_sampling_continues(self):
  s={};x=healthy();m.transition(s,x,0)
  s['held']=[{'eventId':format(i,'024x'),'text':'held','changes':[['resource-disk_pct',False]],'delivery':{'status':'uncertain'}} for i in range(m.MAX_HELD)]
  before=copy.deepcopy(s['held']);x['resources']['node_critical_errors']='1'
  for tick in range(1,20):self.assertIsNone(m.transition(s,x,tick))
  self.assertEqual(s['held'],before);self.assertTrue(s['incidents']['resource-node_critical_errors']['active'])
  self.assertTrue(m.custody(s)['capacityReached']);self.assertLess(len(json.dumps(s)),m.MAX_STATE_BYTES)
 def test_persistence_failures_never_authorize_claim(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'state';s={};x=healthy();x['resources']['disk_pct']='81';e=m.transition(s,x,0);m.atomic_save(p,s)
   for target in ('fsync','replace'):
    t=json.loads(p.read_text());m.claim(t,e['eventId'],1)
    with patch.object(m.os,target,side_effect=OSError()):
     with self.assertRaises(OSError):m.atomic_save(p,t)
    self.assertEqual(json.loads(p.read_text())['pending']['delivery']['status'],'ready')
   # Directory fsync may fail after replace: uncertain state still fails closed.
   t=json.loads(p.read_text());m.claim(t,e['eventId'],2)
   real=m.os.fsync;calls=[]
   def fsync(fd):
    calls.append(fd)
    if len(calls)==2:raise OSError()
    real(fd)
   with patch.object(m.os,'fsync',side_effect=fsync):
    with self.assertRaises(OSError):m.atomic_save(p,t)
   self.assertEqual(m.claim(json.loads(p.read_text()),e['eventId'],3)['status'],'sender-held')
if __name__=='__main__':unittest.main()

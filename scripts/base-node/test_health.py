import copy
import importlib.util
import pathlib
import unittest
spec=importlib.util.spec_from_file_location('health',pathlib.Path(__file__).with_name('health.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

def heads(n=100,ts=5000):
    return {tag:{'number':hex(n),'timestamp':hex(ts),'hash':'0x'+'a'*64,'parentHash':'0x'+'b'*64} for tag in h.TAGS}

class HealthTests(unittest.TestCase):
    def test_local_finality_frozen(self):
        local=heads();ref=heads();ref['finalized']['number']=hex(2000)
        result=h.classify(local,[ref,ref],[local,local],5100)
        self.assertEqual(result['tags']['finalized']['status'],'local-lag')
        self.assertEqual(result['tags']['latest']['status'],'observed')
    def test_chainwide_lag_not_local_fault(self):
        local=heads();result=h.classify(local,[local,local],[local,local],8000)
        self.assertEqual(result['status'],'chainwide-lag')
    def test_provider_disagreement(self):
        local=heads();other=heads();other['safe']['hash']='0x'+'c'*64
        self.assertEqual(h.classify(local,[local,local],[local,other],5100)['status'],'provider-disagreement')
    def test_no_highest_provider_quorum(self):
        local=heads();ref=heads(4000)
        self.assertEqual(h.classify(local,[local,ref],[local,local],5100)['status'],'reference-disagreement')
    def test_bounded_dedup_and_ack(self):
        state={};report={'status':'local-lag'}
        for i in range(3):
            result=h.transition(state,report,100+i);state=result['state']
            self.assertEqual(result['alert'],i==2)
        state.update(notifiedStatus='local-lag',notifiedAt=102)
        self.assertFalse(h.transition(state,report,200)['alert'])
        self.assertTrue(h.transition(state,{'status':'observed'},201)['recovered'])
        self.assertTrue(h.transition(state,report,4000)['alert'])

if __name__=='__main__':unittest.main()

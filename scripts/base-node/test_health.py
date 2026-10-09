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
        local=heads(5000);ref=heads(5000);local['finalized']['number']=hex(1000);ref['finalized']['number']=hex(2000)
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
    def test_stale_age_gap_boundaries_never_recover(self):
        for tag in h.TAGS:
            for gap in (60,61,100,900,901):
                with self.subTest(tag=tag,gap=gap):
                    local=heads(10000,10000);ref=copy.deepcopy(local)
                    local[tag].update(number=hex(1000),timestamp=hex(5000))
                    ref[tag].update(number=hex(1000+gap),timestamp=hex(5200))
                    result=h.classify(local,[ref,ref],[local,local],10000)
                    expected='local-lag' if gap>(60 if tag=='latest' else 900) else 'chainwide-lag'
                    self.assertEqual(result['tags'][tag]['status'],expected)
                    self.assertEqual(result['status'],expected)
                    for other in set(h.TAGS)-{tag}:
                        self.assertEqual(result['tags'][other]['status'],'observed')
                    state={'notifiedStatus':'local-lag','notifiedAt':1}
                    for now in (10000,10001,10002):
                        change=h.transition(state,result,now);state=change['state']
                        self.assertFalse(change['recovered'])
                    self.assertTrue(change['alert'])
                    ref[tag]['timestamp']=hex(9990)
                    fresh=h.classify(local,[ref,ref],[local,local],10000)
                    self.assertEqual(fresh['tags'][tag]['status'],
                                     'local-lag' if expected=='local-lag' else 'local-staleness')
    def test_disagreement_precedes_stale_age_and_local_lag(self):
        local=heads(1000,1000);a=heads(2000,1100);b=heads(4000,1100)
        self.assertEqual(h.classify(local,[a,b],[local,local],10000)['status'],'reference-disagreement')
        other=copy.deepcopy(local);other['finalized']['hash']='0x'+'c'*64
        self.assertEqual(h.classify(local,[a,b],[local,other],10000)['status'],'provider-disagreement')
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

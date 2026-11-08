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
        local=heads(5000);ref=heads(5000);local['finalized'].update(number=hex(1000),timestamp=hex(3000));ref['finalized']['number']=hex(2000)
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
        local=heads();ref=heads(4000,2000)
        self.assertEqual(h.classify(local,[local,ref],[local,local],5100)['status'],'reference-disagreement')
    def test_block_count_spread_alone_is_not_disagreement(self):
        # 0.2s blocks: one ~6.4-minute finality step is ~1900 blocks but only ~384s apart.
        local=heads(100000,5000);slow=heads(100000,5000);slow['finalized'].update(number=hex(98100),timestamp=hex(4616))
        result=h.classify(local,[local,slow],[local,local],5100)
        self.assertEqual(result['tags']['finalized']['status'],'observed')
    def test_stale_age_gap_boundaries_never_recover(self):
        for tag in h.TAGS:
            for gap in (120,121,200,1800,1801):
                with self.subTest(tag=tag,gap=gap):
                    local=heads(10000,10000);ref=copy.deepcopy(local)
                    local[tag].update(number=hex(1000),timestamp=hex(5000))
                    ref[tag].update(number=hex(1000+gap),timestamp=hex(5000+gap))
                    result=h.classify(local,[ref,ref],[local,local],10000)
                    expected='local-lag' if gap>(120 if tag=='latest' else 1800) else 'chainwide-lag'
                    self.assertEqual(result['tags'][tag]['status'],expected)
                    self.assertEqual(result['status'],expected)
                    for other in set(h.TAGS)-{tag}:
                        self.assertEqual(result['tags'][other]['status'],'observed')
                    state={'notifiedStatus':'local-lag','notifiedAt':1}
                    for now in (10000,10001,10002):
                        change=h.transition(state,result,now);state=change['state']
                        self.assertFalse(change['recovered'])
                    self.assertTrue(change['alert'])
                    fresh_ref=copy.deepcopy(ref);fresh_ref[tag]['timestamp']=hex(9990)
                    # One fresh reference, one stale one: local is stale while a reference moves.
                    fresh=h.classify(local,[ref,fresh_ref],[local,local],10000)
                    self.assertEqual(fresh['tags'][tag]['status'],'reference-disagreement')
    def test_reference_spread_and_lag_need_strictly_more_than_the_limit_on_every_reference(self):
        for tag in h.TAGS:
            limit=120 if tag=='latest' else 1800
            with self.subTest(tag=tag):
                local=heads(10000,10000);a=copy.deepcopy(local);b=copy.deepcopy(local)
                a[tag]['timestamp']=hex(10000+limit)
                self.assertEqual(h.classify(local,[a,b],[local,local],10000)['tags'][tag]['status'],'observed')
                a[tag]['timestamp']=hex(10000+limit+1)
                self.assertEqual(h.classify(local,[a,b],[local,local],10000)['tags'][tag]['status'],'reference-disagreement')
                # Only one reference is more than the limit ahead: not local lag.
                b[tag]['timestamp']=hex(10000+limit-10)
                self.assertEqual(h.classify(local,[a,b],[local,local],10000)['tags'][tag]['status'],'observed')
    def test_local_staleness_within_lag_limit(self):
        local=heads(1000,9990);ref=heads(1000,9990);local['latest']['timestamp']=hex(9870)
        self.assertEqual(h.classify(local,[ref,ref],[local,local],10000)['tags']['latest']['status'],'local-staleness')
    def test_disagreement_precedes_stale_age_and_local_lag(self):
        local=heads(1000,1000);a=heads(2000,1100);b=heads(4000,3500)
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

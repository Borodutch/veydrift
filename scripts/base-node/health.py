#!/usr/bin/env python3
"""One bounded observation for the existing monitor; no restarts, scheduler or messaging."""
import importlib.util
import json
import os
import pathlib
import time

spec = importlib.util.spec_from_file_location('relay', pathlib.Path(__file__).with_name('l1-rpc-failover.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
TAGS = ('latest', 'safe', 'finalized')


def sample(url, timeout=6):
    relay = r.Relay([url], timeout=timeout)
    deadline = time.monotonic()+timeout
    def rpc(method, params):
        response=relay._request(0, {'jsonrpc':'2.0','id':1,'method':method,'params':params},deadline,1024*1024)[1]
        if 'error' in response: raise r.RelayError('probe RPC capability unavailable')
        return response['result']
    if r.quantity(rpc('eth_chainId', [])) != 8453:
        raise r.RelayError('reference chain mismatch')
    heads={tag:r.block(rpc('eth_getBlockByNumber',[tag,False])) for tag in TAGS}
    for head in heads.values(): r.quantity(head.get('timestamp'))
    if not all(r.quantity(heads[a]['number']) >= r.quantity(heads[b]['number']) for a,b in [('latest','safe'),('safe','finalized')]):
        raise r.RelayError('inconsistent head ordering')
    def canonical(tags):
        nonlocal deadline
        deadline = time.monotonic()+timeout
        return {tag:r.block(rpc('eth_getBlockByNumber',[tags[tag]['number'],False])) for tag in TAGS}
    return heads, canonical


def classify(local, references, canonical, now):
    """canonical maps each reference's same-height local-tag observations. No highest-provider voting."""
    report={'tags':{},'status':'observed','trustModel':'independent corroboration, not a consensus quorum'}
    for tag in TAGS:
        number=r.quantity(local[tag]['number'])
        age=now-r.quantity(local[tag]['timestamp'])
        refnums=[r.quantity(ref[tag]['number']) for ref in references]
        refages=[now-r.quantity(ref[tag].get('timestamp')) for ref in references]
        threshold={'latest':120,'safe':1800,'finalized':2100}[tag]
        gaps=[n-number for n in refnums]
        match=all(c[tag]['hash'].lower()==local[tag]['hash'].lower() for c in canonical)
        if not match:
            status='provider-disagreement'
        elif max(refnums)-min(refnums) > (60 if tag=='latest' else 900):
            status='reference-disagreement'
        elif all(g > (60 if tag=='latest' else 900) for g in gaps):
            status='local-lag'
        elif age > threshold and all(a > threshold for a in refages):
            status='chainwide-lag'
        elif age > threshold and any(a <= threshold for a in refages):
            status='local-staleness'
        else:
            status='observed'
        report['tags'][tag]={'number':number,'ageSeconds':age,'referenceGaps':gaps,'referenceAgesSeconds':refages,'status':status}
    states=[v['status'] for v in report['tags'].values()]
    for state in ('provider-disagreement','reference-disagreement','local-lag','local-staleness','chainwide-lag'):
        if state in states:
            report['status']=state;break
    return report


def observe(urls):
    # Three head probes and two canonical checks; each owns a 6s budget (30s total).
    if len(urls)!=3:
        raise ValueError('one local and two independent reference URLs required')
    samples=[sample(url) for url in urls]
    local=samples[0][0]
    canonical=[]
    for _,read_canonical in samples[1:]:
        canonical.append(read_canonical(local))
    return classify(local,[s[0] for s in samples[1:]],canonical,int(time.time()))


def transition(previous, report, now):
    """Bounded state consumed by existing notification owner after confirmed delivery."""
    status=report['status']
    prior=previous.get('status')
    streak=min(3,previous.get('streak',0)+1) if status==prior else 1
    alert=status!='observed' and streak>=3 and (previous.get('notifiedStatus')!=status or now-previous.get('notifiedAt',0)>=3600)
    recovered=status=='observed' and previous.get('notifiedStatus') not in (None,'observed')
    state={'status':status,'streak':streak,'notifiedStatus':previous.get('notifiedStatus'),'notifiedAt':previous.get('notifiedAt',0)}
    return {'state':state,'alert':alert,'recovered':recovered,'action':'escalate; no automatic restart'}


if __name__=='__main__':
    try:
        report=observe([os.environ[k] for k in ('BASE_LOCAL_RPC','BASE_REFERENCE_RPC','BASE_REFERENCE_RPC_2')])
    except (r.RelayError,ValueError,KeyError,OSError):
        report={'status':'probe-unavailable','action':'inspect privately; URLs and upstream errors omitted'}
    print(json.dumps(report))

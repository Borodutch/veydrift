"""Read-only node loopback RPC via existing authenticated SSH; no remote files/listeners."""
import json
import subprocess
import time
from pathlib import Path

REMOTE = '''import json,sys,urllib.request,urllib.error,email.utils,time,math
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None
try:
 p=json.load(sys.stdin)
 allowed={"eth_chainId","eth_getBlockByNumber","eth_syncing","eth_getBalance"}
 if p.get("method") not in allowed: raise ValueError()
 q=urllib.request.Request("http://127.0.0.1:8545",data=json.dumps(p).encode(),headers={"Content-Type":"application/json"})
 try:
  r=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect).open(q,timeout=5)
 except urllib.error.HTTPError as e:
  if e.code!=429: raise ValueError()
  v=e.headers.get("Retry-After")
  try: d=float(v)
  except (ValueError,TypeError):
   try: d=email.utils.parsedate_to_datetime(v).timestamp()-time.time()
   except (ValueError,TypeError,OverflowError): d=60
  print(json.dumps({"hold":max(60,d) if math.isfinite(d) else 60}));sys.exit(0)
 with r:
  b=r.read(1048577)
  if r.status!=200 or len(b)>1048576: raise ValueError()
 x=json.loads(b)
 if isinstance(x,dict) and isinstance(x.get("error"),dict) and x["error"].get("code") in (429,-32005,-32016):
  print(json.dumps({"hold":60}));sys.exit(0)
 if not isinstance(x,dict) or x.get("jsonrpc")!="2.0" or x.get("id")!=p.get("id") or "result" not in x or "error" in x: raise ValueError()
 v=x["result"]
 if p["method"]=="eth_getBlockByNumber":
  if not isinstance(v,dict): raise ValueError()
  v={k:v.get(k) for k in ("number","hash","parentHash","timestamp")}
 print(json.dumps({"result":v}))
except Exception:
 print(json.dumps({"unavailable":True}))
'''


def request(ssh, payload, timeout=8):
    import shlex
    # SSH options/host come from reviewed monitor; discard only resource command.
    command = ssh[:-4] + ['timeout', '7', 'python3', '-c', shlex.quote(REMOTE)]
    result = subprocess.run(command, input=json.dumps(payload), text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=timeout, check=False)
    if result.returncode or len(result.stdout) > 16384:
        raise ValueError('node SSH RPC unavailable')
    body = json.loads(result.stdout)
    if body.get('hold'):
        error = ValueError('node quota hold')
        error.retry_after = body['hold']
        raise error
    if 'result' not in body:
        raise ValueError('node RPC unavailable')
    return 200, {'jsonrpc': '2.0', 'id': payload['id'], 'result': body['result']}


def sample(ssh, health):
    # One local phase with four bounded SSH invocations. Remote reads only loopback.
    end = time.monotonic() + 30
    def rpc(method, params):
        remaining = end - time.monotonic()
        if remaining <= 0: raise ValueError('node phase deadline')
        return request(ssh, {'jsonrpc':'2.0','id':1,'method':method,'params':params}, min(8,remaining))[1]['result']
    if health.r.quantity(rpc('eth_chainId', [])) != 8453:
        raise ValueError('node chain mismatch')
    heads = {tag:health.r.block(rpc('eth_getBlockByNumber',[tag,False])) for tag in health.TAGS}
    for head in heads.values(): health.r.quantity(head.get('timestamp'))
    if not all(health.r.quantity(heads[a]['number']) >= health.r.quantity(heads[b]['number']) for a,b in [('latest','safe'),('safe','finalized')]):
        raise ValueError('node head ordering')
    return heads, None

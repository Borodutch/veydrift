"""curl inherits approved proxy and CA; never disables verification or redirects."""
import json,subprocess,tempfile,time
from pathlib import Path

class HealthError(ValueError):
    """Messages are built only from fixed text and integers, so state may keep them."""

class TransportError(HealthError):
    """curl got no HTTP answer: only its exit code and elapsed time survive (no stderr, URL or proxy text)."""

def _curl(url,headers,body):
    started=time.monotonic()
    try:
        r=subprocess.run(['curl','-q','--silent','--show-error','--max-time','7','--max-filesize','1048576','--proto','=https','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',url],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=8,check=False)
    except subprocess.TimeoutExpired:
        raise TransportError('health transport timeout after %ds'%round(time.monotonic()-started)) from None
    if r.returncode or not r.stdout.strip().isdigit():
        raise TransportError('health transport unavailable (curl exit %d after %ds)'%(r.returncode,round(time.monotonic()-started)))
    return int(r.stdout.strip())

def fetch(url, retry_seconds, retry_delay=2, retry=True):
    if url not in ('https://api.veydrift.com/health','https://api-test.veydrift.com/health'):
        raise ValueError('fixed health route required')
    with tempfile.TemporaryDirectory(prefix='monitor-health-') as d:
        headers=Path(d)/'headers';body=Path(d)/'body'
        try:
            code=_curl(url,headers,body)
        except TransportError:
            if not retry: raise
            # One retry: a lone dropped connection on the path is not the backend being down
            # (Nov 8: api-test probes died before reaching the egress proxy while the backend served 200s).
            time.sleep(retry_delay)
            code=_curl(url,headers,body)
        if code==429:
            values=[line.partition(':')[2].strip() for line in headers.read_text().splitlines() if line.lower().startswith('retry-after:')]
            e=ValueError('health quota hold');e.retry_after=retry_seconds(values[-1] if values else None);raise e
        if code not in (200,503): raise HealthError('health HTTP %d'%code)
        raw=body.read_bytes()
        if len(raw)>1048576: raise HealthError('health body too large')
        return code,json.loads(raw)

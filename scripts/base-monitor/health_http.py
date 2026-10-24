"""curl inherits approved proxy and CA; never disables verification or redirects."""
import json,subprocess,tempfile
from pathlib import Path

def fetch(url, retry_seconds):
    if url not in ('https://api.veydrift.com/health','https://api-test.veydrift.com/health'):
        raise ValueError('fixed health route required')
    with tempfile.TemporaryDirectory(prefix='monitor-health-') as d:
        headers=Path(d)/'headers';body=Path(d)/'body'
        r=subprocess.run(['curl','-q','--silent','--show-error','--max-time','7','--max-filesize','1048576','--proto','=https','--dump-header',str(headers),'--output',str(body),'--write-out','%{http_code}',url],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=8,check=False)
        if r.returncode or not r.stdout.strip().isdigit(): raise ValueError('health transport unavailable')
        code=int(r.stdout.strip())
        if code==429:
            values=[line.partition(':')[2].strip() for line in headers.read_text().splitlines() if line.lower().startswith('retry-after:')]
            e=ValueError('health quota hold');e.retry_after=retry_seconds(values[-1] if values else None);raise e
        if code not in (200,503): raise ValueError('health HTTP unavailable')
        raw=body.read_bytes()
        if len(raw)>1048576: raise ValueError('health body too large')
        return code,json.loads(raw)

"""Grounding only, using an existing owned screenshot; sends no desktop input."""
import base64
import json
from pathlib import Path
import statistics
import time

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
fixture = ROOT / 'test-output' / 'visual-fixture-before.png'
width, height = Image.open(fixture).size
data = 'data:image/png;base64,' + base64.b64encode(fixture.read_bytes()).decode()
cases = [
    ('Click once button', (49, 106, 202, 170)),
    ('Double click button', (222, 106, 376, 170)),
    ('Right click button', (396, 106, 550, 170)),
    ('Text input field', (388, 343, 732, 493)),
]
rows = []
with httpx.Client(base_url='http://127.0.0.1:22135', headers={'X-Mitch-Grounding': '1'},
                  timeout=15, trust_env=False) as client:
    health = client.get('/health').json()
    if not health.get('ready'):
        raise SystemExit('GoClick is not ready.')
    for trial in range(2):
        for label, bounds in cases:
            started = time.perf_counter()
            response = client.post('/locate', json={'image': data, 'label': label})
            elapsed_ms = (time.perf_counter() - started) * 1000
            result = response.json()
            point = result.get('point')
            x, y = (point['x'] * width, point['y'] * height) if point else (None, None)
            inside = point is not None and bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3]
            rows.append({'label': label, 'trial': trial, 'http_status': response.status_code,
                         'elapsed_ms': round(elapsed_ms, 2), 'model_ms': result.get('elapsed_ms'),
                         'point_px': [x, y], 'inside_target': inside})
    absent = client.post('/locate', json={'image': data, 'label': 'Delete account button'}).json()
result = {'scope': 'point proposals on one owned fixture, no actions/cloud/API calls',
          'device': health['device'], 'model': health['model'], 'revision': health['revision'],
          'trials': rows, 'inside_target': sum(row['inside_target'] for row in rows), 'total': len(rows),
          'median_http_ms': round(statistics.median(row['elapsed_ms'] for row in rows), 2),
          'absent_target_returned_point': absent.get('point') is not None,
          'limitations': 'Model emits proposals, not absence confidence or element bounds. This tiny fixture does not establish task accuracy.'}
path = ROOT / 'test-output' / 'goclick-cpu-benchmark.json'
path.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))

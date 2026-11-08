"""Local synthetic benchmark. Woof audio: Voice by Underdog Woof (non-commercial)."""
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import io
import json
import sys
import time
from pathlib import Path
import httpx
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor/local-ai/woof'))
from underdog_woof import Woof

OUT = ROOT / 'test-output/tts-comparison'
OUT.mkdir(parents=True, exist_ok=True)
TEXTS = [
    'Hello, I am Mitch. How can I help you today?',
    'Your order ships on March 3rd. Call 415-555-0199 before 5:30 p.m.',
    'I saved your grocery note. It contains apples, bread, milk, and coffee.',
]
results = []
with httpx.Client(timeout=300, trust_env=False) as client:
    for voice in ('kokoro', 'juno', 'mira'):
        start = time.perf_counter()
        model = None if voice == 'kokoro' else Woof(voice=voice)
        load = time.perf_counter() - start
        for index, text in enumerate(TEXTS):
            start = time.perf_counter()
            if model:
                audio = model(text, seed=0)
                buf = io.BytesIO()
                sf.write(buf, audio, 24000, format='WAV')
                wav = buf.getvalue()
            else:
                response = client.post('http://127.0.0.1:22132/speech', json={'text': text, 'language': 'en-us'})
                response.raise_for_status()
                wav = response.content
                audio, rate = sf.read(io.BytesIO(wav))
                assert rate == 24000
            elapsed = time.perf_counter() - start
            assert len(audio) and np.isfinite(audio).all() and np.max(np.abs(audio)) > 0.001
            file = OUT / f'{voice}-{index}.wav'
            file.write_bytes(wav)
            response = client.post('http://127.0.0.1:22132/transcribe', files={'file': ('test.wav', wav, 'audio/wav')})
            response.raise_for_status()
            item = {'voice': voice, 'text': text, 'load_s': round(load, 3), 'generation_s': round(elapsed, 3), 'audio_s': round(len(audio)/24000, 3), 'rtf': round(elapsed/(len(audio)/24000), 3), 'transcript': response.json()['text']}
            results.append(item)
            print(json.dumps(item), flush=True)
            (OUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')

"""Compare local ASR on public LibriSpeech test-clean speech, never personal audio.

Dataset: https://www.openslr.org/12 (CC BY 4.0, Panayotov et al.).
Download test-clean.tar.gz into test-output/asr-comparison before running.
Requires the existing speech service on 22132 and Nemotron trial on 22133.
"""
import hashlib
import io
import json
import re
import statistics
import tarfile
import time
from pathlib import Path
import httpx
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-output/asr-comparison'
ARCHIVE = OUT / 'test-clean.tar.gz'
OUT.mkdir(parents=True, exist_ok=True)


def words(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.lower().replace('’', "'"))


def errors(reference, hypothesis):
    ref, hyp = words(reference), words(hypothesis)
    row = list(range(len(hyp) + 1))
    for i, a in enumerate(ref, 1):
        next_row = [i]
        for j, b in enumerate(hyp, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (a != b)))
        row = next_row
    return row[-1], len(ref)


selected, references = {}, {}
with tarfile.open(ARCHIVE, 'r|gz') as archive:
    for item in archive:
        if item.name.endswith('.trans.txt'):
            for line in archive.extractfile(item).read().decode().splitlines():
                key, text = line.split(' ', 1)
                references[key] = text
        elif item.name.endswith('.flac') and len(selected) < 20:
            name = Path(item.name).stem
            speaker = name.split('-')[0]
            if speaker in selected:
                continue
            audio, rate = sf.read(io.BytesIO(archive.extractfile(item).read()), dtype='float32')
            if rate == 16000 and audio.ndim == 1 and 3 <= len(audio) / rate <= 12:
                selected[speaker] = (name, audio)
assert len(selected) == 20
cases = []
for index, (speaker, (name, audio)) in enumerate(selected.items()):
    cases.append((name, speaker, 'clean', audio))
    if index < 5:
        cases.append((name, speaker, 'quiet', audio * 0.05))
        rng = np.random.default_rng(index)
        noise = rng.standard_normal(len(audio)).astype(np.float32)
        noise *= np.sqrt(np.mean(audio ** 2) / 10) / np.sqrt(np.mean(noise ** 2))
        cases.append((name, speaker, 'noise_10db', np.clip(audio + noise, -1, 1)))

records = []
with httpx.Client(timeout=120, trust_env=False) as client:
    backend = client.get('http://127.0.0.1:22132/health').json().get('asr_model')
    if backend and backend != 'qwen3-asr-0.6b':
        raise RuntimeError('Comparison requires the Qwen baseline service. Restore v0.6.0-local.4 first; refusing to label Nemotron as Qwen.')
    # Warm both recognizers; exclude this request from measurement.
    warm = (OUT / 'jfk.wav').read_bytes()
    endpoints = {'qwen': 'http://127.0.0.1:22132/transcribe', 'nemotron': 'http://127.0.0.1:22133/v1/audio/transcriptions'}
    for endpoint in endpoints.values():
        client.post(endpoint, files={'file': ('warm.wav', warm, 'audio/wav')}).raise_for_status()
    for index, (name, speaker, variant, audio) in enumerate(cases):
        buf = io.BytesIO()
        sf.write(buf, audio, 16000, format='WAV', subtype='PCM_16')
        # Alternate model order to reduce systematic ordering bias. No parallel inference.
        order = ('qwen', 'nemotron') if index % 2 == 0 else ('nemotron', 'qwen')
        for model in order:
            start = time.perf_counter()
            response = client.post(endpoints[model], files={'file': ('test.wav', buf.getvalue(), 'audio/wav')})
            response.raise_for_status()
            elapsed = time.perf_counter() - start
            transcript = response.json()['text']
            distance, count = errors(references[name], transcript)
            records.append({'id': name, 'speaker': speaker, 'variant': variant, 'model': model, 'seconds': round(elapsed, 4), 'audio_seconds': len(audio)/16000, 'errors': distance, 'words': count, 'reference': references[name], 'transcript': transcript})
        print(json.dumps({'case': index + 1, 'id': name, 'variant': variant, 'results': [{'model': r['model'], 'seconds': r['seconds'], 'errors': r['errors']} for r in records[-2:]]}), flush=True)
        (OUT / 'results.json').write_text(json.dumps(records, indent=2), encoding='utf-8')

summary = {'dataset': 'LibriSpeech test-clean, first qualifying clip per speaker in archive order; 20 speakers', 'archive_sha256': hashlib.file_digest(ARCHIVE.open('rb'), 'sha256').hexdigest(), 'conditions': 'Warm CPU servers; single request at a time; Qwen includes ffmpeg adapter overhead; case/punctuation normalization only; noise is synthetic white noise at 10dB SNR; quiet is amplitude x0.05.', 'groups': []}
for variant in ('clean', 'quiet', 'noise_10db'):
    for model in ('qwen', 'nemotron'):
        rows = [r for r in records if r['variant'] == variant and r['model'] == model]
        summary['groups'].append({'variant': variant, 'model': model, 'clips': len(rows), 'words': sum(r['words'] for r in rows), 'errors': sum(r['errors'] for r in rows), 'wer_percent': round(100 * sum(r['errors'] for r in rows) / sum(r['words'] for r in rows), 2), 'median_seconds': round(statistics.median(r['seconds'] for r in rows), 3), 'mean_seconds': round(statistics.mean(r['seconds'] for r in rows), 3)})
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary, indent=2), flush=True)

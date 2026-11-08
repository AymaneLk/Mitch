"""Synthetic fixtures only: no user microphone or private recordings."""
import json
import struct
import subprocess
import time
import zlib
from pathlib import Path
import httpx
import imageio_ffmpeg

output = Path(__file__).resolve().parents[1] / 'test-output'
output.mkdir(exist_ok=True)

def png_chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)

# Simple controlled vision fixture, independent of user screenshots.
rows = b''.join(b'\x00' + b''.join(bytes((230, 20, 20) if 40 <= x < 216 and 40 <= y < 216 else (255, 255, 255)) for x in range(256)) for y in range(256))
(output / 'local-vision.png').write_bytes(b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('!2I5B', 256, 256, 8, 2, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress(rows)) + png_chunk(b'IEND', b''))

results = []
with httpx.Client(timeout=120, trust_env=False) as client:
    for language, text, expected in [
        ('en-us', 'Hello Mitch. Please create a note called groceries. Buy apples and bread.', ['apples', 'bread']),
    ]:
        started = time.monotonic()
        response = client.post('http://127.0.0.1:22132/speech', json={'text': text, 'language': language})
        response.raise_for_status()
        assert response.content.startswith(b'RIFF'), response.text
        tts_ms = round((time.monotonic() - started) * 1000)
        wav = output / f'local-{language}.wav'
        webm = wav.with_suffix('.webm')
        wav.write_bytes(response.content)
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-y', '-i', str(wav), '-c:a', 'libopus', str(webm)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        started = time.monotonic()
        response = client.post('http://127.0.0.1:22132/transcribe', files={'file': (webm.name, webm.read_bytes(), 'audio/webm')})
        response.raise_for_status()
        transcript = response.json()['text']
        assert all(word in transcript.lower() for word in expected), transcript
        result = {'language': language, 'passed': True, 'tts_ms': tts_ms, 'asr_ms': round((time.monotonic() - started) * 1000), 'transcript': transcript}
        results.append(result)
        print(json.dumps(result, ensure_ascii=True), flush=True)
    denied = client.post('http://127.0.0.1:22132/speech', headers={'Origin': 'https://example.com'}, json={'text': 'blocked'})
    assert denied.status_code == 403
    assert client.post('http://127.0.0.1:22132/speech', json={'text': 'Bonjour', 'language': 'fr-fr'}).status_code == 400
(output / 'local-speech-results.json').write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

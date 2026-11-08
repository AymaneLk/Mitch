"""Loopback-only speech adapter. No cloud API, telemetry, or persisted recordings."""
import io
import subprocess
import tempfile
import threading
from pathlib import Path

import httpx
import imageio_ffmpeg
import soundfile as sf
import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'vendor' / 'local-ai' / 'models'
app = FastAPI(docs_url=None, redoc_url=None)
speech_lock = threading.Lock()
kokoro = None


class ModelTypedSession:
    """Normalize the speed input to the pinned export's declared dtype.

    kokoro-onnx 0.4.9 sends int32 for input_ids exports, while the official
    model-files-v1.1 export declares a float speed. Keep the fix in our adapter.
    """
    def __init__(self, session):
        self.session = session
        self.speed_type = next(item.type for item in session.get_inputs() if item.name == 'speed')

    def __getattr__(self, name):
        return getattr(self.session, name)

    def run(self, outputs, inputs):
        inputs = dict(inputs)
        inputs['speed'] = np.asarray(inputs['speed'], dtype=np.float32 if self.speed_type == 'tensor(float)' else np.int32)
        return self.session.run(outputs, inputs)


@app.middleware('http')
async def local_only(request: Request, call_next):
    # No browser-origin access, even on localhost. Electron calls via its main process.
    if request.headers.get('origin') or request.client.host not in ('127.0.0.1', '::1'):
        return Response('Local backend access only', status_code=403)
    return await call_next(request)


@app.get('/health')
def health():
    return {'status': 'ok', 'asr_model': 'nemotron-speech-streaming-en-0.6b', 'language': 'en', 'tts_installed': all((MODELS / f).exists() for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'))}


def transcribe_audio(data: bytes) -> str:
    if not data or len(data) > 24 * 1024 * 1024:
        raise HTTPException(400, 'Recording must be between 1 byte and 24 MB.')
    # ffmpeg needs a seekable input for some container formats. The random temporary
    # directory is private to the OS user and removed on all normal exit paths.
    with tempfile.TemporaryDirectory(prefix='mitch-audio-') as folder:
        source = Path(folder) / 'input.audio'
        source.write_bytes(data)
        try:
            result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(source), '-t', '120', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], capture_output=True, timeout=30, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        except (subprocess.SubprocessError, OSError) as error:
            raise HTTPException(400, 'Could not decode the recording.') from error
    return recognize_wav(result.stdout)


def recognize_wav(wav: bytes) -> str:
    """Send decoded audio only to the locally managed Nemotron service."""
    try:
        with httpx.Client(timeout=120, trust_env=False) as client:
            response = client.post('http://127.0.0.1:22131/v1/audio/transcriptions',
                                   files={'file': ('recording.wav', wav, 'audio/wav')},
                                   data={'language': 'en', 'response_format': 'json'})
            response.raise_for_status()
            text = response.json()['text']
            if not isinstance(text, str):
                raise ValueError('Invalid transcript returned by Nemotron.')
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as error:
        raise HTTPException(503, 'Local speech recognition is unavailable. Start the local services.') from error
    return text.strip()


@app.post('/transcribe')
def transcribe(file: UploadFile = File(...)):
    data = file.file.read(24 * 1024 * 1024 + 1)
    with speech_lock:
        return {'text': transcribe_audio(data)}


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = 'en-us'


@app.post('/speech')
def synthesize(request: SpeechRequest):
    global kokoro
    if request.language != 'en-us':
        raise HTTPException(400, 'Mitch is configured for English speech only.')
    with speech_lock:
        if kokoro is None:
            from kokoro_onnx import Kokoro
            if not (MODELS / 'kokoro-v1.0.onnx').exists():
                raise HTTPException(503, 'Kokoro model files are not installed.')
            ort.disable_telemetry_events()
            options = ort.SessionOptions()
            options.intra_op_num_threads = 4
            session = ort.InferenceSession(str(MODELS / 'kokoro-v1.0.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
            kokoro = Kokoro.from_session(ModelTypedSession(session), str(MODELS / 'voices-v1.0.bin'))
        samples, rate = kokoro.create(request.text, voice='af_heart', speed=1.0, lang='en-us')
    output = io.BytesIO()
    sf.write(output, samples, rate, format='WAV')
    return Response(output.getvalue(), media_type='audio/wav')

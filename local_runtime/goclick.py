"""CPU-only, loopback GoClick proposals. A proposed point is NOT verified presence.

The published model emits center-point tokens, not bounding boxes/confidence.
The desktop executor must independently identify actual bounds before clicking.
No screenshots, labels, generated text or credentials are logged or persisted.
"""
import asyncio
import base64
import binascii
from contextlib import asynccontextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import re
import threading
import time

# Runtime never downloads code/weights and never initializes CUDA.
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'vendor' / 'goclick'
os.environ['HF_HOME'] = str(RUNTIME / 'cache')
os.environ['HF_MODULES_CACHE'] = str(RUNTIME / 'cache' / 'modules')

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

MAX_BODY = 12 * 1024 * 1024
MAX_PIXELS = 16_777_216
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_SECONDS = 8
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode_image(value):
    if not isinstance(value, str):
        raise ValueError('Invalid image.')
    match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=\r\n]+)', value)
    if not match:
        raise ValueError('Expected a PNG or JPEG data URL.')
    try:
        data = base64.b64decode(match[2], validate=True)
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise ValueError('Image size is outside limits.')
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ('PNG', 'JPEG') or image.width < 8 or image.height < 8 or image.width * image.height > MAX_PIXELS:
                raise ValueError('Image dimensions or format are outside limits.')
            image.load()
            return image.convert('RGB')
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError('Could not decode the image.') from error


def parse_point(text):
    """Decode only a single complete coordinate proposal; never default to (0,0)."""
    text = re.sub(r'</?s>|<pad>', '', text).strip()
    if text.startswith('(') and text.endswith(')'):
        text = text[1:-1].strip()
    match = re.fullmatch(r'<loc_(\d{1,3})>\s*,\s*<loc_(\d{1,3})>', text)
    if not match:
        return None
    # Florence quantizes into 1000 bins; use each bin's center.
    return {'x': (int(match[1]) + 0.5) / 1000, 'y': (int(match[2]) + 0.5) / 1000}


class Grounder:
    def __init__(self):
        self.model = self.processor = None
        self.ready = False
        self.error = None
        self.lock = threading.Lock()
        self.manifest = json.loads((ROOT / 'local_runtime' / 'goclick-manifest.json').read_text(encoding='utf-8-sig'))

    def load(self):
        model_path = RUNTIME / 'model'
        for entry in self.manifest['files']:
            path = model_path / entry['file']
            if not path.is_file():
                raise RuntimeError('Run setup-goclick.ps1: model files are missing.')
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != entry['sha256']:
                raise RuntimeError('Model checksum mismatch; rerun setup-goclick.ps1.')
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
        torch.set_num_threads(min(4, max(1, os.cpu_count() or 1)))
        torch.set_num_interop_threads(1)
        self.model = AutoModelForCausalLM.from_pretrained(
            str(model_path), trust_remote_code=True, local_files_only=True,
            use_safetensors=True, torch_dtype=torch.float32, attn_implementation='eager').to('cpu').eval()
        self.processor = AutoProcessor.from_pretrained(str(model_path), trust_remote_code=True, local_files_only=True)
        self.ready = True

    def locate(self, image, label, cancelled, deadline):
        import torch
        from transformers import StoppingCriteria, StoppingCriteriaList
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('busy')
        try:
            if cancelled.is_set() or time.monotonic() >= deadline:
                raise TimeoutError()

            class StopRequested(StoppingCriteria):
                def __call__(self, input_ids, scores, **kwargs):
                    return cancelled.is_set() or time.monotonic() >= deadline

            prompt = f'Where is the {label} element? (Output the center coordinates of the target)'
            started = time.perf_counter()
            inputs = self.processor(images=image, text=prompt, return_tensors='pt', do_resize=True)
            if cancelled.is_set() or time.monotonic() >= deadline:
                raise TimeoutError()
            with torch.inference_mode():
                outputs = self.model.generate(**inputs, do_sample=False, num_beams=1, early_stopping=False, max_new_tokens=16,
                                              use_cache=True, stopping_criteria=StoppingCriteriaList([StopRequested()]))
            if cancelled.is_set() or time.monotonic() >= deadline:
                raise TimeoutError()
            point = parse_point(self.processor.tokenizer.batch_decode(outputs, skip_special_tokens=False)[0])
            return {'found': point is not None, 'point': point, 'box': None, 'grounding_only': True,
                    'source': 'goclick', 'model': self.manifest['repository'], 'revision': self.manifest['revision'],
                    'device': 'cpu', 'elapsed_ms': round((time.perf_counter() - started) * 1000, 2)}
        finally:
            self.lock.release()


grounder = Grounder()


@asynccontextmanager
async def lifespan(app):
    async def load():
        try:
            await asyncio.to_thread(grounder.load)
        except Exception:
            # Errors stay content-free; no model input or environment dump.
            grounder.error = 'model_load_failed'
    task = asyncio.create_task(load())
    yield
    await task


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.middleware('http')
async def local_only(request: Request, call_next):
    host = request.headers.get('host', '').lower()
    if (request.client is None or request.client.host not in ('127.0.0.1', '::1') or
        host not in ('127.0.0.1:22135', 'localhost:22135') or request.headers.get('origin') or
        request.headers.get('x-mitch-grounding') != '1'):
        return JSONResponse({'error': 'local_backend_only'}, status_code=403)
    if request.method == 'POST':
        try:
            size = int(request.headers.get('content-length', '0'))
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_BODY or request.headers.get('transfer-encoding'):
            return JSONResponse({'error': 'invalid_body_size'}, status_code=413)
        # Enforce the actual body size as well, not just an untrusted header.
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_BODY:
                return JSONResponse({'error': 'body_too_large'}, status_code=413)
        request._body = bytes(data)
    return await call_next(request)


@app.get('/health')
async def health():
    return {'status': 'ready' if grounder.ready else ('error' if grounder.error else 'loading'),
            'ready': grounder.ready, 'busy': grounder.lock.locked(), 'error': grounder.error,
            'model': grounder.manifest['repository'], 'revision': grounder.manifest['revision'],
            'device': 'cpu', 'capabilities': ['point_proposal'], 'requires_verification': True}


class LocateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    image: str = Field(min_length=20, max_length=MAX_BODY)
    label: str = Field(min_length=1, max_length=400)


@app.post('/locate')
async def locate(body: LocateRequest, request: Request):
    if not grounder.ready:
        raise HTTPException(503, 'grounder_not_ready')
    if grounder.lock.locked():
        raise HTTPException(429, 'grounder_busy')
    if not body.label.strip() or any(ord(char) < 32 for char in body.label) or '<loc_' in body.label:
        raise HTTPException(400, 'invalid_label')
    try:
        image = decode_image(body.image)
    except ValueError:
        raise HTTPException(400, 'invalid_image') from None
    cancelled = threading.Event()
    worker = asyncio.create_task(asyncio.to_thread(grounder.locate, image, body.label.strip(), cancelled,
                                                  time.monotonic() + MAX_REQUEST_SECONDS))
    try:
        while not worker.done():
            if await request.is_disconnected():
                cancelled.set()
            await asyncio.wait({worker}, timeout=0.05)
        return await worker
    except TimeoutError:
        raise HTTPException(504, 'grounding_timed_out') from None
    except RuntimeError as error:
        raise HTTPException(429 if str(error) == 'busy' else 503, 'grounding_unavailable') from None
    except asyncio.CancelledError:
        cancelled.set()
        worker.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        raise
    except Exception:
        raise HTTPException(503, 'grounding_unavailable') from None
    finally:
        cancelled.set()


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=22135, access_log=False, limit_concurrency=8, timeout_keep_alive=2)

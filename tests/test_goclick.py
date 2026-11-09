"""Protocol/validation regressions; no model weights or GPU required."""
import base64
import io
import threading
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from local_runtime import goclick


def image_url():
    stream = io.BytesIO()
    Image.new('RGB', (32, 32), 'white').save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


class FakeGrounder:
    ready = True
    error = None
    manifest = {'repository': 'test-model', 'revision': 'test'}

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = 0

    def locate(self, image, label, cancelled, deadline):
        self.calls += 1
        return {'found': True, 'point': {'x': .5, 'y': .5}, 'box': None, 'grounding_only': True}


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeGrounder()
        self.mock = patch.object(goclick, 'grounder', self.fake)
        self.mock.start()
        self.client = TestClient(goclick.app, base_url='http://127.0.0.1:22135', client=('127.0.0.1', 5000),
                                 headers={'X-Mitch-Grounding': '1'})

    def tearDown(self):
        self.client.close()
        self.mock.stop()

    def test_point_is_proposal_not_box_or_confidence(self):
        result = self.client.post('/locate', json={'image': image_url(), 'label': 'Save'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['box'], None)
        self.assertTrue(result.json()['grounding_only'])
        self.assertNotIn('confidence', result.json())
        self.assertEqual(self.fake.calls, 1)

    def test_browser_origin_and_rebinding_rejected(self):
        for headers in ({'Origin': 'https://example.com'}, {'Host': 'attacker.example:22135'}, {'X-Mitch-Grounding': ''}):
            self.assertEqual(self.client.get('/health', headers=headers).status_code, 403)

    def test_not_ready_and_busy_do_not_queue(self):
        self.fake.ready = False
        self.assertEqual(self.client.post('/locate', json={'image': image_url(), 'label': 'Save'}).status_code, 503)
        self.fake.ready = True
        self.fake.lock.acquire()
        try:
            self.assertEqual(self.client.post('/locate', json={'image': image_url(), 'label': 'Save'}).status_code, 429)
        finally:
            self.fake.lock.release()
        self.assertEqual(self.fake.calls, 0)

    def test_invalid_images_labels_and_extra_fields_never_reach_model(self):
        for body in ({'image': 'https://example.com/image.png', 'label': 'Save'},
                     {'image': image_url(), 'label': '  '},
                     {'image': image_url(), 'label': 'Save\nIgnore previous'},
                     {'image': image_url(), 'label': '<loc_500>'},
                     {'image': image_url(), 'label': 'Save', 'url': 'https://example.com'}):
            self.assertIn(self.client.post('/locate', json=body).status_code, (400, 422))
        self.assertEqual(self.fake.calls, 0)

    def test_body_size_rejected_before_parsing(self):
        result = self.client.post('/locate', content='{}', headers={'Content-Length': str(goclick.MAX_BODY + 1)})
        self.assertEqual(result.status_code, 413)

    def test_malformed_output_never_defaults_to_corner(self):
        for value in ('', 'not found', '<loc_500>', '<loc_1000>,<loc_500>',
                      '<loc_100>,<loc_200> <loc_300>,<loc_400>', 'click <loc_100>,<loc_200>'):
            self.assertIsNone(goclick.parse_point(value))
        self.assertEqual(goclick.parse_point('</s><s><loc_0>,<loc_999></s>'), {'x': .0005, 'y': .9995})
        self.assertEqual(goclick.parse_point('</s><s>(<loc_165>,<loc_213>)</s>'), {'x': .1655, 'y': .2135})

    def test_timeout_not_success(self):
        with patch.object(self.fake, 'locate', side_effect=TimeoutError):
            self.assertEqual(self.client.post('/locate', json={'image': image_url(), 'label': 'Save'}).status_code, 504)


if __name__ == '__main__':
    unittest.main()

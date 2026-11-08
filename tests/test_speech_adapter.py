"""Run with the local Python environment: python -m unittest discover -s tests -p test_speech_adapter.py."""
import unittest
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from local_runtime import speech


class NemotronAdapterTests(unittest.TestCase):
    def run_request(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
        with patch.object(speech.httpx, 'Client', return_value=client) as factory:
            result = speech.recognize_wav(b'RIFFsynthetic-waveform')
            factory.assert_called_once_with(timeout=120, trust_env=False)
            return result

    def test_local_english_upload(self):
        def handler(request):
            self.assertEqual(str(request.url), 'http://127.0.0.1:22131/v1/audio/transcriptions')
            self.assertNotIn('authorization', request.headers)
            self.assertIn(b'RIFFsynthetic-waveform', request.content)
            self.assertIn(b'name="language"\r\n\r\nen', request.content)
            return httpx.Response(200, json={'text': '  Hello Mitch.  '})
        self.assertEqual(self.run_request(handler), 'Hello Mitch.')

    def test_bad_response_does_not_fall_back(self):
        for status, body in ((503, {}), (200, {'text': None}), (200, {})):
            with self.subTest(status=status, body=body):
                calls = []
                def handler(request):
                    calls.append(str(request.url))
                    return httpx.Response(status, json=body)
                with self.assertRaises(HTTPException) as error:
                    self.run_request(handler)
                self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()

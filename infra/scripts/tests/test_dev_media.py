"""Regression checks for the local movie download cache."""

import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "download-dev-media.py"
spec = importlib.util.spec_from_file_location("download_dev_media", SCRIPT)
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class DevMediaTests(unittest.TestCase):
    def test_download_is_verified_and_reused_offline(self):
        content = b"sample video bytes"
        film = ("Sample.mp4", "https://example.invalid/sample.mp4", len(content), hashlib.sha256(content).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(media, "MOVIES", Path(directory)), patch.object(media, "FILMS", (film,)):
                with patch.object(media, "urlopen", return_value=io.BytesIO(content)) as fetch:
                    media.main()
                    media.main()
                fetch.assert_called_once_with(film[1], timeout=60)
                self.assertEqual((Path(directory) / film[0]).read_bytes(), content)

    def test_bad_download_is_not_published(self):
        film = ("Sample.mp4", "https://example.invalid/sample.mp4", 10, hashlib.sha256(b"expected!!").hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(media, "MOVIES", Path(directory)), patch.object(media, "FILMS", (film,)):
                with patch.object(media, "urlopen", return_value=io.BytesIO(b"incorrect!")):
                    with self.assertRaisesRegex(RuntimeError, "checksum or size mismatch"):
                        media.main()
                self.assertFalse((Path(directory) / film[0]).exists())
                self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()

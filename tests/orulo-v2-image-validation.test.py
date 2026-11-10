import importlib.util
import io
import json
from email.message import Message
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from PIL import Image
import orulo_v2_image_validation as v

spec = importlib.util.spec_from_file_location("dry_run", Path(sys.path[0]) / "orulo-v2-national-dry-run.py")
dry_run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dry_run)
URL = "https://static.orulo.com.br/images/properties/large/1.JPG"


class Response(io.BytesIO):
    status = 200

    def __init__(self, body, mime, length):
        super().__init__(body)
        self.headers = Message()
        self.headers["Content-Type"] = mime
        self.headers["Content-Length"] = str(length)


class ValidatorTest(unittest.TestCase):
    def setUp(self):
        output = io.BytesIO()
        Image.new("RGB", (8, 8)).save(output, format="JPEG")
        self.body = output.getvalue()
        self.evidence = {"url": URL, "status": "VALIDATED_PREFIX", "format": "jpeg",
                         "prefixBytes": 32, "prefixSha256": v.sha(self.body[:32])}

    def check(self, body, mime="image/jpeg", length=None):
        with patch.object(v, "build_opener") as opener:
            opener.return_value.open.return_value = Response(body, mime, len(body) if length is None else length)
            return v.inspect_image(URL, self.evidence)

    def test_url_and_domain(self):
        self.assertIsNone(v.url_status(URL))
        self.assertEqual(v.url_status(URL + "?x"), "SOURCE_URL_INVALID")
        self.assertEqual(v.url_status(URL.replace(v.HOST, "other.example")), "SOURCE_DOMAIN_NOT_ALLOWED")

    def test_http_and_redirect(self):
        for code in (302, 403, 404, 500):
            with self.subTest(code=code), patch.object(v, "build_opener") as opener:
                opener.return_value.open.side_effect = HTTPError(URL, code, "", {}, None)
                expected = "SOURCE_HTTP_REDIRECT" if code == 302 else f"SOURCE_HTTP_{code}"
                self.assertEqual(v.inspect_image(URL, self.evidence), expected)
        self.assertIsNone(v.NoRedirect().redirect_request())

    def test_timeout(self):
        with patch.object(v, "build_opener") as opener:
            opener.return_value.open.side_effect = TimeoutError()
            self.assertEqual(v.inspect_image(URL, self.evidence), "SOURCE_TIMEOUT")

    def test_complete_binary_mime_and_repeat(self):
        for mime in ("image/jpeg", "application/octet-stream"):
            self.assertEqual(self.check(self.body, mime), v.VALID)

    def test_body_failures(self):
        self.assertEqual(self.check(self.body, "text/html"), "SOURCE_CONTENT_TYPE_INVALID")
        self.assertEqual(self.check(b"x" * 40), "SOURCE_SIGNATURE_INVALID")
        self.assertEqual(self.check(self.body[:-2]), "SOURCE_FILE_TRUNCATED")
        self.assertEqual(self.check(self.body, length=len(self.body)+1), "SOURCE_FILE_TRUNCATED")
        self.evidence["prefixSha256"] = "0" * 64
        self.assertEqual(self.check(self.body), "SOURCE_EVIDENCE_MISMATCH")

    def test_checkpoint_and_fallback(self):
        raw = json.dumps(self.evidence).encode()
        path = f"cdn/{v.sha(URL.encode())}.json"
        plan = {"status": "RECOVERABLE", "normalizedPlan": {"id": 1, "images": [], "image_url": URL},
                "imageChecks": [{"url": URL, "evidence": path, "sha256": v.sha(raw)}]}
        with patch.object(v, "inspect_image", return_value=v.VALID):
            self.assertEqual(v.validate_plan(plan, "1", {path: raw}), v.VALID)
            self.assertEqual(v.validate_plan(plan, "2", {path: raw}), "SOURCE_EVIDENCE_MISMATCH")
            self.assertEqual(v.validate_plan(plan, "1", {path: raw+b" "}), "SOURCE_EVIDENCE_MISMATCH")
            self.assertEqual(v.validate_plan(plan, "1", {}), "SOURCE_PROVENANCE_INSUFFICIENT")

    def test_exclusive_occurrence_results(self):
        def status(source, digest="current", **fields):
            row = ({"raw_data": {"building": {"floor_plans": [{"id": 1, **fields}]}}}, "current")
            return dry_run.occurrence_status(row, "1", digest, source)
        self.assertEqual(status(v.VALID, "old"), "BASELINE_CHANGED_SINCE_RECONCILIATION")
        self.assertEqual(status(v.VALID, images=[URL]), "TARGET_IMAGES_PRESENT")
        self.assertEqual(status(v.VALID, url=URL), "ALTERNATE_IMAGE_FIELDS_PRESENT")
        self.assertEqual(status("SOURCE_HTTP_404"), "SOURCE_HTTP_404")
        self.assertEqual(status(v.VALID), "ELIGIBLE")


if __name__ == "__main__":
    unittest.main()

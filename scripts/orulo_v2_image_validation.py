import hashlib
import io
import json
import re
import time
from http.client import HTTPException, IncompleteRead
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image

HOST = "static.orulo.com.br"
LIMIT = 16 * 1024 * 1024
VALID = "SOURCE_IMAGE_VALID"
MIMES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
Image.MAX_IMAGE_PIXELS = 10_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def sha(data):
    return hashlib.sha256(data).hexdigest()


def url_status(url):
    if not isinstance(url, str) or not url.isascii() or any(ord(c) < 33 for c in url):
        return "SOURCE_URL_INVALID"
    try:
        parts = urlsplit(url)
    except ValueError:
        return "SOURCE_URL_INVALID"
    if parts.scheme != "https" or not parts.netloc or parts.username is not None:
        return "SOURCE_URL_INVALID"
    if parts.hostname != HOST:
        return "SOURCE_DOMAIN_NOT_ALLOWED"
    if (parts.netloc != HOST or "?" in url or "#" in url
            or not re.fullmatch(r"/images/[A-Za-z0-9_./-]+", parts.path)
            or any(p in ("", ".", "..") for p in parts.path.split("/")[1:])):
        return "SOURCE_URL_INVALID"
    return None


def inspect_image(url, evidence):
    try:
        deadline = time.monotonic() + 20
        with build_opener(NoRedirect()).open(Request(url, headers={"Accept-Encoding": "identity"}), timeout=5) as response:
            if response.status != 200:
                return "SOURCE_HTTP_ERROR"
            mime = response.headers.get_content_type()
            if mime not in MIMES and mime not in ("application/octet-stream", "binary/octet-stream"):
                return "SOURCE_CONTENT_TYPE_INVALID"
            length = response.headers.get("Content-Length")
            if length is not None and not re.fullmatch(r"[0-9]{1,12}", length):
                return "SOURCE_HTTP_ERROR"
            length = int(length) if length is not None else None
            if length is not None and length > LIMIT:
                return "SOURCE_RESOURCE_LIMIT"
            body = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    return "SOURCE_TIMEOUT"
                block = response.read1(min(65536, LIMIT + 1 - len(body)))
                if not block:
                    break
                body.extend(block)
                if len(body) > LIMIT:
                    return "SOURCE_RESOURCE_LIMIT"
    except HTTPError as error:
        return "SOURCE_HTTP_REDIRECT" if 300 <= error.code < 400 else f"SOURCE_HTTP_{error.code}"
    except TimeoutError:
        return "SOURCE_TIMEOUT"
    except IncompleteRead:
        return "SOURCE_FILE_TRUNCATED"
    except URLError as error:
        return "SOURCE_TIMEOUT" if isinstance(error.reason, TimeoutError) else "SOURCE_HTTP_ERROR"
    except (OSError, HTTPException):
        return "SOURCE_HTTP_ERROR"
    if (length is not None and length != len(body)) or len(body) < evidence["prefixBytes"]:
        return "SOURCE_FILE_TRUNCATED"
    if body.startswith(b"\xff\xd8\xff"):
        fmt, complete = "JPEG", body.endswith(b"\xff\xd9")
    elif body.startswith(b"\x89PNG\r\n\x1a\n"):
        fmt, complete = "PNG", body.endswith(b"IEND\xaeB\x60\x82")
    elif body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        fmt, complete = "WEBP", int.from_bytes(body[4:8], "little") + 8 == len(body)
    else:
        return "SOURCE_SIGNATURE_INVALID"
    if not complete:
        return "SOURCE_FILE_TRUNCATED"
    if mime in MIMES and MIMES[mime] != fmt:
        return "SOURCE_CONTENT_TYPE_INVALID"
    if fmt.lower() != evidence["format"] or sha(body[:evidence["prefixBytes"]]) != evidence["prefixSha256"]:
        return "SOURCE_EVIDENCE_MISMATCH"
    try:
        with Image.open(io.BytesIO(body)) as image:
            if image.width * image.height > Image.MAX_IMAGE_PIXELS:
                return "SOURCE_RESOURCE_LIMIT"
            if image.format != fmt or getattr(image, "n_frames", 1) != 1:
                return "SOURCE_SIGNATURE_INVALID"
            image.verify()
        with Image.open(io.BytesIO(body)) as image:
            image.load()
    except Image.DecompressionBombError:
        return "SOURCE_RESOURCE_LIMIT"
    except (OSError, ValueError, SyntaxError):
        return "SOURCE_IMAGE_DECODE_FAILED"
    return VALID


def validate_plan(plan, plan_id, checkpoint):
    normalized = plan.get("normalizedPlan")
    checks = plan.get("imageChecks")
    if plan.get("status") != "RECOVERABLE" or not isinstance(normalized, dict) or not checks:
        return "SOURCE_PROVENANCE_INSUFFICIENT"
    if str(normalized.get("id")) != plan_id:
        return "SOURCE_EVIDENCE_MISMATCH"
    images = normalized.get("images", [])
    if not isinstance(images, list):
        return "SOURCE_URL_INVALID"
    fields = ("image_url", "url", "2280x1800", "1024x1024", "520x280")
    urls = [*images, *(normalized[f] for f in fields if normalized.get(f) not in (None, ""))]
    if not urls:
        return "SOURCE_PROVENANCE_INSUFFICIENT"
    for url in urls:
        if status := url_status(url):
            return status
    for url in dict.fromkeys(urls):
        matches = [item for item in checks if item.get("url") == url]
        path = f"cdn/{sha(url.encode())}.json"
        if len(matches) != 1 or matches[0].get("evidence") != path:
            return "SOURCE_EVIDENCE_MISMATCH"
        raw = checkpoint.get(path)
        if raw is None:
            return "SOURCE_PROVENANCE_INSUFFICIENT"
        if sha(raw) != matches[0].get("sha256"):
            return "SOURCE_EVIDENCE_MISMATCH"
        evidence = json.loads(raw)
        if (evidence.get("url") != url or evidence.get("status") != "VALIDATED_PREFIX"
                or evidence.get("format") not in ("jpeg", "png", "webp")
                or type(evidence.get("prefixBytes")) is not int or not 1 <= evidence["prefixBytes"] <= 4096
                or not re.fullmatch(r"[a-f0-9]{64}", str(evidence.get("prefixSha256")))):
            return "SOURCE_EVIDENCE_MISMATCH"
        if (status := inspect_image(url, evidence)) != VALID:
            return status
    return VALID

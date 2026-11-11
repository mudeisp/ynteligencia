#!/usr/bin/env python3
"""Bounded full-binary verification, using the original checkpoint prefix proof."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from orulo_v2_image_validation import VALID, inspect_image, url_status

try:
    checks = json.load(sys.stdin)
    assert isinstance(checks, list) and len(checks) <= 10000
    def verify(check):
        url = check['url']
        evidence = check['evidence']
        if url_status(url) is not None or evidence['url'] != url or evidence['status'] != 'VALIDATED_PREFIX':
            return False
        return inspect_image(url, evidence) == VALID
    with ThreadPoolExecutor(max_workers=4) as pool:
        valid = all(pool.map(verify, checks))
    print(json.dumps({'valid': valid, 'checked': len(checks)}))
    sys.exit(0 if valid else 1)
except Exception:
    sys.exit('NATIONAL_IMAGE_VALIDATION_FAILED')

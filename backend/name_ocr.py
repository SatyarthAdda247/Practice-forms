"""Handwritten student-name OCR via Google Cloud Vision.

On the Adda247 sheet the student's name is handwritten in the boxes at the top
of the NAME block (the A-Z bubble grid below it is left empty), so it can't be
read by mark detection. This module crops that handwriting strip and runs it
through Vision's handwriting OCR (``document_text_detection``).

It is deliberately best-effort and never fatal: any failure (missing
credentials, Vision API not enabled, network error, unreadable scrawl) returns
``None`` so the upload/grade flow proceeds with a blank name. After a hard
auth/config failure it disables itself for the process to avoid hammering a
misconfigured API on every sheet.

Setup required (one time):
  * ``backend/credential/adda247-dev-omr.json`` present (already used for
    BigQuery) and ``GOOGLE_APPLICATION_CREDENTIALS`` pointing at it.
  * The **Cloud Vision API** enabled on the ``adda247-dev`` project, and the
    service account allowed to call it.
  * Toggle with env ``OMR_NAME_OCR`` (``"1"`` on — default; ``"0"`` off).
"""

import logging
import re

import cv2

log = logging.getLogger(__name__)

# Handwriting strip on the template, as (x0, y0, x1, y1) fractions of the page.
# Calibrated on the Adda247 100-question sheet at 200 DPI.
NAME_STRIP = (0.088, 0.209, 0.362, 0.234)

_client = None
_disabled = False  # flipped True after a hard auth/config failure


def _vision_client():
    global _client
    if _client is None:
        from google.cloud import vision  # lazy: import only when actually used

        _client = vision.ImageAnnotatorClient()
    return _client


def _clean(text):
    """Normalise OCR output to an uppercase A-Z name, or None if empty."""
    if not text:
        return None
    t = re.sub(r"[^A-Z ]", " ", text.upper())
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def read_name_from_gray(gray):
    """Given a full-page grayscale ndarray, OCR the handwritten name strip.
    Returns the cleaned name string, or ``None`` on any failure/empty."""
    global _disabled
    if _disabled:
        return None

    H, W = gray.shape
    x0, y0, x1, y1 = NAME_STRIP
    crop = gray[int(H * y0):int(H * y1), int(W * x0):int(W * x1)]
    if crop.size == 0:
        return None
    # Upscale — the strip is small and OCR is far more reliable on larger text.
    crop = cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        return None

    try:
        from google.cloud import vision

        image = vision.Image(content=buf.tobytes())
        ctx = vision.ImageContext(language_hints=["en"])
        resp = _vision_client().document_text_detection(image=image, image_context=ctx)
        if resp.error.message:
            raise RuntimeError(resp.error.message)
        return _clean(resp.full_text_annotation.text)
    except Exception as exc:  # never fatal — a missing name must not block grading
        log.warning("name OCR failed: %s", exc)
        # A config/auth failure (no creds, API disabled, no permission) will
        # recur on every sheet — turn OCR off for the rest of the process.
        msg = str(exc).lower()
        hard = any(s in msg for s in (
            "default credentials", "credential", "permission", "not enabled",
            "has not been used", "unauthenticated", "forbidden", "api_key",
        ))
        if hard:
            _disabled = True
            log.warning("disabling name OCR for this process (auth/config issue)")
        return None

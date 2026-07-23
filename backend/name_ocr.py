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
import numpy as np

log = logging.getLogger(__name__)

# Fallback handwriting strip on the template, as (x0, y0, x1, y1) fractions of
# the page. Only used if the bubble-matrix anchor below can't be located.
NAME_STRIP = (0.088, 0.209, 0.362, 0.234)

# Horizontal extent of the handwriting boxes (fractions of page width).
NAME_X = (0.085, 0.37)


def _name_matrix_top(gray):
    """Locate the NAME block's A-Z bubble matrix and return
    ``(top_row_y, median_radius)`` in full-page pixel coords.

    The matrix is hundreds of near-identical small circles in the top-left; its
    first row is a reliable anchor for the handwriting strip that sits just
    above it. Raises ``ValueError`` if too few bubbles are found to be sure."""
    H, W = gray.shape
    x0, x1 = int(W * 0.07), int(W * 0.40)
    y0, y1 = int(H * 0.20), int(H * 0.45)
    sub = gray[y0:y1, x0:x1]
    th = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    sw = sub.shape[1]
    ys, rs = [], []
    for c in cnts:
        (_, cy), r = cv2.minEnclosingCircle(c)
        if r < sw * 0.008 or r > sw * 0.03:  # bubble-sized only
            continue
        if cv2.contourArea(c) < 0.4 * np.pi * r * r:  # roughly round / solid
            continue
        ys.append(cy + y0)
        rs.append(r)
    if len(ys) < 40:  # the matrix has hundreds; too few ⇒ not confidently found
        raise ValueError("name bubble matrix not found")
    return float(np.percentile(ys, 2)), float(np.median(rs))


def _name_crop(gray):
    """Return the handwritten-name strip to OCR.

    The name is written in the row of boxes directly above the NAME block's
    bubble matrix. Scans of this template drift vertically by a few percent, so
    a fixed strip lands on the "NAME" title on some sheets and on the bubble
    rows on others (which is why names weren't being read). We instead detect
    the matrix and take a fixed-height band just above its first row, which
    tracks the drift. Falls back to the static ``NAME_STRIP`` if detection
    fails."""
    H, W = gray.shape
    x_l, x_r = int(W * NAME_X[0]), int(W * NAME_X[1])
    try:
        top_y, rad = _name_matrix_top(gray)
        bot = int(top_y - rad * 2.0)   # just above the first bubble row
        top = int(top_y - rad * 6.5)   # ~one box-row tall, below the NAME title
        if top >= 0 and bot > top:
            crop = gray[top:bot, x_l:x_r]
            if crop.size:
                return crop
    except Exception as exc:
        log.debug("name-matrix anchor failed, using fixed strip: %s", exc)
    x0, y0, x1, y1 = NAME_STRIP
    return gray[int(H * y0):int(H * y1), int(W * x0):int(W * x1)]

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

    crop = _name_crop(gray)
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

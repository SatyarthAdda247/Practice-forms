"""Handwritten student-name OCR via TrOCR (local, no external service).

Used only as a fallback: :func:`omr_pipeline.read_name_grid` reads the name
exactly and for free whenever the student filled the A-Z bubble matrix, so this
runs on the sheets where that grid is blank.

Scope is deliberately narrow — it reads a **free-hand name written in blue pen**
in the form ``NAME- <student name>``, and nothing else. Measured on real sheets:

  * free-hand blue-pen line  ->  'gouray'                (correct)
  * name written in the printed per-character boxes
      whole strip            ->  'Triumphatic that tie'  (garbage)
      one box at a time      ->  'IRRT1RRR1RFFRRIR'      (garbage)

The boxed layout defeats it because the printed cell borders read as strokes,
so we never OCR the boxes: if no blue-pen line is found this returns ``None``
and the sheet keeps a blank name for a human to fill in. Returning a confident
wrong name is worse than returning nothing.

How it works:
  1. Locate blue ink by channel dominance (B > max(G, R)). The form is printed
     black/grey, so this isolates pen strokes anywhere on the page.
  2. Group the ink into horizontal bands and split each into words.
  3. Keep the band whose first word reads as "NAME" (fuzzy — OCR of a 19px word
     is not exact). This anchor is what distinguishes the name from the
     signatures, which otherwise look identical to a locator.
  4. OCR the rest of that band.

Crops are taken from the **greyscale** image, not the blue mask: the ink is weak
(blue-dominance peaks around 41/255 on a phone photo) and binarising it turns
the strokes into blobs.

Setup: needs ``torch`` + ``transformers`` and downloads ~1.4 GB of weights on
first use. Toggle with ``OMR_NAME_TROCR`` ("1" on — default; "0" off).
"""

import logging
import os
import re

import cv2
import numpy as np

log = logging.getLogger(__name__)

ENABLED = os.environ.get("OMR_NAME_TROCR", "1") != "0"
MODEL = os.environ.get("OMR_TROCR_MODEL", "microsoft/trocr-base-handwritten")

DOM_MIN = 18        # blue-dominance above which a pixel counts as pen ink
BAND_MIN_H = 8      # ignore ink bands thinner than this (specks, rules)
TARGET_H = 220      # upscale each crop to roughly this height before OCR
MAX_UPSCALE = 8     # ...but never beyond this (the strip can be very short)

# Scan noise also trips the blue test — a greyscale PDF scan measured 0.52%
# "blue" pixels, *more* than a real blue-pen photo at 0.34% — which yielded 30
# candidate bands and 19s of pointless inference per sheet. Colour alone can't
# separate them, so bound the work instead: only look at the few densest bands,
# and only ones with enough ink to be handwriting.
# Colour cannot be used to skip a sheet cheaply: scanner output carries a
# stronger blue cast than real ink (a greyscale PDF scan measured peak
# dominance 162 with 17k strong pixels, against 41 and 33 for an actual
# blue-pen photo). The "NAME" anchor is what actually rejects those, so the
# only lever on cost is how many candidates we are willing to read.
MAX_BANDS = 3       # OCR at most this many candidates per sheet
BAND_MIN_INK = 60   # a band needs at least this many ink pixels to be a word
SEARCH_TOP = 0.55   # the name field is in the upper part of the form

_model = None
_tokenizer = None
_image_proc = None
_disabled = False   # set after a hard load failure, to avoid retrying per sheet


def _load():
    """Lazily build the model. Returns False if unavailable."""
    global _model, _tokenizer, _image_proc, _disabled
    if _disabled:
        return False
    if _model is not None:
        return True
    try:
        import torch  # noqa: F401
        from transformers import (
            AutoImageProcessor,
            AutoTokenizer,
            VisionEncoderDecoderModel,
        )

        try:
            from transformers import TrOCRProcessor

            proc = TrOCRProcessor.from_pretrained(MODEL)
            _image_proc, _tokenizer = proc.image_processor, proc.tokenizer
        except Exception as exc:
            # Newer transformers can't convert TrOCR's slow tokenizer without
            # `tokenizers` wheels for the running Python. TrOCR decodes with the
            # RoBERTa vocab (50265 tokens, verified identical), which ships a
            # prebuilt fast tokenizer, so assemble the processor by hand.
            log.info("TrOCRProcessor unavailable (%s); using RoBERTa tokenizer", exc)
            _image_proc = AutoImageProcessor.from_pretrained(MODEL)
            _tokenizer = AutoTokenizer.from_pretrained("roberta-large")

        _model = VisionEncoderDecoderModel.from_pretrained(MODEL)
        _model.eval()
        _model.config.decoder_start_token_id = _tokenizer.cls_token_id
        _model.config.pad_token_id = _tokenizer.pad_token_id
        return True
    except Exception as exc:
        log.warning("TrOCR unavailable, name OCR disabled for this process: %s", exc)
        _disabled = True
        return False


def _ocr(gray_crop):
    import torch
    from PIL import Image

    # Scale to a fixed working height rather than a fixed factor: a blanket 8x
    # on a full-width band produces a huge image whose denoise pass dominates
    # the runtime, for no accuracy gain.
    h = max(1, gray_crop.shape[0])
    scale = float(np.clip(TARGET_H / h, 2.0, MAX_UPSCALE))
    big = cv2.resize(gray_crop, None, fx=scale, fy=scale,
                     interpolation=cv2.INTER_CUBIC)
    big = cv2.fastNlMeansDenoising(big, None, 7, 7, 21)
    pixels = _image_proc(images=Image.fromarray(big).convert("RGB"),
                         return_tensors="pt").pixel_values
    with torch.no_grad():
        ids = _model.generate(pixels, max_new_tokens=32)
    return _tokenizer.batch_decode(ids, skip_special_tokens=True)[0].strip()


def _blue_mask(bgr):
    b, g, r = cv2.split(bgr.astype(np.int16))
    dominance = np.clip(b - np.maximum(g, r), 0, 255).astype(np.uint8)
    return (dominance > DOM_MIN).astype(np.uint8)


def _bands(mask):
    """Horizontal bands of ink, as (y0, y1)."""
    rows = mask.sum(axis=1)
    out, start = [], None
    for y, count in enumerate(rows):
        if count > 3 and start is None:
            start = y
        elif count <= 3 and start is not None:
            if y - start >= BAND_MIN_H:
                out.append((start, y))
            start = None
    if start is not None and len(rows) - start >= BAND_MIN_H:
        out.append((start, len(rows)))
    return out


def _is_name_label(text):
    """Fuzzy match for the "NAME" prefix — OCR of a tiny word is never exact."""
    t = re.sub(r"[^a-z]", "", (text or "").lower())
    if not t:
        return False
    if t.startswith(("name", "nam", "nane")):
        return True
    return len(t) >= 4 and sum(a != b for a, b in zip(t[:4], "name")) <= 1


def _clean(text):
    name = re.sub(r"[^A-Z ]", " ", (text or "").upper())
    name = re.sub(r"\s+", " ", name).strip()
    return name or None


def read_name_from_bgr(bgr):
    """OCR a blue-pen ``NAME- <student name>`` line. ``None`` if not found."""
    if not ENABLED or bgr is None or not _load():
        return None
    try:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        mask = _blue_mask(bgr)
        height = mask.shape[0]

        # Densest bands first, capped — see MAX_BANDS. The name line is one of
        # the inkiest things on the page, so ordering by ink finds it early and
        # the cap stops a noisy scan costing 30 inferences.
        candidates = [(y0, y1, int(mask[y0:y1, :].sum()))
                      for y0, y1 in _bands(mask)
                      if y0 < height * SEARCH_TOP]
        candidates = [c for c in candidates if c[2] >= BAND_MIN_INK]
        candidates.sort(key=lambda c: -c[2])

        for y0, y1, _ in candidates[:MAX_BANDS]:
            xs = np.nonzero(mask[y0:y1, :].sum(axis=0) > 0)[0]
            if len(xs) < 10:
                continue
            gaps = np.diff(xs)
            wide = [(g, i) for i, g in enumerate(gaps) if g > (y1 - y0) * 0.5]
            if not wide:
                continue
            _, split = max(wide)
            pad = max(3, (y1 - y0) // 4)
            top, bottom = max(0, y0 - pad), min(height, y1 + pad)

            # One inference per band to test the anchor: read the whole line and
            # check it begins with "NAME". Only a band that passes costs a
            # second, tighter read — so a page of noise stays cheap.
            whole = _ocr(gray[top:bottom, max(0, xs[0] - pad):xs[-1] + pad])
            if not _is_name_label(whole):
                continue  # a signature or stray mark, not the name field
            value = _ocr(gray[top:bottom,
                              max(0, xs[split + 1] - pad):xs[-1] + pad])
            # Fall back to the whole-line read with the label stripped off.
            name = _clean(value) or _clean(re.sub(r"^\s*nam\w*\s*[-:.]*", "",
                                                  whole, flags=re.I))
            if name:
                return name
        return None
    except Exception as exc:  # never fatal — a missing name must not block grading
        log.warning("TrOCR name read failed: %s", exc)
        return None

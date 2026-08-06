"""Read the text off a PDF whose pages are pictures.

Why this exists
---------------
The papers candidates actually hold are often not the file the commission
published. They have been opened in a PDF editor and re-saved, or printed to
PDF, and every page has become a single flattened image: no fonts, no text, no
selectable characters. The browser reader (frontend/src/tools/lib/answerKey.js)
extracts text and colours out of the PDF's own content stream, so against one of
these it finds precisely nothing and the candidate is told their file cannot be
read — of a document whose answers are plainly legible on screen.

The layouts that arrive this way state everything in words ("Correct Answer: 3)
Trituration", "Candidate Answer: [ NOT ANSWERED ]"), so recovering the text is
enough; none of the colour or tick-icon forensics the annotated sheets need
applies. So: rasterise each page and OCR it, and hand the lines back for the
same parsers to read.

Engine
------
Tesseract, run as a subprocess. Chosen over Cloud Vision because Vision is a
per-page billed API call on a project where it is currently disabled, while this
runs locally at ~0.5s a page and costs nothing. The text being read is crisp
digital type rendered at 200dpi rather than a photograph of paper, which is the
case Tesseract is strongest at — the option numbers and the answer digits, which
are the only parts that decide a score, come back clean.

It is deliberately optional. Where the binary is absent this module reports that
it is unavailable and the caller says so; nothing else in the app depends on it.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile

log = logging.getLogger(__name__)

# Rendering resolution. 200dpi is the point where the option digits stop being
# ambiguous on these sheets; going higher costs time for no gain in the only
# characters that matter.
DPI = int(os.environ.get("OMR_OCR_DPI", "200"))

# A whole paper is 35-80 pages. The cap is a guard against somebody posting a
# thousand-page file, not a limit any real response sheet reaches.
MAX_PAGES = int(os.environ.get("OMR_OCR_MAX_PAGES", "120"))

# Per page. Tesseract on a page of this kind takes well under a second; a page
# that takes ten is a page something is wrong with.
PAGE_TIMEOUT = int(os.environ.get("OMR_OCR_PAGE_TIMEOUT", "30"))

TESSERACT = os.environ.get("OMR_TESSERACT", "tesseract")


class OcrUnavailable(RuntimeError):
    """No OCR engine on this host. Not a failure of the file."""


def available() -> bool:
    """Whether OCR can run here at all, so callers can say so up front."""
    return shutil.which(TESSERACT) is not None


def _ocr_png(png: bytes) -> str:
    """One page image through Tesseract, as text.

    --psm 6 ("a single uniform block of text") rather than the default page
    segmentation: these sheets are one column of left-aligned lines, and the
    default splits the watermark and the header logo out as separate blocks,
    which reorders the lines and separates a "Correct Answer:" from the question
    it belongs to.
    """
    with tempfile.NamedTemporaryFile(suffix=".png") as src:
        src.write(png)
        src.flush()
        out = subprocess.run(
            [TESSERACT, src.name, "stdout", "--psm", "6", "-l", "eng"],
            capture_output=True,
            timeout=PAGE_TIMEOUT,
            check=False,
        )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.decode("utf-8", "replace")[:300] or "tesseract failed")
    return out.stdout.decode("utf-8", "replace")


def pdf_has_text(data: bytes) -> bool:
    """Whether the PDF carries a text layer of its own.

    Checked here as well as in the browser so the endpoint cannot be used as a
    general-purpose OCR service for files that never needed it.
    """
    import fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            if page.get_text().strip():
                return True
    return False


def pdf_lines(data: bytes) -> list[str]:
    """Every line of text OCR'd out of a PDF's page images, in reading order.

    Raises OcrUnavailable when there is no engine, ValueError when the file is
    not a readable PDF or is longer than MAX_PAGES.
    """
    if not available():
        raise OcrUnavailable("no OCR engine available")

    import fitz

    lines: list[str] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 — a bad upload is the caller's answer
        raise ValueError(f"not a readable PDF: {exc}") from exc

    with doc:
        if doc.page_count > MAX_PAGES:
            raise ValueError(f"{doc.page_count} pages is more than the {MAX_PAGES}-page limit")
        for number, page in enumerate(doc, start=1):
            try:
                png = page.get_pixmap(dpi=DPI).tobytes("png")
                text = _ocr_png(png)
            except subprocess.TimeoutExpired:
                log.warning("ocr: page %s timed out; skipped", number)
                continue
            except Exception as exc:  # noqa: BLE001 — one bad page must not lose the rest
                log.warning("ocr: page %s failed: %s", number, exc)
                continue
            for raw in text.splitlines():
                line = " ".join(raw.split())
                if line:
                    lines.append(line)
    return lines

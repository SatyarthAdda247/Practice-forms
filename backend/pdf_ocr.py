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
import time
from concurrent.futures import ThreadPoolExecutor

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


def _default_workers() -> int:
    """How many pages to OCR at once.

    From the CPUs the process is actually allowed, which under a container CPU
    limit is fewer than the machine reports — `os.cpu_count()` sees the host.
    Capped because each worker is a Tesseract process holding a page bitmap, and
    several gunicorn workers may be doing this at once.
    """
    try:
        allowed = len(os.sched_getaffinity(0))  # Linux: respects cpuset
    except AttributeError:  # macOS and Windows have no sched_getaffinity
        allowed = os.cpu_count() or 1
    return max(1, min(4, allowed))


OCR_WORKERS = int(os.environ.get("OMR_OCR_WORKERS", "0")) or _default_workers()

# Seconds of OCR per request. Comfortably inside the 60s an nginx ingress
# allows by default, with room for the upload and the response on either side.
OCR_BUDGET = float(os.environ.get("OMR_OCR_BUDGET", "35"))


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


def page_count(data: bytes) -> int:
    """How many pages the PDF has, or 0 if it cannot be opened.

    Only so the caller can tell the candidate how far through a long document
    the OCR has got. Never raises: a file too broken to open has already failed
    the read below, and this must not turn that into a different error.
    """
    import fitz

    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            return doc.page_count
    except Exception:  # noqa: BLE001 — a count is not worth failing a request over
        return 0


def pdf_lines(data: bytes, first: int = 1, budget: float | None = None):
    """OCR pages from `first` onwards, returning ``(lines, next_page)``.

    `next_page` is None when the document was finished, and the page number to
    resume from when the time budget ran out first.

    Two things shape this. Pages are OCR'd **concurrently**, because read one at
    a time a 37-page paper took ~25s on a developer machine and over 70s behind
    the production gateway, which cut the request off with a 504 — from the
    candidate's side the upload simply produced nothing, and pressing Analyze
    then asked them for the answers the OCR had been about to supply. Threads
    rather than processes: the work is a Tesseract subprocess per page, so each
    thread spends its time waiting on a child and releases the GIL. PyMuPDF page
    objects are not thread-safe, so each task opens its own handle on the same
    bytes rather than sharing one document.

    And there is a **time budget**, because concurrency alone only narrows the
    odds: how many CPUs the container is actually allowed decides whether a long
    paper fits inside the gateway's window, and that is not knowable from here.
    So pages are read in batches until the budget is nearly spent, then the
    remainder is handed back as a cursor for the caller to ask for. A document
    that fits — the normal case — still completes in a single call.

    Raises OcrUnavailable when there is no engine, ValueError when the file is
    not a readable PDF, is longer than MAX_PAGES, or `first` is past the end.
    """
    if not available():
        raise OcrUnavailable("no OCR engine available")

    import fitz

    try:
        with fitz.open(stream=data, filetype="pdf") as doc:
            pages = doc.page_count
    except Exception as exc:  # noqa: BLE001 — a bad upload is the caller's answer
        raise ValueError(f"not a readable PDF: {exc}") from exc

    if pages > MAX_PAGES:
        raise ValueError(f"{pages} pages is more than the {MAX_PAGES}-page limit")
    if first < 1 or first > pages:
        raise ValueError(f"page {first} is outside this {pages}-page document")

    budget = OCR_BUDGET if budget is None else budget

    def read(number: int) -> list[str]:
        """One page, rasterised and OCR'd. Never raises: a page that cannot be
        read costs its own lines and nothing else."""
        try:
            with fitz.open(stream=data, filetype="pdf") as doc:
                png = doc[number - 1].get_pixmap(dpi=DPI).tobytes("png")
            text = _ocr_png(png)
        except subprocess.TimeoutExpired:
            log.warning("ocr: page %s timed out; skipped", number)
            return []
        except Exception as exc:  # noqa: BLE001 — one bad page must not lose the rest
            log.warning("ocr: page %s failed: %s", number, exc)
            return []
        return [line for line in (" ".join(r.split()) for r in text.splitlines()) if line]

    # Bounded by the CPUs the container is actually allowed rather than the
    # host's nominal count: oversubscribing makes each page slower without
    # finishing the set any sooner.
    workers = max(1, min(OCR_WORKERS, pages))
    started = time.monotonic()
    lines: list[str] = []
    page = first

    with ThreadPoolExecutor(max_workers=workers) as pool:
        while page <= pages:
            batch = range(page, min(page + workers, pages + 1))
            # map, so pages come back in reading order however they finish — the
            # parsers read "Correct Answer" as belonging to the QID above it, so
            # the order of the lines is the meaning.
            for page_lines in pool.map(read, batch):
                lines.extend(page_lines)
            page = batch.stop
            spent = time.monotonic() - started
            # Stop while there is still room for another batch to overrun a
            # little, rather than at the moment the budget is gone.
            if page <= pages and spent > budget * 0.75:
                log.info("ocr: budget spent after page %s of %s", page - 1, pages)
                return lines, page

    return lines, None

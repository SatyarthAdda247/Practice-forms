"""Real OMR reading pipeline (OpenCV) for the Adda247 100-question sheet.

Replaces the filename-hash stub in :mod:`grading` with actual optical-mark
recognition of the scanned sheet. Layout it is calibrated for:

  * 100 questions laid out in 5 vertical blocks of 20 (Q1-20, 21-40, … 81-100),
    each question offering options A/B/C/D.
  * The blocks are the five large bordered boxes in the lower ~45% of the page.

Approach (robust to the mild skew/warp typical of a phone/flatbed scan):

  1. Render the page to a grayscale raster (PDF via PyMuPDF, or a plain image).
  2. Otsu-threshold the lower region and find the 5 block rectangles by size.
  3. Inside each block, find bubble contours, then cluster their centres into
     exactly 4 columns × 20 rows (k-means on x and y). Because we cluster the
     *actual* detected bubbles per block, per-block skew is absorbed.
  4. Sample a disk at each bubble centre and measure its darkness (fraction of
     dark pixels). Per question, the darkest option above a fill threshold is
     the marked answer; two dark options → a MULTIPLE_MARKS review flag.

Returns the same answer shape the rest of the app expects: ``{"1": "A", ...}``.
"""

import cv2
import numpy as np

OPTIONS = ["A", "B", "C", "D"]

# Darkness thresholds, calibrated on real scans (filled bubbles measure
# ~0.75-0.99 dark, empty ~0.13-0.26 — a wide, safe margin).
#
# Real scans of this template often carry uneven *block/column shading* (whole
# answer boxes print or scan as a grey wash). Shading lifts the measured
# darkness of *every* bubble in a block, so a fixed global cut-off both (a)
# reads several empty-but-shaded bubbles as "filled" and trips a false
# MULTIPLE_MARKS, dropping a clearly-filled answer, and (b) misses a genuine but
# lighter mark that never crosses the line. We therefore classify each question
# *relative to its own four bubbles* (see :func:`_classify`) instead of against
# a single absolute level — the marked bubble is the one that stands clearly
# apart from the other three, whatever the local shading baseline.
FILL_MIN = 0.45    # >= this ⇒ a bubble is "definitely dark" (used for doubles)
STRONG_FILL = 0.70  # >= this ⇒ unmistakably filled, even against heavy shading
AMBIG_MIN = 0.30   # [AMBIG_MIN, FILL_MIN) ⇒ a faint/partial mark worth flagging
MARK_MIN = 0.35    # the darkest bubble must reach this to count as a mark
MARK_MARGIN = 0.12  # ...and lead the runner-up by this much to be unambiguous


class OMRError(Exception):
    """Raised when the sheet can't be parsed as the expected template."""


def _render_gray(path, page=0, dpi=200):
    """Return a grayscale ndarray for ``page`` of a PDF, or a whole image."""
    lower = path.lower()
    if lower.endswith(".pdf"):
        import fitz  # PyMuPDF

        doc = fitz.open(path)
        if page >= doc.page_count:
            raise OMRError(f"page {page} out of range ({doc.page_count} pages)")
        pix = doc[page].get_pixmap(dpi=dpi)
        buf = np.frombuffer(pix.samples, dtype=np.uint8)
        img = buf.reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        elif pix.n == 3:
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        else:  # grayscale already
            return img.reshape(pix.height, pix.width)
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise OMRError(f"could not read image: {path}")
    return img


def _find_answer_blocks(gray):
    """Locate the five bordered answer-column boxes in the lower region.
    Returns a left-to-right sorted list of (x, y, w, h)."""
    H, W = gray.shape
    top = int(H * 0.55)
    region = gray[top:, :]
    th = cv2.threshold(region, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > W * 0.10 and h > (H - top) * 0.5:
            boxes.append((x, y + top, w, h))
    boxes.sort(key=lambda b: b[0])
    return boxes


def _kmeans_1d(values, k):
    """1-D k-means; returns (labels, centres)."""
    vals = np.float32(values).reshape(-1, 1)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
    _, labels, centres = cv2.kmeans(vals, k, None, crit, 5, cv2.KMEANS_PP_CENTERS)
    return labels.flatten(), centres.flatten()


def _read_block(gray, box, rows=20):
    """Read one answer block. Returns a list of ``rows`` darkness vectors
    (one [A,B,C,D] list per question), or ``None`` if too few bubbles found."""
    x, y, w, h = box
    pad = int(w * 0.03)
    sub = gray[y + pad:y + h - pad, x + pad:x + w - pad]
    sh, sw = sub.shape
    th = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    bubbles = []
    for c in cnts:
        (cx, cy), r = cv2.minEnclosingCircle(c)
        if r < sw * 0.015 or r > sw * 0.06:
            continue
        if cv2.contourArea(c) < 0.4 * np.pi * r * r:  # roughly round / solid
            continue
        if cx < sw * 0.18:  # left column holds the question numbers, not bubbles
            continue
        bubbles.append((cx, cy, r))

    if len(bubbles) < rows * 2:  # need a believable grid
        return None

    xs = [b[0] for b in bubbles]
    ys = [b[1] for b in bubbles]
    xlab, xc = _kmeans_1d(xs, 4)
    ylab, yc = _kmeans_1d(ys, rows)
    col_rank = {old: new for new, old in enumerate(np.argsort(xc))}
    row_rank = {old: new for new, old in enumerate(np.argsort(yc))}
    col_x = np.sort(xc)
    row_y = np.sort(yc)
    rad = int(np.median([b[2] for b in bubbles]))

    # Prefer each cell's actually-detected bubble centre (absorbs skew); fall
    # back to the row/col cluster intersection when a bubble wasn't detected.
    cell = {}
    for (cx, cy, _), cl, rl in zip(bubbles, xlab, ylab):
        cell[(row_rank[rl], col_rank[cl])] = (cx, cy)

    grid = []
    r0 = max(3, int(rad * 0.7))
    for ri in range(rows):
        darkness = []
        for ci in range(4):
            bx, by = cell.get((ri, ci), (col_x[ci], row_y[ri]))
            bx, by = int(bx), int(by)
            patch = sub[max(0, by - r0):by + r0, max(0, bx - r0):bx + r0]
            darkness.append(float((patch < 128).mean()) if patch.size else 0.0)
        grid.append(darkness)
    return grid


def _classify(darkness):
    """Map one question's [A,B,C,D] darkness to (answer|None, flags[]).

    Decided relative to the row's own bubbles so block/column shading (which
    raises every bubble's darkness together) doesn't manufacture false marks or
    swallow real ones. Order of tests matters:

      1. Two bubbles unmistakably filled  -> genuine double mark (review).
      2. One bubble dark enough AND clearly ahead of the runner-up -> that mark.
         This is what rescues a solid fill sitting in a shaded block: the fill
         still leads its shaded neighbours by a wide margin.
      3. Two bubbles both over the fill line but close together -> ambiguous
         double (review).
      4. Something darkened but no confident winner -> faint/partial (review).
      5. Nothing darkened -> blank.
    """
    order = sorted(range(len(darkness)), key=lambda i: darkness[i], reverse=True)
    top, runner = order[0], order[1]
    d_top, d_runner = darkness[top], darkness[runner]

    if d_top >= FILL_MIN and d_runner >= STRONG_FILL:
        return None, ["MULTIPLE_MARKS"]
    if d_top >= MARK_MIN and (d_top - d_runner) >= MARK_MARGIN:
        return OPTIONS[top], []
    if d_top >= FILL_MIN and d_runner >= FILL_MIN:
        return None, ["MULTIPLE_MARKS"]
    if d_top >= AMBIG_MIN:
        return None, ["LIGHT_MARK"]
    return None, []


def read_sheet(path, page=0, dpi=200, read_name=False):
    """Read a scanned answer sheet.

    Returns ``{"answers": {"1": "A", ...}, "flags": [...], "name": str|None}``
    where ``answers`` holds only the questions with a single clean mark and
    ``flags`` is the set of filling-rule issues found on the sheet. When
    ``read_name`` is set, the handwritten name strip is OCR'd (best-effort;
    ``None`` if unavailable). Raises :class:`OMRError` if the page doesn't look
    like the expected 5-block template."""
    gray = _render_gray(path, page=page, dpi=dpi)
    blocks = _find_answer_blocks(gray)
    if len(blocks) < 1:
        raise OMRError("no answer blocks detected — unexpected sheet layout")

    answers = {}
    flags = set()
    for bi, box in enumerate(blocks):
        grid = _read_block(gray, box)
        if grid is None:
            raise OMRError(f"could not resolve the bubble grid in block {bi + 1}")
        for ri, darkness in enumerate(grid):
            qno = bi * 20 + ri + 1
            answer, qflags = _classify(darkness)
            if answer is not None:
                answers[str(qno)] = answer
            flags.update(qflags)

    name = None
    if read_name:
        import name_ocr  # lazy: avoids importing Vision unless enabled

        name = name_ocr.read_name_from_gray(gray)
    return {"answers": answers, "flags": sorted(flags), "name": name}

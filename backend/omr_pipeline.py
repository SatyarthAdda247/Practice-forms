"""Real OMR reading pipeline (OpenCV) for the Adda247 answer sheets.

Replaces the filename-hash stub in :mod:`grading` with actual optical-mark
recognition of the scanned sheet. Two printed forms are supported, both
offering options A/B/C/D per question (see :data:`SHEET_TEMPLATES`):

  * 100 questions in 5 vertical blocks of 20, each a large bordered box in the
    lower ~45% of the page.
  * 200 questions in 6 columns, printed as small boxes of 5 questions each.

They need different readers, because the 200-question form has no tall block
border to find — its columns are recovered from the bubbles themselves.

100-question form (:func:`_find_answer_blocks`, :func:`_read_block`):

  1. Render the page to a grayscale raster (PDF via PyMuPDF, or a plain image).
  2. Otsu-threshold the lower region and find the 5 block rectangles by size.
  3. Inside each block, find bubble contours, then cluster their centres into
     exactly 4 columns × 20 rows (k-means on x and y). Because we cluster the
     *actual* detected bubbles per block, per-block skew is absorbed.
  4. Sample a disk at each bubble centre and measure its darkness (fraction of
     dark pixels). Per question, the darkest option above a fill threshold is
     the marked answer; two dark options → a MULTIPLE_MARKS review flag.

Other forms (:func:`_detect_grid`, :func:`_read_generic`) instead:

  1. Straighten the page (:func:`_deskew`) — this reader locates columns from
     an x-histogram spanning the full page width, which even a couple of
     degrees of tilt smears beyond recognition.
  2. Group the histogram peaks into question columns and cluster the rows,
     validating both counts against the declared template.
  3. Sample each bubble as above, snapping onto the detected bubble centres,
     then level out per-column shading before classifying.

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

# Where inside a bubble we measure, as a fraction of its radius. Small enough
# to stay clear of the printed outline, large enough to see a partial fill.
SAMPLE_RADIUS = 0.7
# How far the sampler may move off the nominal row/column intersection to land
# on a bubble that was actually detected, as a fraction of the pitch. Must stay
# under 0.5 or the search reaches into the neighbouring option or row.
SNAP_TOLERANCE = 0.40

# Rows of context used to estimate what an *empty* bubble measures at this point
# down an option column (see :func:`_level_shading`), and the percentile of that
# window taken as the empty level. The percentile is deliberately well below the
# median: a student who answers the same option many questions running would
# otherwise raise their own baseline and erase their marks. At the 25th
# percentile over 11 rows, three quarters of the window would have to carry the
# same filled option before the estimate begins to drift.
SHADE_WINDOW = 11
SHADE_PERCENTILE = 25


# --- NAME block (the A-Z bubble matrix under the handwriting boxes) --------- #
# The matrix is one column per character position, 26 rows (A-Z). Students who
# fill it give us the name with no OCR at all, so this is tried before any
# handwriting recognition. Region is generous — the grid is located by finding
# the bubbles themselves, not by these bounds.
# Generous enough to contain the NAME block on both form variants: the
# 200-question sheet's matrix starts at y~0.13 and runs to x~0.45, where the
# 100-question one starts at y~0.18 and ends by x~0.40. A region tuned to the
# latter clipped rows A-C off the former, so no 26-row run could be found and
# every 200-question sheet silently returned no name. Overshooting is safe —
# the grid itself is located by finding its bubbles inside this window.
NAME_REGION = (0.02, 0.10, 0.50, 0.52)  # x0, y0, x1, y1 as page fractions
NAME_ROWS = 26                          # A-Z
NAME_MIN_BUBBLES = 100                  # fewer ⇒ we haven't found the matrix
NAME_FILL_MIN = 0.55                    # a filled letter bubble measures >= this
NAME_MARGIN = 0.18                      # ...and must lead the runner-up by this
# Below this a column is genuinely blank. Note these bubbles are darker when
# empty than the answer-grid ones (each has a printed letter inside it):
# measured 0.15-0.34 empty vs 0.67-1.00 filled, so 0.45 sits in the gap.
NAME_EMPTY_MAX = 0.45                   # in between fill/empty ⇒ reject sheet


# --- Sheet templates -------------------------------------------------------- #
# How many question slots are *printed* on the form, and how they are laid out.
# This is NOT the exam's question count: a 50-question exam is routinely sat on
# a 200-question form, and reading the sheet needs the printed geometry. Each
# entry maps the printed total to the rows in each answer column, left to right.
#
# Question numbering runs column-major (column 1 top-to-bottom first), which is
# how every variant of this form is printed.
SHEET_TEMPLATES = {
    100: [20, 20, 20, 20, 20],              # 5 columns of 20   (verified)
    200: [35, 35, 35, 35, 35, 25],          # 6 columns, short last column
}
DEFAULT_SHEET_QUESTIONS = 200


# --- Skew correction -------------------------------------------------------- #
# A sheet photographed on a desk arrives rotated *and* keystoned, and the two
# are not the same defect: the rows tilt by one angle and the option columns by
# another. Both break grid detection well before the tilt is visible to the eye.
# On a 739x1600 phone photo skewed by ~3 degrees, the option columns smeared
# into each other (question column 1 measured 20px wide against its true 59px)
# and the row clusters lost a third of their bubbles to the occupancy filter —
# the read failed with "answer column has 22 question rows, expected 35".
#
# Correcting it as a *shear per axis* rather than a rotation is what handles the
# keystone: we search for the coefficient that makes each axis' bubble
# projection sharpest — the true grid is the one alignment where every bubble
# in a row (or column) lands on the same line — and undo both in one affine
# warp. Estimating from the thousands of grid bubbles rather than the four
# corner registration marks matters in practice: phone photos routinely clip a
# corner off the frame, as the sheet that prompted this did.
DESKEW_REGION_TOP = 0.40    # deskew off the answer grid, the largest clean grid
DESKEW_MIN_BUBBLES = 200    # fewer ⇒ we haven't found the grid; leave the page
DESKEW_MAX_SHEAR = 0.15     # search range, ~8.5 degrees each way
DESKEW_MIN_SHEAR = 0.005    # below this the page is straight; skip the resample


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


def _render_bgr(path, page=0, dpi=200):
    """Colour version of :func:`_render_gray`.

    Only used for handwritten-name OCR, which locates the pen strokes by their
    blue channel — that information is gone by the time the page is greyscale.
    Returns ``None`` if the page can't be rendered in colour."""
    try:
        if path.lower().endswith(".pdf"):
            import fitz

            doc = fitz.open(path)
            if page >= doc.page_count:
                return None
            pix = doc[page].get_pixmap(dpi=dpi)
            buf = np.frombuffer(pix.samples, dtype=np.uint8)
            img = buf.reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                return cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            if pix.n == 3:
                return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
            return cv2.cvtColor(img.reshape(pix.height, pix.width),
                                cv2.COLOR_GRAY2BGR)
        return cv2.imread(path, cv2.IMREAD_COLOR)
    except Exception:
        return None


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


def _kmeans_1d(values, k, iters=50):
    """Deterministic 1-D k-means; returns (labels, centres).

    Must be deterministic: this assigns each bubble to a row and column, so an
    unstable clustering silently regrades the same sheet differently on every
    read. ``cv2.kmeans`` with ``KMEANS_PP_CENTERS`` seeds from a global RNG and
    did exactly that — re-reading one real sheet moved 27 of its 51 answers
    (Q4 alternating between A and D) and swung the answer count from 46 to 49.

    Seeding the RNG would only freeze one arbitrary outcome. Instead we
    initialise from the layout itself: the rows of a block, and the four
    options across it, are evenly spaced, so ``linspace`` over the observed
    range starts Lloyd's iteration next to the true centres and converges to
    the same answer every time."""
    vals = np.asarray(values, dtype=np.float64)
    lo, hi = float(vals.min()), float(vals.max())
    centres = np.linspace(lo, hi, k) if hi > lo else np.full(k, lo)
    for _ in range(iters):
        labels = np.abs(vals[:, None] - centres[None, :]).argmin(axis=1)
        moved = centres.copy()
        for j in range(k):
            member = labels == j
            if member.any():
                moved[j] = vals[member].mean()
        if np.allclose(moved, centres, atol=1e-3):
            centres = moved
            break
        centres = moved
    labels = np.abs(vals[:, None] - centres[None, :]).argmin(axis=1)
    return labels, centres


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


def _cluster_1d(values, tol):
    """Group sorted 1-D coordinates into clusters split on gaps > ``tol``.
    Returns ``[(centre, count), ...]``."""
    v = np.sort(values)
    groups = [[v[0]]]
    for x in v[1:]:
        if x - groups[-1][-1] <= tol:
            groups[-1].append(x)
        else:
            groups.append([x])
    return [(float(np.mean(g)), len(g)) for g in groups]


def _comb_axis(v, rad, lo=1.6, hi=4.0):
    """Recover an evenly-spaced axis (pitch + centres) from 1-D positions.

    Used for the letter columns. Plain clustering fails there: on a slightly
    skewed scan a column's x drifts enough down the page that neighbouring
    columns smear into one blob (three columns merged into a single 158-point
    cluster on a real sheet), which silently drops characters. Fitting a comb
    instead recovers the true pitch even when the clusters have merged, because
    the periodicity survives the smearing."""
    v = np.asarray(v, dtype=float)
    best = None
    for pitch in np.arange(rad * lo, rad * hi, 0.05):
        ang = 2 * np.pi * ((v - v.min()) % pitch) / pitch
        strength = float(np.hypot(np.cos(ang).mean(), np.sin(ang).mean()))
        if best is None or strength > best[1]:
            best = (float(pitch), strength)
    pitch, _ = best
    ang = 2 * np.pi * ((v - v.min()) % pitch) / pitch
    offset = (np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) / (2 * np.pi)) * pitch
    start = v.min() + offset
    while start - pitch >= v.min() - rad:
        start -= pitch
    centres, x = [], start
    while x <= v.max() + rad:
        centres.append(x)
        x += pitch
    return pitch, centres


def _evenly_spaced_run(clusters, min_count=5, tol=0.15):
    """Longest run of consecutive clusters separated by a consistent pitch.

    ``clusters`` is ``[(centre, count), ...]``. Returns ``(centres, pitch)`` for
    the longest run, or ``(None, None)``.

    This is the anchor for the letter grid, and picking it correctly is the
    whole ballgame. Selecting the *densest* rows instead does not work: on a
    scan where the upper rows are only partly detected, the densest-26 both drop
    real rows and reach past the block to pull in unrelated contours below, so
    every letter lands on the wrong row. A contiguous, evenly-spaced run is
    self-validating — the matrix is the only thing on the page with that
    signature — and its first element is unambiguously row A."""
    strong = [(c, n) for c, n in clusters if n >= min_count]
    if len(strong) < 2:
        return None, None
    centres = [c for c, _ in sorted(strong)]
    gaps = np.diff(centres)
    pitch = float(np.median(gaps))
    if pitch <= 0:
        return None, None

    best, run = [], [centres[0]]
    for prev_gap, c in zip(gaps, centres[1:]):
        if abs(prev_gap - pitch) <= tol * pitch:
            run.append(c)
        else:
            if len(run) > len(best):
                best = run
            run = [c]
    if len(run) > len(best):
        best = run
    return (best, pitch) if len(best) >= 2 else (None, None)


def _name_rows(ys, rad, ncols):
    """The 26 A-Z row centres, or ``None``.

    Rows are found by comb fit rather than by an evenly-spaced run: the run test
    needs near-perfect spacing and fell apart on a lower-resolution phone photo
    (5 rows found instead of 26), whereas the comb tolerates the jitter.

    The comb returns a few extra rows beyond the matrix — the handwriting boxes
    above it and the first answer rows below. Those sit at the ends and are
    sparsely populated (13-23 bubbles against the grid's 34-47), so trim from
    whichever end is weaker until exactly 26 remain."""
    pitch, candidates = _comb_axis(ys, rad)
    counts = [(c, int((np.abs(ys - c) < pitch * 0.4).sum())) for c in candidates]
    kept = [(c, n) for c, n in counts if n >= max(3, ncols // 3)]
    if len(kept) < NAME_ROWS:
        return None
    stretches = [[kept[0]]]
    for c, n in kept[1:]:
        if c - stretches[-1][-1][0] <= pitch * 1.5:
            stretches[-1].append((c, n))
        else:
            stretches.append([(c, n)])
    band = max(stretches, key=len)
    if len(band) < NAME_ROWS:
        return None
    while len(band) > NAME_ROWS:
        band.pop(0 if band[0][1] <= band[-1][1] else -1)
    return [c for c, _ in band]


def read_name_grid(gray):
    """Decode the student name from the NAME block's A-Z bubble matrix.

    Returns an uppercase name (spaces preserved between words) or ``None`` when
    the grid can't be found or nothing is filled in.

    Rows are located as a contiguous evenly-spaced run and must come to exactly
    26 (A-Z). That exactness is the safety check: a partial or mis-anchored grid
    yields a confidently wrong name, which is far worse than no name at all, so
    anything that doesn't look like a clean 26-row matrix returns ``None``."""
    H, W = gray.shape
    fx0, fy0, fx1, fy1 = NAME_REGION
    x0, x1 = int(W * fx0), int(W * fx1)
    y0, y1 = int(H * fy0), int(H * fy1)
    sub = gray[y0:y1, x0:x1]
    if sub.size == 0:
        return None

    # Adaptive, not Otsu: these scans carry an uneven grey wash, and a single
    # global cut-off loses whole rows of bubbles in the shaded areas (one real
    # sheet went from 853 to 1003 detected bubbles by switching).
    th = cv2.adaptiveThreshold(
        sub, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 7
    )
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    sw = sub.shape[1]
    xs, ys, rs = [], [], []
    for c in cnts:
        (cx, cy), r = cv2.minEnclosingCircle(c)
        if r < sw * 0.008 or r > sw * 0.03:      # bubble-sized only
            continue
        if cv2.contourArea(c) < 0.4 * np.pi * r * r:  # roughly round / solid
            continue
        xs.append(cx)
        ys.append(cy)
        rs.append(r)
    if len(xs) < NAME_MIN_BUBBLES:
        return None

    rad = float(np.median(rs))
    x_arr, y_arr = np.array(xs), np.array(ys)

    # Columns before rows. The search region has to be generous enough to cover
    # both form variants (the 200-question NAME block is wider and starts higher
    # than the 100-question one), which means it also catches the edge of the
    # SET NO / ROLL NO grids. Those are 0-9, so their columns hold ~10 bubbles
    # against the name matrix's 26 — filtering columns by occupancy drops them,
    # and finding the rows only from surviving columns keeps their differently
    # pitched rows from corrupting the A-Z run.
    pitch, candidates = _comb_axis(x_arr, rad)
    name_cols = [c for c in candidates
                 if int((np.abs(x_arr - c) < pitch * 0.4).sum()) >= NAME_ROWS // 2]
    if len(name_cols) < 2:
        return None
    in_grid = np.zeros(len(x_arr), dtype=bool)
    for c in name_cols:
        in_grid |= np.abs(x_arr - c) < pitch * 0.4

    rows = _name_rows(y_arr[in_grid], rad, len(name_cols))
    if rows is None:
        return None  # not a clean A-Z matrix — refuse rather than guess

    # Keep only the comb positions holding a full stack of bubbles, then take
    # the longest unbroken stretch — that discards teeth outside the matrix.
    occupied = [c for c in candidates
                if int((np.abs(x_arr - c) < pitch * 0.4).sum()) >= NAME_ROWS // 2]
    if len(occupied) < 2:
        return None
    stretches = [[occupied[0]]]
    for c in occupied[1:]:
        if c - stretches[-1][-1] <= pitch * 1.5:
            stretches[-1].append(c)
        else:
            stretches.append([c])
    cols = max(stretches, key=len)
    if len(cols) < 2:
        return None

    rr = max(1, int(rad * 0.6))
    out = []
    unreadable = []   # column indices holding ink we can't resolve to a letter
    for ci, cx in enumerate(cols):
        darkness = []
        for cy in rows:
            xi, yi = int(cx), int(cy)
            patch = sub[max(0, yi - rr):yi + rr, max(0, xi - rr):xi + rr]
            darkness.append(float((patch < 128).mean()) if patch.size else 0.0)
        d = np.array(darkness)
        best = int(d.argmax())
        runner = float(np.partition(d, -2)[-2])
        if d[best] >= NAME_FILL_MIN and (d[best] - runner) >= NAME_MARGIN:
            out.append(chr(ord("A") + best))
        elif d[best] < NAME_EMPTY_MAX:
            out.append(" ")   # nothing in this column ⇒ word gap or unused
        else:
            out.append(" ")
            unreadable.append(ci)

    # A column holding ink we can't resolve to a letter is only fatal if it
    # falls *inside* the name: there it would drop or mistake a character while
    # the rest still reads plausibly (a sheet spelling ANUPRIYA MANDAL came out
    # as "ANUPR A MA DAL"), and a convincing wrong name is worse than none.
    #
    # Past the end of the name it means nothing — the unused columns of a form
    # commonly carry scan shading, and one real sheet had three of them sitting
    # in the ambiguous band. Rejecting on those threw away perfectly good short
    # names, so only ambiguity up to the last filled column counts.
    filled = [i for i, ch in enumerate(out) if ch != " "]
    if not filled:
        return None
    if any(i < filled[-1] for i in unreadable):
        return None

    name = " ".join("".join(out[:filled[-1] + 1]).split())
    return name or None


def _answer_bubbles(gray, top):
    """Bubble centres below ``top``, as (x, y, r)."""
    sub = gray[top:, :]
    th = cv2.adaptiveThreshold(
        sub, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 7
    )
    cnts, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    W = gray.shape[1]
    out = []
    for c in cnts:
        (cx, cy), r = cv2.minEnclosingCircle(c)
        if r < W * 0.004 or r > W * 0.02:
            continue
        if cv2.contourArea(c) < 0.4 * np.pi * r * r:
            continue
        out.append((cx, cy + top, r))
    return out


def _projection_sharpness(vals, k):
    """How crisply ``vals`` collapse onto a set of lines.

    Sum of squares of the (smoothed) 1-pixel histogram: piling the same points
    into fewer bins raises it, so it peaks exactly when the projection axis is
    parallel to the grid and every bubble in a line shares one coordinate."""
    hist = np.bincount((vals - vals.min()).astype(np.int64)).astype(np.float64)
    if k > 1:
        hist = np.convolve(hist, np.ones(k) / k, mode="same")
    return float((hist ** 2).sum())


def _best_shear(vals, along, k):
    """Shear coefficient ``s`` maximising the sharpness of ``vals + s * along``.

    Coarse pass then a fine one around the winner — a single fine sweep over the
    full range costs 15x more for the same answer."""
    centred = along - along.mean()
    coarse, fine = 0.01, 0.001
    best = 0.0
    # The fine window spans slightly more than one coarse step, so the true
    # optimum is inside it wherever the coarse pass landed.
    for step, span in ((coarse, DESKEW_MAX_SHEAR), (fine, coarse * 1.2)):
        lo, hi = best - span, best + span
        candidates = np.arange(lo, hi + step / 2, step)
        best = float(max(candidates,
                         key=lambda s: _projection_sharpness(vals + s * centred, k)))
    return best


def _deskew(gray):
    """Straighten a photographed sheet so its rows and columns run true.

    Returns ``gray`` unchanged when the grid can't be found or the page is
    already square, so scans and PDF renders skip the resample entirely.

    The output keeps the input's dimensions: every region in this module is
    expressed as a page fraction, and growing the canvas to fit the warped
    corners would silently shift all of them. The warp is anchored on the
    bubble centroid, which leaves the answer grid — the part that has to land
    accurately — essentially in place, and moves only the margins."""
    H, W = gray.shape
    bubbles = _answer_bubbles(gray, int(H * DESKEW_REGION_TOP))
    if len(bubbles) < DESKEW_MIN_BUBBLES:
        return gray
    xs = np.array([b[0] for b in bubbles])
    ys = np.array([b[1] for b in bubbles])
    k = max(1, int(float(np.median([b[2] for b in bubbles])) * 0.6))

    col_tilt = _best_shear(xs, ys, k)   # option columns leaning: x += a * y
    row_tilt = _best_shear(ys, xs, k)   # question rows leaning:  y += b * x
    if abs(col_tilt) < DESKEW_MIN_SHEAR and abs(row_tilt) < DESKEW_MIN_SHEAR:
        return gray

    cx, cy = float(xs.mean()), float(ys.mean())
    M = np.array([[1.0, col_tilt, -col_tilt * cy],
                  [row_tilt, 1.0, -row_tilt * cx]])
    # Fill the exposed margin with white, not by replicating the edge: the sheet
    # often runs to the frame edge, and replicating smeared its dark border into
    # long streaks that the bubble finder read as an extra option column,
    # collapsing the six question columns into five.
    return cv2.warpAffine(gray, M, (W, H), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=255)


def _x_peaks(vals, rad, span):
    """Peak positions (with strength) in a 1-D histogram of ``vals``."""
    hist = np.zeros(int(span) + 2)
    for v in vals:
        hist[int(v)] += 1
    k = max(1, int(rad * 0.6))
    sm = np.convolve(hist, np.ones(k) / k, mode="same")
    thr = max(3.0, sm.max() * 0.15)
    minsep = max(2, int(rad * 1.2))
    found, i = [], 0
    while i < len(sm):
        if sm[i] >= thr:
            j = i
            while j < len(sm) and sm[j] >= thr:
                j += 1
            width = j - i
            # a wide plateau is several columns run together; split by spacing
            for t in range(max(1, int(round(width / (rad * 2.0))))):
                a = i + int(width * t / max(1, int(round(width / (rad * 2.0)))))
                b = i + int(width * (t + 1) / max(1, int(round(width / (rad * 2.0)))))
                if b > a:
                    found.append((a + int(np.argmax(sm[a:b])), float(sm[a:b].max())))
            i = j
        else:
            i += 1
    peaks = []
    for pos, strength in found:
        if peaks and pos - peaks[-1][0] < minsep:
            if strength > peaks[-1][1]:
                peaks[-1] = (pos, strength)
            continue
        peaks.append((pos, strength))
    return peaks


def _level_shading(darkness):
    """Restate each bubble's darkness against its own option's local background.

    ``darkness`` is one question column's raw readings, shaped (rows, options).

    :func:`_classify` already compares a question against its own four bubbles,
    which copes with a block of the form printing as a grey wash. What defeats
    it is shading that differs *between* the option columns: on one real scan
    the B column ran 0.2-0.3 darker than A, C and D all the way down a shaded
    block, which was enough to make every empty B look like a second mark
    (suppressing eight genuine answers as MULTIPLE_MARKS) and to make two
    untouched questions report a B.

    So we measure the background per option column rather than per question. A
    window of neighbouring rows tracks shading that changes down the page,
    while a low percentile of that window reads the empty level even where
    several rows in it are filled. Rescaling — rather than subtracting — keeps
    a saturated bubble at 1.0, so the thresholds above keep their meaning."""
    out = np.empty_like(darkness)
    half = SHADE_WINDOW // 2
    for i in range(len(darkness)):
        window = darkness[max(0, i - half):i + half + 1]
        base = np.percentile(window, SHADE_PERCENTILE, axis=0)
        out[i] = np.clip((darkness[i] - base) / np.maximum(0.15, 1.0 - base),
                         0.0, 1.0)
    return out


def _bubble_darkness(gray, cx, cy, rad):
    """Fraction of dark pixels inside the bubble at ``(cx, cy)``.

    Samples a disk rather than the enclosing square. The corners of a square
    patch fall on the bubble's printed outline, so on a low-resolution phone
    photo — where the whole bubble is nine pixels across — they contributed
    enough ink to push empty bubbles over the mark threshold and invent
    answers on untouched questions."""
    r = max(2, int(round(rad * SAMPLE_RADIUS)))
    xi, yi = int(round(cx)), int(round(cy))
    patch = gray[yi - r:yi + r + 1, xi - r:xi + r + 1]
    size = 2 * r + 1
    if patch.shape != (size, size):   # bubble runs off the page edge
        return 0.0
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    return float((patch[xx * xx + yy * yy <= r * r] < 128).mean())


def _snap_to_bubble(centres, cx, cy, tol_x, tol_y):
    """Nearest detected bubble centre to ``(cx, cy)``, or the point itself.

    The row/column intersection is only ever an average over a whole column,
    so it drifts by a few pixels against any individual bubble — enough, at
    phone-photo resolution, to sample beside a filled bubble instead of inside
    it. The detected centre is exact, so prefer it whenever one sits in this
    cell. Tolerances are per axis and stay inside half a pitch, which is what
    keeps the search from reaching into the neighbouring option or row —
    rows on this form are barely half as far apart as options."""
    dx = (centres[:, 0] - cx) / tol_x
    dy = (centres[:, 1] - cy) / tol_y
    d2 = dx * dx + dy * dy
    i = int(d2.argmin())
    return centres[i] if d2[i] <= 1.0 else (cx, cy)


def _detect_grid(gray, layout, opts=4):
    """Locate the answer grid described by ``layout`` (rows per column).

    Infers the geometry from the bubbles rather than from printed borders: on
    the 200-question form every group of 5 questions is its own small box, so
    border-based block finding sees a handful of fragments instead of columns.
    Options within a question sit close together and question columns are
    separated by a wider gap, so grouping the x-histogram peaks recovers the
    columns on any variant of the form.

    ``layout`` is also the validator — we scan candidate region tops and keep
    the one whose detected column and row counts match it best, which is what
    stops a header grid or the footer QR code being read as answer rows."""
    H, W = gray.shape
    best = None
    for tf in np.arange(0.36, 0.62, 0.01):
        top = int(H * tf)
        bubbles = _answer_bubbles(gray, top)
        if len(bubbles) < 50:
            continue
        rad = float(np.median([b[2] for b in bubbles]))
        xs = np.array([b[0] for b in bubbles])
        ys = np.array([b[1] for b in bubbles])
        peaks = _x_peaks(xs, rad, W)
        if len(peaks) < opts:
            continue
        pos = [q[0] for q in peaks]
        gaps = np.diff(pos)
        if not len(gaps):
            continue
        tight = [g for g in gaps if g <= np.median(gaps) * 1.4]
        option_pitch = float(np.median(tight)) if tight else float(np.median(gaps))
        groups = [[peaks[0]]]
        for gap, q in zip(gaps, peaks[1:]):
            groups.append([q]) if gap > option_pitch * 1.6 else groups[-1].append(q)
        cols = []
        for grp in groups:
            if len(grp) < opts:
                continue
            # keep the strongest `opts` peaks — noise can add a spurious one
            cols.append([q[0] for q in sorted(sorted(grp, key=lambda t: -t[1])[:opts])])
        if len(cols) != len(layout):
            continue
        rowsets = []
        for oxs in cols:
            lo, hi = min(oxs) - rad * 1.5, max(oxs) + rad * 1.5
            m = (xs >= lo) & (xs <= hi)
            rowsets.append([c for c, n in _cluster_1d(ys[m], rad * 1.2) if n >= 3])
        err = sum(abs(len(rs) - want) for rs, want in zip(rowsets, layout))
        if best is None or err < best[0]:
            best = (err, rad, cols, rowsets, bubbles)
        if err == 0:
            break
    if best is None:
        return None
    _, rad, cols, rowsets, bubbles = best
    return rad, cols, rowsets, bubbles


def _read_generic(gray, layout, opts=4):
    """Read answers for a layout the border-based block reader can't handle."""
    found = _detect_grid(gray, layout, opts)
    if found is None:
        raise OMRError(
            "could not locate the answer grid — wrong layout selected, or the "
            "scan is cropped/unreadable"
        )
    rad, cols, rowsets, bubbles = found
    centres = np.array([[b[0], b[1]] for b in bubbles], dtype=np.float64)
    answers, flags, qbase = {}, set(), 0
    for oxs, rows, want in zip(cols, rowsets, layout):
        # Extra clusters sit below the grid (the footer QR block reads as
        # bubbles); the answer rows are the topmost `want`.
        rows = sorted(rows)[:want]
        if len(rows) != want:
            raise OMRError(
                f"answer column has {len(rows)} question rows, expected {want} "
                "— the scan is cropped, skewed or unreadable"
            )
        # Snap tolerances from this column's own pitches. Rows are grouped in
        # fives with a gap between groups, so take the *tight* gaps as the row
        # pitch — the median would be inflated by the group breaks.
        opt_pitch = float(np.median(np.diff(sorted(oxs))))
        gaps = np.diff(rows)
        tight = [g for g in gaps if g <= np.median(gaps) * 1.4]
        row_pitch = float(np.median(tight)) if tight else float(np.median(gaps))
        tol_x = max(1.0, opt_pitch * SNAP_TOLERANCE)
        tol_y = max(1.0, row_pitch * SNAP_TOLERANCE)
        raw = np.array([
            [_bubble_darkness(gray, *_snap_to_bubble(centres, cx, cy,
                                                     tol_x, tol_y), rad)
             for cx in oxs]
            for cy in rows
        ])
        for ri, darkness in enumerate(_level_shading(raw)):
            answer, qflags = _classify(list(darkness))
            if answer is not None:
                answers[str(qbase + ri + 1)] = answer
            flags.update(qflags)
        qbase += want
    return answers, flags


def _ocr_name(path, page, dpi):
    """Fallback name read for sheets whose A-Z bubble grid is blank.

    Re-renders the page in colour because the reader finds the handwriting by
    its blue ink. Best-effort: ``None`` on anything unexpected."""
    try:
        import name_trocr  # lazy: avoids importing torch unless actually needed

        if not name_trocr.ENABLED:
            return None
        return name_trocr.read_name_from_bgr(_render_bgr(path, page=page, dpi=dpi))
    except Exception:
        return None


def read_sheet(path, page=0, dpi=200, read_name=False,
               sheet_questions=DEFAULT_SHEET_QUESTIONS):
    """Read a scanned answer sheet.

    Returns ``{"answers": {"1": "A", ...}, "flags": [...], "name": str|None}``
    where ``answers`` holds only the questions with a single clean mark and
    ``flags`` is the set of filling-rule issues found on the sheet.

    The name is always read from the NAME block's A-Z bubble matrix when the
    student filled it — that is exact and costs nothing. Only if the grid is
    blank (or absent) and ``read_name`` is set do we fall back to OCR of the
    handwriting strip, which is best-effort and may return ``None``.

    ``sheet_questions`` is how many question slots are *printed* on the form
    (see :data:`SHEET_TEMPLATES`) — not how many the exam grades.

    Raises :class:`OMRError` if the page doesn't match the declared template."""
    layout = SHEET_TEMPLATES.get(int(sheet_questions or DEFAULT_SHEET_QUESTIONS))
    if layout is None:
        raise OMRError(
            f"unknown sheet layout for {sheet_questions} questions "
            f"(known: {sorted(SHEET_TEMPLATES)})"
        )

    gray = _render_gray(path, page=page, dpi=dpi)

    # The 100-question form has one tall bordered box per column, which the
    # border-based reader handles and is calibrated against. Other layouts (the
    # 200-question form prints each group of 5 in its own small box) defeat
    # border detection, so infer the grid from the bubbles instead.
    if layout != SHEET_TEMPLATES[100]:
        # Deskew only this path, and only for the answers. The border-based
        # reader below clusters bubbles *inside* each block it has located, so
        # it already absorbs skew and a global warp only costs it accuracy
        # (it started dropping clearly-filled bubbles on the sample scans).
        # The name grid is likewise read from the untouched page: the warp is
        # fitted to the answer grid at the bottom, and on a keystoned photo
        # extrapolating it up to the header is a guess — one that turned a
        # correctly-read name into a confidently wrong one shifted by a row.
        answers, flags = _read_generic(_deskew(gray), layout)
        name = read_name_grid(gray)
        if name is None and read_name:
            name = _ocr_name(path, page, dpi)
        return {"answers": answers, "flags": sorted(flags), "name": name}

    blocks = _find_answer_blocks(gray)
    if len(blocks) < 1:
        raise OMRError("no answer blocks detected — unexpected sheet layout")
    # Fail loudly on a template mismatch. Without this the reader quietly forces
    # whatever it found into the wrong geometry and returns a handful of
    # plausible answers — a 200-question sheet read as 100 returned 10 of its
    # 24 marks, with three of them numbered wrongly.
    if len(blocks) != len(layout):
        raise OMRError(
            f"sheet declares {sheet_questions} questions "
            f"({len(layout)} answer columns) but {len(blocks)} were detected — "
            "wrong layout selected, or the scan is cropped/unreadable"
        )

    answers = {}
    flags = set()
    qbase = 0
    for bi, (box, rows) in enumerate(zip(blocks, layout)):
        grid = _read_block(gray, box, rows=rows)
        if grid is None:
            raise OMRError(f"could not resolve the bubble grid in block {bi + 1}")
        for ri, darkness in enumerate(grid):
            qno = qbase + ri + 1
            answer, qflags = _classify(darkness)
            if answer is not None:
                answers[str(qno)] = answer
            flags.update(qflags)
        qbase += rows

    # Bubbled name first: exact, free, and needs no external service.
    name = read_name_grid(gray)
    if name is None and read_name:
        name = _ocr_name(path, page, dpi)
    return {"answers": answers, "flags": sorted(flags), "name": name}

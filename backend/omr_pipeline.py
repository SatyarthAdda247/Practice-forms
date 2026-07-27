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


# --- NAME block (the A-Z bubble matrix under the handwriting boxes) --------- #
# The matrix is one column per character position, 26 rows (A-Z). Students who
# fill it give us the name with no OCR at all, so this is tried before any
# handwriting recognition. Region is generous — the grid is located by finding
# the bubbles themselves, not by these bounds.
NAME_REGION = (0.05, 0.18, 0.42, 0.55)  # x0, y0, x1, y1 as page fractions
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
    rows, _ = _evenly_spaced_run(_cluster_1d(np.array(ys), rad * 1.2))
    if rows is None or len(rows) != NAME_ROWS:
        return None  # not a clean A-Z matrix — refuse rather than guess

    # Columns come from a comb fit, then keep only positions that actually hold
    # a stack of bubbles and take the longest unbroken stretch of them — that
    # discards the comb teeth that fall outside the matrix.
    pitch, candidates = _comb_axis(np.array(xs), rad)
    x_arr = np.array(xs)
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
    for cx in cols:
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
            # Ink present but no confident letter. Reading on would drop or
            # mistake this character while the rest still looks like a name
            # (a sheet reading ANUPRIYA MANDAL decodes as "ANUPR A MA DAL"),
            # and a plausible wrong name is worse than none. Refuse the sheet.
            return None

    name = " ".join("".join(out).split())
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
            best = (err, rad, cols, rowsets)
        if err == 0:
            break
    if best is None:
        return None
    _, rad, cols, rowsets = best
    return rad, cols, rowsets


def _read_generic(gray, layout, opts=4):
    """Read answers for a layout the border-based block reader can't handle."""
    found = _detect_grid(gray, layout, opts)
    if found is None:
        raise OMRError(
            "could not locate the answer grid — wrong layout selected, or the "
            "scan is cropped/unreadable"
        )
    rad, cols, rowsets = found
    rr = max(1, int(rad * 0.6))
    answers, flags, qbase = {}, set(), 0
    for oxs, rows, want in zip(cols, rowsets, layout):
        # Extra clusters sit below the grid (the footer QR block reads as
        # bubbles); the answer rows are the topmost `want`.
        rows = sorted(rows)[:want]
        if len(rows) != want:
            raise OMRError(
                f"answer column has {len(rows)} question rows, expected {want}"
            )
        for ri, cy in enumerate(rows):
            darkness = []
            for cx in oxs:
                xi, yi = int(cx), int(cy)
                patch = gray[max(0, yi - rr):yi + rr, max(0, xi - rr):xi + rr]
                darkness.append(float((patch < 128).mean()) if patch.size else 0.0)
            answer, qflags = _classify(darkness)
            if answer is not None:
                answers[str(qbase + ri + 1)] = answer
            flags.update(qflags)
        qbase += want
    return answers, flags


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
        answers, flags = _read_generic(gray, layout)
        name = read_name_grid(gray)
        if name is None and read_name:
            import name_ocr

            name = name_ocr.read_name_from_gray(gray)
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
        import name_ocr  # lazy: avoids importing Vision unless enabled

        name = name_ocr.read_name_from_gray(gray)
    return {"answers": answers, "flags": sorted(flags), "name": name}

"""Automated face detection for the public Image Resizer's "Face Visibility"
check.

Why this is server-side. The rest of the resizer runs entirely on <canvas> in
the browser, and the face row used to say "Check manually" because the only
in-browser detector is the Shape Detection API (`window.FaceDetector`), which
ships on approximately nothing: it is behind a flag on Chrome desktop and absent
from Firefox and Safari. So in practice every candidate got the manual fallback.
OpenCV is already a backend dependency for the OMR pipeline, so the check runs
here instead and the browser only falls back to manual if this is unreachable.

Why YuNet and not a Haar cascade. OpenCV 5.0 removed `cv2.CascadeClassifier`
and stopped shipping the `haarcascade_*.xml` data files, so the classic recipe
no longer exists. `cv2.FaceDetectorYN` (YuNet, a small CNN) replaces it: 232 KB
of ONNX committed under models/, CPU-only, and a few milliseconds per
passport-sized image.

What this returns and what it deliberately does not. Only the two things the
model actually establishes: how many faces there are, and where the bounding box
sits in the frame. Everything reported is derived from that box.

It does NOT report head tilt, "eyes visible", sunglasses, caps or headwear.
YuNet does return five landmarks (two eyes, nose, two mouth corners), which
looks like enough to measure the eye-line angle — but measured against known
rotations they do not hold up: a face rotated 20° reported an eye line of -7.5°,
and 10° reported -3.3°. The landmarks are positioned well enough to align a
crop, not to measure geometry, so a tilt warning built on them would fire on
straight photos and miss crooked ones. Occlusion is worse: landmark coordinates
come back whether or not the eye is actually visible, so any pass there would be
asserting something the model never checked.

The UI copy lives in frontend/src/tools/lib/imageOps.js; this module returns
facts only.

The image bytes are used for detection and dropped. Nothing here writes to
disk, to BigQuery, or to the log.
"""

import os
import threading

MODEL_PATH = os.environ.get(
    "OMR_FACE_MODEL",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models",
                 "face_detection_yunet_2023mar.onnx"),
)

# Confidence floor. 0.6 is YuNet's usual operating point: a properly lit,
# straight-on passport photo scores ~0.9, so this leaves a wide margin while
# still rejecting texture that merely looks face-shaped.
SCORE_THRESHOLD = 0.6
NMS_THRESHOLD = 0.3
TOP_K = 5000

# Detection is scale-invariant for every ratio reported below, so an oversized
# upload is shrunk rather than refused — it only costs inference time.
MAX_SIDE = 2000
# A passport crop is small; anything under this cannot hold a detectable face.
MIN_SIDE = 32


class Unavailable(RuntimeError):
    """The detector could not be loaded — missing model file or OpenCV build
    without FaceDetectorYN. The caller maps this to a 503 so the browser shows
    the manual fallback instead of a wrong answer."""


# FaceDetectorYN keeps its input size as instance state, so a single shared
# detector is not safe to use from two requests at once. gunicorn runs sync
# workers (one request per process) but the Flask dev server is threaded, so the
# lock is what makes both correct.
_lock = threading.Lock()
_detector = None


def _get_detector():
    global _detector
    if _detector is not None:
        return _detector
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover — opencv is a hard dependency
        raise Unavailable("face detection is not available on this server") from exc
    if not hasattr(cv2, "FaceDetectorYN"):
        raise Unavailable("face detection is not available on this server")
    if not os.path.exists(MODEL_PATH):
        raise Unavailable("the face detection model is not installed")
    try:
        _detector = cv2.FaceDetectorYN.create(
            MODEL_PATH, "", (320, 320), SCORE_THRESHOLD, NMS_THRESHOLD, TOP_K
        )
    except Exception as exc:  # noqa: BLE001 — a bad model file must not 500
        raise Unavailable("the face detection model could not be loaded") from exc
    return _detector


def _decode(data):
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("that is not a readable image")
    h, w = img.shape[:2]
    if min(h, w) < MIN_SIDE:
        raise ValueError("that image is too small to check")
    if max(h, w) > MAX_SIDE:
        scale = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (round(w * scale), round(h * scale)),
                         interpolation=cv2.INTER_AREA)
    return img


def _measure(face, img_w, img_h):
    """Turn one YuNet row into frame-relative geometry.

    Row layout is [x, y, w, h, five (x, y) landmark pairs, score]. Only the box
    and the score are read — see the module docstring on why the landmarks are
    left alone.
    """
    x, y, w, h = (float(v) for v in face[:4])
    return {
        "score": round(float(face[14]), 3),
        # Height is the useful framing measure: a passport crop is taller than
        # it is wide, so the face box spans much more of the height than of the
        # width and the height ratio is what moves when the crop is wrong.
        "heightRatio": round(h / img_h, 3),
        "widthRatio": round(w / img_w, 3),
        # Signed offsets from the centre of the frame, as a share of each side.
        "offCenterX": round(((x + w / 2) - img_w / 2) / img_w, 3),
        "offCenterY": round(((y + h / 2) - img_h / 2) / img_h, 3),
    }


def detect(data):
    """Detect faces in encoded image bytes.

    Returns {"faces": <count>, "primary": <geometry or None>}, where `primary`
    describes the largest face found. Raises ValueError for input that is not a
    usable image and Unavailable if the detector itself is missing.
    """
    img = _decode(data)
    h, w = img.shape[:2]
    detector = _get_detector()

    with _lock:
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)

    # A blank frame yields retval 1 with faces None, so the array is the only
    # thing worth counting.
    rows = [] if faces is None else list(faces)
    if not rows:
        return {"faces": 0, "primary": None}

    # Largest box first: with a bystander in shot, the candidate is the subject.
    rows.sort(key=lambda f: float(f[2]) * float(f[3]), reverse=True)
    return {"faces": len(rows), "primary": _measure(rows[0], w, h)}

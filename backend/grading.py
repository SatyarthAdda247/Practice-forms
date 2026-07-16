"""Grading + OMR mark-detection helpers.

Real optical-mark recognition from a scanned image requires a computer-vision
pipeline (deskew -> locate fiducial markers -> sample bubble intensities ->
threshold). That is out of scope for this reference implementation, so
:func:`detect_answers` is a deterministic stub that fabricates plausible
answers for a sheet. Swap it out for an OpenCV pipeline in production; the rest
of the app only depends on its return shape: ``{ "1": "A", "2": "C", ... }``.
"""

import hashlib

OPTIONS = ["A", "B", "C", "D"]


def detect_answers(filename, num_questions, seed_extra=""):
    """Return a deterministic set of marked answers for a sheet.

    Deterministic (seeded by filename) so repeated processing is stable and
    demos are reproducible. Roughly 8% of questions are left blank to simulate
    unattempted bubbles.
    """
    digest = hashlib.sha256(f"{filename}{seed_extra}".encode()).digest()
    answers = {}
    for q in range(1, num_questions + 1):
        b = digest[q % len(digest)]
        if b % 12 == 0:  # ~8% left unattempted
            continue
        answers[str(q)] = OPTIONS[b % 4]
    return answers


def grade(answer_key, answers, marks_correct, marks_penalty):
    """Score a sheet's ``answers`` against the ``answer_key``.

    Only questions present in the answer key are considered. Returns a dict with
    ``correct``, ``wrong``, ``unattempted``, ``score`` and ``maxScore``.
    Penalty is applied per wrong answer; unattempted questions are neither
    rewarded nor penalised.
    """
    correct = wrong = unattempted = 0
    for q, key_opt in answer_key.items():
        marked = answers.get(q)
        if marked is None:
            unattempted += 1
        elif marked == key_opt:
            correct += 1
        else:
            wrong += 1

    total = len(answer_key)
    score = round(correct * marks_correct - wrong * marks_penalty, 2)
    max_score = round(total * marks_correct, 2)
    return {
        "correct": correct,
        "wrong": wrong,
        "unattempted": unattempted,
        "score": score,
        "maxScore": max_score,
    }

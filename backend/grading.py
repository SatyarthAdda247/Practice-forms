"""Grading helpers.

Scoring only. Optical-mark *recognition* — turning a scanned sheet into an
``{"1": "A", ...}`` answer map — lives in :mod:`omr_pipeline` (a real OpenCV
pipeline). This module just compares a detected answer map against the key.
"""

OPTIONS = ["A", "B", "C", "D"]


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

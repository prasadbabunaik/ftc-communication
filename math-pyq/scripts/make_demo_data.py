#!/usr/bin/env python3
"""
Generate a SYNTHETIC demo dataset so the dashboard can be reviewed before the
real papers are ingested.

THIS IS NOT REAL UPSC DATA. Every record carries "synthetic": true and the
generated analytics carry "synthetic": true at the top level, which makes the
dashboard show a permanent warning banner.

What IS faithful here is the *structure*: 2 papers x 8 questions, Q1/Q5
compulsory with five 10-mark parts, Q2-Q4/Q6-Q8 with parts summing to 50,
400 printed marks per paper, and topics drawn only from their own section.
The topic *weights* are invented and must not be read as real trends.

Real data:  scripts/download_papers.py -> extract_questions.py -> build_dataset.py
"""
import argparse
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from classify import load_taxonomy          # noqa: E402
from build_dataset import build, quality    # noqa: E402

# Invented relative weights - plausible shape, NOT measured from real papers.
WEIGHTS = {
    ("I", "A"): {"linear_algebra": 0.36, "calculus": 0.38, "analytic_geometry": 0.26},
    ("I", "B"): {"ordinary_differential_equations": 0.38, "dynamics_and_statics": 0.34,
                 "vector_analysis": 0.28},
    ("II", "A"): {"algebra": 0.30, "real_analysis": 0.30, "complex_analysis": 0.26,
                  "linear_programming": 0.14},
    ("II", "B"): {"partial_differential_equations": 0.34,
                  "numerical_analysis_and_computer_programming": 0.36,
                  "mechanics_and_fluid_dynamics": 0.30},
}
MARK_PATTERNS = [(15, 15, 20), (10, 20, 20), (20, 15, 15), (15, 20, 15), (20, 20, 10)]


def allocate(weights, n, rng):
    """Split n parts across topics roughly proportional to weights."""
    ids = list(weights)
    jittered = {k: max(0.01, weights[k] * rng.uniform(0.75, 1.25)) for k in ids}
    total = sum(jittered.values())
    counts = {k: int(n * jittered[k] / total) for k in ids}
    while sum(counts.values()) < n:
        counts[rng.choice(ids)] += 1
    while sum(counts.values()) > n:
        k = rng.choice([i for i in ids if counts[i] > 0])
        counts[k] -= 1
    pool = []
    for k, c in counts.items():
        pool.extend([k] * c)
    rng.shuffle(pool)
    return pool


def make(year_from, year_to, seed=20140101):
    tax = load_taxonomy()
    topics = {t["id"]: t for t in tax["topics"]}
    rng = random.Random(seed)
    out = []

    for year in range(year_from, year_to + 1):
        for paper in ("I", "II"):
            for section, qnums in (("A", [1, 2, 3, 4]), ("B", [5, 6, 7, 8])):
                pool = allocate(WEIGHTS[(paper, section)], 14, rng)
                i = 0
                for qno in qnums:
                    if qno in (1, 5):
                        parts, marks = list("abcde"), [10] * 5
                    else:
                        parts, marks = list("abc"), list(rng.choice(MARK_PATTERNS))
                    for part, mk in zip(parts, marks):
                        tid = pool[i]
                        i += 1
                        t = topics[tid]
                        sub = rng.choice(t["subtopics"])
                        out.append({
                            "id": f"{year}-P{paper}-Q{qno}{part}",
                            "year": year, "paper": paper, "section": section,
                            "question_no": qno, "part": part,
                            "compulsory": qno in (1, 5),
                            "marks": mk, "marks_inferred": False,
                            "text": f"[SYNTHETIC PLACEHOLDER] {sub['name']} "
                                    f"- {t['name']}, Paper {paper} Section {section}.",
                            "source_pdf": None, "page": None,
                            "topic_id": tid, "topic": t["name"],
                            "subtopic_id": sub["id"], "subtopic": sub["name"],
                            "confidence": 1.0, "matched_keywords": [],
                            "needs_review": False, "cross_section": False,
                            "method": "synthetic", "synthetic": True,
                        })
    return tax, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="y_from", type=int, default=2014)
    ap.add_argument("--to", dest="y_to", type=int, default=2025)
    ap.add_argument("--outdir", default=os.path.join(ROOT, "data", "demo"))
    args = ap.parse_args()

    tax, questions = make(args.y_from, args.y_to)
    analytics = build(questions, tax)
    analytics["synthetic"] = True
    analytics["synthetic_warning"] = (
        "SYNTHETIC DEMO DATA - structure is faithful to the real paper format, "
        "but topic weights are invented. Do NOT use for exam strategy. "
        "Run the ingest pipeline on the official PDFs for real numbers."
    )
    qr = quality(questions, tax)
    qr["synthetic"] = True

    os.makedirs(args.outdir, exist_ok=True)
    for name, payload in (("questions.json", questions),
                          ("analytics.json", analytics),
                          ("quality_report.json", qr)):
        with open(os.path.join(args.outdir, name), "w") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"  wrote {os.path.relpath(os.path.join(args.outdir, name), ROOT)}")

    print(f"\nSYNTHETIC: {len(questions)} parts, {args.y_from}-{args.y_to}, "
          f"{analytics['coverage']['total_marks']} printed marks")
    assert not qr["paper_marks_anomalies"], qr["paper_marks_anomalies"]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

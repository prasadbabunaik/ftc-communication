#!/usr/bin/env python3
"""
Classify extracted questions and build the analytics the dashboard reads.

Inputs :  data/questions_raw.json   (from extract_questions.py)
Outputs:  data/questions.json       classified question bank
          data/analytics.json       pre-aggregated topic-wise analysis
          data/quality_report.json  what the pipeline could not resolve
"""
import argparse
import collections
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from classify import Classifier, load_taxonomy  # noqa: E402


def infer_marks(questions):
    """Fill missing marks. Compulsory parts are 10; otherwise split the 50-mark
    question evenly across its parts, which matches the usual 15/15/20 layout
    closely enough for aggregate analysis and is flagged as inferred."""
    by_q = collections.defaultdict(list)
    for q in questions:
        by_q[(q["year"], q["paper"], q["question_no"])].append(q)

    for (_y, _p, qno), parts in by_q.items():
        if qno in (1, 5):
            for p in parts:
                if p["marks"] is None:
                    p["marks"] = 10
                    p["marks_inferred"] = True
            continue
        known = sum(p["marks"] for p in parts if p["marks"] is not None)
        unknown = [p for p in parts if p["marks"] is None]
        if unknown:
            remaining = max(50 - known, 0)
            each = round(remaining / len(unknown)) if remaining else 0
            for p in unknown:
                p["marks"] = each
                p["marks_inferred"] = True
    for q in questions:
        q.setdefault("marks_inferred", False)
        q["marks"] = q["marks"] or 0
    return questions


def build(questions, tax):
    topics = {t["id"]: t for t in tax["topics"]}
    years = sorted({q["year"] for q in questions})
    papers = sorted({q["paper"] for q in questions})

    def agg(key):
        d = collections.defaultdict(lambda: {"marks": 0, "count": 0})
        for q in questions:
            k = key(q)
            if k is None:
                continue
            d[k]["marks"] += q["marks"]
            d[k]["count"] += 1
        return d

    total_marks = sum(q["marks"] for q in questions)

    by_topic = []
    t_agg = agg(lambda q: q.get("topic_id"))
    for tid, v in t_agg.items():
        t = topics[tid]
        yrs = sorted({q["year"] for q in questions if q.get("topic_id") == tid})
        comp = sum(q["marks"] for q in questions
                   if q.get("topic_id") == tid and q["compulsory"])
        by_topic.append({
            "topic_id": tid, "topic": t["name"], "paper": t["paper"],
            "section": t["section"], "order": t["order"],
            "marks": v["marks"], "count": v["count"],
            "share_pct": round(100 * v["marks"] / total_marks, 2) if total_marks else 0,
            "avg_marks_per_year": round(v["marks"] / len(yrs), 1) if yrs else 0,
            "years_present": len(yrs), "years_total": len(years),
            "consistency_pct": round(100 * len(yrs) / len(years), 1) if years else 0,
            "compulsory_marks": comp,
            "optional_marks": v["marks"] - comp,
        })
    by_topic.sort(key=lambda r: -r["marks"])

    by_subtopic = []
    s_agg = agg(lambda q: (q.get("topic_id"), q.get("subtopic_id")))
    for (tid, sid), v in s_agg.items():
        if not tid:
            continue
        t = topics[tid]
        sub = next((s for s in t["subtopics"] if s["id"] == sid), None)
        yrs = sorted({q["year"] for q in questions
                      if q.get("topic_id") == tid and q.get("subtopic_id") == sid})
        by_subtopic.append({
            "topic_id": tid, "topic": t["name"],
            "subtopic_id": sid, "subtopic": sub["name"] if sub else sid,
            "paper": t["paper"], "marks": v["marks"], "count": v["count"],
            "years": yrs,
        })
    by_subtopic.sort(key=lambda r: -r["marks"])

    # topic x year matrix
    ty = collections.defaultdict(int)
    for q in questions:
        if q.get("topic_id"):
            ty[(q["topic_id"], q["year"])] += q["marks"]
    topic_year = [
        {"topic_id": tid, "topic": topics[tid]["name"], "paper": topics[tid]["paper"],
         "series": [{"year": y, "marks": ty.get((tid, y), 0)} for y in years]}
        for tid in sorted(t_agg, key=lambda t: (topics[t]["paper"], topics[t]["order"]))
    ]

    # never-asked subtopics: real signal for what to deprioritise
    asked = {(r["topic_id"], r["subtopic_id"]) for r in by_subtopic}
    gaps = [
        {"topic_id": t["id"], "topic": t["name"], "paper": t["paper"],
         "subtopic_id": s["id"], "subtopic": s["name"]}
        for t in tax["topics"] for s in t["subtopics"]
        if (t["id"], s["id"]) not in asked
    ]

    by_year = []
    for y in years:
        yq = [q for q in questions if q["year"] == y]
        by_year.append({
            "year": y, "marks": sum(q["marks"] for q in yq), "count": len(yq),
            "papers": sorted({q["paper"] for q in yq}),
        })

    by_paper = [
        {"paper": p,
         "marks": sum(q["marks"] for q in questions if q["paper"] == p),
         "count": len([q for q in questions if q["paper"] == p])}
        for p in papers
    ]

    marks_mix = collections.Counter(q["marks"] for q in questions)

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "coverage": {
            "years": years,
            "year_from": years[0] if years else None,
            "year_to": years[-1] if years else None,
            "papers": papers,
            "question_parts": len(questions),
            "total_marks": total_marks,
        },
        "by_topic": by_topic,
        "by_subtopic": by_subtopic,
        "topic_year": topic_year,
        "by_year": by_year,
        "by_paper": by_paper,
        "marks_mix": [{"marks": m, "count": c} for m, c in sorted(marks_mix.items())],
        "syllabus_gaps": gaps,
    }


def quality(questions, tax):
    years = sorted({q["year"] for q in questions})
    per_paper = collections.defaultdict(int)
    for q in questions:
        per_paper[(q["year"], q["paper"])] += q["marks"]
    # Every UPSC Maths paper prints 8 questions x 50 = 400 marks.
    anomalies = [
        {"year": y, "paper": p, "extracted_marks": m, "expected": 400}
        for (y, p), m in sorted(per_paper.items()) if m != 400
    ]
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "questions": len(questions),
        "unclassified": len([q for q in questions if not q.get("topic_id")]),
        "low_confidence": len([q for q in questions if q.get("needs_review")]),
        "marks_inferred": len([q for q in questions if q.get("marks_inferred")]),
        "years_seen": years,
        "papers_missing": [
            {"year": y, "paper": p}
            for y in years for p in ("I", "II") if (y, p) not in per_paper
        ],
        "paper_marks_anomalies": anomalies,
        "note": "paper_marks_anomalies flag papers whose extracted marks differ "
                "from the official printed 400. Usually a PDF-layout parse miss - "
                "review those papers before trusting their topic split.",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "questions_raw.json"))
    ap.add_argument("--outdir", default=os.path.join(ROOT, "data"))
    args = ap.parse_args()

    if not os.path.exists(args.raw):
        print(f"{args.raw} not found. Run extract_questions.py first.")
        return 1

    with open(args.raw) as f:
        questions = json.load(f)

    tax = load_taxonomy()
    clf = Classifier(tax)
    for q in questions:
        q.update(clf.classify(q["text"], q.get("paper"), q.get("section")))
    infer_marks(questions)

    os.makedirs(args.outdir, exist_ok=True)
    for name, payload in (
        ("questions.json", questions),
        ("analytics.json", build(questions, tax)),
        ("quality_report.json", quality(questions, tax)),
    ):
        with open(os.path.join(args.outdir, name), "w") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"  wrote data/{name}")

    qr = quality(questions, tax)
    print(f"\n{qr['questions']} parts | {qr['unclassified']} unclassified | "
          f"{qr['low_confidence']} low-confidence | {qr['marks_inferred']} marks inferred")
    if qr["paper_marks_anomalies"]:
        print(f"{len(qr['paper_marks_anomalies'])} paper(s) did not total 250 marks "
              f"- see data/quality_report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

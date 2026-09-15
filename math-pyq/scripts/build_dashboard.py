#!/usr/bin/env python3
"""
Embed a dataset into dashboard/index.html so the page is fully standalone -
it opens straight from the filesystem with no server and no fetch.

Prefers the real pipeline output (data/questions.json). Falls back to the
synthetic demo set (data/demo/questions.json), which makes the page render a
permanent "SYNTHETIC" warning banner.

    python3 scripts/build_dashboard.py            # real if present, else demo
    python3 scripts/build_dashboard.py --demo     # force the demo set
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from classify import load_taxonomy  # noqa: E402

import re

BLOCK_RE = re.compile(
    r'(<script id="pyq-data" type="application/json">)(.*?)(</script>)', re.S)


def compact(questions, tax, synthetic, quality_report):
    topics = [
        {"id": t["id"], "name": t["name"], "paper": t["paper"], "section": t["section"],
         "subs": [{"id": s["id"], "name": s["name"]} for s in t["subtopics"]]}
        for t in tax["topics"]
    ]
    qs = [
        {"y": q["year"], "p": q["paper"], "s": q["section"], "q": q["question_no"],
         "pt": q["part"], "c": 1 if q["compulsory"] else 0, "m": q["marks"],
         "t": q.get("topic_id"), "st": q.get("subtopic_id")}
        for q in questions if q.get("topic_id")
    ]
    years = sorted({q["y"] for q in qs})
    meta = {
        "synthetic": synthetic,
        "generated_at": (quality_report or {}).get("generated_at"),
        "low_confidence": (quality_report or {}).get("low_confidence", 0),
        "sources": f"UPSC CSE Mains Mathematics papers {years[0]}-{years[-1]}" if years else "",
    }
    return {"meta": meta, "topics": topics, "questions": qs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="force the synthetic demo dataset")
    ap.add_argument("--page", default=os.path.join(ROOT, "dashboard", "index.html"))
    args = ap.parse_args()

    real = os.path.join(ROOT, "data", "questions.json")
    demo = os.path.join(ROOT, "data", "demo", "questions.json")
    use_demo = args.demo or not os.path.exists(real)
    src = demo if use_demo else real
    if not os.path.exists(src):
        print(f"{src} not found. Run make_demo_data.py or the ingest pipeline first.")
        return 1

    with open(src) as f:
        questions = json.load(f)
    qr_path = os.path.join(os.path.dirname(src), "quality_report.json")
    qr = json.load(open(qr_path)) if os.path.exists(qr_path) else {}

    payload = compact(questions, load_taxonomy(), use_demo, qr)
    blob = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    # The payload sits inside a <script> block; never let it close that tag early.
    blob = blob.replace("</", "<\\/")

    with open(args.page) as f:
        html = f.read()
    if not BLOCK_RE.search(html):
        print("The pyq-data script block was not found - did the page change?")
        return 1
    html, n = BLOCK_RE.subn(lambda m: m.group(1) + blob + m.group(3), html, count=1)
    if n != 1:
        print("Expected exactly one pyq-data block")
        return 1
    with open(args.page, "w") as f:
        f.write(html)

    kind = "SYNTHETIC demo" if use_demo else "real"
    print(f"Embedded {kind} dataset: {len(payload['questions'])} classified parts, "
          f"{len(payload['topics'])} topics")
    print(f"  source: {os.path.relpath(src, ROOT)}")
    print(f"  page:   {os.path.relpath(args.page, ROOT)} "
          f"({os.path.getsize(args.page) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

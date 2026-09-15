#!/usr/bin/env python3
"""
Topic / subtopic classifier for UPSC Mathematics optional questions.

Strategy: weighted keyword matching against taxonomy/syllabus.json, with the
candidate set constrained by paper (a Paper I question can only belong to a
Paper I topic) and, when known, by section. Longer keywords score higher
because they are more specific ("cayley-hamilton" beats "matrix").

Anything the classifier cannot place with confidence is flagged
needs_review=True rather than being silently bucketed.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TAXONOMY = os.path.join(ROOT, "taxonomy", "syllabus.json")

MIN_CONFIDENCE = 0.34


def load_taxonomy(path=TAXONOMY):
    with open(path) as f:
        return json.load(f)


def _normalise(text):
    t = text.lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"\s+", " ", t)
    return t


class Classifier:
    def __init__(self, taxonomy=None):
        self.tax = taxonomy or load_taxonomy()
        self.topics = {t["id"]: t for t in self.tax["topics"]}
        # section -> allowed topic ids, per paper
        self.by_paper_section = {}
        for p in self.tax["papers"]:
            for s in p["sections"]:
                self.by_paper_section[(p["paper"], s["section"])] = list(s["topics"])
        self.by_paper = {}
        for (paper, _sec), ids in self.by_paper_section.items():
            self.by_paper.setdefault(paper, [])
            for i in ids:
                if i not in self.by_paper[paper]:
                    self.by_paper[paper].append(i)

    def candidates(self, paper=None, section=None):
        if paper and section and (paper, section) in self.by_paper_section:
            return self.by_paper_section[(paper, section)]
        if paper and paper in self.by_paper:
            return self.by_paper[paper]
        return list(self.topics)

    def _score(self, norm, allowed):
        scores, matched = {}, {}
        for tid in allowed:
            topic = self.topics[tid]
            for sub in topic["subtopics"]:
                score = 0.0
                hits = []
                for kw in sub["keywords"]:
                    k = kw.lower()
                    n = norm.count(k)
                    if n:
                        # weight by specificity: word count + length
                        w = len(k.split()) * 2.0 + len(k) / 10.0
                        score += n * w
                        hits.append(kw)
                if score:
                    scores[(tid, sub["id"])] = score
                    matched[(tid, sub["id"])] = hits
        return scores, matched

    def classify(self, text, paper=None, section=None):
        """Score against section-appropriate topics first. Real papers keep
        Section A questions on Section A topics, so that constraint sharply
        improves accuracy - but it is a convention, not a guarantee, so fall
        back to the whole paper rather than returning nothing."""
        norm = _normalise(text or "")
        scores, matched = self._score(norm, self.candidates(paper, section))
        cross_section = False
        if not scores and section:
            scores, matched = self._score(norm, self.candidates(paper, None))
            cross_section = bool(scores)
        if not scores:
            return {
                "topic_id": None, "topic": None,
                "subtopic_id": None, "subtopic": None,
                "confidence": 0.0, "matched_keywords": [],
                "needs_review": True, "method": "keyword",
                "cross_section": False,
            }

        total = sum(scores.values())
        (tid, sid), best = max(scores.items(), key=lambda kv: kv[1])
        # Aggregate to topic level so a topic winning across several subtopics
        # is not beaten by one strong subtopic elsewhere.
        topic_totals = {}
        for (t, _s), v in scores.items():
            topic_totals[t] = topic_totals.get(t, 0.0) + v
        top_tid = max(topic_totals, key=topic_totals.get)
        if top_tid != tid:
            tid = top_tid
            sid, _ = max(
                ((s, v) for (t, s), v in scores.items() if t == tid),
                key=lambda kv: kv[1],
            )
        confidence = round(topic_totals[tid] / total, 3) if total else 0.0
        topic = self.topics[tid]
        sub = next(s for s in topic["subtopics"] if s["id"] == sid)
        return {
            "topic_id": tid, "topic": topic["name"],
            "subtopic_id": sid, "subtopic": sub["name"],
            "confidence": confidence,
            "matched_keywords": sorted(set(matched.get((tid, sid), [])))[:8],
            "needs_review": confidence < MIN_CONFIDENCE or cross_section,
            "method": "keyword",
            "cross_section": cross_section,
        }


if __name__ == "__main__":
    import sys
    c = Classifier()
    samples = [
        ("I", "A", "Using Cayley-Hamilton theorem, find the inverse of the matrix A."),
        ("I", "B", "Find the curvature and torsion of the space curve given by r(t)."),
        ("II", "A", "Show that every finite integral domain is a field."),
        ("II", "B", "Solve the one dimensional heat equation by separation of variables."),
        ("II", "B", "Evaluate the integral by Simpson's rule with h = 0.5."),
    ]
    if len(sys.argv) > 1:
        samples = [(None, None, " ".join(sys.argv[1:]))]
    for paper, section, txt in samples:
        r = c.classify(txt, paper, section)
        print(f"[P{paper or '?'}/{section or '?'}] {txt[:58]!r}")
        print(f"   -> {r['topic']} / {r['subtopic']}  conf={r['confidence']} {r['matched_keywords']}\n")

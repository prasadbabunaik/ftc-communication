#!/usr/bin/env python3
"""
Extract structured question-parts from downloaded UPSC Mathematics papers.

UPSC Mains Mathematics papers follow a stable layout:

    SECTION 'A'
    Q1. (a) <question text>                                10
        (b) <question text>                                10
        ...
    Q2. (a) <question text>                                15

Q1 and Q5 are compulsory and carry five 10-mark parts. Q2-Q4 and Q6-Q8 carry
50 marks split across 2-4 parts.

Caveat that matters: these PDFs are typeset mathematics. Text extraction
recovers the prose reliably but mangles formulae (integral signs, matrices,
subscripts). That is good enough for keyword topic classification, which is
what this dataset is for - it is not good enough to reprint the questions.
Every record therefore keeps `source_pdf` and `page` so you can go back to
the original.
"""
import argparse
import json
import os
import re
import sys

try:
    import pdfplumber
except ImportError:  # only parse_pdf() needs it; parse_pages() is pure text
    pdfplumber = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FNAME_RE = re.compile(r"CSM-(20\d{2})-Mathematics-Paper-(I{1,2}|X)", re.I)
SECTION_RE = re.compile(r"SECTION\s*[-—–'\"‘’]*\s*([AB])\b", re.I)
QNUM_RE = re.compile(r"^(?:Q\.?\s*)?(\d{1,2})\s*[.)]\s*(.*)$")
PART_RE = re.compile(r"^\(?([a-eA-E])\)\s*(.*)$")
INLINE_PART_RE = re.compile(r"^(?:Q\.?\s*)?(\d{1,2})\s*[.)]\s*\(?([a-eA-E])\)\s*(.*)$")
MARKS_TAIL_RE = re.compile(r"(?:^|\s)\(?(\d{1,2})\)?\s*$")
NOISE_RE = re.compile(
    r"(^\s*$|^\d+\s*$|marks?\s*:|^\s*page\s|question\s+paper\s+specific|"
    r"candidate\s+should|answers?\s+must\s+be\s+written|attempt\s+.*questions|"
    r"^\s*SECTION|illegible|word\s+limit|^\s*Q\.?\s*No\b)", re.I)

VALID_MARKS = {5, 8, 10, 12, 15, 16, 20, 25}


def meta_from_filename(path):
    m = FNAME_RE.search(os.path.basename(path))
    if not m:
        return None, None
    return int(m.group(1)), m.group(2).upper()


def section_for(qnum, seen_section):
    """Section from an explicit header if we saw one, else from question number."""
    if seen_section:
        return seen_section
    return "A" if 1 <= qnum <= 4 else "B"


def parse_pdf(path):
    year, paper = meta_from_filename(path)
    if year is None:
        print(f"  ! {os.path.basename(path)}: cannot read year/paper from filename, skipped",
              file=sys.stderr)
        return []
    if pdfplumber is None:
        sys.exit("pdfplumber is required to read PDFs. "
                 "Run:  pip install -r scripts/requirements.txt")
    with pdfplumber.open(path) as pdf:
        pages = [(i, p.extract_text() or "") for i, p in enumerate(pdf.pages, start=1)]
    return parse_pages(pages, year, paper, path)


def parse_pages(pages, year, paper, path="<memory>"):
    """Core line parser. Split out from parse_pdf so it can be tested on plain
    text fixtures without a PDF. `pages` is an iterable of (page_no, text)."""
    records = []
    current = None
    cur_section = None
    cur_q = None

    def flush():
        nonlocal current
        if current and current["text"].strip():
            text = re.sub(r"\s+", " ", current["text"]).strip()
            marks = current["marks"]
            m = MARKS_TAIL_RE.search(text)
            if marks is None and m and int(m.group(1)) in VALID_MARKS:
                marks = int(m.group(1))
                text = text[: m.start()].strip()
            current["text"] = text
            current["marks"] = marks
            records.append(current)
        current = None

    for pno, raw in pages:
        for line in raw.split("\n"):
            line = line.strip()
            sm = SECTION_RE.search(line)
            if sm:
                flush()
                cur_section = sm.group(1).upper()
                continue
            if NOISE_RE.search(line) and not QNUM_RE.match(line):
                continue

            im = INLINE_PART_RE.match(line)
            qm = QNUM_RE.match(line)
            pm = PART_RE.match(line)

            if im and int(im.group(1)) <= 8:
                flush()
                cur_q = int(im.group(1))
                current = _new(year, paper, section_for(cur_q, cur_section),
                               cur_q, im.group(2).lower(), im.group(3), path, pno)
            elif qm and int(qm.group(1)) <= 8 and (cur_q is None or int(qm.group(1)) >= cur_q):
                flush()
                cur_q = int(qm.group(1))
                rest = qm.group(2)
                p2 = PART_RE.match(rest)
                if p2:
                    current = _new(year, paper, section_for(cur_q, cur_section),
                                   cur_q, p2.group(1).lower(), p2.group(2), path, pno)
                else:
                    current = _new(year, paper, section_for(cur_q, cur_section),
                                   cur_q, "a", rest, path, pno)
            elif pm and cur_q is not None:
                flush()
                current = _new(year, paper, section_for(cur_q, cur_section),
                               cur_q, pm.group(1).lower(), pm.group(2), path, pno)
            elif current is not None:
                mt = MARKS_TAIL_RE.search(line)
                if mt and int(mt.group(1)) in VALID_MARKS and len(line) - mt.start() < 6:
                    current["text"] += " " + line[: mt.start()]
                    current["marks"] = int(mt.group(1))
                else:
                    current["text"] += " " + line
    flush()

    return [r for r in records if len(r["text"]) >= 12]


def _new(year, paper, section, qnum, part, text, path, page):
    compulsory = qnum in (1, 5)
    return {
        "id": f"{year}-P{paper}-Q{qnum}{part}",
        "year": year, "paper": paper, "section": section,
        "question_no": qnum, "part": part,
        "compulsory": compulsory,
        "marks": 10 if compulsory else None,
        "text": text,
        "source_pdf": os.path.basename(path),
        "page": page,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--papers", default=os.path.join(ROOT, "papers"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "questions_raw.json"))
    args = ap.parse_args()

    pdfs = sorted(
        os.path.join(args.papers, f)
        for f in os.listdir(args.papers)
        if f.lower().endswith(".pdf")
    ) if os.path.isdir(args.papers) else []

    if not pdfs:
        print(f"No PDFs in {args.papers}. Run scripts/download_papers.py first.")
        return 1

    all_recs = []
    for p in pdfs:
        recs = parse_pdf(p)
        print(f"  {os.path.basename(p)}: {len(recs)} question parts")
        all_recs.extend(recs)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(all_recs, f, indent=2, ensure_ascii=False)
    print(f"\n{len(all_recs)} question parts -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

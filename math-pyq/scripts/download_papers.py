#!/usr/bin/env python3
"""
Discover and download UPSC Civil Services (Mains) Mathematics optional
question papers from the official UPSC website.

UPSC does not use a stable filename convention across years, so this script
does NOT guess URLs. It crawls the official "Previous Question Papers"
listing, finds every anchor that looks like a Mains Mathematics paper, and
downloads it.

Usage:
    python3 scripts/download_papers.py                 # 2014 -> current year
    python3 scripts/download_papers.py --from 2014 --to 2025
    python3 scripts/download_papers.py --list-only     # show what it found
"""
import argparse
import datetime as dt
import os
import re
import sys
import time
from urllib.parse import urljoin

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps. Run:  pip install -r scripts/requirements.txt")

BASE = "https://upsc.gov.in"
LISTING = f"{BASE}/examination/previous-question-papers"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "papers")
UA = "Mozilla/5.0 (compatible; math-pyq-dashboard/1.0)"

# A link is a Mathematics Mains paper if it mentions mathematics and is not
# a Prelims / CSAT / other-exam paper.
MATH_RE = re.compile(r"mathemat", re.I)
MAINS_RE = re.compile(r"\b(csm|main|mains|dcsm)\b", re.I)
EXCLUDE_RE = re.compile(r"(prelim|csp|csat|general\s*studies|ifos|ies|cds|nda|capf|geo-?scientist|statistic)", re.I)
YEAR_RE = re.compile(r"(20\d{2})")
PAPER_RE = re.compile(r"paper\s*[-_ ]?\s*(i{1,2}|1|2)\b", re.I)


def norm_paper(text):
    m = PAPER_RE.search(text)
    if not m:
        return None
    tok = m.group(1).upper()
    return {"1": "I", "2": "II", "I": "I", "II": "II"}[tok]


def norm_year(text):
    years = [int(y) for y in YEAR_RE.findall(text)]
    # Prefer a plausible exam year; filenames sometimes carry a date stamp too.
    years = [y for y in years if 2000 <= y <= dt.date.today().year]
    return max(years) if years else None


def crawl(session, max_pages=30, delay=1.0):
    """Walk the paginated listing and yield (url, link_text) for PDF anchors."""
    seen = set()
    for page in range(max_pages):
        url = LISTING if page == 0 else f"{LISTING}?page={page}"
        try:
            r = session.get(url, timeout=60)
            r.raise_for_status()
        except Exception as e:
            print(f"  ! {url}: {e}", file=sys.stderr)
            break
        soup = BeautifulSoup(r.text, "html.parser")
        anchors = soup.find_all("a", href=True)
        found_here = 0
        for a in anchors:
            href = urljoin(BASE, a["href"])
            if ".pdf" not in href.lower():
                continue
            if href in seen:
                continue
            seen.add(href)
            found_here += 1
            yield href, " ".join(a.get_text(" ", strip=True).split())
        print(f"  page {page}: {found_here} new pdf links")
        if found_here == 0 and page > 0:
            break
        time.sleep(delay)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="y_from", type=int, default=2014)
    ap.add_argument("--to", dest="y_to", type=int, default=dt.date.today().year)
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--max-pages", type=int, default=30)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = UA

    print(f"Crawling {LISTING} for Mathematics Mains papers {args.y_from}-{args.y_to}")
    hits = []
    for href, text in crawl(session, max_pages=args.max_pages):
        blob = f"{text} {href}"
        if not MATH_RE.search(blob):
            continue
        if EXCLUDE_RE.search(blob):
            continue
        # Mains papers are usually flagged CSM / "Main"; keep unflagged ones too
        # but note them, since some years only say "Mathematics Paper I".
        year = norm_year(blob)
        paper = norm_paper(blob)
        if year is None or not (args.y_from <= year <= args.y_to):
            continue
        hits.append({
            "year": year, "paper": paper, "url": href, "text": text,
            "mains_flagged": bool(MAINS_RE.search(blob)),
        })

    hits.sort(key=lambda h: (h["year"], h["paper"] or "Z"))
    print(f"\nFound {len(hits)} candidate paper(s):")
    for h in hits:
        print(f"  {h['year']}  Paper {h['paper'] or '?'}  {h['url']}")
    if args.list_only:
        return 0

    ok = 0
    for h in hits:
        name = f"CSM-{h['year']}-Mathematics-Paper-{h['paper'] or 'X'}.pdf"
        dest = os.path.join(args.out, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"  = {name} (already present)")
            ok += 1
            continue
        try:
            r = session.get(h["url"], timeout=120)
            r.raise_for_status()
            if not r.content.startswith(b"%PDF"):
                print(f"  ! {name}: not a PDF, skipped")
                continue
            with open(dest, "wb") as f:
                f.write(r.content)
            print(f"  + {name} ({len(r.content)//1024} KB)")
            ok += 1
        except Exception as e:
            print(f"  ! {name}: {e}", file=sys.stderr)
        time.sleep(1.0)

    print(f"\n{ok}/{len(hits)} paper(s) available in {args.out}")
    missing = sorted({y for y in range(args.y_from, args.y_to + 1)} - {h["year"] for h in hits})
    if missing:
        print(f"No Mathematics paper discovered for: {missing}")
        print("UPSC occasionally reorganises the archive - check the listing manually,")
        print("or drop the PDFs into papers/ named CSM-<year>-Mathematics-Paper-<I|II>.pdf")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

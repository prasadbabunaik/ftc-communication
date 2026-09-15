# UPSC Mathematics Optional — PYQ Topic Analysis

A pipeline and dashboard for analysing **UPSC Civil Services (Mains) Mathematics
optional** previous-year question papers, topic-wise, against the official syllabus.

```
download_papers.py  →  extract_questions.py  →  build_dataset.py  →  build_dashboard.py
   official PDFs        structured questions      classified + aggregated      standalone page
```

---

## ⚠️ Read this first: the papers are not downloaded yet

The session this was built in runs behind a network egress policy that **blocks
`upsc.gov.in`** (and every coaching-site mirror) at the proxy — HTTP 403 on
`CONNECT`, for both `curl` and fetch tooling. Only GitHub and package registries
are reachable. So the PDFs could not be fetched here.

Everything downstream of the download is built, tested and working. **Run step 1
on a machine with normal internet** and the whole thing lights up:

```bash
pip install -r scripts/requirements.txt
python3 scripts/download_papers.py            # 2014 → current year
python3 scripts/extract_questions.py
python3 scripts/build_dataset.py
python3 scripts/build_dashboard.py
open dashboard/index.html
```

Until then the dashboard ships a **synthetic demo dataset**. It is labelled
`SYNTHETIC` in a permanent banner on the page and `"synthetic": true` in the
data. Its *structure* is faithful; its *topic weights are invented*. **Do not use
the demo numbers for exam strategy.**

---

## What's real vs. generated

| Asset | Status |
|---|---|
| `taxonomy/syllabus.json` — 13 topics, 69 sub-topics, 512 keywords | **Real.** The official UPSC Mathematics syllabus, unchanged since the 2013 revision. |
| Exam blueprint (8 questions, Q1/Q5 compulsory, 400 printed / 250 attempted) | **Real.** The published paper structure. |
| Pipeline scripts + 16 tests | **Real**, tested end-to-end. |
| Dashboard | **Real**, renders whatever dataset is embedded. |
| `data/demo/*` | **Synthetic.** Placeholder so the console can be reviewed pre-ingest. |
| `data/questions.json`, `data/analytics.json` | **Not present yet** — produced by the ingest run. |

---

## Marks basis: 400, not 250

Each paper **prints** 8 questions × 50 = **400 marks**, but a candidate **attempts**
only 5 (Q1 + Q5 compulsory, plus 3 of the other 6) = **250 marks**.

All topic-wise analysis here is computed on **marks offered** — the printed 400.
That is the correct basis for "how heavily is this topic examined", because it
counts what the examiner put on the paper rather than what one candidate chose.

---

## The scripts

### `download_papers.py`
Crawls the official *Previous Question Papers* listing and downloads every Mains
Mathematics paper in range. It **does not guess URLs** — UPSC's filenames are
inconsistent year to year, so it discovers links from the listing and filters
them (must mention *mathematics*; must not be Prelims/CSAT/IFoS/IES/CDS/NDA/CAPF).

```bash
python3 scripts/download_papers.py --list-only     # dry run
python3 scripts/download_papers.py --from 2014 --to 2025
```

Files land in `papers/` as `CSM-<year>-Mathematics-Paper-<I|II>.pdf`. If a year
is missing, drop the PDF in by hand using that name — the rest of the pipeline
keys off the filename.

### `extract_questions.py`
Parses each PDF into individual question **parts** (`2019-PI-Q2b`), recovering
section, question number, part letter, marks and page.

> **Caveat that matters:** these are typeset mathematics PDFs. Text extraction
> recovers the prose reliably but mangles formulae — integrals, matrices,
> subscripts. That is fine for keyword topic classification, which is what this
> dataset is for. It is **not** good enough to reprint the questions. Every
> record keeps `source_pdf` + `page` so you can go back to the original.

### `build_dataset.py`
Classifies each part onto the syllabus and pre-aggregates the analysis. Emits
`questions.json`, `analytics.json` and `quality_report.json`.

**Check `quality_report.json` after every run.** `paper_marks_anomalies` flags any
paper whose extracted marks don't total 400 — that's a parse miss, and that
paper's topic split shouldn't be trusted until you look at it.

### `classify.py`
Weighted keyword matching against the taxonomy. Longer keywords score higher
(`cayley-hamilton` beats `matrix`). Candidates are constrained by paper and
section — real papers keep Section A questions on Section A topics, which sharply
improves accuracy — with a fallback to the whole paper rather than returning
nothing. Anything below the confidence floor is flagged `needs_review` instead of
being silently bucketed.

```bash
python3 scripts/classify.py "Evaluate the integral by Simpson's rule"
```

### `build_dashboard.py`
Embeds the dataset into `dashboard/index.html` so the page is **fully standalone** —
opens from the filesystem, no server, no fetch. Prefers real data, falls back to
the demo set.

---

## The dashboard

- **Topic ranking** — all 13 topics by marks offered, colour-coded by paper.
- **Detail panel** — sub-topic split, compulsory/optional split, marks-per-year trend.
- **Topic × year heatmap** — read across for consistency, down for paper balance.
- **Untouched sub-topics** — in the syllabus, never asked in range. Low-yield, still examinable.
- **Filters** — paper, compulsory vs optional, year range. All aggregates recompute live.
- Light/dark themes, keyboard-focusable, table view for every chart, works at phone width.

Topic identity is carried by **labels, not 13 cycled hues**; the only categorical
colours are Paper I / Paper II (validated for colour-vision deficiency in both
themes), with a sequential blue ramp for magnitude.

---

## Tests

```bash
python3 -m unittest discover -s tests -v     # 16 tests
```

Covers extraction (part counts, boilerplate rejection, section assignment,
marks totalling 400, unique IDs), classification (nothing unclassified, topics
respect paper/section, known questions land on the right topic, all 13 topics
reachable) and aggregation (shares sum to 100, marks reconcile, compulsory split
reconciles, JSON-serialisable).

The fixture reproduces the *layout* of a Mathematics paper with representative
prose. It is a layout fixture, not a reproduction of any actual exam paper.

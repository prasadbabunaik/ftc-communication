# FTC Communication Portal — Application Overview

*What each part of the application shows, and the problem it solved.*
*Prepared for: senior management — National / Regional Load Despatch Centres*
*Date: June 2026*

---

## How to read this document

This is a **screen-by-screen tour** of the portal. For every screen it answers
two questions:

- **What you see** — what the screen displays and what it is for.
- **The problem earlier** — how this was handled before, on the manually-updated
  **Google Sheet**, and why that was painful.

It deliberately stays away from the internal technical "how" — the focus is on
*what the application presents to the user*.

---

## The big picture

The portal tracks every generation project and transmission element as it moves
through the commissioning funnel:

```
   CONTD-4 cleared ──► Applied for FTC ──► FTC approved ──► TOC issued ──► COD declared
   (connectivity)      (request raised)    (first charging)  (trial op.)   (commercial op.)
```

Earlier, **all of this lived in a shared Google Sheet that was updated by hand.**
Everyone edited the same file, summaries were re-typed manually, there was no
record of who changed what, and a single mis-key flowed straight into national
reports. The application replaces that sheet with a set of purpose-built screens,
described below.

---

## 1. Login screen

**What you see.** A simple sign-in page — email, password, and an "I'm not a
robot" check. Accounts are created by the Administrator; there is no self
sign-up. After signing in, you land on the Dashboard.

**The problem earlier.** The Google Sheet was protected only by a shared link —
**anyone who had the link could open and edit everything**, with no individual
identity. There was no real "login", no per-user accounts, and no way to lock
out unwanted access.

---

## 2. Dashboard — the headline screen

This is the screen leadership will look at most. At the top sit **stat cards** —
the All-India (or single-region) totals for **Applied, FTC, TOC, COD**. Below
them is a row of **tabs**, each a different view of the same live data. There is
also a **Region dropdown** (for NLDC/Admin, to filter the whole dashboard to one
region) and an **"As on" date picker** to see the picture as it stood on any past
date.

> The dashboard always shows the **portal's own live calculation** — the sum of
> the actual project data — not a copy of a summary anyone maintains by hand.

The tabs:

### 2a. FTC Pipeline tab
**What you see.** The headline capacity table — **Region × Source** (Wind, Solar,
BESS, Hybrid, Thermal, …) with the full pipeline across columns: Total, CONTD-4,
Applied, FTC (done / pending), TOC (issued / pending), COD (done / pending), and
Expected-this-month. A toggle lets you count hybrids **Including** or
**Excluding** their components. Each row has a **"View Breakup"** to drill into
the individual contributing projects.
**The problem earlier.** This summary was **rebuilt by hand** in the sheet every
time something changed — slow, repetitive, and a frequent source of figures that
didn't add up against the underlying rows.

### 2b. CONTD-4 Study tab
**What you see.** Projects under connectivity study, broken down by region and
sub-type (including the various hybrid combinations), with the capacities at each
stage.
**The problem earlier.** Kept as yet another manually-curated block in the sheet,
easily out of step with the rest.

### 2c. Hybrid Breakdown tab
**What you see.** Hybrid projects split into their **components** — Wind / Solar /
BESS / PSP — so you can see how much of each source sits inside the hybrids.
**The problem earlier.** Hybrids are inherently fiddly; splitting them by
component by hand in a spreadsheet was error-prone and rarely reconciled.

### 2d. Source-wise tab
**What you see.** The same pipeline as 2a, but organised **Source × Region** — the
national view per fuel type.
**The problem earlier.** A second hand-built pivot of the same numbers, doubling
the manual effort and the chance of mismatch.

### 2e. Transmission tab
**What you see.** Transmission elements (lines, ICTs, GTs, STs) rolled up by
**Region × Element type** — how much is FTC-done vs still pending, in both count
and MVA / circuit-km, including a "commissioning expected this month" column.
**The problem earlier.** Transmission was tracked separately and informally, with
no consolidated FTC-done-vs-pending view.

### 2f. FTC/TOC/COD Activity tab
**What you see.** "What actually happened in a period." Pick a **date range** (or
use the Indian financial-year / month selector) and get the FTC / TOC / COD
totals for that window, plus a Region × Source table and breakup.
**The problem earlier.** Answering "how much was charged this month?" meant
manually comparing old copies of the sheet — there was no reliable activity view.

### 2g. Project Details tab
**What you see.** The project-level list behind the summaries — the individual
contributors that make up every total.
**The problem earlier.** The detail and the summary lived in different tabs of the
sheet and drifted apart; there was no guaranteed link between them.

### 2h. Day-wise Changes tab
**What you see.** A **change log** — every recorded change (project created /
edited / deleted, milestone events added or removed, transmission edits),
**grouped by day**, showing **who** did it, the **old → new** value, and the
**timestamp**. It can also compare the state on any two dates and highlight what
moved.
**The problem earlier.** This simply did not exist. When a number changed in the
sheet, the previous value was **gone** — no history, no author, no timestamp.
Disputes over figures could not be settled with evidence.

---

## 3. CONTD-4 Applications screen

**What you see.** The working list of projects under connectivity study (status
PENDING / RECEIVED), with capacity, application date, proposed FTC date, and the
capacity expected to complete this month. When connectivity is granted the
project is marked **CLEARED** and flows into the FTC pipeline.
**The problem earlier.** Tracked as rows in the sheet with statuses updated by
hand; nothing enforced the progression or flagged what was due.

---

## 4. FTC Tracker — the main data-entry screen

**What you see.** The day-to-day working screen. It lists the projects being
tracked for FTC/TOC/COD with their current status, and offers **filters** by
plant type and commissioning status. From here an operator picks a project and
records milestones — **FTC, TOC, COD** — as **dated lots** (capacity is usually
charged in parts, so each lot has its own MW and date). It also offers a manual
**"Mark Commissioned / Reopen"** control for genuine edge cases, and per-page
**Excel / Print** export.
**The problem earlier.** Every figure was **typed straight into the Google
Sheet** by hand. Nothing checked the entry — you could record more commercial
capacity than was ever charged, or a wrong date, and it would silently flow into
the reports. There was no concept of dated lots, so point-in-time questions were
unanswerable.

> A key safeguard the application adds: it **enforces COD ≤ TOC ≤ FTC ≤ Applied**
> automatically and blocks impossible entries with a clear message. The sheet
> understood none of these rules.

---

## 5. Project detail page (open any project)

**What you see.** Everything about one project: its components/lanes, each lane's
Applied → FTC → TOC → COD, and two toggles — **By Source** (per component) and
**By Timeline** (every dated milestone in order). It also carries the project's
**Audit / History** feed — a timestamped record of every change to that project.
**The problem earlier.** A project was just a row (or a few scattered rows) in the
sheet, with no consolidated story and certainly no per-project history.

---

## 6. Region-wise & Source-wise Breakup screens

**What you see.** The full **project-level contributor tables** that sit behind
the dashboard summaries — every project that makes up each region or source
total, so any headline figure can be traced to its underlying rows.
**The problem earlier.** The link between a summary number and the rows behind it
was manual and fragile; reconciling "why is this total what it is?" meant
hunting through the sheet.

---

## 7. Transmission screen

**What you see.** The list of transmission elements under FTC — each with its
agency/owner, type (Line / ICT / GT / ST), RE / Non-RE, voltage, capacity (MVA) /
line length (ckt km), first-energisation date, and whether it is still pending
for FTC. Add/edit is region-locked for RLDCs.
**The problem earlier.** Transmission tracking was ad-hoc and disconnected from
the generation picture.

---

## 8. BESS Data screen

**What you see.** A dedicated view for **battery energy storage (BESS)** — its own
commissioning summary (cumulative and month-wise), with a branded export/print.
**The problem earlier.** Storage was lumped into the same manual sheet with no
view tailored to how BESS is reported.

---

## 9. Bulk Import wizard

**What you see.** A guided screen to upload **many** generation projects or
transmission elements at once from a spreadsheet template, instead of keying them
one by one. Every imported row is logged in the audit trail.
**The problem earlier.** Bulk changes meant copy-pasting blocks within the sheet,
with no validation and no record of what the import changed.

---

## 10. Notifications (the header bell)

**What you see.** A bell icon in the header with an unread-count badge. It surfaces
**in-app notifications** for key events — a new project, a CONTD-4 clearance, an
FTC/TOC/COD milestone, a transmission update — directed to the centres that need
to know.
**The problem earlier.** Awareness depended on someone **emailing or phoning**
around to say "I've updated the sheet." There was no built-in way to know that
something had changed.

---

## 11. Export & Print

**What you see.** From the dashboard and most screens, two controls: **Excel**
(a full multi-sheet workbook — Summary, Region-wise, Source-wise, per-source
detail, CONTD-4, Hybrid, Transmission) and **Print / Save as PDF** (a clean,
branded summary, automatically scoped to your region). The print view has a
**Customize** option to choose which tables and columns to include.
**The problem earlier.** "Sharing the report" meant emailing a copy of the sheet
itself — exposing all of it, in whatever half-edited state it happened to be in,
with no clean, presentation-ready output.

---

## 12. Administration (Admin / NLDC only)

**What you see.** **User Management** (create accounts, assign each user a role
and region) and **Access Control** — the screens that decide who can see and do
what. Plus a **Settings** screen for portal preferences.
**The problem earlier.** There was no access model at all — the single shared link
gave everyone the same all-or-nothing access to the whole sheet.

---

## Roles — who sees what

| Role | Sees | Can do |
|---|---|---|
| **Administrator** | All five regions | Everything — add/edit/delete any data, manage users |
| **NLDC** | All five regions (national view) | Oversight, exports, administration |
| **RLDC** (NR/WR/SR/ER/NER) | **Only its own region** | Add and edit its own region's data |

**The problem earlier.** The Google Sheet could not do this. A regional centre
either had edit access to the *whole* sheet or none at all — there was no way to
give each region control of just its own data while protecting the rest.

---

## Summary — earlier vs now, at a glance

| Area | Earlier (manual Google Sheet) | Now (the application) |
|---|---|---|
| Source of truth | Many copies, unsure which is latest | One live system, always current |
| Data entry | Typed by hand, errors slip through | Validated — impossible figures rejected |
| Who can edit | Anyone with the link, all of it | Role- and region-controlled |
| History | None — old values gone | Full audit trail (who / when / old → new) |
| Summaries | Rebuilt by hand | Generated automatically, always reconcile |
| "What changed?" | Compare old copies manually | Day-wise change log + date comparison |
| Awareness | Email / phone | In-app notifications |
| Sharing | Email the whole sheet | Clean, region-scoped print / Excel export |

**The bottom line:** the portal takes everything that used to be done by hand in a
shared spreadsheet and presents it as a set of **secure, validated, audited
screens** — so the numbers that feed national reporting can be trusted, traced,
and shared with confidence.

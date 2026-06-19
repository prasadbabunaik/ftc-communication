# FTC Communication Portal — Management Briefing

*A presentation writeup for senior management*
*Prepared for: National Load Despatch Centre (NLDC) / Regional Load Despatch Centres*
*Date: June 2026*

---

## 1. In one line

The **FTC Communication Portal** is a single, secure, web-based system that
tracks every generation project and transmission element across the Indian grid
— from connectivity clearance all the way to commercial operation — and replaces
the manually-maintained Excel workbook we depend on today.

---

## 2. Why do we need this? (The problem today)

The Load Despatch Centres are responsible for monitoring the commissioning of
new capacity entering the grid — when a power plant is first energised (**First
Time Charging**), when it clears trial operation (**Transfer of Charge**), and
when it goes commercial (**Commercial Operation Date**). This information feeds
national capacity-addition reporting and grid-planning decisions.

Until now, all of this has lived in a **single shared Excel workbook**
(`CONTD and FTC details.xlsx`). That approach has reached its limits:

- **No single source of truth.** The file is copied, emailed, and edited in
  parallel. Different people hold different "latest" versions, and reconciling
  them is manual and error-prone.
- **No access control.** Anyone with the file sees and can change *everything* —
  there is no way to give a regional centre control of only its own region while
  protecting the rest.
- **No history or accountability.** When a number changes, there is no record of
  *who* changed it, *when*, or *what the old value was*. Disputes over figures
  cannot be settled with evidence.
- **No safety net on the data.** A mistyped figure (e.g. declaring more
  commercial capacity than was ever charged) silently flows into reports. Excel
  does not understand the rules of our pipeline.
- **Manual roll-ups.** Region-wise and source-wise summaries are re-built by
  hand each time, which is slow and a frequent source of mismatch.
- **No "what changed since yesterday".** There is no reliable way to see the
  day-on-day movement in the pipeline without manually comparing two files.

In short: the data is **business-critical but ungoverned**. As the volume of
renewable and hybrid capacity entering the grid grows, the spreadsheet approach
is increasingly fragile.

---

## 3. What we built (The solution)

A purpose-built web portal that takes the seven tables from that Excel workbook
and turns them into an **authoritative, audited, role-controlled system**. The
core ideas:

**A. The commissioning pipeline, modelled correctly.**
Every project moves through the same funnel, and the system understands and
enforces it:

```
   CONTD-4 cleared ──► Applied for FTC ──► FTC approved ──► TOC issued ──► COD declared
   (connectivity)      (request raised)    (first charging)  (trial op.)   (commercial op.)
```

The natural rule **COD ≤ TOC ≤ FTC ≤ Applied** is enforced automatically — you
simply cannot enter an impossible figure. "Pending" at each stage is computed,
never typed by hand.

**B. Each centre sees and controls its own region.**
- **Administrator** and **NLDC** get the national, all-India view.
- Each **RLDC** (NRLDC / WRLDC / SRLDC / ERLDC / NERLDC) sees and edits **only
  its own region** — enforced on the server for every single request, not just
  hidden in the screen.

**C. Everything is summarised automatically.**
Region-wise, source-wise (Wind / Solar / BESS / Hybrid / Thermal etc.),
hybrid-component breakdown, transmission elements, and monthly COD reports are
all generated from the same underlying data. No more manual roll-ups, and the
figures always reconcile.

**D. A printable, shareable summary.**
A pixel-correct print/PDF view, automatically scoped to the viewer's region, for
circulating to stakeholders.

---

## 4. The benefits (Why management should care)

| Theme | Before (Excel) | Now (Portal) |
|---|---|---|
| **Single source of truth** | Many copies, manual merge | One live database, always current |
| **Access control** | All-or-nothing | Region-scoped, role-based, server-enforced |
| **Accountability** | No history | Full audit trail — who changed what, when, old → new |
| **Data quality** | Free-form typing | Validated against pipeline rules automatically |
| **Roll-ups** | Re-built by hand | Computed instantly, always consistent |
| **Change tracking** | Compare files manually | Daily snapshots + "what changed" between any two dates |
| **Awareness** | Email / phone | In-app notifications for key events |
| **Security** | A file anyone can open | Login, encryption, rate-limiting, lockout, hardened headers |

Concrete wins:

- **Trust in the numbers.** Validation, automatic computation, and a complete
  audit trail mean the figures going into national reports can be defended with
  evidence.
- **Faster reporting.** Summaries that took manual effort are now instantaneous
  and always reconcile across views.
- **Clear ownership.** Each region owns its data; NLDC retains the national
  oversight view — without anyone stepping on anyone else's data.
- **Visibility of movement.** Daily snapshots let us answer "what moved in the
  pipeline today / this week / this month" reliably.
- **Security posture.** The system has been through security hardening (VAPT
  remediation) and ships with login protection, rate-limiting, account lockout,
  and an automated security test suite.

---

## 5. How it works (Plain-English walkthrough)

1. **Log in.** Each user signs in with their own account (with a "not a robot"
   check). Accounts are created by the Administrator — there is no self-sign-up.
2. **Land on the Dashboard.** A set of tabs gives the national / regional
   picture: CONTD-4 study, FTC pipeline (region- and source-wise), hybrid
   breakdown, transmission elements, monthly COD, day-wise changes.
3. **Track a project.** As a plant progresses, the responsible RLDC records each
   milestone (FTC / TOC / COD). The portal validates it, updates every summary,
   and logs the change.
4. **Get notified.** Relevant centres receive in-app notifications for key
   events (new project, CONTD-4 clearance, FTC/TOC/COD milestones, transmission
   updates).
5. **See what changed.** The dashboard can compare any two days and highlight
   exactly what moved.
6. **Share.** A clean, branded print/PDF summary — scoped to the viewer's region
   — can be circulated to stakeholders.
7. **Migrate easily.** A built-in Excel import wizard brings existing workbook
   data into the system, so we are not starting from a blank slate.

---

## 6. Built to be reliable and safe

- **Modern, supported technology** (Next.js 15, React 19, PostgreSQL) — a
  mainstream, well-supported stack, not a one-off macro spreadsheet.
- **Security-first.** JWT-based login with HttpOnly cookies and refresh-token
  rotation, Google reCAPTCHA on login, per-IP and per-email rate limiting,
  5-strike account lockout, and a full set of security response headers.
- **Defence in depth.** Every input is validated both in the browser *and* again
  on the server; region access is re-checked on every read and every write.
- **Tested.** An automated end-to-end test suite (74 tests) covers login,
  role-based access, the dashboard, snapshot comparison, and API security —
  including deliberate cross-region access probes and injection-payload fuzzing.
- **Auditable by design.** Two append-only audit logs capture every project and
  transmission change; nothing is silently overwritten.

---

## 7. Where it stands today

The portal is **functionally complete and operational** for the core mission:

- All seven Excel `Summary` tables reproduced 1:1 and reconciled.
- Region-scoped access live for Admin, NLDC, and all five RLDCs.
- Audit trail, daily snapshots, day-wise diff, and notifications all in place.
- Security hardening completed (VAPT remediation).
- Recent enhancements: hybrid Including/Excluding bifurcation, financial-year
  activity filter, and a manual commissioning override for edge cases.

---

## 8. Future improvements (The roadmap)

Practical next steps, in rough priority order:

**Near term**
- **Scale-out readiness** — move rate-limiting / session state to a shared store
  (e.g. Redis) so the system runs across multiple servers for high availability.
- **Broader test coverage** — extend automated tests to data-entry (write) flows
  and add scheduled security scanning.
- **Snapshot automation** — a scheduled daily snapshot job so day-wise history
  is captured automatically without any manual step.

**Medium term**
- **Reporting & exports** — scheduled email digests, more export formats, and
  ready-made templates for the reports we produce regularly.
- **Analytics & trends** — charts showing capacity-addition trends over time, by
  region and source, and pipeline ageing (how long capacity sits at each stage).
- **Single sign-on (SSO)** — integrate with the organisation's central login so
  users don't manage a separate password.

**Longer term**
- **Integration** — link with upstream/downstream systems so milestone data
  flows in automatically instead of being keyed in.
- **Mobile-friendly views** — quick read-only access for leadership on the move.
- **Forecasting** — use the historical pipeline to project upcoming
  capacity additions.

---

## 9. The ask / takeaway

We have replaced a fragile, ungoverned spreadsheet with a **secure, audited,
single source of truth** for grid commissioning data — improving the
**trustworthiness, security, and speed** of information that feeds national
capacity reporting.

The foundation is built and operational. The roadmap above turns it from a
strong internal tool into a fully integrated, organisation-wide platform — and
that is where we recommend continued investment.

---

### One-slide summary (for the deck)

> **FTC Communication Portal** — replaces our shared Excel workbook for tracking
> grid commissioning (FTC → TOC → COD) with one secure, role-controlled,
> fully-audited web system.
>
> **Why:** the spreadsheet has no single source of truth, no access control, no
> history, and no validation — risky for business-critical national reporting.
>
> **Benefits:** trustworthy numbers, region-level ownership with national
> oversight, instant auto-reconciled summaries, daily change tracking, and a
> hardened security posture.
>
> **Next:** high-availability scale-out, richer analytics, SSO, and integration
> with upstream systems.

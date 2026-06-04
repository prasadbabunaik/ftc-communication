# FTC Communication Portal — User Guide

A practical guide to accessing the portal and the day-to-day flow of work, with
worked examples. The portal is the **First Time Charging (FTC) Communication
System** for the Load Despatch Centres — it tracks generation projects and
transmission elements from connectivity approval all the way to commercial
operation, and rolls everything up into region- and source-wise summaries.

---

## 1. Getting access & logging in

1. Open the portal URL in **Chrome** (or any modern browser).
2. On the **Login** screen, enter your **email** and **password**, complete the
   **"I'm not a robot"** check, and click **Sign in**.
3. Accounts are created for you by the Administrator — there is **no self
   sign-up**. If you don't have credentials or forgot your password, contact the
   Admin / NLDC.

Once signed in you land on the **Dashboard**, and the left sidebar gives you the
rest of the portal.

---

## 2. Who can do what (roles)

| Role | What they see | What they can do |
|---|---|---|
| **Administrator (ADMIN)** | All five regions | Everything — add/edit/delete any data, manage users, access control, back-date entries |
| **NLDC** | All five regions (national view) | Oversight, exports, administration (Access Control) |
| **RLDC** — NRLDC / WRLDC / SRLDC / ERLDC / NERLDC | **Only their own region** | Add and edit **their region's** generation & transmission data |

> A **RLDC user only ever sees and edits their own region.** NLDC/Admin see all
> regions and can filter to one using the **region dropdown** on the dashboard.

---

## 3. The core idea — the commissioning pipeline

Every generation project moves through the same funnel. The portal tracks **how
much capacity (MW)** has reached each stage:

```
   CONTD-4 issued ──► Applied for FTC ──► FTC approved ──► TOC issued ──► COD declared
   (connectivity)     (request raised)    (first charging)  (trial op.)   (commercial op.)
```

- **CONTD-4** — the connectivity / transmission clearance stage. A project is
  first *under CONTD-4 study*, then *CLEARED*.
- **Applied for FTC** — capacity the developer has requested to charge.
- **FTC approved** — capacity granted First Time Charging.
- **TOC issued** — capacity that has cleared trial operation.
- **COD declared** — capacity in commercial operation.

The natural rule (the system enforces it): **COD ≤ TOC ≤ FTC ≤ Applied.** You
can't declare more COD than you have TOC, etc.

**"Pending" columns** are simply the gaps: *FTC Pending* = Applied − FTC,
*TOC Pending* = FTC − TOC, *COD Pending* = TOC − COD.

### Sources and regions
- **Regions:** NR, WR, SR, ER, NER.
- **Sources (plant types):** Wind, Solar, BESS (battery), Coal, Hydro, PSP
  (pumped storage), and **Hybrids** (any combination, e.g. *Wind+Solar*,
  *Solar+BESS*, *Coal+BESS*).

### Source / Component (important concept)
A project is split into **Source / Component lanes**. A plain Solar plant has one
lane (*Solar*). A **hybrid** has several — e.g. a *Wind+Solar* plant has a
**Wind** lane and a **Solar** lane, each with its own FTC/TOC/COD. Inside each
lane, individual **milestones are recorded by date** ("150 MW on 30-Mar,
50 MW on 01-Apr").

> So: **Project → Source/Component (the "what") → dated milestone events (the
> "when").**

---

## 4. The screens (sidebar tour)

- **Dashboard** — the headline. Stat cards (Applied / FTC / TOC / COD totals) and
  tabs: *FTC Pipeline*, *CONTD-4 Study*, *Hybrid Breakdown*, *Source-wise*,
  *Transmission*, *FTC/TOC/COD Activity*, *Project Details*, *Day-wise Changes*.
- **CONTD-4 Applications** — projects under connectivity study.
- **FTC Tracker** — the working screen for entering FTC/TOC/COD per project.
- **Transmission** — transmission lines / ICTs under FTC.
- **Region-wise Breakup** / **Source-wise Breakup** — the full project-level
  contributor tables behind the summaries.
- **Bulk Import** — load many projects/elements at once from a spreadsheet.
- **Administration** (ADMIN/NLDC) — *User Management*, *Access Control*.
- **Settings**.

---

## 5. Common tasks, step by step

### A. Reading the Dashboard
1. The **stat cards** show All-India (or your region) totals for Applied, FTC,
   TOC, COD.
2. Use the **tabs** to switch views — e.g. *FTC Pipeline* shows Region × Source
   capacity; click a row's **View Breakup** to see the individual projects.
3. **Region dropdown** (NLDC/Admin): filter the whole dashboard to one region.
4. **"As on" date picker** (top-right): see the picture *as it stood on a past
   date* — handy for "what did we report last Friday?" (see task **H**).
5. The blue **"N changes recorded"** banner shows recent edits at a glance.

> **The dashboard always shows the portal's own calculation** — the live sum of
> the entered project data — not a copy of any external summary sheet.

### B. Record FTC / TOC / COD for a project — *the most common task*
**Example: IB Vogt Solar (NR) got 200 MW TOC issued on 27-Mar.**
1. Go to **FTC Tracker → Add Source / Component**.
2. In **Generating Station**, search and pick *IB VOGT SOLAR SEVEN…*. The picker
   list scrolls; type to filter by name, region, or capacity.
3. The form opens for that project's **Source lane(s)**. Under **TOC**, click
   **Add TOC Event**, enter **200** MW and date **27-Mar-2026**.
4. Click **Save**. Done — the dashboard and breakups update immediately.

> Recording commissioning data **automatically puts the project into the FTC
> pipeline** — its CONTD-4 status is independent (you do *not* need CONTD-4 to be
> cleared to record FTC). Projects not yet in the pipeline are tagged
> **"• new to FTC"** in the picker.

### C. Add a brand-new generating station (from the same screen)
**Example: a new station that isn't in the list yet.**
1. **FTC Tracker → Add Source / Component**.
2. Below the picker, click **"Not in the list? Create a new generating
   station"**.
3. Fill the **Create Generation Project** form: search the **station master
   list** (or type a new name), pick **Region**, choose the **Plant Type** by
   tapping the source chips (e.g. **Solar**, or **BESS + Coal** for a hybrid),
   enter **Total Capacity**, pooling station, etc. Save.
4. The new station is **auto-selected** and the FTC/TOC/COD form opens — record
   its data as in task **B**.

### D. Enter a HYBRID project (multiple sources)
**Example: AMPIN Energy Green Ten (NR) — Wind + Solar.**
1. When you add the project, select **both** *Solar* and *Wind* chips — the type
   resolves to **Hybrid (Wind+Solar)**.
2. In the FTC form it shows **two component lanes** — a **SOLAR** card (114.4 MW)
   and a **WIND** card (40.4 MW) — each with its own FTC/TOC/COD events.
3. On the project's detail page you'll see a **By Source / By Timeline** toggle:
   - **By Source** — each lane's Applied → FTC → TOC → COD.
   - **By Timeline** — every dated milestone in order, with a *Source* filter.

### E. Track a CONTD-4 application
1. **CONTD-4 Applications** lists projects under connectivity study (status
   *PENDING / RECEIVED*).
2. Record the capacity, application date, proposed FTC date, and the capacity
   *expected to complete this month*.
3. When connectivity is granted, the project is **CLEARED** and flows into the
   FTC pipeline.

### F. See what changed, and when (audit trail)
1. **Dashboard → Day-wise Changes tab → Change Log.**
2. It lists **every recorded change** — project created/edited/deleted,
   milestone events added/removed, transmission edits — **grouped by day**, with
   **who** did it, the **old → new** value, and the **timestamp**. Back-dated
   edits are tagged.
3. Use the **From / To** date pickers to widen the window.
4. Each project's detail page also has a **Phased Commissioning History** with an
   "Entered" timestamp per milestone.

### G. The date-range Activity view
**Example: "How much FTC/TOC/COD happened this month?"**
1. **Dashboard → FTC/TOC/COD Activity tab.**
2. Pick a **From / To** date range (defaults to the 1st of this month → today).
3. You get three totals (FTC / TOC / COD in that window) plus a Region × Source
   table, and **View Breakup** for the contributing projects.

### H. Point-in-time ("As on" a past date)
- Set the **"As on" date** (top-right of the dashboard / FTC tracker) to any past
  date to see exactly what the numbers were then. Milestones dated *after* that
  date are excluded. Clear it (or click **Today**) to return to live.

### I. Export & Print
- **Excel** (green icon) — full multi-sheet workbook (Summary, Region-wise,
  Source-wise, per-source detail, CONTD-4, Hybrid, Transmission).
- **Print / Save as PDF** (printer icon) — opens a clean print view. On that
  screen:
  - **Customize** — tick/untick which **tables** and which **columns** to
    include before printing (everything is on by default).
  - **Print / Save as PDF** — produces the document (the toolbar/controls don't
    appear in the output).
- The **View Breakup** drawers also have their own Excel / PDF download in the
  same clean style.

### J. Bulk import
- **Bulk Import** lets you upload many generation projects or transmission
  elements at once from a spreadsheet template, instead of entering them one by
  one. Each imported row is logged in the audit trail.

---

## 6. Rules the system enforces (so you don't have to worry)

- **COD ≤ TOC ≤ FTC ≤ Applied** at all times. If an edit would break this, the
  portal blocks it with a clear message (e.g. *"would leave COD greater than
  TOC"*).
- A milestone **only counts once its date arrives.** A 100 MW FTC dated next week
  won't show in today's totals — it appears on/after that date. (Set the "As on"
  date forward to preview it.)
- **Soft delete is reversible.** Deactivating a project hides it but keeps its
  history; it can be reactivated. Only an Admin can permanently delete — and even
  then the audit entry survives.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **FTC** | First Time Charging — the first energisation of capacity |
| **TOC** | Trial-operation milestone (issued after FTC, before COD) |
| **COD** | Commercial Operation Declaration — capacity in commercial service |
| **CONTD-4** | Connectivity / transmission clearance stage |
| **Applied** | Capacity the developer has requested for FTC |
| **Pending** | The gap to the next stage (Applied−FTC, FTC−TOC, TOC−COD) |
| **Source / Component** | A generation lane within a project (a hybrid has several) |
| **Milestone event** | A dated MW increment within a lane (e.g. "50 MW on 01-Apr") |
| **Pipeline** | A project that is being tracked for FTC/TOC/COD |
| **Expected (Jun'26)** | Capacity expected to commission within the target month |

---

*Tip: the two screens you'll use most are the **Dashboard** (to read the picture)
and the **FTC Tracker** (to enter FTC/TOC/COD). Everything else hangs off those.*

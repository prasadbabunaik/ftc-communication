// Shared print-preview shell for the CONTD-4 and FTC report exports.
//
// Matches the dashboard print view's UI (PrintSummaryClient): a slate-800
// toolbar (doc icon · "… As on <date>" · A3 note · Customize / Print / Close),
// a full-width white "Customize" bar with a bordered column-group box, a navy
// branded DocHeader, and navy table headers. The preview NEVER auto-downloads.
//
// The content sits in a fixed, independently scrollable region below the
// toolbar (no overlap; vertical + horizontal scroll) with a sticky table
// header. Column exclusion happens live: every <th>/<td> carries data-col; the
// Customize checkboxes toggle those columns' display, and hidden columns are
// excluded from the printout too.
//
// opts:
//   documentTitle   window/tab title
//   toolbarTitle    toolbar label (rendered as "<toolbarTitle> · As on <date>")
//   dateLabel       "As on" date string
//   header          { issuer, title, subtitle } for the navy DocHeader
//   page            { size:'A4'|'A3', orientation }
//   columns         [{ key, label, locked? }] — non-locked appear in the panel
//   initiallyHidden [key, ...] — columns hidden on open (from the page picker)
//   tableMinWidth   px min-width for the table (drives horizontal scroll)
//   tableHtml       the <table>…</table> markup (cells tagged data-col)
//   tableCss        report-specific extra table CSS
export function openPrintReport(opts) {
  const {
    documentTitle, toolbarTitle = 'Print Preview', dateLabel = '',
    header = {}, page = { size: 'A4', orientation: 'landscape' },
    columns = [], initiallyHidden = [], tableMinWidth = 1100,
    tableHtml = '', tableCss = '',
  } = opts;

  const hiddenSet = new Set(initiallyHidden);
  const checkboxes = columns
    .filter((c) => !c.locked)
    .map((c) => `<label><input type="checkbox" value="${esc(c.key)}" ${hiddenSet.has(c.key) ? '' : 'checked'} onchange="setCol(this.value,this.checked)"> <span>${esc(c.label)}</span></label>`)
    .join('');

  // Toolbar icons (inline SVG, matching the dashboard toolbar).
  const docIcon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';
  const gearIcon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>';
  const printIcon = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';

  const js = `
    var HIDDEN = ${JSON.stringify([...hiddenSet])};
    function setCol(key, show){
      var els = document.querySelectorAll('[data-col="'+key+'"]');
      for (var i=0;i<els.length;i++){ els[i].style.display = show ? '' : 'none'; }
    }
    function togglePanel(){
      var p = document.getElementById('cpanel');
      var b = document.getElementById('custBtn');
      var open = p.classList.toggle('open');
      if (b) b.classList.toggle('active', open);
    }
    function selectAll(show){
      var bx = document.querySelectorAll('#cpanel input[type=checkbox]');
      for (var i=0;i<bx.length;i++){ if(!bx[i].disabled){ bx[i].checked=show; setCol(bx[i].value, show); } }
    }
    window.onload = function(){ HIDDEN.forEach(function(k){ setCol(k,false); }); };
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(documentTitle)}</title>
    <style>
      @page { size: ${page.size} ${page.orientation}; margin: 12mm 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; height: 100%; font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; }
      body { background: #f1f5f9; }

      /* Toolbar — dashboard style (slate-800) */
      .toolbar { position: fixed; top: 0; left: 0; right: 0; height: 46px; z-index: 60; background: #1e293b; color: #fff;
        display: flex; align-items: center; gap: 10px; padding: 0 16px; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
      .tb-left { display: flex; align-items: center; gap: 8px; margin-right: auto; }
      .tb-left svg { width: 16px; height: 16px; color: #60a5fa; }
      .tb-title { font-size: 13px; font-weight: 600; }
      .tb-note { font-size: 11px; color: #94a3b8; }
      .tb-btn { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 6px;
        padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: #fff; }
      .tb-btn svg { width: 14px; height: 14px; }
      .tb-btn.cust { background: #475569; } .tb-btn.cust:hover { background: #64748b; } .tb-btn.cust.active { background: #2563eb; }
      .tb-btn.print { background: #2563eb; } .tb-btn.print:hover { background: #1d4ed8; }
      .tb-btn.close { background: #475569; } .tb-btn.close:hover { background: #64748b; }

      /* Customize bar — full-width white panel below the toolbar */
      .cpanel { position: fixed; top: 46px; left: 0; right: 0; z-index: 55; background: #fff;
        border-bottom: 1px solid #e2e8f0; box-shadow: 0 6px 16px rgba(0,0,0,.12); padding: 14px 20px;
        max-height: 70vh; overflow-y: auto; display: none; }
      .cpanel.open { display: block; }
      .cp-inner { max-width: 1280px; margin: 0 auto; }
      .cgroup { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
      .cg-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .cg-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
      .cg-link { border: 0; background: none; color: #2563eb; font-size: 11px; cursor: pointer; padding: 0 2px; }
      .cg-link:hover { text-decoration: underline; }
      .cg-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 2px 18px; }
      .cg-grid label { display: flex; align-items: center; gap: 8px; padding: 3px 2px; font-size: 12px; color: #334155; cursor: pointer; }
      .cg-grid input { accent-color: #2563eb; width: 14px; height: 14px; }
      .cp-note { font-size: 10px; color: #94a3b8; margin: 8px 0 0; }

      /* Scroll region + sheet */
      .content { position: fixed; top: 46px; left: 0; right: 0; bottom: 0; overflow: auto; }
      .sheet { background: #fff; width: max-content; min-width: 100%; margin: 0 auto; padding: 16px 20px; box-shadow: 0 1px 6px rgba(0,0,0,.12); }

      /* Navy branded DocHeader (dashboard) */
      .docheader { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
        border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 12px; }
      .dh-issuer { font-size: 8px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 2px; }
      .dh-title { font-size: 17px; font-weight: 900; color: #1e3a5f; line-height: 1.1; }
      .dh-sub { font-size: 12px; color: #475569; margin-top: 3px; }
      .dh-date { border: 1px solid #1e3a5f; border-radius: 4px; padding: 5px 12px; text-align: right; white-space: nowrap; }
      .dh-date-l { font-size: 8px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
      .dh-date-v { font-size: 12px; font-weight: 700; color: #1e3a5f; }

      /* Table — navy headers (dashboard) */
      table { border-collapse: collapse; width: 100%; min-width: ${tableMinWidth}px; font-size: 8.5px; }
      thead { position: sticky; top: 0; z-index: 2; }
      th, td { border: 1px solid #cbd5e1; padding: 3px 5px; vertical-align: middle; text-align: left; }
      thead th { background: #1e3a5f; color: #fff; font-weight: 700; text-align: center; font-size: 8px; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      td.c { text-align: center; } td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      ${tableCss}

      @media print {
        .toolbar, .cpanel { display: none !important; }
        .content { position: static; overflow: visible; }
        body { background: #fff; }
        .sheet { width: auto; min-width: 0; margin: 0; padding: 0; box-shadow: none; }
        table { min-width: 0; }
        thead { position: table-header-group; }
        tr { break-inside: avoid; }
      }
    </style></head><body>
    <div class="toolbar">
      <div class="tb-left">${docIcon}<span class="tb-title">${esc(toolbarTitle)} — As on ${esc(dateLabel)}</span><span class="tb-note">· ${page.size} ${page.orientation} recommended</span></div>
      <button class="tb-btn cust" id="custBtn" onclick="togglePanel()">${gearIcon} Customize</button>
      <button class="tb-btn print" onclick="window.print()">${printIcon} Print / Save as PDF</button>
      <button class="tb-btn close" onclick="window.close()">Close</button>
    </div>
    <div class="cpanel" id="cpanel">
      <div class="cp-inner">
        <div class="cgroup">
          <div class="cg-head"><span class="cg-title">Show columns</span>
            <span><button class="cg-link" onclick="selectAll(true)">Select all</button> · <button class="cg-link" onclick="selectAll(false)">Clear all</button></span>
          </div>
          <div class="cg-grid">${checkboxes}</div>
        </div>
        <p class="cp-note">Identifying columns are always included. Unchecked columns are excluded from the printout.</p>
      </div>
    </div>
    <div class="content"><div class="sheet">
      <div class="docheader">
        <div>
          <div class="dh-issuer">${esc(header.issuer || 'National / Regional Load Despatch Centre')}</div>
          <div class="dh-title">${esc(header.title || '')}</div>
          ${header.subtitle ? `<div class="dh-sub">${esc(header.subtitle)}</div>` : ''}
        </div>
        <div class="dh-date"><div class="dh-date-l">As on</div><div class="dh-date-v">${esc(dateLabel)}</div></div>
      </div>
      ${tableHtml}
    </div></div>
    <script>${js}</script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups for this site to open the print preview.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

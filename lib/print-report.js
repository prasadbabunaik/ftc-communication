// Shared print-preview shell for the CONTD-4 and FTC report exports.
//
// Opens a branded print-preview page in a new tab (like the dashboard print
// view) with a toolbar: Customize columns / Print-Save-as-PDF / Close. The
// preview NEVER auto-downloads. The content sits in a fixed, independently
// scrollable region below the toolbar (so the toolbar never overlaps the table
// and both vertical + horizontal scrolling work), with a sticky table header.
//
// Column exclusion happens live in the preview: every <th>/<td> carries a
// data-col="<key>" attribute; the Customize panel's checkboxes toggle those
// columns' display, and hidden columns are excluded from the printout too.
//
// opts:
//   documentTitle   window/tab title
//   toolbarLabel    left-hand label in the toolbar
//   page            { size: 'A4'|'A3', orientation: 'landscape'|'portrait' }
//   columns         [{ key, label, locked? }] — non-locked appear in the panel
//   initiallyHidden [key, ...] — columns hidden on open (from the page picker)
//   tableMinWidth   px min-width for the table (drives horizontal scroll)
//   bodyHtml        the .sheet inner markup (subtitle + table with data-col attrs)
//   tableCss        report-specific table CSS
export function openPrintReport(opts) {
  const {
    documentTitle, toolbarLabel,
    page = { size: 'A4', orientation: 'landscape' },
    columns = [], initiallyHidden = [], tableMinWidth = 1100,
    bodyHtml = '', tableCss = '',
  } = opts;

  const hiddenSet = new Set(initiallyHidden);
  const checkboxes = columns
    .filter((c) => !c.locked)
    .map((c) => `<label><input type="checkbox" value="${esc(c.key)}" ${hiddenSet.has(c.key) ? '' : 'checked'} onchange="setCol(this.value,this.checked)"> ${esc(c.label)}</label>`)
    .join('');

  const js = `
    var HIDDEN = ${JSON.stringify([...hiddenSet])};
    function setCol(key, show){
      var els = document.querySelectorAll('[data-col="'+key+'"]');
      for (var i=0;i<els.length;i++){ els[i].style.display = show ? '' : 'none'; }
    }
    function togglePanel(){ document.getElementById('cpanel').classList.toggle('open'); }
    function allCols(show){
      var bx = document.querySelectorAll('#cpanel input[type=checkbox]');
      for (var i=0;i<bx.length;i++){ if(!bx[i].disabled){ bx[i].checked = show; setCol(bx[i].value, show); } }
    }
    window.onload = function(){ HIDDEN.forEach(function(k){ setCol(k,false); }); };
  `;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(documentTitle)}</title>
    <style>
      @page { size: ${page.size} ${page.orientation}; margin: 8mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; height: 100%; font-family: Arial, Helvetica, sans-serif; color: #0f172a; }
      body { background: #f1f5f9; }
      .toolbar { position: fixed; top: 0; left: 0; right: 0; height: 46px; background: #1e293b; color: #fff;
        display: flex; align-items: center; gap: 10px; padding: 0 16px; z-index: 60; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
      .toolbar .tt { font-weight: 600; font-size: 13px; margin-right: auto; }
      .toolbar button { border: 0; border-radius: 6px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: #fff; }
      .toolbar .cust { background: #334155; } .toolbar .cust:hover { background: #475569; }
      .toolbar .print { background: #2563eb; } .toolbar .print:hover { background: #1d4ed8; }
      .toolbar .close { background: #64748b; } .toolbar .close:hover { background: #475569; }
      .cpanel { position: fixed; top: 50px; right: 12px; z-index: 59; width: 250px; max-height: 74vh; overflow-y: auto;
        background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 10px 12px; display: none; }
      .cpanel.open { display: block; }
      .cpanel h4 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #475569; }
      .cpanel label { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 12px; cursor: pointer; }
      .cpanel .row { display: flex; gap: 8px; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
      .cpanel .row button { flex: 1; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 5px; font-size: 11px; cursor: pointer; }
      .cpanel .row button:hover { background: #eef2f7; }
      .content { position: fixed; top: 46px; left: 0; right: 0; bottom: 0; overflow: auto; }
      .sheet { background: #fff; width: max-content; min-width: 100%; margin: 0 auto; padding: 14px 18px; box-shadow: 0 1px 6px rgba(0,0,0,.12); }
      .sub { font-size: 11px; color: #475569; margin: 0 0 10px; }
      table { border-collapse: collapse; width: 100%; min-width: ${tableMinWidth}px; }
      thead { position: sticky; top: 0; z-index: 2; }
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
      <span class="tt">${esc(toolbarLabel)}</span>
      <button class="cust" onclick="togglePanel()">Customize columns</button>
      <button class="print" onclick="window.print()">Print / Save as PDF</button>
      <button class="close" onclick="window.close()">Close</button>
    </div>
    <div class="cpanel" id="cpanel">
      <h4>Show columns</h4>
      ${checkboxes}
      <div class="row"><button onclick="allCols(true)">Show all</button><button onclick="allCols(false)">Hide all</button></div>
    </div>
    <div class="content"><div class="sheet">${bodyHtml}</div></div>
    <script>${js}</script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups for this site to open the print preview.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

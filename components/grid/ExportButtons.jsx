'use client';

import { FileSpreadsheet, Printer } from 'lucide-react';

/**
 * Inline Excel + PDF export controls. Used in page headers across the portal
 * so the icons stay visually consistent with the dashboard.
 *
 * Both endpoints accept an optional `asOf` query param for point-in-time
 * exports; pass the current asOf string when relevant.
 *
 * @param {object} props
 * @param {string} [props.asOf]   ISO date string (YYYY-MM-DD)
 * @param {('sm'|'md')} [props.size='md']  visual size — 'sm' fits inline next
 *                                          to a primary action button on
 *                                          dense pages like /ftc and /contd4.
 */
export function ExportButtons({ asOf = null, size = 'md' }) {
  const excelUrl = `/api/grid/export${asOf ? `?asOf=${asOf}` : ''}`;
  const printUrl = `/dashboard/print${asOf ? `?asOf=${asOf}` : ''}`;

  const btnSize = size === 'sm' ? 'size-9' : 'size-11';
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  return (
    <div className="flex items-center gap-2">
      <a
        href={excelUrl}
        download
        title="Download as Excel"
        aria-label="Download as Excel"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors`}
      >
        <FileSpreadsheet className={iconSize} />
      </a>
      <a
        href={printUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open print / PDF view"
        aria-label="Open print / PDF view"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors`}
      >
        <Printer className={iconSize} />
      </a>
    </div>
  );
}

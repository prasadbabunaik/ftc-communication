import { apiFetch } from '@/lib/api-fetch';

// Fire-and-forget: record a file download / print for the admin-only download
// log. Must never throw or delay the actual download, so failures are swallowed.
//   label  — what was downloaded, e.g. "FTC Tracker", "FTC/TOC/COD Activity"
//   format — 'XLSX' | 'PDF' | 'PRINT'
//   meta   — optional context string (region / date range / filters)
export function logDownload(label, format, meta = null) {
  try {
    apiFetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, format, meta }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

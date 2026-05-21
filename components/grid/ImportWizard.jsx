'use client';

import { useState, useRef, useTransition } from 'react';
import { read, utils } from 'xlsx';
import { bulkImportRows } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';
import { GovLoader } from '@/components/ui/gov-loader';
import { toast } from 'sonner';
import { Upload, AlertTriangle, CheckCircle, FileSpreadsheet } from 'lucide-react';

// ─── Column maps ─────────────────────────────────────────────────────────────

const GEN_COLS = {
  'Generating Station': 'name',
  'Pooling Station':    '__poolingStation',  // fuzzy-matched
  'Region':             '__region',
  'Generation Type':    '__plantType',
  'Capacity(MW)':       'totalCapacityMw',
  'Application Date':   'applicationDate',
  'Proposed FTC date':  'proposedFtcDate',
  'Capacity(MW) to be completed': 'capacityApr26Mw',
  'Issues if any':      'remarks',
};

const TX_COLS = {
  'Agency/Owner':       'agencyOwner',
  'Name of Line/ICT':   'elementName',
  'Type':               '__elementType',
  'RE/Non-RE':          '__isRe',
  'Voltage Rating(kV)': 'voltageRatingKv',
  'Capacity (MVA)':     'capacityMva',
  'Line length':        'lineLengthKm',
  'Date of First Time Energization': 'firstEnergyDate',
  'Pendig for FTC':     '__pendingFtc',
  'Pending for FTC':    '__pendingFtc',
  'Proposed FTC date if Pending': 'proposedFtcDate',
  'Reason for delay':   'remarks',
  'Any Otherremark':    'remarks',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fuzzyMatch(value, list, key) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return list.find((item) => {
    const k = String(item[key]).toLowerCase().replace(/[^a-z0-9]/g, '');
    return k === v || k.includes(v) || v.includes(k);
  }) ?? null;
}

function parseExcelDate(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return String(val);
}

function parseSheet(sheet, colMap) {
  const rows = utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((raw) => {
    const mapped = {};
    for (const [sheetCol, fieldName] of Object.entries(colMap)) {
      // Try exact then case-insensitive header match
      const val = raw[sheetCol] ?? raw[Object.keys(raw).find((k) => k.toLowerCase().includes(sheetCol.toLowerCase())) ?? ''] ?? '';
      if (fieldName) mapped[fieldName] = val;
    }
    return mapped;
  }).filter((r) => r.name || r.agencyOwner || r.elementName);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportWizard({ regions, plantTypes, poolingStations, lockedRegionId }) {
  const [step, setStep] = useState('upload'); // upload | review | done
  const [type, setType] = useState('generation');
  const [rawRows, setRawRows] = useState([]);
  const [mappedRows, setMappedRows] = useState([]);
  const [result, setResult] = useState(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef(null);

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const colMap = type === 'generation' ? GEN_COLS : TX_COLS;
      const parsed = parseSheet(sheet, colMap);

      // Attempt auto-resolution
      const resolved = parsed.map((row) => {
        const out = { ...row, _errors: [] };

        if (type === 'generation') {
          // Resolve region
          const region = lockedRegionId
            ? regions.find((r) => r.id === lockedRegionId)
            : fuzzyMatch(row.__region, regions, 'code');
          out.regionId = region?.id ?? null;
          if (!out.regionId) out._errors.push('region');

          // Resolve plant type
          const pt = fuzzyMatch(row.__plantType, plantTypes, 'label') || fuzzyMatch(row.__plantType, plantTypes, 'code');
          out.plantTypeId = pt?.id ?? null;
          if (!out.plantTypeId) out._errors.push('plantType');
          out.__plantTypeRaw = row.__plantType;

          // Resolve pooling station
          const ps = fuzzyMatch(row.__poolingStation, poolingStations, 'name');
          out.poolingStationId = ps?.id ?? null;
          if (!out.poolingStationId && row.__poolingStation) out._errors.push('poolingStation');
          out.__poolingStationRaw = row.__poolingStation;

          out.applicationDate = parseExcelDate(row.applicationDate);
          out.proposedFtcDate = parseExcelDate(row.proposedFtcDate);
        } else {
          const region = lockedRegionId
            ? regions.find((r) => r.id === lockedRegionId)
            : fuzzyMatch(row.__region, regions, 'code');
          out.regionId = region?.id ?? null;
          if (!out.regionId) out._errors.push('region');

          out.elementType = ['LINE','ICT','GT','ST'].includes(String(row.__elementType).toUpperCase())
            ? String(row.__elementType).toUpperCase()
            : 'LINE';
          out.isRe = String(row.__isRe).toUpperCase() === 'RE';
          out.pendingFtc = String(row.__pendingFtc).toLowerCase() === 'yes';
          out.firstEnergyDate = parseExcelDate(row.firstEnergyDate);
          out.proposedFtcDate = parseExcelDate(row.proposedFtcDate);
        }

        return out;
      });

      setRawRows(parsed);
      setMappedRows(resolved);
      setStep('review');
    };
    reader.readAsArrayBuffer(file);
  }

  function updateMapping(rowIndex, field, value) {
    setMappedRows((rows) =>
      rows.map((r, i) => {
        if (i !== rowIndex) return r;
        const updated = { ...r, [field]: value };
        updated._errors = updated._errors.filter((e) => e !== field.replace('Id', '').replace('Id', ''));
        // re-check
        if (field === 'regionId' && !value)         updated._errors = [...updated._errors, 'region'];
        if (field === 'plantTypeId' && !value)       updated._errors = [...updated._errors, 'plantType'];
        if (field === 'poolingStationId' && !value && updated.__poolingStationRaw) updated._errors = [...updated._errors, 'poolingStation'];
        return updated;
      })
    );
  }

  function handleImport() {
    const hasErrors = mappedRows.some((r) => r._errors.length > 0);
    if (hasErrors) {
      toast.error('Please resolve all highlighted mapping errors before importing.');
      return;
    }

    startTransition(async () => {
      const result = await bulkImportRows(type, mappedRows);
      setResult(result);
      setStep('done');
    });
  }

  if (step === 'done') {
    return (
      <div className="rounded-xl border bg-card p-8 text-center space-y-4">
        <CheckCircle className="size-12 text-emerald-500 mx-auto" />
        <h2 className="text-lg font-bold text-foreground">Import Complete</h2>
        <div className="flex gap-6 justify-center text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{result?.created ?? 0}</p>
            <p className="text-muted-foreground">Created</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{result?.failed ?? 0}</p>
            <p className="text-muted-foreground">Failed</p>
          </div>
        </div>
        {result?.errors?.length > 0 && (
          <div className="text-left bg-red-50 rounded-lg p-4 max-h-40 overflow-y-auto">
            {result.errors.map((e, i) => (
              <p key={i} className="text-xs text-red-700">{e.row}: {e.error}</p>
            ))}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => { setStep('upload'); setMappedRows([]); setResult(null); }}>
            Import More
          </Button>
          <Button asChild>
            <a href={type === 'generation' ? '/generation' : '/transmission'}>
              View {type === 'generation' ? 'Projects' : 'Elements'}
            </a>
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    const errorCount = mappedRows.filter((r) => r._errors.length > 0).length;

    return (
      <div className="space-y-4">
        {isPending && <GovLoader overlay size="page" theme="navy" label="Importing rows..." />}

        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground">{mappedRows.length} rows parsed</p>
            {errorCount > 0 && (
              <p className="text-sm text-amber-700 flex items-center gap-1.5 mt-0.5">
                <AlertTriangle className="size-4" />
                {errorCount} rows have unresolved mappings (highlighted in amber)
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('upload')}>Back</Button>
            <Button onClick={handleImport} disabled={errorCount > 0 || isPending}>
              Confirm Import ({mappedRows.length} rows)
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-card border-b sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                  {type === 'generation' ? (
                    <>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Region</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Plant Type</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Pooling Station</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">MW</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">App. Date</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Agency</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Region</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Type</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Voltage</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground">MVA</th>
                    </>
                  )}
                  <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mappedRows.map((row, i) => (
                  <tr key={i} className={`${row._errors.length > 0 ? 'bg-amber-50/60' : 'hover:bg-muted/10'} transition-colors`}>
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    {type === 'generation' ? (
                      <>
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className={`px-3 py-2 ${row._errors.includes('region') ? 'bg-amber-100' : ''}`}>
                          {row._errors.includes('region') ? (
                            <select
                              className="w-32 h-7 rounded border border-amber-400 bg-white text-xs px-1"
                              value={row.regionId ?? ''}
                              onChange={(e) => updateMapping(i, 'regionId', e.target.value)}
                            >
                              <option value="">-- select --</option>
                              {regions.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                            </select>
                          ) : (
                            regions.find((r) => r.id === row.regionId)?.code ?? '—'
                          )}
                        </td>
                        <td className={`px-3 py-2 ${row._errors.includes('plantType') ? 'bg-amber-100' : ''}`}>
                          {row._errors.includes('plantType') ? (
                            <select
                              className="w-40 h-7 rounded border border-amber-400 bg-white text-xs px-1"
                              value={row.plantTypeId ?? ''}
                              onChange={(e) => updateMapping(i, 'plantTypeId', e.target.value)}
                            >
                              <option value="">-- select --</option>
                              {plantTypes.map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
                            </select>
                          ) : (
                            <span>{plantTypes.find((pt) => pt.id === row.plantTypeId)?.label ?? row.__plantTypeRaw}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 ${row._errors.includes('poolingStation') ? 'bg-amber-100' : ''}`}>
                          {row._errors.includes('poolingStation') ? (
                            <div>
                              <p className="text-[10px] text-amber-700 mb-0.5">"{row.__poolingStationRaw}"</p>
                              <select
                                className="w-48 h-7 rounded border border-amber-400 bg-white text-xs px-1"
                                value={row.poolingStationId ?? ''}
                                onChange={(e) => updateMapping(i, 'poolingStationId', e.target.value)}
                              >
                                <option value="">-- select --</option>
                                {poolingStations
                                  .filter((ps) => !row.regionId || ps.regionId === row.regionId)
                                  .map((ps) => <option key={ps.id} value={ps.id}>{ps.name}</option>)}
                              </select>
                            </div>
                          ) : (
                            poolingStations.find((ps) => ps.id === row.poolingStationId)?.name ?? '—'
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">{row.totalCapacityMw}</td>
                        <td className="px-3 py-2">{row.applicationDate || '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{row.agencyOwner}</td>
                        <td className="px-3 py-2">{row.elementName}</td>
                        <td className={`px-3 py-2 ${row._errors.includes('region') ? 'bg-amber-100' : ''}`}>
                          {row._errors.includes('region') ? (
                            <select
                              className="w-32 h-7 rounded border border-amber-400 bg-white text-xs px-1"
                              value={row.regionId ?? ''}
                              onChange={(e) => updateMapping(i, 'regionId', e.target.value)}
                            >
                              <option value="">-- select --</option>
                              {regions.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
                            </select>
                          ) : (
                            regions.find((r) => r.id === row.regionId)?.code ?? '—'
                          )}
                        </td>
                        <td className="px-3 py-2">{row.elementType}</td>
                        <td className="px-3 py-2 font-mono">{row.voltageRatingKv || '—'}</td>
                        <td className="px-3 py-2 font-mono">{row.capacityMva || '—'}</td>
                      </>
                    )}
                    <td className="px-3 py-2">
                      {row._errors.length > 0
                        ? <span className="text-amber-700 font-semibold">Needs mapping</span>
                        : <span className="text-emerald-600">✓ Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="space-y-6">
      {/* Type selector */}
      <div className="flex gap-3">
        {['generation', 'transmission'].map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
              type === t
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-border hover:bg-muted'
            }`}
          >
            {t === 'generation' ? 'Generation Projects' : 'Transmission Elements'}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        className="rounded-xl border-2 border-dashed bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer p-12 text-center"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <FileSpreadsheet className="size-10 text-muted-foreground mx-auto mb-3" />
        <p className="font-semibold text-foreground">Drop Excel or CSV file here</p>
        <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />
      </div>

      {/* Column guide */}
      <div className="rounded-xl border bg-card p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Expected columns for {type === 'generation' ? 'Generation' : 'Transmission'} import
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(type === 'generation' ? GEN_COLS : TX_COLS).map((col) => (
            <span key={col} className="px-2 py-0.5 rounded bg-muted text-xs font-mono text-foreground">
              {col}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Headers don't need to match exactly — partial matches are attempted automatically.
          Any unresolved values can be mapped manually in the next step.
        </p>
      </div>
    </div>
  );
}

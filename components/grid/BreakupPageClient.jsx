'use client';

import { TabBreakdown } from '@/components/grid/TabBreakdown';

// Thin client wrapper that renders the FTC-pipeline breakdown inline (no
// modal) for the dedicated Source-wise / Region-wise sidebar pages.
//   activeTab='sourcewise' → source-wise layout default
//   activeTab='pipeline'   → region-wise layout default
// The in-view layout toggle still lets the user switch between Region-wise,
// Source-wise and Region × Source.
export function BreakupPageClient({ activeTab, projects, txElements }) {
  const isSource = activeTab === 'sourcewise';
  const title    = isSource ? 'Source-wise Pipeline' : 'Region-wise Pipeline';
  const subtitle = isSource
    ? 'CLEARED projects grouped by Source → Region — mirrors the "Source wise" sheet.'
    : 'CLEARED projects grouped by Region → Source — mirrors the NR / WR / SR / ER / NER sheets.';
  return (
    <div className="px-6 pt-3 pb-3 flex flex-col h-[calc(100vh-110px)] min-h-0">
      <TabBreakdown
        asPage
        activeTab={activeTab}
        projects={projects}
        txElements={txElements}
        titleOverride={title}
        subtitleOverride={subtitle}
      />
    </div>
  );
}

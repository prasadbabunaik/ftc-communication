// Region → States / UTs mapping for the five RLDC regions, used to scope the
// "State (situated)" dropdown on the BESS Data edit modal to the project's
// region. Region codes match GridRegion.code (NR / WR / SR / ER / NER).

export const REGION_STATES = {
  NR: [
    'Delhi', 'Haryana', 'Punjab', 'Rajasthan', 'Uttar Pradesh', 'Uttarakhand',
    'Himachal Pradesh', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh',
  ],
  WR: [
    'Gujarat', 'Maharashtra', 'Madhya Pradesh', 'Chhattisgarh', 'Goa',
    'Dadra & Nagar Haveli and Daman & Diu',
  ],
  SR: [
    'Andhra Pradesh', 'Telangana', 'Karnataka', 'Kerala', 'Tamil Nadu', 'Puducherry',
  ],
  ER: [
    'Bihar', 'Jharkhand', 'Odisha', 'West Bengal', 'Sikkim',
  ],
  NER: [
    'Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura',
  ],
};

// All states across every region (deduped, sorted) — the fallback list when a
// row's region is unknown or unmapped.
export const ALL_STATES = [...new Set(Object.values(REGION_STATES).flat())].sort((a, b) => a.localeCompare(b));

// States for a region code, or the full list when the code isn't one of the
// five regions (e.g. '—' / undefined).
export function statesForRegion(code) {
  return REGION_STATES[code] ?? ALL_STATES;
}

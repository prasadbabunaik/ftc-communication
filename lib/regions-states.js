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

// Island UTs run isolated grids (not part of a mainland RLDC region), so they
// aren't in REGION_STATES — but a project can still be situated there, so they
// belong in the complete national list.
const OTHER_UTS = ['Andaman & Nicobar Islands', 'Lakshadweep'];

// Every Indian State / UT (28 states + 8 UTs), deduped and sorted. This is the
// full list offered in the "State (situated)" dropdown.
export const ALL_STATES = [...new Set([...Object.values(REGION_STATES).flat(), ...OTHER_UTS])]
  .sort((a, b) => a.localeCompare(b));

// States for a region code, or the full list when the code isn't one of the
// five regions (e.g. '—' / undefined).
export function statesForRegion(code) {
  return REGION_STATES[code] ?? ALL_STATES;
}

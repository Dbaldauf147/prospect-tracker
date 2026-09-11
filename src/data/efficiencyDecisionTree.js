// The C&I efficiency decision tree the Efficiency Decision Tree page opens
// with, before anyone edits it.
//
// It does two jobs at once, which is why it's a tree and not a checklist: it
// sequences the TECHNICAL choices (what to fix, in what order) and gates the
// FINANCIAL ones (what gets funded, with whose money). The seven gates are the
// master flow; the detail under each is what the gate actually turns on.
//
// This is a template, not the truth. The page copies it into the user's
// settings on their first edit and every change after that is theirs — the
// payback bands in particular are conventions to calibrate against your own
// capital committee, not rules. "Reset to the template" brings this back.

export const EFFICIENCY_TREE_VERSION = 1;

export const DEFAULT_EFFICIENCY_TREE = {
  rootId: 'gate1',
  nodes: {
    // ── Gate 1 — is the action forced? ────────────────────────────────
    gate1: {
      id: 'gate1',
      kind: 'question',
      title: 'Gate 1 — Is the action forced?',
      detail: 'Compliance deadlines, safety findings, permit conditions and imminent equipment failure bypass the economics entirely. The only decision left is specification quality.\n\nThis is the single highest-leverage moment in the whole program: a like-for-like emergency replacement locks in the inefficiency for 15–25 years.',
      branches: [
        { id: 'b1', label: 'Yes — deadline, finding, permit or imminent failure', to: 'forcedSpec' },
        { id: 'b2', label: 'No — this is a choice', to: 'gate2' },
      ],
    },
    forcedSpec: {
      id: 'forcedSpec',
      kind: 'outcome',
      title: 'Forced — so execute now, but to spec',
      detail: '* Pull the pre-approved burnout spec for the asset class: motors, chillers, boilers, air compressors, cooling tower fill.\n* Do not let procurement default to the cheapest like-for-like match at 2 a.m.\n* No burnout spec on file for that class? Write it now — the next failure is the one it pays for.\n\nEfficiency here is won or lost in the 24 hours after the failure, not in a business case.',
      branches: [
        { id: 'b1', label: 'Spec is locked — carry on with the rest', to: 'gate2' },
      ],
    },

    // ── Gate 2 — do you have data? ────────────────────────────────────
    gate2: {
      id: 'gate2',
      kind: 'question',
      title: 'Gate 2 — Do you have the data?',
      detail: 'Minimum before ranking anything:\n* 24 months of utility bills WITH the rate structure, not just totals\n* interval data wherever it exists\n* a closed water balance — purchased water accounted for against evaporation, blowdown, process consumption, sanitary, irrigation and losses\n\nIf the balance doesn\'t close within roughly 10%, you have unmetered use or leaks — and that gap is usually the cheapest thing on site.\n\nIndustrial sites: submeter the big four separately — compressed air, steam, process cooling, refrigeration. Whole-plant billing hides everything.',
      branches: [
        { id: 'b1', label: 'Yes — bills, intervals and a closed balance', to: 'gate3' },
        { id: 'b2', label: 'No — or the balance won\'t close', to: 'dataFirst' },
      ],
    },
    dataFirst: {
      id: 'dataFirst',
      kind: 'outcome',
      title: 'Meter and reconcile before you rank anything',
      detail: '* Pull 24 months of bills with tariff detail and rebuild the rate structure.\n* Close the water balance. The unexplained gap is the first project, not a data problem.\n* Submeter compressed air, steam, process cooling and refrigeration.\n\nRanking measures off whole-plant billing produces a defensible-looking list that is wrong.',
      branches: [
        { id: 'b1', label: 'Data is in place', to: 'gate3' },
      ],
    },

    // ── Gate 3 — the measure hierarchy ───────────────────────────────
    gate3: {
      id: 'gate3',
      kind: 'question',
      title: 'Gate 3 — Which tier is this measure?',
      detail: 'Rank in this order, and don\'t skip up the list. Buying an efficient version of something you shouldn\'t be running at all is the most common expensive mistake in this work.',
      branches: [
        { id: 'b1', label: 'Tier 1 — eliminate', to: 'tier1' },
        { id: 'b2', label: 'Tier 2 — reduce demand at the point of use', to: 'tier2' },
        { id: 'b3', label: 'Tier 3 — recover', to: 'tier3' },
        { id: 'b4', label: 'Tier 4 — improve conversion efficiency', to: 'tier4' },
        { id: 'b5', label: 'Tier 5 — change the supply', to: 'tier5' },
      ],
    },
    tier1: {
      id: 'tier1',
      kind: 'outcome',
      title: 'Tier 1 — eliminate',
      detail: '* Leak surveys: compressed air, water, steam traps\n* Shut down idle equipment; correct schedules and setpoints\n* Eliminate once-through cooling\n* End inappropriate compressed air uses — blow-off, cooling, agitation\n\nTypically under one year payback, often under three months.',
      branches: [{ id: 'b1', label: 'Price it', to: 'gate4' }],
    },
    tier2: {
      id: 'tier2',
      kind: 'outcome',
      title: 'Tier 2 — reduce demand at the point of use',
      detail: '* Compressor discharge pressure reduction\n* Chilled water and hot water reset\n* Cooling tower cycles of concentration\n* Low-flow fixtures; irrigation controls\n* Process setpoint optimization; boiler blowdown control',
      branches: [{ id: 'b1', label: 'Price it', to: 'gate4' }],
    },
    tier3: {
      id: 'tier3',
      kind: 'outcome',
      title: 'Tier 3 — recover',
      detail: '* Heat recovery from compressors, flue gas and process streams\n* Condensate return\n* Water cascading — a clean effluent stream feeding a dirtier duty, e.g. RO reject to cooling tower makeup\n* Counterflow rinse water',
      branches: [{ id: 'b1', label: 'Price it', to: 'gate4' }],
    },
    tier4: {
      id: 'tier4',
      kind: 'outcome',
      title: 'Tier 4 — improve conversion efficiency',
      detail: '* VFDs; premium-efficiency motors\n* High-efficiency chillers and boilers\n* LED\n* Refrigeration compressor upgrades\n* Membrane treatment\n\nOnly once Tiers 1–3 have set the load this equipment has to serve.',
      branches: [{ id: 'b1', label: 'Price it', to: 'gate4' }],
    },
    tier5: {
      id: 'tier5',
      kind: 'outcome',
      title: 'Tier 5 — change the supply',
      detail: '* On-site generation; CHP\n* Thermal storage\n* Alternative water — rainwater, reclaimed, condensate capture, stormwater\n\nLast, because sizing supply against an unreduced load oversizes the asset permanently.',
      branches: [{ id: 'b1', label: 'Price it', to: 'gate4' }],
    },

    // ── Gate 4 — economics, priced properly ──────────────────────────
    gate4: {
      id: 'gate4',
      kind: 'question',
      title: 'Gate 4 — Is the economics priced properly?',
      detail: 'Two things break most efficiency business cases, and both are input errors rather than genuine failures of the measure: water priced off the tariff, and non-energy benefits left out.',
      branches: [
        { id: 'b1', label: 'Yes — loaded water cost and non-energy benefits are in', to: 'payback' },
        { id: 'b2', label: 'Not sure / priced off the posted tariff', to: 'waterPricing' },
      ],
    },
    waterPricing: {
      id: 'waterPricing',
      kind: 'outcome',
      title: 'Re-price water at its loaded cost',
      detail: 'Loaded cost = supply + sewer/discharge + pretreatment chemicals + pumping energy + heating or cooling energy + effluent surcharges + softening/RO operating cost.\n\n* For heated process water this runs three to ten times the posted $/kgal.\n* Sewer charges alone often exceed supply.\n* Evaporative losses never reach the sewer bill — so cooling tower savings and process savings have different effective values. Price them separately.',
      branches: [{ id: 'b1', label: 'Water re-priced', to: 'neb' }],
    },
    neb: {
      id: 'neb',
      kind: 'outcome',
      title: 'Count the non-energy benefits',
      detail: 'Reduced maintenance hours, extended equipment life, avoided chemical spend, scrap reduction, uptime, insurance, comfort-driven productivity. These frequently exceed the utility savings.\n\nIn an industrial setting, a measure justified purely on kWh will usually lose to one justified on kWh plus avoided downtime.',
      branches: [{ id: 'b1', label: 'Benefits are in the case', to: 'payback' }],
    },
    payback: {
      id: 'payback',
      kind: 'question',
      title: 'What\'s the payback, priced properly?',
      detail: 'Rough hurdle conventions — calibrate these to your own capital committee.\n\nUse lifecycle cost or NPV for anything long-lived, and build a marginal abatement cost curve if you\'re managing a multi-site portfolio: it makes the sequencing argument for you.',
      branches: [
        { id: 'b1', label: 'Under 2 years', to: 'pbFast' },
        { id: 'b2', label: '2 to 5 years', to: 'pbMid' },
        { id: 'b3', label: 'Over 5 years', to: 'pbSlow' },
      ],
    },
    pbFast: {
      id: 'pbFast',
      kind: 'outcome',
      title: 'Under 2 years — delegated authority',
      detail: 'Approve on delegated authority. No committee time.',
      branches: [{ id: 'b1', label: 'Check operational risk', to: 'gate5' }],
    },
    pbMid: {
      id: 'pbMid',
      kind: 'outcome',
      title: '2 to 5 years — bundle and stack',
      detail: '* Bundle with Tier 1 measures to blend the portfolio payback under the threshold.\n* Stack incentives before the price is fixed.',
      branches: [{ id: 'b1', label: 'Check operational risk', to: 'gate5' }],
    },
    pbSlow: {
      id: 'pbSlow',
      kind: 'question',
      title: 'Over 5 years — is there another driver?',
      detail: 'Park it in the register with a trigger date tied to asset end-of-life — unless something other than payback is carrying it.',
      branches: [
        { id: 'b1', label: 'Yes — emissions target, water risk, resilience, or third-party capital', to: 'gate5' },
        { id: 'b2', label: 'No', to: 'register' },
      ],
    },
    register: {
      id: 'register',
      kind: 'outcome',
      title: 'In the register, waiting on its trigger',
      detail: 'Trigger date tied to the asset\'s end-of-life. When the asset enters its replacement window this becomes a Gate 1 decision, and the burnout spec is what decides it.\n\nSo write that spec now, while there\'s time to think about it.',
      branches: [],
    },

    // ── Gate 5 — operational risk ────────────────────────────────────
    gate5: {
      id: 'gate5',
      kind: 'question',
      title: 'Gate 5 — What\'s the operational risk?',
      detail: 'Operations will veto anything that threatens throughput, and they\'re usually right to. Sort measures by what they need to be done.\n\nAnything touching process control gets piloted on one line first.',
      branches: [
        { id: 'b1', label: 'Can be done live', to: 'riskLive' },
        { id: 'b2', label: 'Needs a short outage', to: 'riskOutage' },
        { id: 'b3', label: 'Needs a turnaround', to: 'riskTurnaround' },
      ],
    },
    riskLive: {
      id: 'riskLive',
      kind: 'outcome',
      title: 'Can be done live',
      detail: 'Schedule it. Still pilot anything that touches process control on one line before it goes plant-wide.',
      branches: [{ id: 'b1', label: 'Find the money', to: 'gate6' }],
    },
    riskOutage: {
      id: 'riskOutage',
      kind: 'outcome',
      title: 'Needs a short outage',
      detail: 'Book the window with operations now, and bundle other work into the same outage so the line only stops once.',
      branches: [{ id: 'b1', label: 'Find the money', to: 'gate6' }],
    },
    riskTurnaround: {
      id: 'riskTurnaround',
      kind: 'outcome',
      title: 'Needs a turnaround',
      detail: 'Getting a slot in the next planned shutdown is usually the binding constraint — not money.\n\nWhich means the engineering has to be FINISHED 6–12 months before the window. Miss that and the measure waits a full cycle.',
      branches: [{ id: 'b1', label: 'Find the money', to: 'gate6' }],
    },

    // ── Gate 6 — funding route ───────────────────────────────────────
    gate6: {
      id: 'gate6',
      kind: 'question',
      title: 'Gate 6 — Which funding route?',
      detail: 'Apply for utility and efficiency-program incentives BEFORE purchase. Most programs disqualify retroactive applications, and custom-measure incentives typically require pre-approval with a savings calculation.',
      branches: [
        { id: 'b1', label: 'Self-funded capex (short payback)', to: 'fundSelf' },
        { id: 'b2', label: 'Capital-constrained site', to: 'fundThirdParty' },
        { id: 'b3', label: 'Leased commercial space', to: 'fundLeased' },
      ],
    },
    fundSelf: {
      id: 'fundSelf',
      kind: 'outcome',
      title: 'Self-funded capex',
      detail: 'Short paybacks fund themselves. File the incentive application before the purchase order anyway — retroactive applications are usually refused.',
      branches: [{ id: 'b1', label: 'Set up M&V', to: 'gate7' }],
    },
    fundThirdParty: {
      id: 'fundThirdParty',
      kind: 'outcome',
      title: 'Third-party capital',
      detail: '* Energy services agreements\n* Efficiency-as-a-service — off balance sheet, paid from savings\n* ESPC for the public sector and large campuses\n* On-bill financing where the utility offers it',
      branches: [{ id: 'b1', label: 'Set up M&V', to: 'gate7' }],
    },
    fundLeased: {
      id: 'fundLeased',
      kind: 'question',
      title: 'Leased space — does the lease allow recovery?',
      detail: 'In leased commercial space the split incentive is the real obstacle, not the technology. Green lease clauses and cost-recovery provisions come BEFORE the equipment decision.',
      branches: [
        { id: 'b1', label: 'Yes — clause or recovery provision is in place', to: 'gate7' },
        { id: 'b2', label: 'No — the lease blocks it', to: 'leaseBlocked' },
      ],
    },
    leaseBlocked: {
      id: 'leaseBlocked',
      kind: 'outcome',
      title: 'Blocked by the lease, not the technology',
      detail: 'Park the measure and open the lease conversation instead: a green lease clause at renewal, or a cost-recovery provision now. Revisit at the next lease event.',
      branches: [],
    },

    // ── Gate 7 — measure and verify ──────────────────────────────────
    gate7: {
      id: 'gate7',
      kind: 'question',
      title: 'Gate 7 — How will you measure and verify?',
      detail: 'Pick the IPMVP option that matches the measure, and decide it before the work starts — the baseline is only available beforehand.',
      branches: [
        { id: 'b1', label: 'Isolated retrofit with a clear boundary', to: 'mvAB' },
        { id: 'b2', label: 'Whole-facility work, 10%+ of the bill', to: 'mvC' },
        { id: 'b3', label: 'Needs a calibrated model', to: 'mvD' },
      ],
    },
    mvAB: {
      id: 'mvAB',
      kind: 'outcome',
      title: 'IPMVP Option A or B',
      detail: 'Option A where key parameters are measured and the rest stipulated; Option B where the isolated retrofit is measured in full. Draw the measurement boundary before the work starts.',
      branches: [{ id: 'b1', label: 'Check persistence', to: 'persistence' }],
    },
    mvC: {
      id: 'mvC',
      kind: 'outcome',
      title: 'IPMVP Option C — whole facility',
      detail: 'For work at 10%+ of the bill, where the saving is visible above the noise in the utility meter.',
      branches: [{ id: 'b1', label: 'Check persistence', to: 'persistence' }],
    },
    mvD: {
      id: 'mvD',
      kind: 'outcome',
      title: 'IPMVP Option D — calibrated simulation',
      detail: 'For measures you can neither isolate cleanly nor see at whole-facility level. It costs real money — budget for it up front rather than discovering it later.',
      branches: [{ id: 'b1', label: 'Check persistence', to: 'persistence' }],
    },
    persistence: {
      id: 'persistence',
      kind: 'outcome',
      title: 'Check persistence at 12 and 24 months',
      detail: 'Control-based and behavioral savings decay fast — setpoints get overridden, schedules get bypassed, leaks come back.\n\nA site that re-surveys compressed air leaks annually keeps the savings. One that surveys once loses roughly half of them within two years.',
      branches: [
        { id: 'b1', label: 'Re-survey scheduled — take the next measure', to: 'gate3' },
      ],
    },
  },
};

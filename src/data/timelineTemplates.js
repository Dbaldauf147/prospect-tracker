// Seed timeline templates for the Dropdowns → Timelines subtab.
//
// These ship as the starting vocabulary the same way DROPDOWN_LISTS seeds the
// Lists tab: they show until the user saves their own set, and the first edit
// on the page writes the whole array to settings.timelineTemplates (seeds
// included) so from then on the saved copy is the source of truth.
//
// The Budget timeline mirrors the standard FY budget engagement — the client
// signs and supplies inputs, Schneider Electric builds and delivers, and the
// client's fiscal year picks up the result.
//
// The Strategic Sourcing and Risk Management timelines are the two standard
// implementation plans, transcribed from the slides they're presented on:
// five milestones apiece, spaced along one line, each carrying the month
// window it runs in. They're phrased as the deck phrases them — this is the
// text that goes in front of a client — so the timing reads "Month 1 –
// Month 3" rather than a calendar date. Nothing here is dated until an
// engagement fixes month 1.
//
// Owners are the app's own addition: the slides don't name a side, so each
// step is marked by who actually does it, which is what colours its marker.

export const BUILTIN_TIMELINE_TEMPLATES = [
  {
    id: 'tl-budget',
    name: 'Budget timeline',
    format: 'gantt',
    // Placed by each stage's start / end dates, stated rather than inferred.
    positionMode: 'dates',
    services: ['Budgets'],
    stages: [
      {
        id: 'tl-budget-agreement',
        name: 'Agreement signed',
        owner: 'Client',
        timing: '7/31/2026',
        description: 'Client signs the SE statement of work.',
        icon: 'turbine',
      },
      {
        id: 'tl-budget-inputs',
        name: 'Inputs due',
        owner: 'Client',
        timing: '8/7/2026',
        description: 'Client provides required information to SE.',
        icon: 'handshake',
      },
      {
        id: 'tl-budget-build',
        name: 'Budget build',
        owner: 'Schneider Electric',
        timing: 'Aug–Sep 2026',
        description: 'SE builds EP, NG, and water budgets.',
        icon: 'laptop',
      },
      {
        id: 'tl-budget-delivery',
        name: 'Delivery',
        owner: 'Schneider Electric',
        timing: '9/25/2026',
        description: 'Site-level budgets delivered in Excel format.',
        icon: 'chart',
      },
      {
        id: 'tl-budget-fy',
        name: 'FY2027 begins',
        owner: 'Client',
        timing: 'Jan 2027',
        description: 'Budgets cover fiscal year Jan–Dec 2027.',
        icon: 'leaf',
      },
    ],
  },
  {
    id: 'tl-strategic-sourcing',
    name: 'Strategic Sourcing Implementation',
    subtitle: 'Building the procurement foundation to move quickly when market opportunities arise',
    // Evenly spaced milestones on one line, the way the slide draws them.
    format: 'milestone',
    services: [],
    stages: [
      {
        id: 'tl-sourcing-agreements',
        name: 'Review current supply agreements and expirations',
        owner: 'Schneider Electric',
        timing: 'Month 1',
        description: 'Identify upcoming contract expirations, \u201chot items,\u201d renewal notice requirements, and decisions that may require immediate action.',
        icon: 'turbine',
      },
      {
        id: 'tl-sourcing-first-wave',
        name: 'Prioritize 1st wave sourcing activity',
        owner: 'Both',
        timing: 'Month 1 \u2013 Month 2',
        description: 'Sequence sourcing events based on upcoming expirations, market opportunities, and your internal approval priorities.',
        icon: 'handshake',
      },
      {
        id: 'tl-sourcing-stakeholders',
        name: 'Align Stakeholders and Approval Processes',
        owner: 'Client',
        timing: 'Month 2 \u2013 Month 3',
        description: 'Establish governance protocols for approving load profiles, sourcing recommendations, executing supplier agreements.',
        icon: 'laptop',
      },
      {
        id: 'tl-sourcing-preferences',
        name: 'Capture Procurement Preferences in RA',
        owner: 'Schneider Electric',
        timing: 'Month 2 \u2013 Month 3',
        description: 'Document preferred contract terms, pricing structures, supplier considerations, green preferences, approval requirements, and other sourcing priorities.',
        icon: 'chart',
      },
      {
        id: 'tl-sourcing-readiness',
        name: 'Establish sourcing readiness requirements',
        owner: 'Both',
        timing: 'Month 1 \u2013 Month 3',
        description: 'Record invoice history, supply agreements, LOAs, utility data authorizations, contracting entity info (TAX ID/DUNS).',
        icon: 'leaf',
      },
    ],
  },
  {
    id: 'tl-risk-management',
    name: 'EP and NG Risk Management Implementation',
    subtitle: 'Building the governance, strategy, and reporting framework needed to execute a disciplined physical or financial hedging program',
    format: 'milestone',
    services: [],
    stages: [
      {
        id: 'tl-risk-governance',
        name: 'Define governance and decision authority',
        owner: 'Both',
        timing: 'Month 3 \u2013 Month 4',
        description: 'Establish stakeholders, approval thresholds, execution authorities, and communication protocols for natural gas hedge decisions.',
        icon: 'turbine',
      },
      {
        id: 'tl-risk-profile',
        name: 'Assess risk profile and objectives',
        owner: 'Both',
        timing: 'Month 3 \u2013 Month 4',
        description: 'Align on cost certainty goals, budget objectives, risk tolerance, hedge horizon, and acceptable market exposure.',
        icon: 'handshake',
      },
      {
        id: 'tl-risk-policy',
        name: 'Develop portfolio Risk Policy',
        owner: 'Schneider Electric',
        timing: 'Month 3 \u2013 Month 4',
        description: 'Document a common framework for evaluating and managing portfolio risks, enabling aligned decision-making and effective execution of the energy program.',
        icon: 'laptop',
      },
      {
        id: 'tl-risk-baseline',
        name: 'Establish portfolio baseline & counterparty framework',
        owner: 'Both',
        timing: 'Month 4 \u2013 Month 5',
        description: 'Gather existing hedge positions, counterparties, transaction history, and supporting documentation to create a complete view of current portfolio exposure and enable position reporting in Resource Advisor.',
        icon: 'chart',
      },
      {
        id: 'tl-risk-reporting',
        name: 'Implement position reporting & monitoring',
        owner: 'Schneider Electric',
        timing: 'Month 5 \u2013 Month 6',
        description: 'Establish a recurring forum to review strategy, positions, market developments, portfolio exposures, action plans, to enable informed decision-making and timely execution.',
        icon: 'leaf',
      },
    ],
  },
];

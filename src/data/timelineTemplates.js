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
// The Strategic Sourcing Process timeline is the sourcing cycle itself, off
// the process slide of the same name: the eight numbered steps that run an
// actual bid event, in the order the slide numbers them. It picks up where
// Strategic Sourcing Implementation leaves off — that one builds the
// procurement foundation through month 3, this one spends months 4–8
// using it — so the two read as one plan against a single month 1.
//
// The slide splits its steps between two tracks: Analysis, where we monitor
// markets and regulations to form insights, and Execution, where we quantify
// the opportunity and buy. That split rides along as each step's `phase`, so
// it survives if the timeline is redrawn in the implementation format, which
// is the one that bands its steps by group.
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
  {
    id: 'tl-sourcing-process',
    name: 'Strategic Sourcing Process',
    subtitle: 'Monitoring markets and tracking changes to inform buying recommendations',
    format: 'milestone',
    services: [],
    stages: [
      {
        id: 'tl-process-preferences',
        name: 'Review & prioritize procurement preferences',
        owner: 'Both',
        phase: 'Execution',
        timing: 'Month 4',
        description: 'Confirm the contract terms, product structures, green preferences, and approval requirements captured in Resource Advisor, and set the priorities this sourcing event is run against.',
        icon: 'document',
      },
      {
        id: 'tl-process-suppliers',
        name: 'Know supplier strengths and weaknesses',
        owner: 'Schneider Electric',
        phase: 'Analysis',
        timing: 'Month 4 \u2013 Month 5',
        description: 'Map which suppliers are competitive for the market, product, and load shape at hand \u2014 credit terms, pass-throughs, and service levels included \u2014 so the invitation list is built on fit rather than familiarity.',
        icon: 'people',
      },
      {
        id: 'tl-process-benchmarks',
        name: 'Define pricing benchmarks and product structures',
        owner: 'Schneider Electric',
        phase: 'Analysis',
        timing: 'Month 5',
        description: 'Set the benchmark each bid is measured against and the structures suppliers are asked to quote \u2014 fixed, index, block-and-index, layered \u2014 so the offers arrive comparable.',
        icon: 'dollar',
      },
      {
        id: 'tl-process-bid-tools',
        name: 'Utilize efficient & flexible bid tools',
        owner: 'Schneider Electric',
        phase: 'Execution',
        timing: 'Month 5 \u2013 Month 6',
        description: 'Run the event on the online bid platform, with suppliers quoting live against one common load profile and every structure priced inside the same window.',
        icon: 'laptop',
      },
      {
        id: 'tl-process-analyze-bids',
        name: 'Analyze bids against sourcing & risk strategy',
        owner: 'Schneider Electric',
        phase: 'Analysis',
        timing: 'Month 6 \u2013 Month 7',
        description: 'Score the live offers against the benchmark, the agreed risk tolerance, and the budget objective rather than on headline price alone.',
        icon: 'chart',
      },
      {
        id: 'tl-process-compare',
        name: 'Compare & determine most strategic solution',
        owner: 'Both',
        phase: 'Analysis',
        timing: 'Month 7',
        description: 'Put the shortlisted structures side by side and settle on the one that best meets the cost certainty, budget, and risk objectives set at kickoff.',
        icon: 'check',
      },
      {
        id: 'tl-process-refresh',
        name: 'Secure refreshed pricing from preferred supplier',
        owner: 'Schneider Electric',
        phase: 'Execution',
        timing: 'Month 7 \u2013 Month 8',
        description: 'Go back to the preferred supplier for a refreshed quote at the moment of execution \u2014 the market moves, and the offer signed has to be the one priced that day.',
        icon: 'handshake',
      },
      {
        id: 'tl-process-execute',
        name: 'Validate pricing, negotiate & execute deal',
        owner: 'Both',
        phase: 'Analysis',
        timing: 'Month 8',
        description: 'Validate the refreshed price against the benchmark, close the remaining contract terms, and execute the supplier agreement inside its acceptance window.',
        icon: 'target',
      },
    ],
  },
];

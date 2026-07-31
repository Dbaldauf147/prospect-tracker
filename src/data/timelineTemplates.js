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
];

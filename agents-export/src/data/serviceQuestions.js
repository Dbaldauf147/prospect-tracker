// Canned questions seeded into the Opportunity form's question tables when
// a service appears in "Scope Being Explored". These are the DEFAULTS — the
// Dropdowns → Questions subtab can override them per service (stored in
// settings.serviceQuestions / settings.serviceTheirQuestions), and the
// OpportunityForm seeding prefers an override when one exists.

// 'Questions to Ask Them' — a plain list of questions per service.
export const SERVICE_QUESTIONS = {
  'bill payment': [
    'Can you tell us a bit more about our current bill payment program?',
    'How many utility accounts are you managing each month?',
    "How often do you catch billing errors, and what's your process when you do?",
    'Have you ever been hit with late fees or service disruptions? How did that come about?',
    'What does your approval workflow look like, and where does it tend to get stuck?',
  ],
  'budgets': [
    'How do you build your energy budget today? Is it based on prior year actuals, a rate forecast, or something else?',
    "How do you account for weather variability, rate changes, or new sites when you're forecasting?",
    'How close did your actuals come to budget last year, and where were the biggest misses?',
    'How many reforecasts do you do per year?',
  ],
  'rate optimization': [
    'How often do you screen for new regulated rate opportunities?',
    'What kind of regulated rate savings have you seen over the past several years?',
  ],
  'microgrid advisor': [
    'Do they already have batteries in place? If so, where?',
    'What is their main objective they are trying to solve for?',
    "If they don't have batteries in place, what are they looking for? Just BESS or any sort of MG?",
    'How do they plan to fund?',
    'What is their lead time objective?',
  ],
};

// 'Questions They Might Ask' per service, paired with a suggested
// 'Our Response'. Responses may be blank — those rows seed the prompt but
// leave the answer for Dan to craft in the moment.
export const SERVICE_THEIR_QUESTIONS = {
  'bill payment': [
    { question: "What's your process for onboarding new sites or accounts?", response: '' },
    { question: 'Do you integrate with our ERP/AP system, or will we need to manually import data?', response: '' },
    { question: 'What does the approval workflow look like on our end — can we customize it?', response: '' },
    { question: 'How do you handle exceptions, disputes, and bills that fall outside normal parameters?', response: '' },
  ],
  'budgets': [
    { question: "What's your forecasting methodology, and how accurate have you been historically?", response: '' },
    { question: 'How do you handle weather normalization and rate volatility?', response: '' },
    { question: 'How do you factor in our operational changes — new sites, closures, expansions?', response: '' },
    { question: 'Can you model "what-if" scenarios for us?', response: '' },
  ],
  'rate optimization': [
    { question: 'Do you scan all sites and rate schedules?', response: "With our hunting license approach, we only go after utilities where we have a good chance of finding savings. You would not want to pay us to search where it doesn't make sense." },
    { question: 'How often do you scan for new rates?', response: '' },
    { question: "What's a typical savings percentage you find for companies like ours?", response: '' },
    { question: 'Who handles the actual rate switch — you or us?', response: '' },
  ],
};

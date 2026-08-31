import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { leadNameKey } from '../../utils/marketingLeadsImport';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';
import { setOppField, setOppBfoLink, loadOpps2Cache, loadOpps2FromFirestore, mergeOpps2Datasets } from '../../utils/opps2Store';
import { normalizeCompany as canonCompany } from '../../utils/companyNorm';
import { dbGet } from '../../utils/db';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import { getEffectiveServiceMetadata } from '../../data/serviceCatalog';
import { computeNewBfoOpps, computeNewBfoMissingData } from '../../utils/newBfoOpps';
import { computeCloseNotSoldOpps, hasBfoOppNameIndex, detectBfoUrl, resolveOppForRow } from '../../utils/closeNotSoldOpps';
import { BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY, BFO_ACTIVITY_EVENT } from '../../utils/bfoActivityStore';
import { buildActivityAddressLines } from '../../utils/activityAddressLines';
import { resolveSfUrl } from '../../utils/salesforceLeads';
import { loadCallRecords } from '../../utils/callRecordingsStore';
import { oppMeetingsFromRecords, withUnloggedGranolaMeetings } from '../../utils/granolaMeetings';
import { OppInfoModal } from '../OppsView2/OppsView2';
import styles from './AgentsView.module.css';
import {
  AGENTS_SETTINGS_KEY,
  AGENTS_SNOOZE_SETTINGS_KEY,
  AGENTS_RUN_INTERVAL_BUSINESS_DAYS,
  AGENTS_SNOOZE_DURATIONS,
  agentsDaysSinceRun,
  agentsDaysUntilDue,
  agentsLastRunMs,
  agentsSnoozeEndAt,
  agentsSnoozeRemainingLabel,
  agentsSnoozedUntilMs,
} from '../../utils/agentsRunReminder';
import { useAgentsRunDue } from '../../hooks/useAgentsRunDue';

// Manual BFO Opportunity tags the user picked for an email recipient
// (or meeting contact) that didn't auto-match an Opps-tab row. Keyed
// by lower-cased email (or meeting id when no contact email exists)
// so the next email to the same recipient re-uses the same tag.
const OVERRIDE_STORAGE_KEY = 'agents-bfo-overrides';
const IGNORED_EMAILS_STORAGE_KEY = 'agents-ignored-emails';
const IGNORED_MEETINGS_STORAGE_KEY = 'agents-ignored-meetings';
const HIDE_ACTIVITY_ON_DATE_STORAGE_KEY = 'agents-hide-activity-on-date';
// External recipient addresses the user has chosen to permanently
// exclude from the Sent emails table. Unlike IGNORED_EMAILS (one
// message at a time), this hides every current and future email sent
// to that recipient.
const EXCLUDED_RECIPIENTS_STORAGE_KEY = 'agents-excluded-recipients';
const AI_PROMPT_STORAGE_KEY = 'agents-ai-prompt';
const NEW_BFO_OPP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-new-bfo-opp';
const CLOSE_DATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-dates';
const AMOUNT_UPDATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-amount-updates';
const STAGE_CHANGE_PROMPT_STORAGE_KEY = 'agents-ai-prompt-stage-change';
const CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-not-solds';
const UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY = 'agents-ai-prompt-update-bfo-activity';
const BFO_PREP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-bfo-prep';
const IMPORT_MARKETING_LEADS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-import-marketing-leads';
const MARKETING_LEADS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-marketing-leads';
const MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY = 'agents-ai-prompt-marketing-lead-status-update';
const DUPLICATE_LEADS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-duplicate-leads';

// The BFO Activity page's "Leads" subtab (pasted Salesforce Leads
// printable view) persists under its own key in the same store. The
// Marketing Lead Status Update agent reads it to compare each lead's
// current Salesforce status against the Marketing Leads source of truth.
const BFO_LEADS_KEY = 'leads-current';

const DEFAULT_AI_PROMPT = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Choose the New Tast (green button) under the Activity menu on the righthand side of the screen.
3.  In the Subject box type in email, call, or meeting based on the second column of data (under Type) in this prompt.
4.  In the Due Date box enter todays date in the MM/DD/YYYY format.
5.  In the the Status box select completed.  IMPORTANT - THIS MUST NOT BE LISTED AS NOT STARTED.
6.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7.  Select the blue Save button without asking for my confirmation.
8.  Make sure this update does not save in the Up Comning & Overdue list.  If you see that Today this update shows there, go back in and update this to the Completed Status.
9.  Complete  these steps for the next BFO Address until all have been completed.
10.  Run through the whole list automatically and then report back the success of each one until they're all done.
11.  When that's completed, go further below to take the next steps. `;

const DEFAULT_AI_PROMPT_NEW_BFO_OPP = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Search the top BFO Account Name.  Click on that account name to open up the account page.
3. Click the New Guided Opportunity button.
4. Enter in the Project Name into the Project Name field.  DO NOT include the Project Line name into this field or the Local Project Name field.
5.  Then paste in the Local Project Name into the Local Project Name box and then click Next.  DO NOT include the Product Line in this box.
6. Select Sustainability on the menu list.
7. Click the + sign next to the relevant Product Line assocaited with this BFO Opportuntiy and enter in 80000 and then click Next.
8 . Answer this question as no "*1. Does the opportunity scope ONLY include Carbon Credit?
9. Next make the close date 150 days from today and then click Next.
10.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
11. On the next page click Create.  When you get to this step, dont ask me for permission to Create.  Just click create and continue until this process is done.
12. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_CLOSE_DATES = `1.  I am logged into BFO.  Open up this BFO page https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the Opportunity Names below, and then go to their corresponding CloseDateSorted or CloseDate column.  This should be the 5th column of the table.
3.  Then click the pencil button next to the close date and input the New Close Date value and press Enter.
4.  At the bottom of the screen you will then click the Save button.
5.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_AMOUNT_UPDATES = `1. Open up the BFO Address below.
2. Select Opportunity Lines which will open up a new tab.
3. On the new tab select the link below the Opportunity Line ID which should open a new tab.
4. Select the pencil icon next to the Unit Amount.
5. Enter in the Quoted Amount from this list provided below that corresponds with the BFO Address.
6. You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7. On the next page click Save.  When you get to this step, dont ask me for permission to Save.  Just click Save and continue until this process is done.
8. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_STAGE_CHANGE = `1.  Reference the BFO links below, and then update the opportunity to the New Stage listed.
2.  After selecting the new stage, click save to ensure the new stage is selected.
3.  Make sure to save the new stage status before proceeding with the next item.
4.  Repeat this process for all Opportunities listed below.`;

// Appended to the end of every prompt copy (and the Copy-all bundle) so
// the assistant finishes by re-pulling the BFO list into the BFO
// Activity tab. Editable + reset like the others.
const DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY = `1.  When you are on this page click the Printable View https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  A new tab will pop up, go to that tab and change the number of records to 250
3.  Copy all data in the table on that page starting with Account Name going all the way down to the bottom righthand corner of that table in the final row of data in the final column.
4.  Navigate to this website https://prospect-tracker-ashen.vercel.app/ and then paste the data from the previous page into the BFO Activity tab .`;

// Opps 2 Stage → expected BFO Sales Stage. When the BFO Activity tab's
// Sales Stage value for an opp doesn't match the expected stage for the
// Opps 2 stage on its joined row, the Stage Change prompt surfaces it
// with the expected BFO stage as the value the user should set BFO to.
const OPPS_STAGE_TO_BFO_STAGE = {
  'agreement sent': '6 - Negotiate to Win',
  'contracting': '5 - Prepare & Bid',
  'quoted': '5 - Prepare & Bid',
  'quoting': '4 - Influence and Develop',
  'qualifying': '4 - Influence and Develop',
  'lead': '3 - Qualify Opportunity',
};

const DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS = `1.  Reference the BFO links below.
2.  If the link's associated status is Lost, then click on the Competitors button and then select New
3.  In the Competitor Name enter the value from the Competition column below and mark the box below Winner as checked.
4.  Click the save button and then navigate back to the BFO link for this opportunity.
5.  When you are back on that page, update the opportunity to the stage Closed and then click the Select Closed Stage blue button.
6.  The Edit Dependencies menu, choose the 0 - Closed option.
7.  Then select the corresponding Status from the menu below.
8.  Then select the corresponding Reason from the menu below.
9.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_BFO_PREP = `1.  I am logged on to this website https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the BFO Opportunity names below.  My goal is to have you open their websites and copy and paste the BFO website Address to the BFO address table here on the Agents tab of this website https://prospect-tracker-ashen.vercel.app/ in the AI BFO Prep table.`;

// The one prompt that pulls INTO the tracker. Every other Marketing
// Leads prompt reads the leads already saved on the Contacts page, so a
// lead sitting in Salesforce but not in the tracker is invisible to all
// of them — this is what gets it in. Runs first in the bundle for that
// reason, and feeds the BFO Activity "Leads" subtab in the same pass
// (the Status Update + Duplicate Leads prompts compare against it).
const DEFAULT_AI_PROMPT_IMPORT_MARKETING_LEADS = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  Click Printable View. A new tab opens — go to that tab and set the number of records to 250 so the whole list is on one page.
3.  Copy the entire table, starting with the Name header and going down to the bottom right-hand corner of the last row.
4.  Navigate to https://prospect-tracker-ashen.vercel.app/, open the Contacts page and select the Marketing Leads subtab.
5.  Paste the copied table anywhere on that page (Ctrl+V / Cmd+V, not inside a cell). A column-mapping box opens: check that Name, Email, Job Title, Company, Status, Created Date, Last Lead Source, Owner, Country and Qualification Source Detail each point at the matching pasted column, then click Import.
6.  Leads already saved are skipped by email, so pasting the whole list is safe — only the new ones are added. If a message says leads were skipped because they match a hidden lead, report which ones rather than unhiding them.
7.  Go back to the printable view tab, copy the same table again, then on this website open the BFO Activity page, select the Leads subtab and paste it there. That feeds the Marketing Lead Status Update and Duplicate Leads prompts below, and any lead still missing from Marketing Leads is added there as you paste — the confirmation line names them.
8.  Report back how many leads were newly imported and their names. Anything imported now is NOT in the lists further down this bundle — those were captured before the import ran — so say so, and I will re-copy the prompts to pick the new leads up.`

const DEFAULT_AI_PROMPT_MARKETING_LEADS = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  For each lead listed below (by Name), click the lead's name in Salesforce to open their record page.
3.  Copy the record page's URL from the browser address bar.
4.  Paste that URL into the Salesforce Link cell for that lead in the table below (on the Agents tab of this website https://prospect-tracker-ashen.vercel.app/). It saves straight to the Marketing Leads subtab on the Contacts page, and the row drops off this list once the link is set.
5.  Repeat for every lead listed below.`;

const DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  For each lead listed below (by Name), find the matching lead in the Salesforce list and compare its Status in Salesforce against the Marketing Leads Status shown below. The Marketing Leads Status (from this website's Marketing Leads page) is the source of truth.
3.  If the two statuses already match, do nothing and move on to the next lead.
4.  If they differ, click the lead's Name to open their record page, go to the Assessment tab, set the Status to the Marketing Leads Status listed below, and Save.
5.  Repeat for every lead listed below.`;

const DEFAULT_AI_PROMPT_DUPLICATE_LEADS = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  Each lead listed below appears more than once on the Leads list — the same person with more than one Lead record — and at least one of those copies carries the wrong Status. Search the list by Name to find every copy (the name may be written "Last, First" on one and "First Last" on another).
3.  For each copy, compare its Status in Salesforce against the Marketing Leads Status shown below. The Marketing Leads Status (from this website's Marketing Leads page) is the source of truth.
4.  Open each copy whose Status differs, go to the Assessment tab, set the Status to the Marketing Leads Status, and Save. A copy that already agrees is left alone.
5.  Do NOT merge or delete any Lead record. When every copy carries the right status, report back the list of leads that have duplicate records, with each record's URL, so the duplicates can be merged by hand.
6.  Repeat for every lead listed below.`;


function readOverrides() {
  try {
    const raw = userLsGet(OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(next) {
  try { userLsSet(OVERRIDE_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredEmails() {
  try {
    const raw = userLsGet(IGNORED_EMAILS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredEmails(next) {
  try { userLsSet(IGNORED_EMAILS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredMeetings() {
  try {
    const raw = userLsGet(IGNORED_MEETINGS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredMeetings(next) {
  try { userLsSet(IGNORED_MEETINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readExcludedRecipients() {
  try {
    const raw = userLsGet(EXCLUDED_RECIPIENTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(a => String(a).toLowerCase()) : [];
  } catch {
    return [];
  }
}

function writeExcludedRecipients(next) {
  try { userLsSet(EXCLUDED_RECIPIENTS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readHideActivityOnDate() {
  try { return userLsGet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY) === '1'; } catch { return false; }
}

function writeHideActivityOnDate(on) {
  try { userLsSet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY, on ? '1' : '0'); } catch {}
}

// Which sub-tab of the Agents page is showing: 'automations' (the default
// activity/BFO agent tables) or 'prompts' (the saved Prompt Library).
// Persisted per user so the choice survives a reload.
const SUBTAB_STORAGE_KEY = 'agents-active-subtab';
function readActiveSubTab() {
  try {
    const raw = userLsGet(SUBTAB_STORAGE_KEY);
    return raw === 'prompts' ? 'prompts' : 'automations';
  } catch { return 'automations'; }
}
function writeActiveSubTab(tab) {
  try { userLsSet(SUBTAB_STORAGE_KEY, tab); } catch {}
}

// Seed content for the Prompt Library sub-tab. These show immediately so
// the user can copy them out of the box; they only persist to
// settings.savedPrompts once the user edits/adds/deletes something.
// Seeds added after the Prompt Library shipped. A library that's already
// the user's own never picks a new seed up on its own, so these are the
// ones merged into the list at render time (see savedPrompts below).
// Only genuinely new seeds belong here: an id listed here would come back
// for a user who deleted it long ago, which is why the original four
// aren't.
const LATE_SEED_IDS = ['seed-big-site-list-python'];

const DEFAULT_SAVED_PROMPTS = [
  {
    id: 'seed-contract-review',
    title: 'Contract Review',
    body: `Take the following energy contract documents and produce a FINAL Excel-ready dataset.

----------------------------------------
1) OUTPUT STRUCTURE (MANDATORY)
----------------------------------------
Create ONE ROW PER CONTRACT.

Columns MUST appear in this exact order:

Address | Customer | Commodity | Supplier | Product Type | Contract Name / Notes | Price | Coverage Start | Coverage End | Term | Number of Accounts | Annual Consumption

----------------------------------------
2) PRODUCT TYPE (NEW: REQUIRED)
----------------------------------------
For each contract, classify the Product Type using the rules below:

- Fixed:
  → Fully fixed price contracts (e.g., fixed $/kWh or $/MMBtu)

- Hedged:
  → Any hedge structure, including:
     - Percent of load hedges (e.g., 50% hedge)
     - Layered/structured hedges
  → MUST include hedge % in the label
     Example formats:
     - "Hedged – 50% Fixed"
     - "Hedged – 50% Fixed + 50% Floating" (if applicable)

- Variable / Index:
  → NYMEX + Adder, load-following, or market-based pricing

- Block / Slice:
  → Fixed volume contracts (if explicitly stated)

If unclear:
- Use best classification based on contract language
- If still unclear → "Other / Unspecified"

----------------------------------------
3) FULL ACCOUNT EXTRACTION (MANDATORY: NO PARTIAL LISTS)
----------------------------------------
For EACH contract, you MUST capture EVERY UNIQUE utility account number.

You must scan ALL sections of the document, including:
- Exhibit A / Pricing Attachments
- Account tables
- Service Location schedules
- Appendices / addenda
- Any column labeled:
  "Account Number", "Utility Account", "UDC Account", "LDC Account"

RULES:
1) Scan the ENTIRE document (all pages: do not stop early)
2) Extract account numbers exactly (preserve leading zeros)
3) De-duplicate to UNIQUE account numbers
4) Compute:
   - Number of Accounts = COUNT of UNIQUE account numbers

CRITICAL:
- If accounts repeat across rows → count only once
- Do NOT rely on "No. of Accounts" fields alone → independently verify
- If the table continues across pages → capture all rows before counting

----------------------------------------
4) DATA EXTRACTION + COMPLETION
----------------------------------------

Address:
- Use SERVICE ADDRESS (not billing HQ)
- Normalize across rows for same site

Customer:
- Exact legal entity name

Commodity:
- Electricity or Natural Gas

Supplier:
- Extract supplier entity

Contract Name / Notes:
- Short, clean descriptor (e.g., "50% Hedge RTT", "NG Fixed Renewal")

Price:
- Extract explicitly
- Electricity: $/kWh or ¢/kWh
- Gas: $/MMBtu or $/Ccf
- If missing → "N/A"

Coverage Start / End:
- Format MM/DD/YYYY
- If enrollment-based → estimate if clearly stated
- If unknown → "N/A"

Term:
- Calculate duration in months
- Format: "XX Months"
- If open-ended → "Open"

Annual Consumption:
- Extract or calculate:
   → Electricity = kWh
   → Gas = MMBtu or Ccf
- If monthly values exist → SUM to annual
- If partial → estimate clearly
- If not available → "N/A"

----------------------------------------
5) CRITICAL VALIDATION RULES
----------------------------------------

A. DO NOT MISS ROWS
- If a table spans multiple pages → treat as ONE continuous dataset

B. ACCOUNT RECONCILIATION
- Ensure:
   → Account count matches extracted unique accounts
   → No duplicates inflate totals

C. SITE CONSISTENCY
- For same Address:
   → Account counts and consumption must reconcile logically
   → Flag mismatches internally and correct

D. DO NOT COLLAPSE CONTRACTS
- Each contract stays its own row even if:
   → Same supplier
   → Same address
   → Same commodity

----------------------------------------
6) FORMATTING RULES
----------------------------------------

- Dates → MM/DD/YYYY
- Term → always include "Months"
- Consumption → include units
- Price → consistent formatting
- Missing values → "N/A"

----------------------------------------
7) OUTPUT REQUIREMENTS
----------------------------------------

Return:
1) FINAL Excel-ready table only
2) No commentary before or after
3) Ensure:
   → Product Type is populated for every row
   → Number of Accounts is accurate and complete

----------------------------------------

DATA:
[PASTE CONTRACT FILES OR TEXT HERE]`,
  },
  {
    id: 'seed-deep-research-site-list',
    title: 'Deep Research - Building a site list for a PC',
    body: `Populate the file attached in this project (or an Excel file with the standard schema below) with the detailed site/buildings that this company owns or operates.
Buildings can be owned or rented.
Ensure this is a global search. Please leverage the company website provided as well as other public sources of data about the company.
Include every kind of site the company operates (headquarters, offices, manufacturing plants, R&D, warehouses, etc.).
Include the zip / postal code for each site wherever it is available from public sources.
Provide the final deliverable in Excel format: in the template attached to this project.
Do this for {COMPANY_NAME}.
Name the column that classifies each building "Property Type" (not "Site Type"), and fill it for every row.
Property Type must match one of the following categories as closely as possible (controlled vocabulary: do not invent new categories):


University / College Campus
Industrial (Heavy Manufacturing)
Data Center
Hospital / Healthcare
Office - High-Rise
Shopping Mall / Retail Center
Multifamily High-Rise
Hotel / Lodging
Industrial (Light Manufacturing)
Industrial - Other
Mixed Use
Laboratory / R&D
Office - Mid-Rise
Multifamily Mid-Rise
Industrial Flex / R&D
Medical Office
Refrigerated Warehouse
School (K-12)
Senior Housing
Retail - Neighborhood Retail
BTR Residential
Retail - High Street
Office - Small (Low-Rise)
Retail - Other
Non-Refrigerated Warehouse
Multifamily Low-Rise
Restaurant (Full-Service)
Self-Storage (Climate Controlled)
Office Occupier
Retail - Outparcel
Restaurant (Quick-Service)
Self-Storage (Non-Climate Controlled)`,
  },
  {
    id: 'seed-big-site-list-python',
    title: 'Big Site List Python',
    body: `**Build a global site register for: \`{COMPANY_NAME}\`**
Company website: \`{URL — leave blank if you want me to find it}\`
Position as at: \`{DATE — default: today}\`

### 1. Scope

List every site this company owns, leases, operates or occupies, worldwide. Include all site
types: headquarters, offices, manufacturing plants, R&D and labs, warehouses and distribution
centres, data centres, retail, hotels, and any other property type the company holds.

Before you start, tell me which of these the company is, because it changes what "its sites" means:

- **An occupier** (manufacturer, retailer, services firm) — one register of the sites it uses.
- **A property owner or investment manager** (REIT, developer, fund) — TWO registers on separate
  tabs: (a) the investment portfolio it owns or manages, and (b) the corporate offices it occupies
  to run itself. Flag any office that sits inside a building the company owns.
- **An operator with franchisees** — mark which sites are company-operated vs franchised, or say
  plainly that the split isn't public.

### 2. Required columns

| Column | Notes |
|---|---|
| Site Name | As the company names it |
| Address | Street address |
| City | |
| State / Province | |
| Postal / ZIP Code | |
| Country | |
| Property Type | Must match the controlled vocabulary in rule 6 exactly |
| Owned / Leased | See rule 4 |
| Square Footage | See rule 5 |

Also add these supporting columns — they are what make the file auditable:

| Column | Notes |
|---|---|
| Site Type (Function) | What happens there, in the company's own words |
| Company's Own Type | The company's own facility label, kept verbatim — see rule 6 |
| Tenure Evidence | The specific disclosure behind the Owned/Leased value |
| Sq Ft Source | Where the area figure came from |
| Address Confidence | High / Medium / Unverified — see rule 3 |
| Status | Active / Under construction / Idled / Announced |
| Notes | Anything that affects how the row should be read |
| Source | The page or filing this row came from |

### 3. Accuracy rules — these matter more than completeness

- **Never invent an address or postal code.** If a company doesn't publish one, leave it blank
  and mark the row Unverified rather than guessing from the city.
- Grade every address: **High** = published by the company or confirmed in a named source;
  **Medium** = street address solid but postal code inferred from location; **Unverified** = not
  found. Highlight Unverified rows.
- Watch ambiguous postal formats. A bare five-digit code is used by the US, Germany, France, Spain
  and Italy — don't infer a country from it alone.
- If sources disagree, keep both, pick the more likely one, and say so in Notes.
- Reproduce obvious errors on the company's own site as published, with a flag — don't silently
  "correct" them.

### 4. Owned vs leased

Use only what's actually disclosed, and cite it in Tenure Evidence. Good sources, in order:

1. Item 2 (Properties) of a 10-K, which usually footnotes leased sites
2. Schedule III for REITs (owned only, aggregated by geography)
3. Annual reports, sustainability reports, investor decks

Where tenure isn't public — which is normal for offices, service centres and private companies —
write "Not disclosed" and say what would resolve it. Don't dress up an assumption as a fact.

### 5. Square footage

Use published figures only. If the company reports only a network total, put that on the summary
tab and leave the per-site column blank rather than dividing it up. Flag any figure that looks
wrong for the building described.

### 6. Property Type — controlled vocabulary

Property Type must match one of the following 32 values exactly. Do not invent new categories,
and do not reword them — the whole point is that registers for different companies stay
comparable.

> University / College Campus · Industrial (Heavy Manufacturing) · Data Center ·
> Hospital / Healthcare · Office - High-Rise · Shopping Mall / Retail Center ·
> Multifamily High-Rise · Hotel / Lodging · Industrial (Light Manufacturing) · Industrial - Other ·
> Mixed Use · Laboratory / R&D · Office - Mid-Rise · Multifamily Mid-Rise · Industrial Flex / R&D ·
> Medical Office · Refrigerated Warehouse · School (K-12) · Senior Housing ·
> Retail - Neighborhood Retail · BTR Residential · Retail - High Street ·
> Office - Small (Low-Rise) · Retail - Other · Non-Refrigerated Warehouse · Multifamily Low-Rise ·
> Restaurant (Full-Service) · Self-Storage (Climate Controlled) · Office Occupier ·
> Retail - Outparcel · Restaurant (Quick-Service) · Self-Storage (Non-Climate Controlled)

How to apply it:

- **Classify by dominant use, not by the company's leasing label.** Landlords tag almost every
  office tower "Mixed-Use, Retail" because there are shops on the ground floor. That's a marketing
  label. An office building with a coffee shop in the lobby is an office.
- **Keep the company's own label** in the "Company's Own Type" column. Where a company runs its own
  facility taxonomy — port location, production advantaged, dedicated or leased, select suites —
  that's operational or commercial information, not a property class, and it's worth preserving
  rather than flattening into this list.
- **Split offices by height**: High-Rise, Mid-Rise, or Small (Low-Rise), on floor count.
- **Reserve Mixed Use for genuine multi-component estates** — a campus or district with materially
  different uses — not for a single building with incidental retail.
- If a site genuinely straddles two categories, pick the dominant one and explain in Notes.
- Add a **Reference** tab listing all 32 values, and put a data-validation drop-down on the
  Property Type column pointing at it, so a non-approved value can't be typed in later.

### 7. Recently divested or closed sites

Put these on a separate "Excluded" tab with the transaction, date, buyer and source. Cached pages
and old profiles keep these alive long after they've gone, so an explicit exclusion list makes the
register auditable.

### 8. If the portfolio is large

If there are more than roughly 150 sites, don't try to research them one at a time. Instead:

1. Tell me the true site count up front and where a complete list does or doesn't exist.
2. Build the workbook with the schema, a summary tab of verified counts by country / region /
   type, and a notes tab.
3. Write me a **Python scraper** that extracts the full list from the company's own location
   directory and outputs the finished Excel in this schema. Requirements:
   - runs on Windows with \`py script_name.py\`
   - uses \`requests\` + \`beautifulsoup4\` + \`openpyxl\`
   - full browser headers, and automatic \`cloudscraper\` fallback if the site returns 403
   - a \`--max-pages\` or \`--max-hotels\` style flag for a quick test run
   - saves partial results to CSV periodically so an interrupted run isn't wasted
   - prints progress, and flags rows where parsing failed
   - **test the parser against representative markup before you give it to me**

### 9. Deliverable

A single Excel workbook containing:

- **Site Register** — the columns above, with autofilter and frozen header
- **Summary** — counts by country, type and tenure, as live formulas
- **Reference** — the 32 Property Type values, with a drop-down on the register bound to it
- **Excluded** — divested or closed sites (if any)
- **Notes & Sources** — method, every source used, key judgement calls, and an explicit list of
  what you could NOT verify

In your reply, lead with the two or three things I'd most want to know: how complete it is, the
biggest data gap, and anything surprising about the portfolio.`,
  },
  {
    id: 'seed-pe-portfolio-analysis',
    title: 'PE Portfolio Analysis',
    body: `https://docs.google.com/document/d/1WoypQRaFrowZ8cK-r_akA7PdgWS2wODoFTQq_XnZcp8/edit?tab=t.0`,
  },
];

// Toggleable columns on the Activity table (merged Sent emails + Called
// + Meetings), in render order. The Actions column is always shown and
// is not part of this list.
const ACTIVITY_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'type', label: 'Type' },
  { key: 'subject', label: 'Subject / Title' },
  { key: 'to', label: 'To (external)' },
  { key: 'company', label: 'Company' },
  { key: 'bfoCompanyName', label: 'BFO Company Name' },
  { key: 'bfoOpp', label: 'BFO Opportunity' },
  { key: 'lastActivity', label: 'Last Activity' },
  { key: 'bfoLink', label: 'BFO Link' },
  { key: 'outcome', label: 'Outcome / Status' },
  { key: 'location', label: 'Location' },
];
const ACTIVITY_COLUMN_KEYS = ACTIVITY_COLUMNS.map(c => c.key);
const ACTIVITY_COLS_STORAGE_KEY = 'agents-activity-hidden-cols';

// Read the set of hidden Activity-table column keys (persisted per user).
function readHiddenActivityCols() {
  try {
    const raw = userLsGet(ACTIVITY_COLS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(k => ACTIVITY_COLUMN_KEYS.includes(k)) : []);
  } catch { return new Set(); }
}

function writeHiddenActivityCols(set) {
  try { userLsSet(ACTIVITY_COLS_STORAGE_KEY, JSON.stringify([...set])); } catch {}
}

// Normalize a BFO Opportunity Name for matching the Opps tab's "BFO
// Link" value against the BFO Activity tab's "Opportunity Name" column:
// trim, lower-case, and collapse internal whitespace so a stray double
// space on either side doesn't drop the match.
function normalizeBfoOppName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Values an Opps "BFO Link" (BFO Opportunity Name) cell can hold that
// mean "no name yet" — a dash placeholder on new opps, #N/A on sheet
// imports. Neither counts as "already tagged". Mirrors the BFO Activity
// page so the two views agree on which opps still need a tag.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);

// The opp's BFO Opportunity Name, or '' when it holds only a blank
// placeholder. Use this everywhere we decide whether an opp is tagged.
function bfoOppNameOf(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// Readable label for an Opps opp shown as an assignment target — Scope
// plus Stage / Open Year context, falling back to the row id. Mirrors
// the BFO Activity page's oppTargetLabel.
function bfoOppTargetLabel(r) {
  const scope = String(r?.Scope || '').trim();
  const meta = [r?.Stage, r?.['Open Year']].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  const base = scope || `Opp ${r?._id}`;
  return meta ? `${base} (${meta})` : base;
}

function readAiPrompt() {
  try {
    const raw = userLsGet(AI_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT : raw;
  } catch {
    return DEFAULT_AI_PROMPT;
  }
}

function writeAiPrompt(next) {
  try { userLsSet(AI_PROMPT_STORAGE_KEY, next); } catch {}
}

function readNewBfoOppPrompt() {
  try {
    const raw = userLsGet(NEW_BFO_OPP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_NEW_BFO_OPP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_NEW_BFO_OPP;
  }
}

function writeNewBfoOppPrompt(next) {
  try { userLsSet(NEW_BFO_OPP_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseDatesPrompt() {
  try {
    const raw = userLsGet(CLOSE_DATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_DATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_DATES;
  }
}

function writeCloseDatesPrompt(next) {
  try { userLsSet(CLOSE_DATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readAmountUpdatesPrompt() {
  try {
    const raw = userLsGet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_AMOUNT_UPDATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_AMOUNT_UPDATES;
  }
}

function writeAmountUpdatesPrompt(next) {
  try { userLsSet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readStageChangePrompt() {
  try {
    const raw = userLsGet(STAGE_CHANGE_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_STAGE_CHANGE : raw;
  } catch {
    return DEFAULT_AI_PROMPT_STAGE_CHANGE;
  }
}

function writeStageChangePrompt(next) {
  try { userLsSet(STAGE_CHANGE_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseNotSoldsPrompt() {
  try {
    const raw = userLsGet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS;
  }
}

function writeCloseNotSoldsPrompt(next) {
  try { userLsSet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY, next); } catch {}
}

function readUpdateBfoActivityPrompt() {
  try {
    const raw = userLsGet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY : raw;
  } catch {
    return DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY;
  }
}

function writeUpdateBfoActivityPrompt(next) {
  try { userLsSet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY, next); } catch {}
}

function readBfoPrepPrompt() {
  try {
    const raw = userLsGet(BFO_PREP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_BFO_PREP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_BFO_PREP;
  }
}

function writeBfoPrepPrompt(next) {
  try { userLsSet(BFO_PREP_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readImportMarketingLeadsPrompt() {
  try {
    const raw = userLsGet(IMPORT_MARKETING_LEADS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_IMPORT_MARKETING_LEADS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_IMPORT_MARKETING_LEADS;
  }
}

function writeImportMarketingLeadsPrompt(next) {
  try { userLsSet(IMPORT_MARKETING_LEADS_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readMarketingLeadsPrompt() {
  try {
    const raw = userLsGet(MARKETING_LEADS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_MARKETING_LEADS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_MARKETING_LEADS;
  }
}

function writeMarketingLeadsPrompt(next) {
  try { userLsSet(MARKETING_LEADS_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readMarketingLeadStatusUpdatePrompt() {
  try {
    const raw = userLsGet(MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE : raw;
  } catch {
    return DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE;
  }
}

function writeMarketingLeadStatusUpdatePrompt(next) {
  try { userLsSet(MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readDuplicateLeadsPrompt() {
  try {
    const raw = userLsGet(DUPLICATE_LEADS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_DUPLICATE_LEADS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_DUPLICATE_LEADS;
  }
}

function writeDuplicateLeadsPrompt(next) {
  try { userLsSet(DUPLICATE_LEADS_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

// Small editable cell for the Marketing Leads agent's Salesforce Link
// column. Commits the trimmed value verbatim (a full record URL or a
// Lead id) — unlike BfoAddressCell it does NOT force an https:// prefix,
// so a bare Lead id round-trips intact.
function MarketingLeadSfCell({ value, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <input
      key={initial}
      type="text"
      defaultValue={initial}
      placeholder="Paste Salesforce record link…"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4, font: 'inherit',
      }}
    />
  );
}

// Pull the leading stage digit from BFO Sales Stage values like
// "6 - Negotiate to Win" / "4 - Influence and Develop". Same shape
// PipelineView.matchStage uses so the two views agree on what "Stage
// 5" means.
function bfoStageNumber(v) {
  const m = String(v ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Calendar days from today to the given date string (negative when the
// date is already in the past). Returns null when unparseable.
function daysUntilDate(raw) {
  if (!raw) return null;
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

// Add `days` to a date string and return the result in M/D/YYYY — the
// format BFO's inline Close Date editor expects.
function addDaysFormatted(raw, days) {
  if (!raw) return '';
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return '';
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// Strip currency symbols / commas / whitespace from an Amount-shaped
// cell and return a finite number, or null when the value is blank /
// non-numeric. Same shape DailySuccessManager.parseMoney uses so the
// two views agree on what "amount" means.
function parseMoneyNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Render a money number back as "$1,234" — used to format the Quoted
// Amount that the AI prompt copies into BFO.
function fmtMoney(n) {
  if (!Number.isFinite(n)) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

// "Did I send this?" is keyed off the per-user work email on HubSpot,
// not the Google auth address — the user signs in (e.g.) with a Gmail
// address but HubSpot threads always carry the @se.com from-address.
// Stored per-user in userSettings.workEmail, set via the CDM Name modal.

// Extract every email-shaped token from an Opps "Contact" cell, which
// can hold a single email, a name + email pair, or a comma/semicolon
// list of either.
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g;

function readActivityCache() {
  try {
    const raw = userLsGet(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// detectBfoUrl (the Opps "BFO Address" → Salesforce link resolver) lives
// in utils/closeNotSoldOpps.js, shared with the Issues-tab detector.

// A BFO field counts as "missing" when it's blank, "-", or an "#N/A"
// variant — the same placeholders Opps 2 uses for "no value yet".
function bfoFieldBlank(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

// Inline editor for the BFO Address in the AI BFO Prep table. Uncontrolled
// and keyed on the stored value (so an external refresh / the row dropping
// off the list remounts it cleanly). Commits on blur / Enter; Escape
// reverts. A bare host like "se.bfo.com/x" is prefixed with https:// so it
// registers as a URL downstream (detectBfoUrl expects an http(s) link).
function BfoAddressCell({ value, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    let next = el.value.trim();
    if (next && !/^https?:\/\//i.test(next)) next = `https://${next}`;
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <input
      key={initial}
      type="text"
      defaultValue={initial}
      placeholder="Paste BFO website address…"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4, font: 'inherit',
      }}
    />
  );
}

// Phone-touch detection for the Next Steps column — matches "call",
// "called", "calls", "calling", any "voicemail", and "left a vm" / "left
// vm". Shared by detectNextStepsType (email-table Type cell) and the
// Called-today section so both use identical wording rules.
const CALLED_NEXT_STEPS_RE = /\b(call(ed|s|ing)?|voicemail|left\s+(?:a\s+)?vm)\b/i;

// "called" if the Next Steps text mentions a phone touch, otherwise
// the row reflects the email cadence and we tag it as "email".
function detectNextStepsType(rawOpp) {
  const text = String(rawOpp?.['Next Steps'] || '');
  if (CALLED_NEXT_STEPS_RE.test(text)) return 'called';
  return 'email';
}

// Normalize an arbitrary date string into YYYY-MM-DD. Mirrors the
// helper OppsView2 uses so a date parsed there parses the same way
// here. Returns '' if the value isn't a date.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Business days between the Opps "Last Client Heard From Us" date and
// the supplied reference date (defaults to today) — same formula
// OppsView2 uses for its computed "Last Spoke" column. Returns null
// when the field is empty or unparseable.
function lastSpokeBusinessDays(rawOpp, referenceIso) {
  const iso = toISODate(rawOpp?.['Last Client Heard From Us']);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const ref = referenceIso ? parseIsoDate(referenceIso) : new Date();
  ref.setHours(0, 0, 0, 0);
  if (ref <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < ref) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

// Whole calendar days from today to an ISO/parseable date (negative when
// the date is in the past). Mirrors Opps 2's daysFromToday so a Call In
// resolved here matches what the Opps 2 tab shows.
function daysFromTodayAgents(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Resolve an opp's Call In the way Opps 2 does: a blank sentinel stored
// under "Call In" means "no call in"; otherwise compute live from the
// Follow Up date; otherwise fall back to a stored numeric Call In.
// Returns null when there's no resolvable value (i.e. Call In is blank).
function resolveOppCallIn(row) {
  if (row && 'Call In' in row) {
    const s = String(row['Call In'] ?? '').trim().toLowerCase();
    if (s === '' || s === '-' || s === '#n/a' || s === 'n/a') return null;
  }
  const live = daysFromTodayAgents(row?.['Follow Up']);
  if (live != null) return live;
  if (row && 'Call In' in row) {
    const n = parseFloat(String(row['Call In'] ?? '').replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Stages that mean the opp is closed (no longer live).
const CLOSED_OPP_STAGES = new Set(['sold', 'not sold']);

function boundsForDate(iso) {
  const d = parseIsoDate(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// The most recent business day strictly before `date` (skips Sat/Sun).
function previousBusinessDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

// ISO (YYYY-MM-DD) of the previous business day before the given ISO date.
function previousBusinessDayIso(iso) {
  const d = previousBusinessDay(parseIsoDate(iso));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Millisecond window spanning the reference date PLUS the previous
// business day — the "past 2 business days" the Activity sections
// (Sent emails / Called opps) scope to.
function boundsForActivityWindow(iso) {
  const ref = parseIsoDate(iso);
  const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime() + 24 * 60 * 60 * 1000;
  const prev = previousBusinessDay(ref);
  const start = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate()).getTime();
  return { start, end };
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d)) return '-';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

function externalRecipientList(toRaw) {
  return splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
}

// Normalize a company name for fuzzy matching against BFO Account
// Name. Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes,
// strip punctuation, collapse whitespace. Same shape ActivityView and
// MyAccountsView use so a name that matches there matches here too.
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose status key for comparing a Marketing Lead's Status against the
// Leads subtab's Status. Lower-cases and strips everything but letters
// and digits so hyphen/en-dash/spacing differences ("Closed-Recycle" vs
// "Closed–Recycle", "1 - New" vs "1 – New") don't read as a mismatch.
function leadStatusKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Best-effort company guess from a recipient's email domain — used
// only when neither an Opps-tab row nor a HubSpot contact carries a
// company so the Company column doesn't render empty.
function domainCompanyGuess(addr) {
  if (!addr) return '';
  const at = String(addr).lastIndexOf('@');
  if (at < 0) return '';
  return String(addr).slice(at + 1)
    .replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

function OppPicker({ oppsCache, onSelect, triggerLabel = '+ Pick opportunity', company = '' }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  // The dropdown is rendered in a portal with fixed positioning so it
  // floats above the page instead of being clipped by the table's
  // horizontal-scroll wrapper (which previously cut it off at the
  // bottom edge of the table). Position is measured from the input.
  const [menuPos, setMenuPos] = useState(null);

  const matches = useMemo(() => {
    if (!oppsCache?.records?.length) return [];
    // With no search term and a company in context, default to that
    // company's opportunities only — so editing a row's tag shows the
    // BFO opps for that company first. Typing searches across all opps.
    if (!term.trim() && company) {
      return oppsCache.records
        .filter(r => companiesMatch(String(r['Account'] || ''), company))
        .slice(0, 50);
    }
    return searchOpps(oppsCache, term).slice(0, 12);
  }, [oppsCache, term, company]);

  // Recompute the fixed-position coordinates from the input's rect,
  // flipping above the field when there isn't room below it.
  const updatePosition = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const MENU_MAX = 260;
    const GAP = 2;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < MENU_MAX + GAP && rect.top > spaceBelow;
    setMenuPos({
      left: rect.left,
      width: rect.width,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
      maxHeight: Math.min(MENU_MAX, Math.max(120, (flipUp ? rect.top : spaceBelow) - GAP - 4)),
    });
  };

  // Measure once the input mounts, then keep the menu pinned to the
  // input as the user scrolls or resizes the window.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onMove = () => updatePosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Close on outside click. The menu lives in a portal, so check both
  // the trigger wrapper and the floating menu before closing.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pickerTrigger}
        onClick={() => setOpen(true)}
        disabled={!oppsCache?.records?.length}
        title={oppsCache?.records?.length ? 'Search Opps for a matching opportunity' : 'Open the Opps tab to load the cache'}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={styles.pickerWrap}>
      <input
        autoFocus
        className={styles.pickerInput}
        placeholder={company ? `Showing ${company}: type to search all opps…` : 'Search opps by account, BFO link, or contact…'}
        value={term}
        onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTerm(''); } }}
      />
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.pickerMenu}
          style={{
            position: 'fixed',
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
            maxHeight: menuPos.maxHeight,
          }}
        >
          {matches.length === 0 ? (
            <div className={styles.pickerEmpty}>
              {!term.trim() && company
                ? `No opportunities found for ${company}. Type to search all opps.`
                : 'No matching opps. Try a different search term.'}
            </div>
          ) : matches.map((opp, i) => {
            const bfoOpp = opp['BFO Link'] || '(no opportunity name)';
            const account = opp['Account'] || '';
            return (
              <button
                key={i}
                type="button"
                className={styles.pickerOption}
                onClick={() => { onSelect(opp); setOpen(false); setTerm(''); }}
              >
                {bfoOpp}
                {account && <span className={styles.pickerOptionAccount}>{account}</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Editable BFO Company Name cell for the New BFO Opp table. When a Table
// View company matches the opp's account, the value is an editable input
// that writes straight back to that company's `bfoCompanyName` (so it
// ties to the Table View / Opps 2). With no match there's nowhere to
// store it, so it stays a read-only dash with a hint.
function NewBfoCompanyNameCell({ prospect, value, onCommit }) {
  if (!prospect) {
    return (
      <td
        className={styles.muted}
        title="No Table View company matches this account. Add the company on the Table View first to store a BFO Company Name."
      >-</td>
    );
  }
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <td>
      <input
        key={initial}
        type="text"
        defaultValue={initial}
        placeholder="Enter BFO Company Name…"
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '2px 5px',
          border: '1px solid transparent', borderRadius: 4, font: 'inherit',
          background: 'transparent', color: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid var(--color-border)'; }}
        onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = '1px solid transparent'; }}
      />
    </td>
  );
}

// Prompt Library sub-tab: a simple store of reusable AI prompts the user
// can title, edit, and copy with one click. Prompts persist through
// settings.savedPrompts (Firestore-backed, so they sync across devices);
// until the user touches anything, DEFAULT_SAVED_PROMPTS is shown.
function PromptLibrary({ prompts, onChange }) {
  // editingId: a prompt id being edited, 'new' for the add form, or null.
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [copyFlashId, setCopyFlashId] = useState(null);
  const [query, setQuery] = useState('');
  // Prompt bodies are hidden by default — the library is a pick-and-copy
  // list, so a wall of prompt text just gets in the way. Each id in this
  // set has been expanded via its "Show" toggle.
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const toggleExpand = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Reorder a prompt within the saved list by swapping it with its
  // neighbor, then persist the new order via onChange. Only offered when
  // no search filter is active (moving within a filtered subset would be
  // ambiguous about where the item lands in the full list).
  const move = (id, dir) => {
    const idx = prompts.findIndex(p => p.id === id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= prompts.length) return;
    const next = prompts.slice();
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    onChange(next);
  };

  const startNew = () => { setEditingId('new'); setDraftTitle(''); setDraftBody(''); };
  const startEdit = (p) => { setEditingId(p.id); setDraftTitle(p.title); setDraftBody(p.body); };
  const cancel = () => { setEditingId(null); setDraftTitle(''); setDraftBody(''); };

  const save = () => {
    const title = draftTitle.trim() || 'Untitled prompt';
    const body = draftBody;
    if (editingId === 'new') {
      const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      onChange([...prompts, { id, title, body }]);
    } else {
      onChange(prompts.map(p => (p.id === editingId ? { ...p, title, body } : p)));
    }
    cancel();
  };

  const remove = (id) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this saved prompt?')) return;
    onChange(prompts.filter(p => p.id !== id));
    if (editingId === id) cancel();
  };

  const copy = async (p) => {
    try {
      await navigator.clipboard.writeText(p.body);
      setCopyFlashId(p.id);
    } catch {
      setCopyFlashId(`err:${p.id}`);
    }
    window.setTimeout(() => setCopyFlashId(null), 1500);
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? prompts.filter(p =>
        p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q))
    : prompts;

  const renderForm = () => (
    <div className={styles.promptForm}>
      <input
        type="text"
        className={styles.promptTitleInput}
        placeholder="Prompt name (e.g. Contract Review)"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className={styles.aiPromptInput}
        placeholder="Paste or type the prompt text here…"
        value={draftBody}
        onChange={(e) => setDraftBody(e.target.value)}
        rows={12}
        spellCheck={false}
      />
      <div className={styles.aiPromptControls}>
        <button type="button" className={styles.aiPromptBtn} onClick={save} disabled={!draftBody.trim()}>
          Save prompt
        </button>
        <button type="button" className={styles.aiPromptBtnGhost} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className={styles.promptLib}>
      <p className={styles.subnote}>
        Save prompts you reuse often and copy any of them with one click. Use the arrows to reorder, and click <strong>Show</strong> to reveal a prompt&rsquo;s text. Prompts sync across your devices.
      </p>
      <div className={styles.promptLibToolbar}>
        <input
          type="search"
          className={styles.promptSearch}
          placeholder="Search prompts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {editingId !== 'new' && (
          <button type="button" className={styles.aiPromptBtn} onClick={startNew}>+ New prompt</button>
        )}
      </div>

      {editingId === 'new' && (
        <section className={styles.promptCard}>
          <h2 className={styles.sectionHeader}>New prompt</h2>
          {renderForm()}
        </section>
      )}

      {prompts.length === 0 && editingId !== 'new' && (
        <div className={styles.empty}>No saved prompts yet. Click &ldquo;New prompt&rdquo; to add one.</div>
      )}

      {prompts.length > 0 && visible.length === 0 && (
        <div className={styles.empty}>No prompts match &ldquo;{query}&rdquo;.</div>
      )}

      {visible.map((p, i) => {
        const expanded = expandedIds.has(p.id);
        // Reordering is disabled while a search filter is active (see move()).
        const canReorder = !q;
        return (
        <section key={p.id} className={styles.promptCard}>
          {editingId === p.id ? (
            <>
              <h2 className={styles.sectionHeader}>Edit prompt</h2>
              {renderForm()}
            </>
          ) : (
            <>
              <div className={styles.promptCardHead}>
                {canReorder && (
                  <div className={styles.promptReorder}>
                    <button type="button" className={styles.promptMoveBtn} onClick={() => move(p.id, -1)} disabled={i === 0} title="Move up" aria-label="Move up">▲</button>
                    <button type="button" className={styles.promptMoveBtn} onClick={() => move(p.id, 1)} disabled={i === visible.length - 1} title="Move down" aria-label="Move down">▼</button>
                  </div>
                )}
                <h2 className={styles.promptCardTitle}>{p.title}</h2>
                <div className={styles.promptCardActions}>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => toggleExpand(p.id)} aria-expanded={expanded}>{expanded ? 'Hide' : 'Show'}</button>
                  <button type="button" className={styles.aiPromptBtn} onClick={() => copy(p)}>Copy</button>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => startEdit(p)}>Edit</button>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => remove(p.id)}>Delete</button>
                  {copyFlashId === p.id && <span className={styles.copyFlash}>Copied!</span>}
                  {copyFlashId === `err:${p.id}` && <span className={styles.copyFlashErr}>Copy failed</span>}
                </div>
              </div>
              {expanded && <pre className={styles.aiPromptPreview}>{p.body}</pre>}
            </>
          )}
        </section>
        );
      })}
    </div>
  );
}

export function AgentsView({ prospects = [], settings, updateProspect, updateSettings }) {
  const { user } = useAuth();
  // "Run the prompts" reminder. The stamp lives on synced settings, so the
  // banner here and the Sidebar's red badge always agree — and marking a run
  // on one device clears it on the others.
  const agentsLastRunAt = settings?.[AGENTS_SETTINGS_KEY] || '';
  // "Not now" without claiming a run: while the snooze is live the banner
  // and the Sidebar dot stay down, then the reminder returns on its own.
  const agentsSnoozeUntil = settings?.[AGENTS_SNOOZE_SETTINGS_KEY] || '';
  const agentsRunDue = useAgentsRunDue(agentsLastRunAt, !!settings, agentsSnoozeUntil);
  const agentsSnoozeUntilMs = agentsSnoozedUntilMs(agentsSnoozeUntil);
  const agentsSnoozeLeft = agentsSnoozeRemainingLabel(agentsSnoozeUntilMs);
  const agentsDaysSince = agentsDaysSinceRun(agentsLastRunAt);
  const agentsDaysLeft = agentsDaysUntilDue(agentsLastRunAt);
  const agentsLastRunLabel = (() => {
    const ms = agentsLastRunMs(agentsLastRunAt);
    return ms == null ? '' : new Date(ms).toLocaleString();
  })();
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const snoozeMenuRef = useRef(null);
  useEffect(() => {
    if (!snoozeMenuOpen) return undefined;
    const onDown = (e) => {
      if (!snoozeMenuRef.current?.contains(e.target)) setSnoozeMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [snoozeMenuOpen]);
  function markAgentsRan() {
    if (!updateSettings) return;
    // Clear any snooze alongside the stamp: the run it was deferring has
    // happened, so leaving it set would swallow the *next* reminder too.
    updateSettings({
      [AGENTS_SETTINGS_KEY]: new Date().toISOString(),
      [AGENTS_SNOOZE_SETTINGS_KEY]: '',
    });
  }
  function snoozeAgentsRun(duration) {
    setSnoozeMenuOpen(false);
    if (!updateSettings) return;
    const end = agentsSnoozeEndAt(duration);
    if (end == null) return;
    updateSettings({ [AGENTS_SNOOZE_SETTINGS_KEY]: new Date(end).toISOString() });
  }
  function unsnoozeAgentsRun() {
    if (!updateSettings) return;
    updateSettings({ [AGENTS_SNOOZE_SETTINGS_KEY]: '' });
  }
  // Configured per-user via Settings → CDM Name. The Sent emails section
  // matches HubSpot's hs_email_from_email against this address; blank
  // means "no outbound to show yet — set your work email in Settings".
  const senderEmail = String(settings?.workEmail || '').toLowerCase().trim();
  const [cache, setCache] = useState(() => readActivityCache());
  const [hubspotCache, setHubspotCache] = useState(null);
  const [oppsCache, setOppsCache] = useState(null);
  // Raw Opps record shown in the read-only Opp info modal (New BFO Opp
  // table "i" button). null = closed.
  const [infoOpp, setInfoOpp] = useState(null);
  const [overrides, setOverrides] = useState(readOverrides);
  const [ignoredEmails, setIgnoredEmails] = useState(readIgnoredEmails);
  const [ignoredMeetings, setIgnoredMeetings] = useState(readIgnoredMeetings);
  const [excludedRecipients, setExcludedRecipients] = useState(readExcludedRecipients);
  // When on, the Called / Sent tables hide rows whose Last Activity date
  // is the same calendar day as the selected Activity date up top.
  const [hideActivityOnDate, setHideActivityOnDate] = useState(readHideActivityOnDate);
  // Which Activity-table columns are hidden, plus the column-menu open state.
  const [hiddenActivityCols, setHiddenActivityCols] = useState(readHiddenActivityCols);
  const [activityColsMenuOpen, setActivityColsMenuOpen] = useState(false);
  const activityColsMenuRef = useRef(null);
  const isActivityColVisible = (key) => !hiddenActivityCols.has(key);
  const toggleActivityCol = (key) => {
    setHiddenActivityCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeHiddenActivityCols(next);
      return next;
    });
  };
  useEffect(() => {
    if (!activityColsMenuOpen) return;
    const onDown = (e) => {
      if (!activityColsMenuRef.current?.contains(e.target)) setActivityColsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activityColsMenuOpen]);
  const [aiPrompt, setAiPrompt] = useState(readAiPrompt);
  const [newBfoOppPrompt, setNewBfoOppPrompt] = useState(readNewBfoOppPrompt);
  const [closeDatesPrompt, setCloseDatesPrompt] = useState(readCloseDatesPrompt);
  const [amountUpdatesPrompt, setAmountUpdatesPrompt] = useState(readAmountUpdatesPrompt);
  const [stageChangePrompt, setStageChangePrompt] = useState(readStageChangePrompt);
  const [closeNotSoldsPrompt, setCloseNotSoldsPrompt] = useState(readCloseNotSoldsPrompt);
  const [updateBfoActivityPrompt, setUpdateBfoActivityPrompt] = useState(readUpdateBfoActivityPrompt);
  const [bfoPrepPrompt, setBfoPrepPrompt] = useState(readBfoPrepPrompt);
  const [importMarketingLeadsPrompt, setImportMarketingLeadsPrompt] = useState(readImportMarketingLeadsPrompt);
  const [marketingLeadsPrompt, setMarketingLeadsPrompt] = useState(readMarketingLeadsPrompt);
  const [marketingLeadStatusUpdatePrompt, setMarketingLeadStatusUpdatePrompt] = useState(readMarketingLeadStatusUpdatePrompt);
  const [duplicateLeadsPrompt, setDuplicateLeadsPrompt] = useState(readDuplicateLeadsPrompt);
  const [bfoActivity, setBfoActivity] = useState(null);
  const [bfoLeads, setBfoLeads] = useState(null);
  // Tagging state for the "BFO Opportunity Name not tagged to an opp"
  // warning mirrored from the BFO Activity page.
  const [assigningBfo, setAssigningBfo] = useState(false);
  const [bfoAssignFlash, setBfoAssignFlash] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  const [importMarketingLeadsCopyFlash, setImportMarketingLeadsCopyFlash] = useState('');
  const [marketingLeadsCopyFlash, setMarketingLeadsCopyFlash] = useState('');
  const [marketingLeadStatusUpdateCopyFlash, setMarketingLeadStatusUpdateCopyFlash] = useState('');
  const [duplicateLeadsCopyFlash, setDuplicateLeadsCopyFlash] = useState('');
  const [newBfoOppCopyFlash, setNewBfoOppCopyFlash] = useState('');
  const [closeDatesCopyFlash, setCloseDatesCopyFlash] = useState('');
  const [amountUpdatesCopyFlash, setAmountUpdatesCopyFlash] = useState('');
  const [stageChangeCopyFlash, setStageChangeCopyFlash] = useState('');
  const [closeNotSoldsCopyFlash, setCloseNotSoldsCopyFlash] = useState('');
  const [updateBfoActivityCopyFlash, setUpdateBfoActivityCopyFlash] = useState('');
  // HubSpot Activity refresh — kicked off by the header button. Mirrors
  // the fetchActivity flow on ActivityView so both tabs share the same
  // hubspot-activity-cache localStorage entry.
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [activityRefreshError, setActivityRefreshError] = useState(null);
  const [activityRefreshProgress, setActivityRefreshProgress] = useState(null);
  // ISO date the activity sections (sent emails / meetings / called)
  // are scoped to. Defaults to today; the picker in the header lets the
  // user review what was logged on any past calendar day.
  const [referenceDate, setReferenceDate] = useState(todayIso);
  // Per-section reveal flags for the AI prompt editors. Hidden by
  // default — the user copies prompts far more often than they edit
  // them, so the textareas just take up screen space. Click "Edit
  // prompt" to expand the textarea + reset button for that section.
  const [revealedPrompts, setRevealedPrompts] = useState({});
  const togglePrompt = (key) =>
    setRevealedPrompts(prev => ({ ...prev, [key]: !prev[key] }));

  // Agents page sub-tab: 'automations' (the default agent tables) or
  // 'prompts' (the saved Prompt Library).
  const [activeSubTab, setActiveSubTab] = useState(readActiveSubTab);
  const selectSubTab = (tab) => { setActiveSubTab(tab); writeActiveSubTab(tab); };

  // Saved prompts for the Prompt Library. Falls back to the seed list
  // until the user edits anything, then persists via settings.savedPrompts.
  //
  // A seed added after that switch has already happened would never be
  // seen, since the seed list stops being consulted the moment the library
  // becomes the user's own. Those (LATE_SEED_IDS) are merged in here at
  // render time rather than migrated into stored settings on load: showing
  // them takes no write at all, so nothing about it can fail quietly —
  // a rejected save, a settings document at its size ceiling, or a
  // half-loaded snapshot all left the earlier migration silently doing
  // nothing. Deleting one records it in dismissedSeedPrompts, which is
  // what keeps it gone.
  const savedPrompts = useMemo(() => {
    const own = settings?.savedPrompts;
    if (!Array.isArray(own)) return DEFAULT_SAVED_PROMPTS;
    const dismissed = new Set(settings?.dismissedSeedPrompts || []);
    const present = new Set(own.map(p => p?.id));
    const missing = DEFAULT_SAVED_PROMPTS.filter(
      s => LATE_SEED_IDS.includes(s.id) && !present.has(s.id) && !dismissed.has(s.id));
    return missing.length > 0 ? [...own, ...missing] : own;
  }, [settings?.savedPrompts, settings?.dismissedSeedPrompts]);

  // Any late seed that isn't in the list being saved has been deleted, so
  // it goes on the dismissed list in the same write — otherwise the merge
  // above would hand it straight back.
  const handleSavedPromptsChange = (next) => {
    if (!updateSettings) return;
    const keptIds = new Set((next || []).map(p => p?.id));
    const dismissed = new Set(settings?.dismissedSeedPrompts || []);
    let newlyDismissed = false;
    for (const id of LATE_SEED_IDS) {
      if (!keptIds.has(id) && !dismissed.has(id)) { dismissed.add(id); newlyDismissed = true; }
    }
    updateSettings(newlyDismissed
      ? { savedPrompts: next, dismissedSeedPrompts: [...dismissed] }
      : { savedPrompts: next });
  };

  const ignoredEmailIds = useMemo(() => new Set(ignoredEmails), [ignoredEmails]);
  const ignoredMeetingIds = useMemo(() => new Set(ignoredMeetings), [ignoredMeetings]);
  const excludedRecipientSet = useMemo(() => new Set(excludedRecipients), [excludedRecipients]);

  const updateAiPrompt = (next) => {
    setAiPrompt(next);
    writeAiPrompt(next);
  };
  const resetAiPrompt = () => updateAiPrompt(DEFAULT_AI_PROMPT);

  const updateNewBfoOppPrompt = (next) => {
    setNewBfoOppPrompt(next);
    writeNewBfoOppPrompt(next);
  };
  const resetNewBfoOppPrompt = () => updateNewBfoOppPrompt(DEFAULT_AI_PROMPT_NEW_BFO_OPP);

  const updateCloseDatesPrompt = (next) => {
    setCloseDatesPrompt(next);
    writeCloseDatesPrompt(next);
  };
  const resetCloseDatesPrompt = () => updateCloseDatesPrompt(DEFAULT_AI_PROMPT_CLOSE_DATES);

  const updateAmountUpdatesPrompt = (next) => {
    setAmountUpdatesPrompt(next);
    writeAmountUpdatesPrompt(next);
  };
  const resetAmountUpdatesPrompt = () => updateAmountUpdatesPrompt(DEFAULT_AI_PROMPT_AMOUNT_UPDATES);

  const updateStageChangePrompt = (next) => {
    setStageChangePrompt(next);
    writeStageChangePrompt(next);
  };
  const resetStageChangePrompt = () => updateStageChangePrompt(DEFAULT_AI_PROMPT_STAGE_CHANGE);

  const updateCloseNotSoldsPrompt = (next) => {
    setCloseNotSoldsPrompt(next);
    writeCloseNotSoldsPrompt(next);
  };
  const resetCloseNotSoldsPrompt = () => updateCloseNotSoldsPrompt(DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS);

  const updateUpdateBfoActivityPrompt = (next) => {
    setUpdateBfoActivityPrompt(next);
    writeUpdateBfoActivityPrompt(next);
  };
  const resetUpdateBfoActivityPrompt = () => updateUpdateBfoActivityPrompt(DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY);

  const updateBfoPrepPrompt = (next) => {
    setBfoPrepPrompt(next);
    writeBfoPrepPrompt(next);
  };
  const resetBfoPrepPrompt = () => updateBfoPrepPrompt(DEFAULT_AI_PROMPT_BFO_PREP);
  const updateImportMarketingLeadsPrompt = (next) => {
    setImportMarketingLeadsPrompt(next);
    writeImportMarketingLeadsPrompt(next);
  };
  const resetImportMarketingLeadsPrompt = () => updateImportMarketingLeadsPrompt(DEFAULT_AI_PROMPT_IMPORT_MARKETING_LEADS);
  const updateMarketingLeadsPrompt = (next) => {
    setMarketingLeadsPrompt(next);
    writeMarketingLeadsPrompt(next);
  };
  const resetMarketingLeadsPrompt = () => updateMarketingLeadsPrompt(DEFAULT_AI_PROMPT_MARKETING_LEADS);
  const updateMarketingLeadStatusUpdatePrompt = (next) => {
    setMarketingLeadStatusUpdatePrompt(next);
    writeMarketingLeadStatusUpdatePrompt(next);
  };
  const resetMarketingLeadStatusUpdatePrompt = () => updateMarketingLeadStatusUpdatePrompt(DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE);
  const updateDuplicateLeadsPrompt = (next) => {
    setDuplicateLeadsPrompt(next);
    writeDuplicateLeadsPrompt(next);
  };
  const resetDuplicateLeadsPrompt = () => updateDuplicateLeadsPrompt(DEFAULT_AI_PROMPT_DUPLICATE_LEADS);

  // Leads the user hid on the Contacts → Marketing Leads page
  // (settings.marketingLeadsHiddenLeads holds their ids). Hidden leads are
  // set aside, so the Marketing Leads agents ignore them entirely.
  const hiddenMarketingLeadIds = useMemo(() => {
    const arr = settings?.marketingLeadsHiddenLeads;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  }, [settings?.marketingLeadsHiddenLeads]);

  // Marketing Leads that still need a Salesforce Link — sourced live from
  // the Marketing Leads subtab's store (settings.marketingLeads). A lead
  // qualifies when it has a Name but an empty Salesforce Link (sfUrl).
  // Leads hidden on the Contacts page are skipped.
  const marketingLeadsMissing = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    return arr.filter(r => String(r?.name || '').trim() && !String(r?.sfUrl || '').trim()
      && !hiddenMarketingLeadIds.has(String(r?.id)));
  }, [settings, hiddenMarketingLeadIds]);

  // Index of the BFO Activity "Leads" subtab: order-insensitive name key →
  // every row pasted under that name, as { name, company, statuses }.
  //
  // The statuses are a list in paste order rather than the first one that
  // turned up, because the same person routinely carries more than one
  // Lead record in Salesforce: those duplicates are what the Duplicate
  // Leads agent reports, and a wrong status on the SECOND copy is just as
  // wrong as one on the first.
  //
  // Detects the Name / Company / Status columns from the pasted headers
  // (the printable view labels them "Name", "Company" and "Status"). Empty
  // until the user pastes the Leads subtab, which leaves both agents'
  // lists empty.
  const leadsSubtabByName = useMemo(() => {
    const map = new Map();
    const headers = Array.isArray(bfoLeads?.headers) ? bfoLeads.headers : [];
    const rows = Array.isArray(bfoLeads?.rows) ? bfoLeads.rows : [];
    if (!headers.length || !rows.length) return map;
    const norm = (h) => String(h || '').trim().toLowerCase();
    const nameCol = headers.find(h => norm(h) === 'name')
      || headers.find(h => /\bname\b/i.test(h) && !/company|account/i.test(h));
    const statusCol = headers.find(h => norm(h) === 'status')
      || headers.find(h => /status/i.test(h));
    const companyCol = headers.find(h => norm(h) === 'company')
      || headers.find(h => /company|account/i.test(h));
    if (!nameCol || !statusCol) return map;
    for (const r of rows) {
      const name = String(r[nameCol] ?? '').trim();
      const key = leadNameKey(name);
      if (!key) continue;
      const entry = map.get(key) || { name, company: '', statuses: [] };
      // First non-empty company wins: the copies are the same person, so a
      // blank on one row is a gap in that row, not a different employer.
      if (!entry.company && companyCol) entry.company = String(r[companyCol] ?? '').trim();
      entry.statuses.push(String(r[statusCol] || '').trim());
      map.set(key, entry);
    }
    return map;
  }, [bfoLeads]);

  // Marketing Leads whose Status (the source of truth on the Marketing
  // Leads page) DIFFERS from the same lead's status on the BFO Activity
  // "Leads" subtab — the only ones the status-update agent needs to act
  // on. A lead qualifies when it has a Name + Status, has a matching row
  // in the Leads subtab, and the two statuses don't match. Leads with no
  // matching Leads-subtab row are hidden (we can't confirm a diff), as are
  // leads the user hid on the Contacts → Marketing Leads page.
  //
  // ANY copy that disagrees puts the lead on the list: where Salesforce
  // holds duplicate records for one person, one of them already carrying
  // the right status doesn't make the other one right. The Leads Subtab
  // Status column then names the statuses that actually need changing,
  // which is a shorter answer than every status the copies carry.
  const marketingLeadStatusRows = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const out = [];
    for (const r of arr) {
      if (hiddenMarketingLeadIds.has(String(r?.id))) continue; // hidden on Contacts → skip
      const name = String(r?.name || '').trim();
      const status = String(r?.status || '').trim();
      if (!name || !status) continue;
      const key = leadNameKey(name);
      const entry = leadsSubtabByName.get(key);
      if (!entry) continue; // no match → hide
      const differing = [...new Set(
        entry.statuses.filter(s => leadStatusKey(status) !== leadStatusKey(s))
      )];
      if (!differing.length) continue; // every copy already agrees → hide
      out.push({
        ...r,
        bfoStatus: differing.map(s => s || '(blank)').join(', '),
        copies: entry.statuses.length,
      });
    }
    return out;
  }, [settings, leadsSubtabByName, hiddenMarketingLeadIds]);

  // Leads pasted more than once on the BFO Activity page's Leads subtab —
  // one person carrying two or more Salesforce Lead records — where at
  // least one of those copies carries a status the Marketing Leads page
  // disagrees with. Each row reports how many copies there are and the
  // statuses they carry.
  //
  // Only the mismatching duplicates: a duplicate whose copies all agree
  // has nothing to fix here, and listing it would bury the ones that do
  // behind a list of leads that only need merging. Leads with no matching
  // Marketing Leads row, or one with no status, can't be compared and are
  // left out for the same reason. So are leads the user hid on the
  // Contacts → Marketing Leads page, which are set aside there.
  const duplicateLeadRows = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const leadByKey = new Map();
    for (const r of arr) {
      const key = leadNameKey(r?.name);
      if (!key || hiddenMarketingLeadIds.has(String(r?.id))) continue;
      if (!leadByKey.has(key)) leadByKey.set(key, r);
    }
    const out = [];
    for (const [key, entry] of leadsSubtabByName) {
      if (entry.statuses.length < 2) continue; // one record → not a duplicate
      const lead = leadByKey.get(key);
      if (!lead) continue; // not on Marketing Leads (or hidden) → nothing to compare
      const mlStatus = String(lead.status || '').trim();
      if (!mlStatus) continue; // no source of truth to compare against
      // A copy with no status at all counts as disagreeing: an empty
      // status is not the status the Marketing Leads page says it is.
      if (!entry.statuses.some(s => leadStatusKey(s) !== leadStatusKey(mlStatus))) continue;
      out.push({
        key,
        name: String(lead.name || entry.name || '').trim(),
        company: String(lead.company || entry.company || '').trim(),
        copies: entry.statuses.length,
        statuses: [...new Set(entry.statuses.map(s => s || '(blank)'))],
        mlStatus,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [settings, leadsSubtabByName, hiddenMarketingLeadIds]);

  // Write a Salesforce Link back onto the matching lead in
  // settings.marketingLeads so it saves through the same settings →
  // Firestore pipeline and shows up on the Marketing Leads page.
  const updateMarketingLeadSfUrl = (leadId, value) => {
    if (!updateSettings || !leadId) return;
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const v = String(value || '').trim();
    const next = arr.map(r => (r?.id != null && String(r.id) === String(leadId) ? { ...r, sfUrl: v } : r));
    updateSettings({ marketingLeads: next });
  };

  // The "Update BFO Activity" prompt is appended to the end of every
  // individual prompt copy (and the Copy-all bundle). Helper keeps that
  // one place so all the copy buttons stay in sync.
  const withBfoActivitySuffix = (text) => {
    const suffix = (updateBfoActivityPrompt || '').trim();
    return suffix ? `${text}\n\n===== Update BFO Activity =====\n${suffix}` : text;
  };

  const ignoreEmail = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredEmails(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredEmails(next);
      return next;
    });
  };

  // Permanently exclude the given external recipient address(es) from
  // the Sent emails table — hides this email and any future email sent
  // to the same recipient.
  const excludeRecipient = (addrs) => {
    const list = (Array.isArray(addrs) ? addrs : [addrs])
      .map(a => String(a || '').toLowerCase().trim())
      .filter(Boolean);
    if (!list.length) return;
    setExcludedRecipients(prev => {
      const next = [...prev];
      for (const a of list) if (!next.includes(a)) next.push(a);
      if (next.length === prev.length) return prev;
      writeExcludedRecipients(next);
      return next;
    });
  };

  // Re-include every previously excluded recipient.
  const clearExcludedRecipients = () => {
    setExcludedRecipients(prev => {
      if (!prev.length) return prev;
      writeExcludedRecipients([]);
      return [];
    });
  };

  const ignoreMeeting = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredMeetings(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredMeetings(next);
      return next;
    });
  };

  const setOverride = (key, opp) => {
    if (!key || !opp) return;
    setOverrides(prev => {
      const next = {
        ...prev,
        [key]: {
          bfoOpp: String(opp['BFO Link'] || '').trim(),
          account: String(opp['Account'] || '').trim(),
        },
      };
      writeOverrides(next);
      return next;
    });
  };

  const clearOverride = (key) => {
    if (!key) return;
    setOverrides(prev => {
      const next = { ...prev };
      delete next[key];
      writeOverrides(next);
      return next;
    });
  };

  // Pick up new HubSpot activity pulls from the Activity tab.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Pull the latest HubSpot activity (emails, calls, meetings) AND
  // re-sync the Opps 2 store so the BFO tagging and the Called
  // section both reflect the latest data. The HubSpot pull writes to
  // the shared localStorage cache that ActivityView reads from; the
  // Opps half reconciles the local Opps 2 cache against Firestore
  // (Opps 2 is the canonical opps store — the legacy Google Sheet is
  // a read-only backup that no longer feeds anything here). Each
  // half runs independently so a failure on one doesn't block the
  // other.
  async function refreshActivityCache() {
    if (activityRefreshing) return;
    setActivityRefreshing(true);
    setActivityRefreshError(null);
    setActivityRefreshProgress({ email: 0, call: 0, meeting: 0, opps: 0 });
    async function fetchAllPages(type) {
      const all = [];
      let after = '';
      while (true) {
        const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${after}` : ''}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        all.push(...(json.results || []));
        setActivityRefreshProgress(prev => ({ ...prev, [type]: all.length }));
        if (json.nextAfter) after = json.nextAfter;
        else break;
        if (all.length > 5000) break;
      }
      return all;
    }
    async function fetchOpps() {
      // Opps 2 is the canonical opps store. Reconcile the local cache
      // against the Firestore copy with the same merge the Opps 2 tab
      // uses, so the values here always match the current Opps data —
      // including edits made on another device since the last visit.
      const [fromIdb, fromFs] = await Promise.all([
        loadOpps2Cache(),
        user?.uid ? loadOpps2FromFirestore(user.uid) : Promise.resolve(null),
      ]);
      const next = (fromIdb && fromFs)
        ? mergeOpps2Datasets(fromIdb, fromFs)
        : (fromIdb || fromFs);
      if (!next) {
        // Nothing cached locally or in the cloud yet — leave the
        // existing oppsCache (if any) untouched.
        return;
      }
      const result = {
        headers: Array.isArray(next.headers) ? next.headers : [],
        records: Array.isArray(next.records) ? next.records : [],
        fetchedAt: next.fetchedAt || null,
      };
      setActivityRefreshProgress(prev => ({ ...prev, opps: result.records.length }));
      setOppsCache(result);
      return result;
    }

    const activityPromise = (async () => {
      const emails = await fetchAllPages('email');
      const calls = await fetchAllPages('call');
      const meetings = await fetchAllPages('meeting');
      const result = { emails, calls, meetings, fetchedAt: new Date().toISOString() };
      try {
        userLsSet(ACTIVITY_CACHE_KEY, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
      } catch (err) {
        console.warn('Agents activity cache write skipped (quota):', err?.message || err);
      }
      setCache(result);
    })();
    const oppsPromise = fetchOpps();

    const [activityRes, oppsRes] = await Promise.allSettled([activityPromise, oppsPromise]);
    const errors = [];
    if (activityRes.status === 'rejected') {
      console.error('Agents activity refresh error:', activityRes.reason);
      errors.push(`Activity: ${activityRes.reason?.message || 'fetch failed'}`);
    }
    if (oppsRes.status === 'rejected') {
      console.error('Agents opps refresh error:', oppsRes.reason);
      errors.push(`Opps: ${oppsRes.reason?.message || 'fetch failed'}`);
    }
    if (errors.length > 0) setActivityRefreshError(errors.join(' · '));
    setActivityRefreshing(false);
    setActivityRefreshProgress(null);
  }

  // HubSpot contacts cache — email → company lookup for tagging.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Opps cache (IndexedDB) — drives the BFO Opportunity Name tagging.
  // Each opp record carries Contact (recipient email[s]), Account
  // (company), and BFO Link (= BFO Opportunity Name). Refresh on
  // window focus so a fresh paste over on the Opps tab shows up here
  // without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache()
        .then(o => { if (!cancelled) setOppsCache(o); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    // Re-pull when Opps 2 writes its cache (an edit on the Opps 2 tab or
    // an inline save here) so matches reflect the latest data live.
    window.addEventListener('opps2-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('opps2-cache-updated', refresh);
    };
  }, []);

  // BFO Activity rows — pasted on the BFO Activity tab, persisted in
  // IndexedDB. Nearly every prompt on this page joins against them: the
  // Sales Stage the Opps sheet doesn't carry (Close Dates, Stage Change),
  // the Amount to compare against Quoted Amount, and the "is this opp
  // still open in BFO?" check behind Close Not Solds.
  //
  // Refreshed on the store's own change event as well as window focus.
  // That event fires when the mirror lands a cloud copy locally — another
  // device's paste, or the first hydration on a browser that didn't hold
  // the record yet. Window focus doesn't cover either: the record can
  // arrive while this page is already open and focused, leaving it on an
  // empty copy while the BFO Activity tab shows a full one. Close Not
  // Solds then has nothing to check its opps against.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)
        .then(d => { if (!cancelled) setBfoActivity(d || null); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(BFO_ACTIVITY_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(BFO_ACTIVITY_EVENT, refresh);
    };
  }, []);

  // Leads subtab rows — pasted on the BFO Activity page's "Leads" tab
  // (Salesforce Leads printable view), persisted under BFO_LEADS_KEY.
  // Read here so the Marketing Lead Status Update agent can surface only
  // the leads whose Salesforce status differs from the Marketing Leads
  // source of truth. Refresh on focus so a fresh paste shows up live.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_ACTIVITY_STORE, BFO_LEADS_KEY)
        .then(d => { if (!cancelled) setBfoLeads(d || null); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // email → company map from the HubSpot contacts cache.
  const companyByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  // Pre-index the Opps cache for two lookup modes:
  //   1. email → opp  (Contact field carries email tokens)
  //   2. company → opp (Account field, fuzzy-matched)
  // The same opp can answer for either path. BFO Link is the BFO
  // Opportunity Name (the column was renamed visibly elsewhere but the
  // data key stayed "BFO Link").
  const oppIndex = useMemo(() => {
    const records = oppsCache?.records || [];
    const byEmail = new Map(); // lower-case email → opp
    const byBfoOpp = new Map(); // lower-case opp name → opp
    const allOpps = [];
    for (const r of records) {
      const rawBfoOpp = String(r['BFO Link'] || '').trim();
      // The Opps tab uses "-" / "#N/A" as placeholders for rows that
      // don't yet have a BFO Opportunity Name. Treat those as empty
      // here so the Sent emails table renders the inline picker
      // (instead of showing the literal "-") and the user can map
      // the row to a real opportunity.
      const bfoOpp = (rawBfoOpp && rawBfoOpp !== '-' && rawBfoOpp !== '#N/A') ? rawBfoOpp : '';
      const account = String(r['Account'] || '').trim();
      // Skip opps that don't carry the data we need to surface.
      if (!bfoOpp && !account) continue;
      const entry = { raw: r, account, bfoOpp };
      allOpps.push(entry);
      if (bfoOpp) {
        const key = bfoOpp.toLowerCase();
        if (!byBfoOpp.has(key)) byBfoOpp.set(key, entry);
      }
      const contactRaw = String(r['Contact'] || '').toLowerCase();
      if (!contactRaw) continue;
      const emails = contactRaw.match(EMAIL_RE) || [];
      for (const e of emails) {
        const existing = byEmail.get(e);
        // First match wins — except a BFO-tagged opp always beats an
        // untagged one that shares the same contact email, so a row with
        // a real BFO Opportunity Name isn't shadowed by a duplicate opp
        // that doesn't have one.
        if (!existing || (!existing.bfoOpp && entry.bfoOpp)) byEmail.set(e, entry);
      }
    }
    return { byEmail, byBfoOpp, allOpps };
  }, [oppsCache]);

  // Primary path: which Opps-tab row covers this email recipient?
  // Falls back to a fuzzy Account match on the HubSpot company so an
  // unknown-contact email still finds its opp when the company has
  // any open opportunity on the Opps tab.
  const findOppForRecipient = (recipientEmail, hubspotCompany) => {
    if (recipientEmail) {
      const direct = oppIndex.byEmail.get(recipientEmail);
      if (direct) return direct;
    }
    if (hubspotCompany) {
      for (const opp of oppIndex.allOpps) {
        if (companiesMatch(opp.account, hubspotCompany)) return opp;
      }
    }
    return null;
  };

  // Marketing Leads (Contacts tab) indexed by lower-cased email → the
  // lead's resolvable Salesforce record link. Lets the Activity table
  // recognise when an outbound email's external recipient is a known
  // lead, so the same activity can be logged on that lead's Salesforce
  // record in addition to any matched Opp. Only leads whose Salesforce
  // Link resolves to a real URL are indexed — there's nothing to open
  // (or log against) otherwise.
  const leadSfByEmail = useMemo(() => {
    const map = new Map();
    const leads = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    for (const lead of leads) {
      const email = String(lead?.email || '').toLowerCase().trim();
      if (!email || map.has(email)) continue;
      const url = resolveSfUrl(lead?.sfUrl);
      if (!url) continue;
      map.set(email, { url, name: String(lead?.name || '').trim() });
    }
    return map;
  }, [settings?.marketingLeads]);

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = boundsForDate(referenceDate);
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    // Sent emails span the past 2 business days (the reference day plus
    // the previous business day); meetings stay scoped to the single
    // reference day.
    const activityBounds = boundsForActivityWindow(referenceDate);
    const inActivityWindow = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= activityBounds.start && t < activityBounds.end;
    };
    const sentByMe = (e) => {
      if (!senderEmail) return false;
      const from = String(e.hs_email_from_email || '').toLowerCase().trim();
      return from === senderEmail;
    };
    const outbound = senderEmail ? (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inActivityWindow(e.hs_timestamp))
      .filter(sentByMe)
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .filter(e => !ignoredEmailIds.has(String(e.id || e.hs_object_id)))
      // Drop emails whose external recipients have all been excluded
      // by the user ("don't include moving forward").
      .filter(e => externalRecipientList(e.hs_email_to_email)
        .some(addr => !excludedRecipientSet.has(addr.toLowerCase())))
      .map(e => {
        const recipients = externalRecipientList(e.hs_email_to_email);
        // Pick the HubSpot-company off the first recipient we have a
        // contact record for. Used both as a fallback Company when no
        // Opp matches and as the secondary-match key for the Opps-tab
        // lookup.
        let hubspotCompany = '';
        for (const addr of recipients) {
          const c = companyByEmail.get(addr);
          if (c) { hubspotCompany = c; break; }
        }
        // Walk the external recipients and take the first one that
        // resolves to an Opp on the Opps tab (by Contact email, then by
        // company-name fuzzy match against the Opps Account). The company
        // comes from the HubSpot contact when we have one, otherwise from
        // a guess off the email domain — so an email to an unknown
        // contact still gets a BFO Opportunity estimate from its company.
        let matchedOpp = null;
        for (const addr of recipients) {
          const companyCandidate = companyByEmail.get(addr) || hubspotCompany || domainCompanyGuess(addr);
          matchedOpp = findOppForRecipient(addr, companyCandidate);
          if (matchedOpp) break;
        }
        // If any external recipient is a known Marketing Lead, capture
        // that lead's Salesforce record link so the activity can also be
        // logged on the lead. First matching recipient wins.
        let leadMatch = null;
        for (const addr of recipients) {
          const m = leadSfByEmail.get(String(addr).toLowerCase());
          if (m) { leadMatch = m; break; }
        }
        // Override key — keyed by the first external recipient so a
        // future email to the same person reuses the manual tag.
        const overrideKey = recipients[0] || '';
        const override = overrideKey ? overrides[overrideKey] : null;
        // Manual override wins over the auto-match. Auto-match wins
        // when there's no override.
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || hubspotCompany || domainCompanyGuess(recipients[0]);
        // Resolve the full opp record for this row's BFO URL / Next
        // Steps — a manual override's named opp, else the one we matched,
        // preferring a record that actually carries a BFO Address. Shared
        // with the meeting rows so both resolve the same way.
        const oppForRow = resolveOppForRow(oppIndex, override?.bfoOpp, matchedOpp);
        const bfoUrl = detectBfoUrl(oppForRow?.raw);
        const nextStepsType = detectNextStepsType(oppForRow?.raw);
        return {
          id: e.id || e.hs_object_id,
          ts: e.hs_timestamp,
          subject: e.hs_email_subject || '(no subject)',
          to: recipients.join(', '),
          recipients,
          rawTo: e.hs_email_to_email || '',
          status: e.hs_email_status || '',
          company,
          bfoOpp,
          bfoUrl,
          leadSfUrl: leadMatch?.url || '',
          leadName: leadMatch?.name || '',
          nextStepsType,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)) : [];

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .filter(m => !ignoredMeetingIds.has(String(m.id || m.hs_object_id)))
      .map(m => {
        // Resolve associated HubSpot contacts up front. We walk each
        // one looking for an Opps-tab match (by email → Contact, then
        // by company → Account) instead of taking the first contact
        // and stopping — meetings frequently include internal SE
        // attendees first, which would block a match if we short-
        // circuited on the first email / company we saw.
        const ids = m._contactIds || [];
        const contacts = ids
          .map(id => (hubspotCache?.contacts || []).find(c => c.id === id))
          .filter(Boolean);

        // Strongest match keys: an external recipient email and the
        // first non-empty company. Used as the override key + as the
        // last-chance fuzzy match.
        let primaryEmail = '';
        let primaryCompany = '';
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && !e.endsWith('@se.com') && !primaryEmail) primaryEmail = e;
          if (ct.company && !primaryCompany) primaryCompany = ct.company;
        }

        // Walk every external contact + their company against the
        // Opps tab. First opp that resolves wins.
        let matchedOpp = null;
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && e.endsWith('@se.com')) continue;
          matchedOpp = findOppForRecipient(e, ct.company || '');
          if (matchedOpp) break;
        }
        // Final fuzzy fallback: the meeting title or location often
        // carries the customer's company name. Match that against
        // every opp's Account field.
        if (!matchedOpp) {
          const haystack = `${m.hs_meeting_title || ''} ${m.hs_meeting_location || ''}`.trim();
          if (haystack) matchedOpp = findOppForRecipient('', haystack);
        }

        // Meetings rarely have a stable contact email — fall back to
        // the meeting id so the override survives. Same shape as the
        // email rows so the picker code stays one path.
        const meetingId = m.id || m.hs_object_id || '';
        const overrideKey = primaryEmail || (meetingId ? `meeting:${meetingId}` : '');
        const override = overrideKey ? overrides[overrideKey] : null;
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || primaryCompany;
        // Same resolution the email rows use. Without this a logged
        // meeting reached the table with no BFO address at all, so it
        // could neither be opened from the BFO Link column nor be logged
        // by the Activity prompt — the email to the same account was the
        // only touch that made it through.
        const oppForRow = resolveOppForRow(oppIndex, override?.bfoOpp, matchedOpp);
        return {
          id: meetingId,
          ts: m.hs_meeting_start_time || m.hs_timestamp,
          endTs: m.hs_meeting_end_time,
          title: m.hs_meeting_title || 'Meeting',
          outcome: m.hs_meeting_outcome || '',
          location: m.hs_meeting_location || '',
          company,
          bfoOpp,
          bfoUrl: detectBfoUrl(oppForRow?.raw),
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
    // findOppForRecipient / companyByEmail are derived from the same
    // dependency set as cache + hubspotCache + oppIndex + overrides,
    // so they don't need their own entries here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, hubspotCache, oppIndex, overrides, ignoredEmailIds, ignoredMeetingIds, excludedRecipientSet, referenceDate, senderEmail, leadSfByEmail]);

  // Granola notes from the Call Recordings page, as meetings.
  //
  // HubSpot only knows about a meeting once it has been logged against a
  // deal, which is work that happens after the fact — so a day spent in
  // customer calls could show an empty Activity table. Granola sits in
  // those calls and writes a note for each, and the Call Recordings page
  // has already stored them, so they are a record of the day that exists
  // whether or not anything was logged.
  //
  // Read-only here: this reads what that page stored and never syncs.
  // Keeping the import on one page means this one can't race it, and a
  // stale read costs a missing row rather than a wrong one.
  const [granolaRecords, setGranolaRecords] = useState({});
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) { setGranolaRecords({}); return undefined; }
    let cancelled = false;
    loadCallRecords(uid)
      .then(records => { if (!cancelled) setGranolaRecords(records || {}); })
      // A page that can't reach the store still has HubSpot's meetings.
      // Losing the Granola ones is worth less than an error banner over
      // an Activity table that is otherwise fine.
      .catch(err => { if (!cancelled) console.warn('Could not load call recordings for the Activity table:', err); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Those notes as Activity rows — scoped to the reference day, matched
  // to an opp the same way the HubSpot meetings are, and reduced to the
  // ones that landed on one.
  //
  // Tied-to-an-opp is the filter because this table is the day's work
  // against the pipeline: an internal stand-up Granola also sat in isn't
  // that, and the notes carry plenty of those. A meeting that IS with a
  // customer but didn't match can still be tagged by hand from the
  // Meetings section of the Call Recordings page, or logged in HubSpot,
  // and it arrives here the moment it is.
  const granolaMeetingRows = useMemo(() => {
    const bounds = boundsForDate(referenceDate);
    return oppMeetingsFromRecords(granolaRecords, {
      start: bounds.start,
      end: bounds.end,
      isIgnored: (id) => ignoredMeetingIds.has(id),
      overrides,
      resolve: (email, company) => findOppForRecipient(email, company),
      // Resolved the same way the email and HubSpot-meeting rows are, so
      // a Granola call whose opp was picked by hand still carries the
      // address of the opp that was picked.
      bfoUrlFor: (opp, overrideBfoOpp) => detectBfoUrl(
        resolveOppForRow(oppIndex, overrideBfoOpp, opp)?.raw,
      ),
    });
    // findOppForRecipient is derived from oppIndex, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granolaRecords, referenceDate, ignoredMeetingIds, overrides, oppIndex]);

  // One meeting list for the table: the logged meetings plus the Granola
  // calls nobody has logged yet.
  const allTodaysMeetings = useMemo(
    () => withUnloggedGranolaMeetings(todaysMeetings, granolaMeetingRows),
    [todaysMeetings, granolaMeetingRows],
  );

  // Opps that count as "called" in the activity window. Two signals:
  //   • An explicit mark from the Opps tab's Called button (`_calledOn`
  //     stamp on the reference day or the previous business day), OR
  //   • the legacy heuristic: a phone touch logged in Next Steps and
  //     the Last Spoke column (business days since Last Client Heard
  //     From Us) computing to 0 or 1 relative to the reference date.
  const calledOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const prevBiz = previousBusinessDayIso(referenceDate);
    const rows = [];
    for (const r of records) {
      const nextSteps = String(r['Next Steps'] || '');
      const markedOn = toISODate(r._calledOn);
      const marked = !!markedOn && (markedOn === referenceDate || markedOn === prevBiz);
      if (!marked) {
        if (!CALLED_NEXT_STEPS_RE.test(nextSteps)) continue;
        // Include calls from the past 2 business days: 0 = the reference
        // day itself, 1 = the previous business day.
        const lsbd = lastSpokeBusinessDays(r, referenceDate);
        if (lsbd !== 0 && lsbd !== 1) continue;
      }
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '-',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        nextSteps,
        marked,
        markedOn: marked ? markedOn : '',
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, referenceDate]);

  // Opps the user explicitly marked "Meeting" on the Opps tab (`_metOn`
  // stamp on the reference day or the previous business day). These join
  // the Activity table and the BFO Activity AI prompt as meeting rows —
  // unlike HubSpot meetings they already know their opp, so they carry a
  // BFO address directly.
  const markedMeetingOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const prevBiz = previousBusinessDayIso(referenceDate);
    const rows = [];
    for (const r of records) {
      const markedOn = toISODate(r._metOn);
      if (!markedOn || (markedOn !== referenceDate && markedOn !== prevBiz)) continue;
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '-',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        markedOn,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, referenceDate]);

  // Opps that don't yet exist in BFO and need a fresh Guided Opportunity
  // created. Filter mirrors the user's spec:
  //   • Stage NOT in {Not Started, Not Sold, Sold}
  //   • No BFO Opportunity Name — the Opps tab's "BFO Link" column is
  //     blank, "-", or "#N/A" (all treated as "no link yet").
  // Output carries Company (Account), Lead Source + a current-customer
  // boolean, and Scope so the appended block reads as the table the
  // user described.
  // BFO Company Name lookup — normalized company → bfoCompanyName from
  // the Table View prospect records. Used to enrich each New BFO Opp
  // row with the BFO-side account name (which often differs from the
  // marketing-friendly Account on the Opps sheet).
  const bfoCompanyByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      const bfo = String(p.bfoCompanyName || '').trim();
      if (!norm || !bfo) continue;
      // First match wins so the lookup is deterministic when two
      // prospect rows happen to normalize to the same key.
      if (!map.has(norm)) map.set(norm, bfo);
    }
    return map;
  }, [prospects]);

  // Normalized company → Table View prospect, so the New BFO Opp table
  // can write an entered BFO Company Name straight back to that company's
  // record (the same field Opps 2 / Table View read). First match wins.
  const prospectByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      if (norm && !map.has(norm)) map.set(norm, p);
    }
    return map;
  }, [prospects]);

  // Resolve a Sent-email row's BFO Company Name from the strongest
  // signal available, in order:
  //   1. the recipient contact's company (looked up by email),
  //   2. the company name shown on the row,
  //   3. the matched BFO opp — its own "BFO Company Name" field if the
  //      Opps sheet carries one, else its Account.
  // Each company identifier maps through the Table View bfoCompanyName
  // lookup so the BFO-side name stays consistent with Opps 2.
  const resolveBfoCompanyName = (e) => {
    for (const addr of (e.recipients || [])) {
      const co = companyByEmail.get(addr);
      const v = co ? (bfoCompanyByNorm.get(normalizeCompany(co)) || '') : '';
      if (v) return v;
    }
    const byCompany = bfoCompanyByNorm.get(normalizeCompany(e.company)) || '';
    if (byCompany) return byCompany;
    const opp = e.bfoOpp ? oppIndex.byBfoOpp.get(e.bfoOpp.toLowerCase()) : null;
    if (opp) {
      return String(opp.raw?.['BFO Company Name'] || '').trim()
        || bfoCompanyByNorm.get(normalizeCompany(opp.account || '')) || '';
    }
    return '';
  };

  // Opps that don't yet exist in BFO and need a fresh Guided Opportunity
  // created. Computed by the shared util so the Agents table, the red
  // banner, and the Issues tab all agree on the same set (and the same
  // "what's missing" check). See utils/newBfoOpps.js.
  const newBfoOpps = useMemo(
    () => computeNewBfoOpps({ oppsCache, prospects, serviceOverrides: settings?.serviceOverrides }),
    [oppsCache, prospects, settings?.serviceOverrides]
  );

  // Missing data the New BFO Opp AI prompt needs. One entry per affected
  // opp, listing its blank fields; drives the red banner at the top of
  // the page (and the matching row on the Issues tab).
  const newBfoMissingData = useMemo(() => computeNewBfoMissingData(newBfoOpps), [newBfoOpps]);

  // BFO Opportunity Name → Last Activity date from the BFO Activity tab.
  // Lets the Called and Sent emails tables show how long it's been since
  // anything happened on the matched BFO opp. Keyed by normalized
  // opportunity name (== the Opps tab's "BFO Link").
  const bfoLastActivityByName = useMemo(() => {
    const map = new Map();
    const headers = bfoActivity?.headers || [];
    const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
    const actCol = headers.find(h => /last\s*activity/i.test(h));
    if (!oppCol || !actCol) return map;
    for (const r of (bfoActivity?.rows || [])) {
      const k = normalizeBfoOppName(r[oppCol]);
      if (!k || map.has(k)) continue;
      const v = String(r[actCol] ?? '').trim();
      if (v) map.set(k, v);
    }
    return map;
  }, [bfoActivity]);

  // Look up the BFO Last Activity date for a given BFO Opportunity Name
  // (blank when there's no opp or no matching BFO Activity row).
  const lastActivityFor = (bfoOpp) => {
    const k = normalizeBfoOppName(bfoOpp);
    return k ? (bfoLastActivityByName.get(k) || '') : '';
  };

  // "Hide rows last active in the activity window" toggle. The Sent /
  // Called tables now span the past 2 business days, so this hides rows
  // whose BFO Last Activity falls on either the reference day or the
  // previous business day. Last Activity is whatever BFO pasted (usually
  // M/D/YYYY) while referenceDate is ISO, so normalize both before
  // comparing.
  const prevBusinessDate = previousBusinessDayIso(referenceDate);
  const lastActivityOnReference = (bfoOpp) => {
    const iso = toISODate(lastActivityFor(bfoOpp));
    return !!iso && (iso === referenceDate || iso === prevBusinessDate);
  };
  const visibleCalledOpps = hideActivityOnDate
    ? calledOpps.filter(o => !lastActivityOnReference(o.bfoOpp))
    : calledOpps;
  const visibleOutbound = hideActivityOnDate
    ? todaysOutbound.filter(e => !lastActivityOnReference(e.bfoOpp))
    : todaysOutbound;
  const visibleMeetings = hideActivityOnDate
    ? allTodaysMeetings.filter(m => !lastActivityOnReference(m.bfoOpp))
    : allTodaysMeetings;
  const visibleMarkedMeetings = hideActivityOnDate
    ? markedMeetingOpps.filter(o => !lastActivityOnReference(o.bfoOpp))
    : markedMeetingOpps;
  const activityHiddenCount =
    (calledOpps.length - visibleCalledOpps.length)
    + (todaysOutbound.length - visibleOutbound.length)
    + (allTodaysMeetings.length - visibleMeetings.length)
    + (markedMeetingOpps.length - visibleMarkedMeetings.length);

  // Unified Activity rows: Sent emails + Called + Meetings, normalized to
  // one shape and tagged with `type` (email / call / meeting). Emails and
  // meetings carry an overrideKey so their BFO Opportunity tag is
  // editable; calls come straight off the Opps sheet, so they're shown
  // read-only. Sorted newest-first by timestamp; calls (no timestamp)
  // fall to the bottom.
  const activityRows = useMemo(() => {
    const rows = [];
    for (const e of visibleOutbound) {
      rows.push({
        rowKey: `email:${e.id}`, type: 'email', ts: e.ts, endTs: null,
        title: e.subject, to: e.to, rawTo: e.rawTo, recipients: e.recipients || [],
        company: e.company, bfoOpp: e.bfoOpp, bfoUrl: e.bfoUrl,
        leadSfUrl: e.leadSfUrl || '', leadName: e.leadName || '',
        outcome: e.status || '', location: '', overrideKey: e.overrideKey,
        isManual: e.isManual, editable: true, emailId: e.id,
      });
    }
    for (const o of visibleCalledOpps) {
      rows.push({
        rowKey: `call:${o.id}`, type: 'call', ts: null, endTs: null,
        title: o.nextSteps || (o.marked ? `Marked "Called" on the Opps tab (${o.markedOn})` : ''),
        to: '', rawTo: '', recipients: [],
        company: (o.company && o.company !== '-') ? o.company : '', bfoOpp: o.bfoOpp, bfoUrl: o.bfoUrl,
        outcome: '', location: '', overrideKey: '', isManual: false, editable: false,
        marked: o.marked,
      });
    }
    for (const m of visibleMeetings) {
      rows.push({
        rowKey: `meeting:${m.id}`, type: 'meeting', ts: m.ts, endTs: m.endTs,
        // A HubSpot meeting carries no attendee list in this shape, so
        // `to` stays blank for those and reads as the dash it always has.
        title: m.title, to: m.attendees || '', rawTo: m.attendees || '', recipients: [],
        company: m.company, bfoOpp: m.bfoOpp, bfoUrl: m.bfoUrl || '',
        outcome: m.outcome || '', location: m.location || '', overrideKey: m.overrideKey,
        isManual: m.isManual, editable: true, meetingId: m.id,
        source: m.source || '', granolaUrl: m.granolaUrl || '',
      });
    }
    // Meetings marked on the Opps tab — read-only like calls, since they
    // come straight off the opp row (which already carries the BFO opp).
    for (const o of visibleMarkedMeetings) {
      rows.push({
        rowKey: `meetingflag:${o.id}`, type: 'meeting', ts: null, endTs: null,
        title: `Marked "Meeting" on the Opps tab (${o.markedOn})`, to: '', rawTo: '', recipients: [],
        company: (o.company && o.company !== '-') ? o.company : '', bfoOpp: o.bfoOpp, bfoUrl: o.bfoUrl,
        outcome: '', location: '', overrideKey: '', isManual: false, editable: false,
        marked: true,
      });
    }
    rows.sort((a, b) => (new Date(b.ts || 0)) - (new Date(a.ts || 0)));
    return rows;
  }, [visibleOutbound, visibleCalledOpps, visibleMeetings, visibleMarkedMeetings]);

  // BFO opps whose Close Date should slip by 30 days. Three windows
  // collapsed into one filter, all keyed off the BFO Sales Stage number
  // (which is why we read the BFO Activity tab — the Opps sheet's
  // Stage column doesn't carry the 1-6 BFO sales-stage value):
  //   • Stage ≤ 4 and < 100 days from today
  //   • Stage = 5 and < 60 days
  //   • Stage = 6 and < 30 days
  const closeDateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const closeCol = bfoActivity.headers.find(h => /close\s*date/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !closeCol || !oppCol) return [];
    const rows = [];
    for (const r of bfoActivity.rows) {
      const stage = bfoStageNumber(r[stageCol]);
      if (stage === null) continue;
      const closeRaw = String(r[closeCol] || '').trim();
      const days = daysUntilDate(closeRaw);
      if (days === null) continue;
      let include = false;
      if (stage <= 4 && days < 100) include = true;
      else if (stage === 5 && days < 60) include = true;
      else if (stage === 6 && days < 30) include = true;
      if (!include) continue;
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      rows.push({
        id: `${name}|${closeRaw}`,
        name,
        stage,
        stageLabel: String(r[stageCol] || '').trim(),
        currentClose: closeRaw,
        newClose: addDaysFormatted(closeRaw, 30),
        daysOut: days,
      });
    }
    rows.sort((a, b) => a.daysOut - b.daysOut);
    return rows;
  }, [bfoActivity]);

  // BFO ↔ Opps amount discrepancies. Joins each BFO Activity row to
  // its Opps record by BFO Opportunity Name (BFO's "Opportunity Name"
  // column == Opps' "BFO Link" column). When the rounded amounts
  // differ, we surface the BFO Address + the Opps Quoted Amount so
  // the AI assistant can update BFO to match. Rows where either side
  // doesn't carry a numeric amount are skipped — they're indistinguishable
  // from "not yet quoted" and would generate noise.
  const amountUpdateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const amtCol = bfoActivity.headers.find(h => /^amount$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!amtCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const bfoAmt = parseMoneyNumber(r[amtCol]);
      const oppsAmt = parseMoneyNumber(oppsRow['Quoted Amount']);
      if (bfoAmt == null || oppsAmt == null) continue;
      if (Math.round(bfoAmt) === Math.round(oppsAmt)) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        stage: stageCol ? String(r[stageCol] || '').trim() : '',
        bfoUrl,
        bfoAmount: bfoAmt,
        quotedAmount: oppsAmt,
        quotedAmountFmt: fmtMoney(oppsAmt),
      });
    }
    rows.sort((a, b) => (b.quotedAmount - b.bfoAmount) - (a.quotedAmount - a.bfoAmount));
    return rows;
  }, [bfoActivity, oppsCache]);

  // BFO ↔ Opps stage mismatches. For each BFO Activity row we look up
  // its joined Opps record by Opportunity Name, then check whether the
  // BFO Sales Stage matches the BFO stage we'd expect for that opp's
  // current Opps 2 Stage. Mismatches surface the BFO Link + the
  // expected BFO stage so the AI assistant can advance BFO to match.
  const stageChangeOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const oppsStage = String(oppsRow.Stage || '').trim();
      const expectedBfoStage = OPPS_STAGE_TO_BFO_STAGE[oppsStage.toLowerCase()];
      if (!expectedBfoStage) continue;
      const bfoStage = String(r[stageCol] || '').trim();
      if (!bfoStage) continue;
      if (bfoStage.toLowerCase() === expectedBfoStage.toLowerCase()) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        bfoStage,
        oppsStage,
        expectedBfoStage,
        bfoUrl,
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return rows;
  }, [bfoActivity, oppsCache]);

  // Not-Sold opps that still have a corresponding BFO row open. Each
  // pulls its Reason Not Sold + Competition from Opps 2 and maps the
  // pair to the Status + Reason values BFO expects when closing the
  // opp out. Rows whose combination isn't in the rules table fall
  // through so the user can see them and either update the row or
  // extend the table.
  // Shared with the Issues tab's "Close Not Sold missing data" detector,
  // so both pages agree on the row set and on what counts as missing.
  const closeNotSoldOpps = useMemo(
    () => computeCloseNotSoldOpps({ oppsCache, bfoActivity }),
    [oppsCache, bfoActivity],
  );
  // False when the pasted BFO Activity data can't answer "is this opp
  // still open in BFO?" — no paste, or no Opportunity Name column in it.
  // computeCloseNotSoldOpps returns nothing in that case, so without
  // this the section would show its ordinary "none to close out" empty
  // state and read like the work is done.
  const closeNotSoldBfoReady = useMemo(() => hasBfoOppNameIndex(bfoActivity), [bfoActivity]);

  // AI BFO Prep — live Opps 2 opps (Stage not Sold / Not Sold) that have
  // a non-blank Call In, carry a BFO Opportunity Name (BFO Link), but
  // have no BFO Address yet. The user fills in each BFO Address inline;
  // once set, the opp drops off this list.
  const bfoPrepOpps = useMemo(() => {
    const recs = oppsCache?.records || [];
    const rows = [];
    for (const r of recs) {
      const name = String(r['BFO Link'] ?? '').trim();
      if (bfoFieldBlank(name)) continue;
      if (!bfoFieldBlank(r['BFO Address'])) continue;
      // Live opps only — drop closed stages.
      if (CLOSED_OPP_STAGES.has(String(r.Stage || '').trim().toLowerCase())) continue;
      // Only opps with an actual Call In number (on a callback schedule).
      if (resolveOppCallIn(r) == null) continue;
      rows.push({
        id: r._id,
        name,
        account: String(r.Account || '').trim(),
        bfoAddress: String(r['BFO Address'] ?? '').trim(),
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
    return rows;
  }, [oppsCache]);

  const [bfoPrepCopyFlash, setBfoPrepCopyFlash] = useState('');

  // Persist a BFO Address edit straight to Opps 2 (cache + Firestore) and
  // optimistically update the local cache so the row reflects it / drops
  // off the prep list immediately.
  const updateOppBfoAddress = async (oppId, value) => {
    setOppsCache(prev => (prev && Array.isArray(prev.records))
      ? { ...prev, records: prev.records.map(r => (String(r._id) === String(oppId) ? { ...r, 'BFO Address': value } : r)) }
      : prev);
    try {
      await setOppField(user?.uid, oppId, 'BFO Address', value);
    } catch (err) {
      console.error('AI BFO Prep: failed to save BFO Address', { oppId, err });
    }
  };

  // ---- BFO Opportunity Names not tagged to an opp on Opps ----
  // Mirrors the warning on the BFO Activity page: any Opportunity Name in
  // the pasted BFO Activity data that has no matching opp on the Opps tab
  // is surfaced up top so it can be tagged onto an untagged opp.

  // Set of BFO Opportunity Names that already exist on the Opps tab
  // (keyed by "BFO Link", lower-cased + trimmed).
  const taggedBfoOppNameKeys = useMemo(() => {
    const set = new Set();
    for (const r of (oppsCache?.records || [])) {
      const k = bfoOppNameOf(r).toLowerCase();
      if (k) set.add(k);
    }
    return set;
  }, [oppsCache]);

  // BFO Activity Opportunity Names with no matching opp on the Opps tab,
  // paired with the BFO Account they came from. Suppressed until the Opps
  // cache has loaded (taggedBfoOppNameKeys empty) so we don't flag every
  // row before there's anything to match against.
  const untaggedBfoOppNames = useMemo(() => {
    if (!bfoActivity?.headers?.length || taggedBfoOppNameKeys.size === 0) return [];
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!oppCol) return [];
    const acctCol = bfoActivity.headers.find(h => /^account(\s*name)?$/i.test(h.trim()))
      || bfoActivity.headers.find(h => /account/i.test(h));
    const seen = new Set();
    const missing = [];
    for (const r of bfoActivity.rows) {
      const raw = String(r[oppCol] || '').trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (taggedBfoOppNameKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      missing.push({ name: raw, account: acctCol ? String(r[acctCol] || '').trim() : '' });
    }
    return missing;
  }, [bfoActivity, taggedBfoOppNameKeys]);

  // Normalized company → that company's BFO Company Name, sourced from the
  // Table View prospect records. Keyed with the canonical companyNorm so
  // it lines up with the BFO Activity page's matching.
  const bfoCompanyByAccountCanon = useMemo(() => {
    const map = new Map();
    for (const p of (prospects || [])) {
      const key = canonCompany(p?.company || '');
      const bfo = String(p?.bfoCompanyName || '').trim();
      if (key && bfo) map.set(key, bfo);
    }
    return map;
  }, [prospects]);

  // Opps that have NO BFO Opportunity Name yet, indexed by every key we
  // might match a BFO Activity row on: the normalized Account, the opp's
  // own normalized BFO Company Name, and the normalized BFO Company Name
  // carried on the matching Table View company. Closed opps excluded.
  const untaggedOppsByCanonKey = useMemo(() => {
    const map = new Map();
    const add = (key, opp) => {
      if (!key) return;
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      if (!list.some(o => o._id === opp._id)) list.push(opp);
    };
    for (const r of (oppsCache?.records || [])) {
      if (bfoOppNameOf(r) !== '') continue;
      if (CLOSED_OPP_STAGES.has(String(r.Stage || '').trim().toLowerCase())) continue;
      const acctKey = canonCompany(r.Account || '');
      add(acctKey, r);
      add(canonCompany(r['BFO Company Name'] || ''), r);
      const bfo = bfoCompanyByAccountCanon.get(acctKey);
      if (bfo) add(canonCompany(bfo), r);
    }
    return map;
  }, [oppsCache, bfoCompanyByAccountCanon]);

  // Tag the chosen Opps opp with the BFO Opportunity Name, persist through
  // the shared Opps 2 store, then refresh the local cache so the warning
  // reflects the new tag. Optimistically drops the opp off the candidate
  // lists immediately.
  async function assignBfoOppName(oppId, bfoName) {
    if (assigningBfo) return;
    setAssigningBfo(true);
    setOppsCache(prev => (prev && Array.isArray(prev.records))
      ? { ...prev, records: prev.records.map(r => (String(r._id) === String(oppId) ? { ...r, 'BFO Link': bfoName } : r)) }
      : prev);
    try {
      await setOppBfoLink(user?.uid, oppId, bfoName);
      const refreshed = await loadOppsFromCache();
      if (refreshed) setOppsCache(refreshed);
      setBfoAssignFlash(`Tagged an Opps opp with "${bfoName}".`);
    } catch (err) {
      setBfoAssignFlash(`Could not tag opp: ${err?.message || err}`);
    } finally {
      setAssigningBfo(false);
      window.setTimeout(() => setBfoAssignFlash(''), 3500);
    }
  }

  const dateLabel = useMemo(() => parseIsoDate(referenceDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), [referenceDate]);
  const isToday = referenceDate === todayIso();

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const oppsLoaded = (oppsCache?.records?.length || 0) > 0;

  // Single master prompt that bundles every AI Prompt section on the
  // page so the user can paste one block into their assistant instead
  // of copying each section one at a time. Each section keeps the
  // same prompt + appended data block its individual Copy button
  // would produce; sections are separated by a heading rule so the
  // assistant can still tell them apart.
  const masterPromptBundle = useMemo(() => {
    const activityLines = buildActivityAddressLines({
      meetings: allTodaysMeetings,
      markedMeetings: markedMeetingOpps,
      calls: calledOpps,
      emails: todaysOutbound,
    });
    const activityBlock = activityLines.join('\n');

    const newBfoLines = ['BFO Opportunities to Create', 'BFO Company Name | Project Name | Product Line | Local Project Name'];
    for (const o of newBfoOpps) {
      newBfoLines.push([o.bfoCompanyName, o.projectName, o.productLine, o.localProjectName].join(' | '));
    }
    const newBfoBlock = newBfoLines.join('\n');

    const closeDatesLines = ['Opportunity Name\tNew Close Date'];
    for (const o of closeDateOpps) closeDatesLines.push(`${o.name}\t${o.newClose}`);
    const closeDatesBlock = closeDatesLines.join('\n');

    const amountLines = ['BFO Address\tQuoted Amount'];
    for (const o of amountUpdateOpps) amountLines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
    const amountBlock = amountLines.join('\n');

    const stageLines = ['BFO Link\tNew Stage'];
    for (const o of stageChangeOpps) stageLines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
    const stageBlock = stageLines.join('\n');

    const closeNotSoldLines = ['BFO Link\tStatus\tReason\tCompetition'];
    for (const o of closeNotSoldOpps) {
      if (o.unmapped) continue;
      closeNotSoldLines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}\t${o.competition}`);
    }
    const closeNotSoldBlock = closeNotSoldLines.join('\n');

    const bfoPrepBlock = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');

    const marketingLeadsBlock = ['Name\tCompany', ...marketingLeadsMissing.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}`)].join('\n');

    const marketingLeadStatusBlock = ['Name\tCompany\tMarketing Leads Status', ...marketingLeadStatusRows.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}\t${(l.status || '').trim()}`)].join('\n');

    const duplicateLeadsBlock = [
      'Name\tCompany\tCopies\tLeads Subtab Statuses\tMarketing Leads Status',
      ...duplicateLeadRows.map(l => [
        l.name, l.company, l.copies, l.statuses.join(' | '), l.mlStatus,
      ].join('\t')),
    ].join('\n');

    const sections = [
      { title: 'BFO Prep', prompt: bfoPrepPrompt, block: bfoPrepBlock, hasData: bfoPrepOpps.length > 0 },
      { title: 'Activity', prompt: aiPrompt, block: activityBlock, hasData: activityLines.length > 1 },
      { title: 'New BFO Opp', prompt: newBfoOppPrompt, block: newBfoBlock, hasData: newBfoOpps.length > 0 },
      { title: 'Close Dates', prompt: closeDatesPrompt, block: closeDatesBlock, hasData: closeDateOpps.length > 0 },
      { title: 'Amount Updates', prompt: amountUpdatesPrompt, block: amountBlock, hasData: amountUpdateOpps.length > 0 },
      { title: 'Stage Change', prompt: stageChangePrompt, block: stageBlock, hasData: stageChangeOpps.length > 0 },
      { title: 'Close Not Solds', prompt: closeNotSoldsPrompt, block: closeNotSoldBlock, hasData: closeNotSoldLines.length > 1 },
      // Import Marketing Leads leads the three lead sections: it is the only
      // one that pulls new leads in from Salesforce, and the ones below can
      // only act on leads the tracker already holds. No data block of its
      // own — the whole job is to fetch a list this app doesn't have yet.
      { title: 'Import Marketing Leads', prompt: importMarketingLeadsPrompt, block: '', hasData: false, always: true },
      // Marketing Leads always rides along in the bundle, even with no leads
      // missing a Salesforce Link — its prompt stands alone as a reusable
      // instruction, so `always` keeps it in every copy regardless of data.
      { title: 'Marketing Leads', prompt: marketingLeadsPrompt, block: marketingLeadsBlock, hasData: marketingLeadsMissing.length > 0, always: true },
      { title: 'Marketing Lead Status Update', prompt: marketingLeadStatusUpdatePrompt, block: marketingLeadStatusBlock, hasData: marketingLeadStatusRows.length > 0, always: true },
      { title: 'Duplicate Leads', prompt: duplicateLeadsPrompt, block: duplicateLeadsBlock, hasData: duplicateLeadRows.length > 0, always: true },
    ];
    // Skip sections that carry no data — when a section is just its prompt
    // with an empty data block (no BFO links, names, or opportunities to
    // act on), there's nothing for the assistant to do, so leave it out of
    // the bundle. hasData checks the underlying rows (the header-only line
    // count for the deduped / filtered blocks) rather than the prompt text.
    // `always` sections stay in even when empty, dropping just their data
    // block so only the prompt itself carries through.
    const base = sections
      .filter(s => s.hasData || s.always)
      .map(s => s.hasData ? `===== ${s.title} =====\n${s.prompt}\n\n${s.block}` : `===== ${s.title} =====\n${s.prompt}`)
      .join('\n\n');
    // Update BFO Activity closes out the bundle (no data block of its own).
    const bfoSuffix = (updateBfoActivityPrompt || '').trim();
    if (!bfoSuffix) return base;
    const suffixSection = `===== Update BFO Activity =====\n${bfoSuffix}`;
    return base ? `${base}\n\n${suffixSection}` : suffixSection;
  }, [
    aiPrompt, newBfoOppPrompt, closeDatesPrompt, amountUpdatesPrompt,
    stageChangePrompt, closeNotSoldsPrompt, updateBfoActivityPrompt,
    bfoPrepPrompt, todaysOutbound, calledOpps, allTodaysMeetings, markedMeetingOpps, newBfoOpps, closeDateOpps,
    amountUpdateOpps, stageChangeOpps, closeNotSoldOpps, bfoPrepOpps,
    importMarketingLeadsPrompt, marketingLeadsPrompt, marketingLeadsMissing,
    marketingLeadStatusUpdatePrompt, marketingLeadStatusRows,
    duplicateLeadsPrompt, duplicateLeadRows,
  ]);

  const [copyAllFlash, setCopyAllFlash] = useState('');
  const onCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(masterPromptBundle);
      setCopyAllFlash('Copied all!');
    } catch {
      setCopyAllFlash('Copy failed');
    }
    window.setTimeout(() => setCopyAllFlash(''), 1500);
  };

  // One-click copy of the standard deal-folder setup command, ready to
  // paste into a terminal to scaffold the folder structure.
  const FOLDER_SETUP_COMMAND = 'md Presentations PRW.SIA.Proposal Agreement "Other Docs.NDA" "Final Paperwork" PCs "Old" "Compliance Screening"';
  const [foldersFlash, setFoldersFlash] = useState('');
  const onCopyFolders = async () => {
    try {
      await navigator.clipboard.writeText(FOLDER_SETUP_COMMAND);
      setFoldersFlash('Copied!');
    } catch {
      setFoldersFlash('Copy failed');
    }
    window.setTimeout(() => setFoldersFlash(''), 1500);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        <button
          type="button"
          className={styles.refreshActivityBtn}
          onClick={onCopyFolders}
          title={`Copy the folder-setup command to your clipboard:\n${FOLDER_SETUP_COMMAND}`}
        >Copy folders</button>
        {foldersFlash && <span className={styles.copyFlash}>{foldersFlash}</span>}
        {activeSubTab === 'automations' && (
          <>
            <span className={styles.dateline}>{dateLabel}</span>
            <label className={styles.dateField} title="Pick the date the activity sections (sent emails, meetings, called opps) should reference.">
              Activity date
              <input
                type="date"
                className={styles.dateInput}
                value={referenceDate}
                max={todayIso()}
                onChange={(e) => setReferenceDate(e.target.value || todayIso())}
              />
              {!isToday && (
                <button
                  type="button"
                  className={styles.dateResetBtn}
                  onClick={() => setReferenceDate(todayIso())}
                  title="Jump back to today"
                >Today</button>
              )}
            </label>
            <label
              className={styles.hideActivityField}
              title="Hide rows in the Called and Sent tables whose Last Activity falls within the past 2 business days (the selected Activity date or the previous business day)."
            >
              <input
                type="checkbox"
                checked={hideActivityOnDate}
                onChange={(e) => {
                  const on = e.target.checked;
                  setHideActivityOnDate(on);
                  writeHideActivityOnDate(on);
                }}
              />
              Hide rows last active in the past 2 business days
            </label>
            <button
              type="button"
              className={styles.refreshActivityBtn}
              onClick={refreshActivityCache}
              disabled={activityRefreshing}
              title="Re-pull every HubSpot email, call, and meeting AND re-sync Opps from the Opps tab's store (local cache reconciled against the cloud copy). Updates the shared activity cache (same as the Activity tab's Refresh)."
            >
              {activityRefreshing
                ? (activityRefreshProgress
                    ? `Refreshing… ${activityRefreshProgress.email || 0} email · ${activityRefreshProgress.call || 0} call · ${activityRefreshProgress.meeting || 0} meeting · ${activityRefreshProgress.opps || 0} opps`
                    : 'Refreshing…')
                : 'Refresh Activity & Opps'}
            </button>
            <button
              type="button"
              className={styles.refreshActivityBtn}
              onClick={onCopyAll}
              title="Copy every AI Prompt section on this page into one master prompt, ready to paste into an assistant."
            >Copy all prompts</button>
            {copyAllFlash && <span className={styles.copyFlash}>{copyAllFlash}</span>}
          </>
        )}
      </div>

      {agentsRunDue ? (
        <div className={styles.runAlert} role="status">
          <span className={styles.runAlertIcon} aria-hidden="true">!</span>
          <div className={styles.runAlertText}>
            <strong>Time to run the agent prompts.</strong>{' '}
            {agentsDaysSince == null
              ? 'No run recorded yet.'
              : `Last run ${agentsLastRunLabel} (${agentsDaysSince} day${agentsDaysSince === 1 ? '' : 's'} ago).`}
            {' '}Work through the prompts below, then mark the run to clear this
            alert: it comes back every {AGENTS_RUN_INTERVAL_BUSINESS_DAYS} business days.
            {' '}Not now? Snooze it instead &mdash; the run stays owed and the alert
            comes back when the snooze is up.
          </div>
          <div className={styles.runAlertActions} ref={snoozeMenuRef}>
            <button
              type="button"
              className={styles.runAlertBtnGhost}
              onClick={() => setSnoozeMenuOpen(o => !o)}
              disabled={!updateSettings}
              aria-haspopup="menu"
              aria-expanded={snoozeMenuOpen}
              title="Hide this alert (and the red dot on the Agents tab) for a while, without recording a run."
            >Snooze &#9662;</button>
            {snoozeMenuOpen && (
              <div className={styles.snoozeMenu} role="menu">
                <div className={styles.snoozeMenuLabel}>Snooze for</div>
                {AGENTS_SNOOZE_DURATIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    role="menuitem"
                    className={styles.snoozeMenuItem}
                    onClick={() => snoozeAgentsRun(opt)}
                    title={`Quiet until ${new Date(agentsSnoozeEndAt(opt)).toLocaleString()}`}
                  >{opt.label}</button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={styles.runAlertBtn}
              onClick={markAgentsRan}
              disabled={!updateSettings}
              title={`Record that you've run the agent prompts. Clears this alert and the red dot on the Agents tab for ${AGENTS_RUN_INTERVAL_BUSINESS_DAYS} business days.`}
            >Agents Ran</button>
          </div>
        </div>
      ) : agentsSnoozeUntilMs != null ? (
        <div className={styles.runStatus}>
          <span className={styles.runSnoozeIcon} aria-hidden="true">&#128164;</span>
          Agent prompts snoozed until {new Date(agentsSnoozeUntilMs).toLocaleString()}
          {agentsSnoozeLeft && ` (${agentsSnoozeLeft} left)`}
          {agentsLastRunLabel && ` · last run ${agentsLastRunLabel}`}
          <button
            type="button"
            className={styles.runStatusBtn}
            onClick={unsnoozeAgentsRun}
            disabled={!updateSettings}
            title="End the snooze now and bring the reminder back."
          >Un-snooze</button>
          <button
            type="button"
            className={styles.runStatusBtn}
            onClick={markAgentsRan}
            disabled={!updateSettings}
            title="Record a run now, ending the snooze and restarting the reminder clock."
          >Agents Ran</button>
        </div>
      ) : (
        <div className={styles.runStatus}>
          Agent prompts last run {agentsLastRunLabel}
          {agentsDaysLeft != null && ` · next reminder in ${agentsDaysLeft} day${agentsDaysLeft === 1 ? '' : 's'}`}
          <button
            type="button"
            className={styles.runStatusBtn}
            onClick={markAgentsRan}
            disabled={!updateSettings}
            title="Record another run now, restarting the reminder clock."
          >Agents Ran</button>
        </div>
      )}

      <div className={styles.subTabs}>
        <button
          type="button"
          className={activeSubTab === 'automations' ? styles.subTabActive : styles.subTab}
          onClick={() => selectSubTab('automations')}
        >Automations</button>
        <button
          type="button"
          className={activeSubTab === 'prompts' ? styles.subTabActive : styles.subTab}
          onClick={() => selectSubTab('prompts')}
        >Prompt Library</button>
      </div>

      {activeSubTab === 'prompts' && (
        <PromptLibrary prompts={savedPrompts} onChange={handleSavedPromptsChange} />
      )}

      {activeSubTab === 'automations' && (<>
      {bfoAssignFlash && (
        <div className={styles.bfoAssignFlash}>{bfoAssignFlash}</div>
      )}
      {untaggedBfoOppNames.length > 0 && (
        <div className={styles.warning}>
          <strong>
            ⚠ {untaggedBfoOppNames.length} BFO Opportunity Name{untaggedBfoOppNames.length === 1 ? '' : 's'} not tagged to an opp on Opps
          </strong>
          <div className={styles.warningHint}>
            Click an Opps opp below to tag it with the BFO Opportunity Name. Only opps that don&apos;t already have a BFO Opportunity Name are listed.
          </div>
          <ul className={styles.warnList}>
            {untaggedBfoOppNames.map(({ name, account }) => {
              const candidates = untaggedOppsByCanonKey.get(canonCompany(account)) || [];
              return (
                <li key={name} className={styles.warnItem}>
                  <div className={styles.warnName}>
                    <span className={styles.warnNameText}>{name}</span>
                    {account && <span className={styles.warnAcct}> · {account}</span>}
                  </div>
                  {candidates.length === 0 ? (
                    <div className={styles.warnNone}>
                      No untagged Opps opps{account ? ` for “${account}”` : ''} to assign.
                    </div>
                  ) : (
                    <div className={styles.warnChips}>
                      {candidates.map(c => (
                        <button
                          key={c._id}
                          type="button"
                          className={styles.assignChip}
                          disabled={assigningBfo}
                          title={`Tag this opp's BFO Opportunity Name as "${name}"`}
                          onClick={() => assignBfoOppName(c._id, name)}
                        >
                          + {bfoOppTargetLabel(c)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {newBfoMissingData.length > 0 && (
        <div className={styles.errorBanner}>
          <strong>New BFO Opp prompt is missing data for {newBfoMissingData.length} opp{newBfoMissingData.length === 1 ? '' : 's'}:</strong>{' '}
          {newBfoMissingData.map((m, i) => (
            <span key={m.company + i}>
              {i > 0 && '; '}
              <strong>{m.company}</strong>: {m.missing.join(', ')}
            </span>
          ))}
          {' '}(BFO Company Name comes from the company&rsquo;s Table View record; Product Line / Type / Region / Local Project Name come from Dropdowns › Services for the opp&rsquo;s Scope.)
        </div>
      )}
      {activityRefreshError && (
        <div className={styles.staleBanner}>
          Refresh failed: {activityRefreshError}
        </div>
      )}
      {senderEmail ? (
        <p className={styles.subnote}>
          The Activity table merges outbound emails from <strong>{senderEmail}</strong> (to non-SE recipients, past 2 business days), logged calls from the Opps tab, and meetings on {isToday ? 'today' : `${dateLabel}`}&rsquo;s calendar: the Type column marks each row as Email, Call, or Meeting. Meetings come from HubSpot and from the Granola notes the Call Recordings page has stored &mdash; a Granola call that nobody has logged in HubSpot yet is added if it ties to an opportunity, badged <em>Granola</em>, and linked to its note. BFO Opportunity tagging walks each recipient&rsquo;s email against the Opps tab&rsquo;s Contact field first, then estimates by company name: fuzzy-matching the HubSpot company (or, when there&rsquo;s no HubSpot contact, the company guessed from the email domain) against the Opps tab&rsquo;s Account field. Use the inline picker to set or change any tag (it shows that company&rsquo;s opportunities first); your selection is remembered for that recipient on future emails. The BFO Company Name column is resolved from the Company. Use the Columns menu to choose which columns are shown.
        </p>
      ) : (
        <div className={styles.staleBanner}>
          Set your work email in Settings → CDM Name so this section can match your outbound HubSpot emails. Until then, no Sent emails will appear.
        </div>
      )}

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>sent emails</div>
        <div className={styles.tally}><strong>{calledOpps.length}</strong>call{calledOpps.length === 1 ? '' : 's'}</div>
        <div className={styles.tally}><strong>{allTodaysMeetings.length + markedMeetingOpps.length}</strong>meeting{(allTodaysMeetings.length + markedMeetingOpps.length) === 1 ? '' : 's'}</div>
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
        </div>
      )}
      {cache && !oppsLoaded && (
        <div className={styles.staleBanner}>
          No Opps cache loaded yet. Visit the Opps tab to populate the BFO Opportunity column.
        </div>
      )}
      {cache && fetchedLabel && (
        <div className={styles.subnote}>Cache last refreshed {fetchedLabel}.</div>
      )}

      <section className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <h2 className={styles.sectionHeader}>
            Activity <span className={styles.sectionCount}>{activityRows.length}</span>
          </h2>
          <div ref={activityColsMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setActivityColsMenuOpen(o => !o)}
              title="Choose which columns are visible on the Activity table"
            >
              Columns ({ACTIVITY_COLUMNS.length - hiddenActivityCols.size}/{ACTIVITY_COLUMNS.length}) ▾
            </button>
            {activityColsMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '0.35rem', minWidth: 190 }}>
                {ACTIVITY_COLUMNS.map(col => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.25rem 0.4rem', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={isActivityColVisible(col.key)} onChange={() => toggleActivityCol(col.key)} />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              {isActivityColVisible('time') && <th style={{ width: 110 }}>Time</th>}
              {isActivityColVisible('type') && <th style={{ width: 80 }}>Type</th>}
              {isActivityColVisible('subject') && <th>Subject / Title</th>}
              {isActivityColVisible('to') && <th>To (external)</th>}
              {isActivityColVisible('company') && <th>Company</th>}
              {isActivityColVisible('bfoCompanyName') && <th>BFO Company Name</th>}
              {isActivityColVisible('bfoOpp') && <th>BFO Opportunity</th>}
              {isActivityColVisible('lastActivity') && <th style={{ width: 110 }}>Last Activity</th>}
              {isActivityColVisible('bfoLink') && <th style={{ width: 70 }}>BFO Link</th>}
              {isActivityColVisible('outcome') && <th style={{ width: 130 }}>Outcome / Status</th>}
              {isActivityColVisible('location') && <th>Location</th>}
              <th style={{ width: 64 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {activityRows.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={ACTIVITY_COLUMNS.length - hiddenActivityCols.size + 1}>No activity (emails, calls, or meetings) for {isToday ? 'today' : dateLabel}.</td>
              </tr>
            ) : activityRows.map(r => {
                const lastActivity = lastActivityFor(r.bfoOpp);
                const bfoCompanyName = resolveBfoCompanyName(r);
                const typeLabel = r.type === 'email' ? 'Email' : r.type === 'call' ? 'Call' : 'Meeting';
                // Rows born from the Opps tab's Called/Meeting buttons get
                // a chip so it's clear where the flag came from.
                const markedChip = r.marked ? (
                  <span
                    title="Marked with the Called/Meeting buttons on the Opps tab"
                    style={{
                      marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                      color: '#166534', background: '#DCFCE7', border: '1px solid #86EFAC',
                      borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                    }}
                  >Opps ✓</span>
                ) : null;
                // A meeting that came from a Granola note rather than from
                // a HubSpot log. Says where the row is from — and that
                // nobody has logged it yet — and links straight to the note.
                const granolaChip = r.source === 'granola' ? (
                  r.granolaUrl ? (
                    <a
                      href={r.granolaUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="From a Granola note on the Call Recordings page — open the note"
                      style={{
                        marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                        color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD',
                        borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                        textDecoration: 'none',
                      }}
                    >Granola ↗</a>
                  ) : (
                    <span
                      title="From a Granola note on the Call Recordings page"
                      style={{
                        marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                        color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD',
                        borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                      }}
                    >Granola</span>
                  )
                ) : null;
                return (
                <tr key={r.rowKey}>
                  {isActivityColVisible('time') && <td className={r.ts ? '' : styles.muted}>{r.ts ? `${fmtTime(r.ts)}${r.endTs ? ` – ${fmtTime(r.endTs)}` : ''}` : '-'}</td>}
                  {isActivityColVisible('type') && <td>{typeLabel}{markedChip}{granolaChip}</td>}
                  {isActivityColVisible('subject') && <td className={r.title ? '' : styles.muted} title={r.title}>{r.title || '-'}</td>}
                  {isActivityColVisible('to') && <td title={r.rawTo}>{r.to || <span className={styles.muted}>-</span>}</td>}
                  {isActivityColVisible('company') && <td className={r.company ? '' : styles.muted}>{r.company || '-'}</td>}
                  {isActivityColVisible('bfoCompanyName') && <td className={bfoCompanyName ? '' : styles.muted}>{bfoCompanyName || '-'}</td>}
                  {isActivityColVisible('bfoOpp') && (
                    <td>
                      {r.editable ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {r.bfoOpp && (
                            <span className={styles.overrideValue}>
                              {r.bfoOpp}
                              {r.isManual && (
                                <button
                                  type="button"
                                  className={styles.overrideClear}
                                  onClick={() => clearOverride(r.overrideKey)}
                                  title="Clear manual tag (revert to auto-match)"
                                >✕</button>
                              )}
                            </span>
                          )}
                          <OppPicker
                            oppsCache={oppsCache}
                            company={r.company}
                            triggerLabel={r.bfoOpp ? '✎ Change' : '+ Pick opportunity'}
                            onSelect={(opp) => setOverride(r.overrideKey, opp)}
                          />
                        </div>
                      ) : (
                        <span className={r.bfoOpp ? '' : styles.muted} title={r.title}>{r.bfoOpp || '-'}</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('lastActivity') && <td className={lastActivity ? '' : styles.muted}>{lastActivity || '-'}</td>}
                  {isActivityColVisible('bfoLink') && (
                    <td>
                      {(r.bfoUrl || r.leadSfUrl) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {r.bfoUrl && (
                            <a
                              href={r.bfoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.bfoLink}
                            >Open</a>
                          )}
                          {r.leadSfUrl && (
                            <a
                              href={r.leadSfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.bfoLink}
                              title={`Log this activity on the matched Marketing Lead${r.leadName ? ` (${r.leadName})` : ''} in Salesforce`}
                            >Lead ↗</a>
                          )}
                        </span>
                      ) : (
                        <span className={styles.muted}>-</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('outcome') && <td className={r.outcome ? '' : styles.muted}>{r.outcome || '-'}</td>}
                  {isActivityColVisible('location') && <td className={r.location ? '' : styles.muted}>{r.location || '-'}</td>}
                  <td className={styles.actionsCell}>
                    {r.type === 'email' && (
                      <>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => ignoreEmail(r.emailId)}
                          title="Hide just this email from the Activity table"
                          aria-label="Ignore email"
                        >✕</button>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => excludeRecipient(r.recipients)}
                          disabled={!r.recipients?.length}
                          title={r.recipients?.length
                            ? `Don't include emails to ${r.recipients.join(', ')} moving forward`
                            : 'No external recipient to exclude'}
                          aria-label="Exclude recipient from future activity"
                        >🚫</button>
                      </>
                    )}
                    {r.type === 'meeting' && r.meetingId && (
                      <button
                        type="button"
                        className={styles.ignoreBtn}
                        onClick={() => ignoreMeeting(r.meetingId)}
                        title="Hide this meeting from the Activity table"
                        aria-label="Ignore meeting"
                      >✕</button>
                    )}
                  </td>
                </tr>
                );
              })}
          </tbody>
        </table>
        {hideActivityOnDate && activityHiddenCount > 0 && (
          <p className={styles.subnote}>
            Hiding {activityHiddenCount} row{activityHiddenCount === 1 ? '' : 's'} last active in the past 2 business days.
          </p>
        )}
        {excludedRecipients.length > 0 && (
          <p className={styles.subnote}>
            Hiding emails to {excludedRecipients.length} excluded recipient{excludedRecipients.length === 1 ? '' : 's'} ({excludedRecipients.join(', ')}).{' '}
            <button type="button" className={styles.linkBtn} onClick={clearExcludedRecipients}>Restore all</button>
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          AI BFO Prep
          <span className={styles.sectionCount}>{bfoPrepOpps.length}</span>
        </h2>
        <p className={styles.subnote}>
          Live Opps opps (Stage not Sold / Not Sold) with a Call In number that have a BFO Opportunity Name but no BFO Address yet. Copy the prompt to have your AI assistant look up each opp&rsquo;s BFO website address, then paste it into the BFO Address column below: it saves straight to Opps and the row drops off once set.
        </p>
        {revealedPrompts.bfoPrep && (
          <textarea
            className={styles.aiPromptInput}
            value={bfoPrepPrompt}
            onChange={(e) => updateBfoPrepPrompt(e.target.value)}
            rows={12}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            disabled={bfoPrepOpps.length === 0}
            onClick={async () => {
              const block = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');
              const fullPrompt = `${bfoPrepPrompt}\n\n${block}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setBfoPrepCopyFlash('Copied!');
              } catch {
                setBfoPrepCopyFlash('Copy failed');
              }
              window.setTimeout(() => setBfoPrepCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('bfoPrep')}>
            {revealedPrompts.bfoPrep ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.bfoPrep && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetBfoPrepPrompt}>Reset to default</button>
          )}
          {bfoPrepCopyFlash && <span className={styles.copyFlash}>{bfoPrepCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Company</th>
                <th>BFO Opportunity Name</th>
                <th style={{ minWidth: 280 }}>BFO Address</th>
              </tr>
            </thead>
            <tbody>
              {bfoPrepOpps.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={3}>No opps are missing a BFO Address (every opp with a BFO Opportunity Name already has one).</td>
                </tr>
              ) : bfoPrepOpps.map(o => (
                <tr key={o.id}>
                  <td className={o.account ? '' : styles.muted}>{o.account || '-'}</td>
                  <td>{o.name}</td>
                  <td>
                    <BfoAddressCell
                      value={o.bfoAddress}
                      onCommit={(v) => updateOppBfoAddress(o.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>Import Marketing Leads</h2>
        <p className={styles.subnote}>
          Pulls the Salesforce Leads list into the app: the assistant copies the Leads printable view and pastes it into the Contacts page&rsquo;s <strong>Marketing Leads</strong> subtab, then into the BFO Activity page&rsquo;s <strong>Leads</strong> subtab. Leads already saved are skipped by email, so the whole list can be pasted every time. This is the only prompt that brings <em>new</em> leads in &mdash; the three below act on leads the app already holds, so run this first. Leads it imports won&rsquo;t appear in the lists below until you copy the prompts again. The prompt is always part of &ldquo;Copy all prompts.&rdquo;
        </p>
        {revealedPrompts.importMarketingLeads && (
          <textarea
            className={styles.aiPromptInput}
            value={importMarketingLeadsPrompt}
            onChange={(e) => updateImportMarketingLeadsPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(importMarketingLeadsPrompt);
                setImportMarketingLeadsCopyFlash('Copied!');
              } catch {
                setImportMarketingLeadsCopyFlash('Copy failed');
              }
              window.setTimeout(() => setImportMarketingLeadsCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('importMarketingLeads')}>
            {revealedPrompts.importMarketingLeads ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.importMarketingLeads && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetImportMarketingLeadsPrompt}>Reset to default</button>
          )}
          {importMarketingLeadsCopyFlash && <span className={styles.copyFlash}>{importMarketingLeadsCopyFlash}</span>}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Marketing Leads
          <span className={styles.sectionCount}>{marketingLeadsMissing.length}</span>
        </h2>
        <p className={styles.subnote}>
          Leads from the Marketing Leads subtab on the Contacts page that don&rsquo;t have a Salesforce Link yet. Copy the prompt to have your AI assistant open each lead in Salesforce and grab its record URL, then paste it into the Salesforce Link column below: it saves straight to the Marketing Leads page and the row drops off this list once set.
        </p>
        {revealedPrompts.marketingLeads && (
          <textarea
            className={styles.aiPromptInput}
            value={marketingLeadsPrompt}
            onChange={(e) => updateMarketingLeadsPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              // With no leads missing a link there's no data block to append,
              // so copy the prompt on its own — it's still useful standalone.
              const fullPrompt = marketingLeadsMissing.length === 0
                ? marketingLeadsPrompt
                : `${marketingLeadsPrompt}\n\n${['Name\tCompany', ...marketingLeadsMissing.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}`)].join('\n')}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setMarketingLeadsCopyFlash('Copied!');
              } catch {
                setMarketingLeadsCopyFlash('Copy failed');
              }
              window.setTimeout(() => setMarketingLeadsCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('marketingLeads')}>
            {revealedPrompts.marketingLeads ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.marketingLeads && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetMarketingLeadsPrompt}>Reset to default</button>
          )}
          {marketingLeadsCopyFlash && <span className={styles.copyFlash}>{marketingLeadsCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th style={{ minWidth: 280 }}>Salesforce Link</th>
              </tr>
            </thead>
            <tbody>
              {marketingLeadsMissing.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={3}>No marketing leads are missing a Salesforce Link.</td>
                </tr>
              ) : marketingLeadsMissing.map((l, i) => (
                <tr key={l.id || `${l.name}-${i}`}>
                  <td>{l.name || '-'}</td>
                  <td className={l.company ? '' : styles.muted}>{l.company || '-'}</td>
                  <td>
                    <MarketingLeadSfCell
                      value={l.sfUrl}
                      onCommit={(v) => updateMarketingLeadSfUrl(l.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Marketing Lead Status Update
          <span className={styles.sectionCount}>{marketingLeadStatusRows.length}</span>
        </h2>
        <p className={styles.subnote}>
          Only lists leads whose Marketing Leads Status (the source of truth on the Contacts page) differs from that lead&rsquo;s status on the BFO Activity page&rsquo;s <strong>Leads</strong> subtab: the ones that actually need updating. Leads that match, or that aren&rsquo;t on the Leads subtab, are hidden. Copy the prompt to have your AI assistant open each lead by name, go to the Assessment tab, and update the status to the Marketing Leads Status. Paste the Salesforce Leads printable view into the BFO Activity page&rsquo;s Leads subtab to feed this comparison. The prompt is always part of &ldquo;Copy all prompts.&rdquo;
        </p>
        {revealedPrompts.marketingLeadStatusUpdate && (
          <textarea
            className={styles.aiPromptInput}
            value={marketingLeadStatusUpdatePrompt}
            onChange={(e) => updateMarketingLeadStatusUpdatePrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              // With no leads carrying a Status there's nothing to reconcile,
              // so copy the prompt on its own — it's still useful standalone.
              const fullPrompt = marketingLeadStatusRows.length === 0
                ? marketingLeadStatusUpdatePrompt
                : `${marketingLeadStatusUpdatePrompt}\n\n${['Name\tCompany\tMarketing Leads Status', ...marketingLeadStatusRows.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}\t${(l.status || '').trim()}`)].join('\n')}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setMarketingLeadStatusUpdateCopyFlash('Copied!');
              } catch {
                setMarketingLeadStatusUpdateCopyFlash('Copy failed');
              }
              window.setTimeout(() => setMarketingLeadStatusUpdateCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('marketingLeadStatusUpdate')}>
            {revealedPrompts.marketingLeadStatusUpdate ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.marketingLeadStatusUpdate && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetMarketingLeadStatusUpdatePrompt}>Reset to default</button>
          )}
          {marketingLeadStatusUpdateCopyFlash && <span className={styles.copyFlash}>{marketingLeadStatusUpdateCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Leads Subtab Status</th>
                <th>Marketing Leads Status (apply)</th>
              </tr>
            </thead>
            <tbody>
              {marketingLeadStatusRows.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={4}>
                    {leadsSubtabByName.size === 0
                      ? 'Paste the Salesforce Leads printable view into the BFO Activity page’s Leads subtab to compare statuses.'
                      : 'No status discrepancies: every matched lead already agrees with the Leads subtab.'}
                  </td>
                </tr>
              ) : marketingLeadStatusRows.map((l, i) => (
                <tr key={l.id || `${l.name}-${i}`}>
                  <td>{l.name || '-'}</td>
                  <td className={l.company ? '' : styles.muted}>{l.company || '-'}</td>
                  <td className={l.bfoStatus ? '' : styles.muted}>{l.bfoStatus || '-'}</td>
                  <td className={l.status ? '' : styles.muted}>{l.status || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Duplicate Leads
          <span className={styles.sectionCount}>{duplicateLeadRows.length}</span>
        </h2>
        <p className={styles.subnote}>
          Leads that appear more than once on the BFO Activity page&rsquo;s <strong>Leads</strong> subtab &mdash; the same person carrying more than one Salesforce Lead record &mdash; where at least one of those copies disagrees with that lead&rsquo;s Marketing Leads Status (the source of truth on the Contacts page). Duplicates whose copies all agree aren&rsquo;t listed: there&rsquo;s no status to fix on them. Neither are leads the Marketing Leads page doesn&rsquo;t carry, which there&rsquo;s nothing to compare against. Paste the Salesforce Leads printable view into the Leads subtab to feed this. The prompt is always part of &ldquo;Copy all prompts.&rdquo;
        </p>
        {revealedPrompts.duplicateLeads && (
          <textarea
            className={styles.aiPromptInput}
            value={duplicateLeadsPrompt}
            onChange={(e) => updateDuplicateLeadsPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              // No duplicates means no data block to append, so copy the
              // prompt on its own — it still reads as an instruction.
              const fullPrompt = duplicateLeadRows.length === 0
                ? duplicateLeadsPrompt
                : `${duplicateLeadsPrompt}\n\n${[
                  'Name\tCompany\tCopies\tLeads Subtab Statuses\tMarketing Leads Status',
                  ...duplicateLeadRows.map(l => [
                    l.name, l.company, l.copies, l.statuses.join(' | '), l.mlStatus,
                  ].join('\t')),
                ].join('\n')}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setDuplicateLeadsCopyFlash('Copied!');
              } catch {
                setDuplicateLeadsCopyFlash('Copy failed');
              }
              window.setTimeout(() => setDuplicateLeadsCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('duplicateLeads')}>
            {revealedPrompts.duplicateLeads ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.duplicateLeads && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetDuplicateLeadsPrompt}>Reset to default</button>
          )}
          {duplicateLeadsCopyFlash && <span className={styles.copyFlash}>{duplicateLeadsCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Copies</th>
                <th>Leads Subtab Statuses</th>
                <th>Marketing Leads Status (apply)</th>
              </tr>
            </thead>
            <tbody>
              {duplicateLeadRows.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={5}>
                    {leadsSubtabByName.size === 0
                      ? 'Paste the Salesforce Leads printable view into the BFO Activity page\u2019s Leads subtab to find duplicate leads.'
                      : 'No duplicate lead has a status mismatch: every lead pasted twice already agrees with its Marketing Leads Status.'}
                  </td>
                </tr>
              ) : duplicateLeadRows.map((l, i) => (
                <tr key={l.key || `${l.name}-${i}`}>
                  <td>{l.name || '-'}</td>
                  <td className={l.company ? '' : styles.muted}>{l.company || '-'}</td>
                  <td>{l.copies}</td>
                  <td className={l.statuses.length ? '' : styles.muted}>{l.statuses.join(', ') || '-'}</td>
                  <td>{l.mlStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(() => {
        const addressBlock = buildActivityAddressLines({
          meetings: allTodaysMeetings,
          markedMeetings: markedMeetingOpps,
          calls: calledOpps,
          emails: todaysOutbound,
        }).join('\n');
        const fullPrompt = `${aiPrompt}\n\n${addressBlock}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCopyFlash('Copied!');
          } catch {
            setCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Activity)</h2>
            <p className={styles.subnote}>
              The past 2 business days&rsquo; BFO addresses (sent emails, calls, and meetings marked on the Opps tab) are appended automatically. When an email&rsquo;s external recipient matches a Marketing Lead (Contacts tab), that lead&rsquo;s Salesforce Link is appended too so the touch is logged on the lead as well. Click Copy to grab the full prompt for your AI assistant, or Edit prompt to tweak the wording.
            </p>
            {revealedPrompts.activity && (
              <textarea
                className={styles.aiPromptInput}
                value={aiPrompt}
                onChange={(e) => updateAiPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('activity')}>
                {revealedPrompts.activity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.activity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAiPrompt}>Reset to default</button>
              )}
              {copyFlash && <span className={styles.copyFlash}>{copyFlash}</span>}
            </div>
            {revealedPrompts.activity && (
              <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            )}
          </section>
        );
      })()}

      {(() => {
        // New BFO Opp prompt — table of qualifying opps the AI assistant
        // should create in BFO. The user only needs BFO Company Name and
        // Project Name in the pasted block; the rest of the fields stay
        // on the New BFO Opp table for review but are dropped from the
        // prompt to keep the AI focused.
        const header = 'BFO Company Name | Project Name | Product Line | Local Project Name';
        const lines = ['BFO Opportunities to Create', header];
        for (const o of newBfoOpps) {
          lines.push([
            o.bfoCompanyName,
            o.projectName,
            o.productLine,
            o.localProjectName,
          ].join(' | '));
        }
        const block = lines.join('\n');
        const fullPrompt = `${newBfoOppPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setNewBfoOppCopyFlash('Copied!');
          } catch {
            setNewBfoOppCopyFlash('Copy failed');
          }
          window.setTimeout(() => setNewBfoOppCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (New BFO Opp)
              <span className={styles.sectionCount}>{newBfoOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Lists Opps whose Stage is not Not Started / Not Sold / Sold and whose BFO Opportunity Name is &ldquo;-&rdquo; (the placeholder for opps that still need a BFO opp created). Blank or &ldquo;#N/A&rdquo; values are excluded.
            </p>
            {revealedPrompts.newBfoOpp && (
              <textarea
                className={styles.aiPromptInput}
                value={newBfoOppPrompt}
                onChange={(e) => updateNewBfoOppPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('newBfoOpp')}>
                {revealedPrompts.newBfoOpp ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.newBfoOpp && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetNewBfoOppPrompt}>Reset to default</button>
              )}
              {newBfoOppCopyFlash && <span className={styles.copyFlash}>{newBfoOppCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Company</th>
                    <th>BFO Company Name</th>
                    <th>Lead Source</th>
                    <th style={{ width: 110 }}>Current Customer</th>
                    <th>Scope</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th>Project Name</th>
                    <th>Product Line</th>
                    <th>Local Project Name</th>
                    <th>Type</th>
                    <th>Region</th>
                    <th>Class</th>
                    <th>Years</th>
                  </tr>
                </thead>
                <tbody>
                  {newBfoOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={14}>No Opps currently match (Stage ≠ Not Started / Not Sold / Sold and BFO Opportunity Name is &ldquo;-&rdquo;).</td>
                    </tr>
                  ) : newBfoOpps.map(o => {
                    const matchedProspect = prospectByNorm.get(normalizeCompany(o.company)) || null;
                    return (
                    <tr key={o.id}>
                      <td>
                        {o.raw && (
                          <button
                            type="button"
                            onClick={() => setInfoOpp(o.raw)}
                            title="Show opp info"
                            style={{
                              padding: 0, width: 22, height: 22, lineHeight: 1,
                              fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
                              color: 'var(--color-accent)', background: '#fff',
                              border: '1px solid var(--color-accent)', borderRadius: '50%',
                              cursor: 'pointer',
                            }}
                          >i</button>
                        )}
                      </td>
                      <td className={o.company && o.company !== '-' ? '' : styles.muted}>{o.company || '-'}</td>
                      <NewBfoCompanyNameCell
                        prospect={matchedProspect}
                        value={o.bfoCompanyName}
                        onCommit={(v) => updateProspect && matchedProspect && updateProspect(matchedProspect.id, { bfoCompanyName: v })}
                      />
                      <td className={o.leadSource && o.leadSource !== '-' ? '' : styles.muted}>{o.leadSource || '-'}</td>
                      <td>
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: o.currentCustomer ? '#DCFCE7' : '#F1F5F9',
                          color: o.currentCustomer ? '#166534' : '#64748B',
                          border: `1px solid ${o.currentCustomer ? '#86EFAC' : '#CBD5E1'}`,
                        }}>{o.currentCustomer ? 'Yes' : 'No'}</span>
                      </td>
                      <td className={o.scope && o.scope !== '-' ? '' : styles.muted}>{o.scope || '-'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '-'}</td>
                      <td className={o.projectName ? '' : styles.muted}>{o.projectName || '-'}</td>
                      <td className={o.productLine ? '' : styles.muted}>{o.productLine || '-'}</td>
                      <td className={o.localProjectName ? '' : styles.muted}>{o.localProjectName || '-'}</td>
                      <td className={o.type ? '' : styles.muted}>{o.type || '-'}</td>
                      <td className={o.region ? '' : styles.muted}>{o.region || '-'}</td>
                      <td className={o.class ? '' : styles.muted}>{o.class || '-'}</td>
                      <td className={o.years ? '' : styles.muted}>{o.years || '-'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            {infoOpp && (
              <OppInfoModal
                opp={infoOpp}
                headers={oppsCache?.headers || []}
                onClose={() => setInfoOpp(null)}
              />
            )}
          </section>
        );
      })()}

      {(() => {
        // Close Dates prompt — a tab-delimited "Opportunity Name | New
        // Close Date" block the AI assistant can read row-by-row to
        // bump each opp's BFO Close Date 30 days out.
        const headerLine = 'Opportunity Name\tNew Close Date';
        const lines = [headerLine];
        for (const o of closeDateOpps) lines.push(`${o.name}\t${o.newClose}`);
        const block = lines.join('\n');
        const fullPrompt = `${closeDatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseDatesCopyFlash('Copied!');
          } catch {
            setCloseDatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseDatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Dates)
              <span className={styles.sectionCount}>{closeDateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              BFO opps that should slip 30 days: Stage ≤ 4 with under 100 days to close, Stage 5 under 60 days, Stage 6 under 30 days. Stages come from the BFO Activity tab: paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.closeDates && (
              <textarea
                className={styles.aiPromptInput}
                value={closeDatesPrompt}
                onChange={(e) => updateCloseDatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeDates')}>
                {revealedPrompts.closeDates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeDates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseDatesPrompt}>Reset to default</button>
              )}
              {closeDatesCopyFlash && <span className={styles.copyFlash}>{closeDatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>Current Close</th>
                    <th style={{ width: 90 }}>Days Out</th>
                    <th style={{ width: 130 }}>New Close Date</th>
                  </tr>
                </thead>
                <tbody>
                  {closeDateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={5}>No BFO opps currently meet the close-date slip criteria. Confirm the BFO Activity tab has fresh data.</td>
                    </tr>
                  ) : closeDateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.stageLabel || `Stage ${o.stage}`}</td>
                      <td>{o.currentClose}</td>
                      <td>{o.daysOut}</td>
                      <td>{o.newClose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Amount Updates prompt — for every BFO opp whose Amount disagrees
        // with the Opps tab's Quoted Amount, emit "BFO Address\tQuoted
        // Amount" so the AI assistant can open each link and bump the
        // BFO Unit Amount to match.
        const headerLine = 'BFO Address\tQuoted Amount';
        const lines = [headerLine];
        for (const o of amountUpdateOpps) lines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
        const block = lines.join('\n');
        const fullPrompt = `${amountUpdatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setAmountUpdatesCopyFlash('Copied!');
          } catch {
            setAmountUpdatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setAmountUpdatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Amount updates)
              <span className={styles.sectionCount}>{amountUpdateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Amount disagrees with the Opps tab&rsquo;s Quoted Amount. Join key is BFO Opportunity Name. BFO amounts come from the BFO Activity tab: paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.amountUpdates && (
              <textarea
                className={styles.aiPromptInput}
                value={amountUpdatesPrompt}
                onChange={(e) => updateAmountUpdatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('amountUpdates')}>
                {revealedPrompts.amountUpdates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.amountUpdates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAmountUpdatesPrompt}>Reset to default</button>
              )}
              {amountUpdatesCopyFlash && <span className={styles.copyFlash}>{amountUpdatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>BFO Amount</th>
                    <th style={{ width: 120 }}>Quoted Amount</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {amountUpdateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No discrepancies: every BFO opp matched against the Opps tab has the same amount. Confirm the BFO Activity tab has fresh data if you expected mismatches.</td>
                    </tr>
                  ) : amountUpdateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '-'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '-'}</td>
                      <td>{fmtMoney(o.bfoAmount)}</td>
                      <td>{o.quotedAmountFmt}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Stage Change prompt — every opp whose BFO Sales Stage doesn't
        // match what its current Opps 2 Stage maps to gets a
        // "BFO Link\tNew Stage" line so the AI assistant can update BFO.
        const headerLine = 'BFO Link\tNew Stage';
        const lines = [headerLine];
        for (const o of stageChangeOpps) lines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
        const block = lines.join('\n');
        const fullPrompt = `${stageChangePrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setStageChangeCopyFlash('Copied!');
          } catch {
            setStageChangeCopyFlash('Copy failed');
          }
          window.setTimeout(() => setStageChangeCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Stage Change)
              <span className={styles.sectionCount}>{stageChangeOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Sales Stage doesn&rsquo;t match what their Opps Stage implies. Join key is BFO Opportunity Name. BFO stages come from the BFO Activity tab: paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.stageChange && (
              <textarea
                className={styles.aiPromptInput}
                value={stageChangePrompt}
                onChange={(e) => updateStageChangePrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('stageChange')}>
                {revealedPrompts.stageChange ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.stageChange && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetStageChangePrompt}>Reset to default</button>
              )}
              {stageChangeCopyFlash && <span className={styles.copyFlash}>{stageChangeCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Opps Stage</th>
                    <th>BFO Stage (current)</th>
                    <th>New BFO Stage</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {stageChangeOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No stage mismatches: every BFO opp matched against the Opps tab is on the BFO stage its Opps Stage maps to.</td>
                    </tr>
                  ) : stageChangeOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '-'}</td>
                      <td>{o.oppsStage}</td>
                      <td>{o.bfoStage}</td>
                      <td>{o.expectedBfoStage}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Close Not Solds prompt — every Not-Sold Opps 2 opp that's
        // still open on the BFO Activity tab. Output is a tab-delimited
        // "BFO Link\tStatus\tReason\tCompetition" block so the AI
        // assistant can walk each row and close it out. Rows without a
        // known Reason Not Sold mapping leave Status / Reason blank —
        // surfaced in the table so the user can act on them.
        const headerLine = 'BFO Link\tStatus\tReason\tCompetition';
        const lines = [headerLine];
        for (const o of closeNotSoldOpps) {
          if (o.unmapped) continue;
          lines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}\t${o.competition}`);
        }
        const block = lines.join('\n');
        const fullPrompt = `${closeNotSoldsPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseNotSoldsCopyFlash('Copied!');
          } catch {
            setCloseNotSoldsCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseNotSoldsCopyFlash(''), 1500);
        };
        const unmappedCount = closeNotSoldOpps.filter(o => o.unmapped).length;
        const readyCount = closeNotSoldOpps.length - unmappedCount;
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Not Solds)
              <span className={styles.sectionCount}>{closeNotSoldOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Not-Sold Opps rows that still have a matching BFO Activity row. Status + Reason come from the Reason Not Sold + Competition → BFO mapping. Rows whose combination isn&rsquo;t in the mapping table (including a blank or N/A Competition) are listed (highlighted) so you can update them on Opps or extend the mapping.
            </p>
            {!closeNotSoldBfoReady && (
              <div className={styles.warning}>
                <strong>⚠ No BFO Activity data to check against</strong>
                <div className={styles.warningHint}>
                  This list only holds opps still open in BFO, and there are no BFO Activity rows with an Opportunity Name column to test that against &mdash; so nothing is listed. Paste the BFO Opportunity printable view into the <strong>BFO Activity</strong> tab (the &ldquo;Update BFO Activity&rdquo; prompt below walks through it), then come back.
                </div>
              </div>
            )}
            {revealedPrompts.closeNotSolds && (
              <textarea
                className={styles.aiPromptInput}
                value={closeNotSoldsPrompt}
                onChange={(e) => updateCloseNotSoldsPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeNotSolds')}>
                {revealedPrompts.closeNotSolds ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeNotSolds && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseNotSoldsPrompt}>Reset to default</button>
              )}
              {closeNotSoldsCopyFlash && <span className={styles.copyFlash}>{closeNotSoldsCopyFlash}</span>}
            </div>
            {closeNotSoldOpps.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
                {readyCount} ready · {unmappedCount} need a mapped Reason Not Sold + Competition combination (excluded from the prompt block below).
              </div>
            )}
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Reason Not Sold</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Competition</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {closeNotSoldOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={7}>{closeNotSoldBfoReady
                        ? 'No Not-Sold opps with a matching BFO Activity row — every Not-Sold opp is already closed out in BFO.'
                        : 'Nothing to show until the BFO Activity tab has data: without it there is no way to tell which Not-Sold opps are still open in BFO.'}</td>
                    </tr>
                  ) : closeNotSoldOpps.map(o => (
                    <tr key={o.id} style={o.unmapped ? { background: '#FEF3C7' } : undefined}>
                      <td className={o.name ? '' : styles.missing}>{o.name || 'Missing'}</td>
                      <td className={o.account ? '' : styles.missing}>{o.account || 'Missing'}</td>
                      <td className={o.reasonNotSold ? '' : styles.missing}>{o.reasonNotSold || 'Missing'}</td>
                      <td className={o.status ? '' : styles.missing}>{o.status || (o.unmapped ? 'Missing (unmapped combination)' : 'Missing')}</td>
                      <td className={o.reason ? '' : styles.missing}>{o.reason || (o.unmapped ? 'Missing (unmapped combination)' : 'Missing')}</td>
                      <td className={o.competition ? '' : styles.missing}>{o.competition || 'Missing'}</td>
                      <td className={o.bfoUrl ? '' : styles.missing}>
                        {o.bfoUrl ? (
                          <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                        ) : 'Missing'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
      {(() => {
        const fullPrompt = updateBfoActivityPrompt;
        const onCopy = async () => {
          try {
            // This prompt is itself the suffix, so copy it as-is (no
            // double-append).
            await navigator.clipboard.writeText(fullPrompt);
            setUpdateBfoActivityCopyFlash('Copied!');
          } catch {
            setUpdateBfoActivityCopyFlash('Copy failed');
          }
          window.setTimeout(() => setUpdateBfoActivityCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Update BFO Activity)</h2>
            <p className={styles.subnote}>
              Appended to the end of every prompt copy on this page (and &ldquo;Copy all prompts&rdquo;) so the assistant finishes by re-pulling the BFO Opportunity list into the BFO Activity tab. You can copy it on its own here too.
            </p>
            {revealedPrompts.updateBfoActivity && (
              <textarea
                className={styles.aiPromptInput}
                value={updateBfoActivityPrompt}
                onChange={(e) => updateUpdateBfoActivityPrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('updateBfoActivity')}>
                {revealedPrompts.updateBfoActivity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.updateBfoActivity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetUpdateBfoActivityPrompt}>Reset to default</button>
              )}
              {updateBfoActivityCopyFlash && <span className={styles.copyFlash}>{updateBfoActivityCopyFlash}</span>}
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
      </>)}
    </div>
  );
}

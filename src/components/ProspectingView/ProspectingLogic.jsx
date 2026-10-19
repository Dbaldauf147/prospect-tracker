// Prospecting > Logic: the rules the rest of the page runs on, written out
// in one place, plus a notes box for the user's own prospecting logic.
//
// The ladder section reads the live steps (the user's own edits included)
// rather than a copy, so it can never describe an order the Ladder subtab
// doesn't show. Whether a step counts itself or waits for a tick is read
// off the same `workLabel` / `dueWhenReached` behaviour ladderStates uses
// (utils/prospectingStatus.js). The prose about the other subtabs is a
// summary of their file headers; change it with them.
//
// The notes are one string in settings. Saved on blur and on the Save
// button rather than per keystroke, because every settings write takes a
// backup snapshot first.

import { useState } from 'react';

export const PROSPECTING_LOGIC_NOTES_SETTING = 'prospectingLogicNotes';

const SECTION = {
  border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff',
  padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
};
const HEADING = { fontSize: '0.85rem', fontWeight: 700, color: '#1E293B', margin: 0 };
const BODY = { fontSize: '0.75rem', color: '#475569', lineHeight: 1.5, margin: 0 };
const LIST = { ...BODY, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' };
const PILL = {
  flexShrink: 0, fontSize: '0.62rem', fontWeight: 700, padding: '1px 7px',
  borderRadius: 999, whiteSpace: 'nowrap',
};

// How a step's Status gets answered, in the words the Ladder uses.
function clearsBy(step) {
  if (typeof step.workLabel === 'function') {
    return { label: 'Counts itself', bg: '#DBEAFE', color: '#1E40AF', title: 'Clear when its count reaches zero, or when marked caught up for the day.' };
  }
  if (step.dueWhenReached) {
    return { label: 'Owed when reached', bg: '#FEE2E2', color: '#991B1B', title: 'Nothing counts it, so it shows Outstanding in red once every step above it is clear, until it is marked caught up.' };
  }
  return { label: 'Marked by hand', bg: '#F1F5F9', color: '#475569', title: 'Nothing counts it. Mark it caught up for the day once it is worked.' };
}

const SUBTAB_NOTES = [
  ['Ladder', 'The ranked steps above, each with its Status and a button to the tab where the work happens.'],
  ['History', 'How far down the ladder each working day got and how many opps were overdue on step 1, plus the Tiered Activity tiles day by day.'],
  ['Prospects and PCs', 'Every prospect (or portfolio company) with its sites, utility accounts and energy, its biggest open service, and the decision makers for that service. A row whose biggest service already has a status is being worked, not prospected, so it is left off.'],
  ['Tiered Activity', 'Every Tier 1, 2 and 3 account with you as CDM, when anything last happened on it, and its Status. A company with a Substatus counts as Hold Off.'],
];

export function ProspectingLogic({ steps = [], settings, updateSettings, canEdit = true, maxWidth }) {
  const saved = typeof settings?.[PROSPECTING_LOGIC_NOTES_SETTING] === 'string'
    ? settings[PROSPECTING_LOGIC_NOTES_SETTING]
    : '';
  // null while nothing is typed, so the box follows the stored copy
  // (another device, a late settings load) until the user types over it.
  const [draft, setDraft] = useState(null);
  const dirty = draft !== null && draft !== saved;

  const save = async () => {
    if (!dirty) return;
    const ok = await updateSettings?.({ [PROSPECTING_LOGIC_NOTES_SETTING]: draft });
    if (ok !== false) setDraft(null);
  };

  return (
    <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth }}>
      <section style={SECTION}>
        <h3 style={HEADING}>The ladder</h3>
        <p style={BODY}>
          Work starts at step 1 and only moves down once the step above is clear, so the warmest
          paths in get worked before the coldest ones. This is your current order, edits included.
        </p>
        {steps.length === 0 ? (
          <p style={{ ...BODY, color: '#94A3B8' }}>No steps yet. Add some on the Ladder subtab.</p>
        ) : (
          <ol style={{ ...LIST, gap: '0.45rem' }}>
            {steps.map(step => {
              const how = clearsBy(step);
              return (
                <li key={step.key}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#1E293B' }}>{step.title}</span>
                    <span title={how.title} style={{ ...PILL, background: how.bg, color: how.color }}>{how.label}</span>
                    {step.viewLabel && <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>Worked on {step.viewLabel}</span>}
                  </div>
                  {step.detail && <div style={{ color: '#64748B' }}>{step.detail}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section style={SECTION}>
        <h3 style={HEADING}>When a step turns green</h3>
        <ul style={LIST}>
          <li><b>Counted steps</b> are clear when their count reaches zero, and show the work left while it doesn&apos;t.</li>
          <li><b>Any step</b> can be marked caught up for the day. A mark made today wins over the step&apos;s count.</li>
          <li><b>Marks expire overnight.</b> Prospecting is daily work, so each new day starts with every hand-marked step open again.</li>
          <li><b>Owed when reached:</b> a step nothing counts goes red as Outstanding once every step above it is clear, and the sidebar dots Prospecting until it is marked.</li>
          <li><b>Some steps answer themselves:</b> contact mapping clears when Key, Client and Key Prospect are all fully tagged, and market updates clears when every email campaign that isn&apos;t paused has finished sending.</li>
        </ul>
      </section>

      <section style={SECTION}>
        <h3 style={HEADING}>The other subtabs</h3>
        <ul style={LIST}>
          {SUBTAB_NOTES.map(([name, text]) => (
            <li key={name}><b>{name}:</b> {text}</li>
          ))}
        </ul>
      </section>

      <section style={SECTION}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h3 style={HEADING}>Your notes</h3>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              style={{
                marginLeft: 'auto', padding: '0.25rem 0.75rem', borderRadius: 6, fontFamily: 'inherit',
                fontSize: '0.72rem', fontWeight: 600, cursor: dirty ? 'pointer' : 'default',
                border: `1px solid ${dirty ? '#0A66C2' : '#E2E8F0'}`,
                background: dirty ? '#0A66C2' : '#fff', color: dirty ? '#fff' : '#94A3B8',
              }}
            >{dirty ? 'Save' : 'Saved'}</button>
          )}
        </div>
        <textarea
          value={draft ?? saved}
          readOnly={!canEdit}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          placeholder="Your own prospecting logic: who to go after first, what counts as a good account, the rules you work by."
          rows={10}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
            fontSize: '0.78rem', lineHeight: 1.5, color: '#1E293B', padding: '0.6rem 0.7rem',
            border: '1px solid #CBD5E1', borderRadius: 6, outline: 'none',
          }}
        />
      </section>
    </div>
  );
}

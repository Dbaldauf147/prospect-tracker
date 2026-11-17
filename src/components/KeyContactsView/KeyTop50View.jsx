// The Key Contacts tab: the contacts tagged Dan Key Target, read as Dan's
// top 50 by revenue potential.
//
// Key used to be an open-ended "important people" tag, which left it
// overlapping the DMs page and the old Key Prospects tab. It is meant to be
// a short, ranked list, so this page holds it to that:
//
// - a counter against KEY_CONTACTS_TARGET, which turns amber with a warning
//   once the list goes over. Soft on purpose: nothing stops a 51st tag, but
//   adding somebody should mean deciding who drops off.
// - every row's Category says why they are on it: Decision Maker or Not a DM,
//   plus the rosters they also sit on (Client, Active, DM at Tier 1-3).
//   A Key contact need not be a decision maker (a champion or introducer can
//   earn a place), but it should be a choice, so "Not a DM" is a pill that
//   lists just them.
//
// Everything else is the KeyContactsView table the tab has always been,
// under the same "key-contacts" storage prefix, so column layouts carry over.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { KeyContactsView } from './KeyContactsView';
import { useOppsRecords, useClientFlagMaps } from '../../utils/rosterHooks';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { makeRosterGates } from '../../utils/contactRosters';
import { KEY_CONTACTS_TARGET, DM_LABEL, NOT_DM_LABEL, isDmTagged, keyTopCounts } from '../../utils/keyTop50';

export function KeyTop50View({ prospects = [], onSelectProspect, settings, updateSettings, updateSettingsPath, cdmName = '' }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  const { clientStatusMap, clientUntrackedMap } = useClientFlagMaps();
  const connected = settings?.contactConnected || null;

  const gates = useMemo(
    () => makeRosterGates({ prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, showHidden: false, connected }),
    [prospects, cdmName, oppsRecords, clientStatusMap, clientUntrackedMap, connected],
  );

  // Why they're key: DM status first, then the other rosters they sit on.
  // Key itself is left out, since every row here is on it.
  const categorizeContact = useCallback((c) => [
    isDmTagged(c) ? DM_LABEL : NOT_DM_LABEL,
    ...gates.categorize(c).filter(label => label !== 'Key'),
  ], [gates]);

  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache().then(c => { if (!cancelled) setHubspotContacts(c?.contacts || []); }).catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  const { total, notDm } = useMemo(() => keyTopCounts(hubspotContacts), [hubspotContacts]);

  const [notDmOnly, setNotDmOnly] = useState(false);
  const over = total - KEY_CONTACTS_TARGET;

  const subtitle = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          data-key-target-count
          title={`Key Contacts is meant to be your top ${KEY_CONTACTS_TARGET} contacts by revenue potential. This is a target, not a limit: tagging more is allowed, but each one past ${KEY_CONTACTS_TARGET} should push somebody else off.`}
          style={{
            padding: '2px 10px', borderRadius: 999,
            background: over > 0 ? '#FEF3C7' : '#DCFCE7',
            border: `1px solid ${over > 0 ? '#FCD34D' : '#86EFAC'}`,
            color: over > 0 ? '#92400E' : '#166534',
            fontSize: '0.74rem', fontWeight: 800,
          }}
        >
          {total} / {KEY_CONTACTS_TARGET}
        </span>
        {over > 0 ? (
          <span data-key-target-warning style={{ fontSize: '0.72rem', color: '#92400E', fontWeight: 600 }}>
            {over} over your top {KEY_CONTACTS_TARGET}. Remove the Dan Key Target tag from whoever is worth the least.
          </span>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
            Your top {KEY_CONTACTS_TARGET} contacts by revenue potential{total < KEY_CONTACTS_TARGET ? `, ${KEY_CONTACTS_TARGET - total} spot${KEY_CONTACTS_TARGET - total === 1 ? '' : 's'} open` : ''}.
          </span>
        )}
        {(notDm > 0 || notDmOnly) && (
          <button
            type="button"
            data-not-dm-pill
            aria-pressed={notDmOnly}
            onClick={() => setNotDmOnly(v => !v)}
            title={notDmOnly
              ? 'Showing only the Key Contacts not tagged Decision Maker. Click again to show everyone.'
              : 'Key Contacts not tagged Decision Maker. That can be right (a champion or an introducer), but check each one earns a top spot. Click to list only them.'}
            style={{
              padding: '1px 8px', borderRadius: 999,
              background: notDmOnly ? '#9A3412' : '#FFF7ED',
              border: `1px ${notDmOnly ? 'solid #9A3412' : 'dashed #FED7AA'}`,
              color: notDmOnly ? '#fff' : '#9A3412',
              fontSize: '0.68rem', fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {notDm} not tagged Decision Maker
          </button>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        Every HubSpot contact tagged <code>Dan Key Target</code>. <strong>Category</strong> says why each one is key: <strong>{DM_LABEL}</strong> or <strong>{NOT_DM_LABEL}</strong>, plus any other list they are on. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with Tier, AUM and opportunities.
      </div>
    </>
  );

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      updateSettingsPath={updateSettingsPath}
      cdmName={cdmName}
      pageSubtitle={subtitle}
      categorizeContact={categorizeContact}
      categoryFilter={notDmOnly ? NOT_DM_LABEL : null}
    />
  );
}

export default KeyTop50View;

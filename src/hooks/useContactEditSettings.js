import { useMemo } from 'react';
import { withCompanyOverride } from '../utils/contactCompanyOverride';

// The settings-backed half of ContactEditModal's props, in one place.
//
// The popup edits two kinds of field. The HubSpot ones it pushes itself; the
// rest — notes, nickname, team name, old emails, reports-to, cc/to-also, the
// family fields, met-in-person, invited-to-Louisville, and the per-tag review
// verdicts — HubSpot has nowhere to put, so they live in the user's settings
// under one map apiece, and every page that opens the popup has to hand it
// both the map and the writer for it.
//
// That is sixty lines of wiring, and it was already copied verbatim into
// Draft Emails, Marketing Leads, Opps 2 and Key Contacts before the
// Prospecting page needed it too. Spread `useContactEditSettings(...)` onto
// the modal instead: a field the popup learns to save is added here once
// rather than in five places that are only identical until one of them isn't.
//
// Callers still pass `contact`, `onSave`, `onClose` and whatever
// company-scoped context they have (companyContacts / emailDomains /
// companyNames) — those differ per page, which is the point.
export function useContactEditSettings({ settings, updateSettings }) {
  return useMemo(() => {
    // Every one of these maps is keyed by contact id and stores a string,
    // with "blank means remove the key" rather than storing an empty value —
    // so one writer covers all of them.
    const saveMap = (mapKey, cid, value) => {
      if (cid == null) return;
      const cur = settings?.[mapKey] || {};
      const next = { ...cur };
      if (value && String(value).trim()) next[cid] = value; else delete next[cid];
      updateSettings?.({ [mapKey]: next });
    };
    return {
      contactNotes: settings?.contactNotes || {},
      onSaveNote: (cid, v) => saveMap('contactNotes', cid, v),
      contactOldEmails: settings?.contactOldEmails || {},
      onSaveOldEmails: (cid, v) => saveMap('contactOldEmails', cid, v),
      contactOldCompany: settings?.contactOldCompany || {},
      onSaveOldCompany: (cid, v) => saveMap('contactOldCompany', cid, v),
      // Pins the Company name typed in the popup, so the next HubSpot refresh
      // doesn't rewrite it back from the Company record the contact is
      // associated with. See utils/contactCompanyOverride.js.
      onSaveCompanyOverride: (contactId, value) => {
        const nextLocal = withCompanyOverride(settings?.contactLocalFields, contactId, value);
        if (nextLocal) updateSettings?.({ contactLocalFields: nextLocal });
      },
      contactNicknames: settings?.contactNicknames || {},
      onSaveNickname: (cid, v) => saveMap('contactNicknames', cid, v),
      contactTeamNames: settings?.contactTeamNames || {},
      onSaveTeamName: (cid, v) => saveMap('contactTeamNames', cid, v && v.trim()),
      contactReportsTo: settings?.contactReportsTo || {},
      onSaveReportsTo: (cid, managerIds) => {
        if (cid == null) return;
        const cur = settings?.contactReportsTo || {};
        const next = { ...cur };
        const arr = Array.isArray(managerIds)
          ? managerIds.filter(Boolean).map(String)
          : (managerIds ? [String(managerIds)] : []);
        if (arr.length) next[cid] = arr; else delete next[cid];
        updateSettings?.({ contactReportsTo: next });
      },
      // cc / to-also are whole-map settings rather than per-contact strings:
      // the popup hands back the map it wants stored.
      ccMap: settings?.ccMap || {},
      onSaveCcMap: m => updateSettings?.({ ccMap: m }),
      toAlsoMap: settings?.toAlsoMap || {},
      onSaveToAlsoMap: m => updateSettings?.({ toAlsoMap: m }),
      contactFamilies: settings?.contactFamilies || {},
      onSaveFamily: (cid, info) => {
        if (cid == null) return;
        const cur = settings?.contactFamilies || {};
        const next = { ...cur };
        const partner = String(info?.partner || '').trim();
        const kids = String(info?.kids || '').trim();
        if (!partner && !kids) delete next[cid]; else next[cid] = { partner, kids };
        updateSettings?.({ contactFamilies: next });
      },
      contactMetInPerson: settings?.contactMetInPerson || {},
      onSaveMetInPerson: (cid, met) => {
        if (cid == null) return;
        updateSettings?.({ contactMetInPerson: { ...(settings?.contactMetInPerson || {}), [cid]: !!met } });
      },
      contactInvitedToLouisville: settings?.contactInvitedToLouisville || {},
      onSaveInvitedToLouisville: (cid, invited) => {
        if (cid == null) return;
        updateSettings?.({ contactInvitedToLouisville: { ...(settings?.contactInvitedToLouisville || {}), [cid]: !!invited } });
      },
      contactTagReview: settings?.contactTagReview || {},
      onSaveTagReview: (cid, map) => {
        if (cid == null) return;
        updateSettings?.({ contactTagReview: { ...(settings?.contactTagReview || {}), [cid]: map } });
      },
    };
  }, [settings, updateSettings]);
}

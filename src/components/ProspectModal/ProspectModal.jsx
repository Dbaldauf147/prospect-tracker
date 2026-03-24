import { useState } from 'react';
import { STATUSES, TYPES, TIERS, GEOGRAPHIES, PUBLIC_PRIVATE, ASSET_TYPES, FRAMEWORKS } from '../../data/enums';
import styles from './ProspectModal.module.css';

const EMPTY = {
  company: '', cdm: '', status: 'Inside Sales', type: '', geography: '', publicPrivate: '',
  assetTypes: [], peAum: null, reAum: null, numberOfSites: null, rank: '', tier: 'Tier 2',
  hqRegion: '', frameworks: [], notes: '', website: '', emailDomain: '',
};

export function ProspectModal({ prospect, onSave, onClose, isNew }) {
  const [fields, setFields] = useState(() => {
    if (prospect) return { ...EMPTY, ...prospect };
    return { ...EMPTY };
  });

  function set(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function toggleArrayField(key, value) {
    setFields(prev => {
      const arr = prev[key] || [];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  function handleSave() {
    if (!fields.company.trim()) return;
    const data = { ...fields };
    // Clean up number fields
    data.peAum = data.peAum === '' || data.peAum == null ? null : Number(data.peAum);
    data.reAum = data.reAum === '' || data.reAum == null ? null : Number(data.reAum);
    data.numberOfSites = data.numberOfSites === '' || data.numberOfSites == null ? null : Number(data.numberOfSites);
    // Remove id/createdAt/updatedAt — those are managed by Firestore
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    onSave(data);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isNew ? 'Add Prospect' : fields.company}</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>
          <div className={styles.grid}>
            <div className={styles.fieldFull}>
              <label className={styles.label}>Company</label>
              <input className={styles.input} value={fields.company} onChange={e => set('company', e.target.value)} placeholder="Company name" />
            </div>

            <div>
              <label className={styles.label}>Status</label>
              <select className={styles.select} value={fields.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Tier</label>
              <select className={styles.select} value={fields.tier} onChange={e => set('tier', e.target.value)}>
                <option value="">—</option>
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Type</label>
              <select className={styles.select} value={fields.type} onChange={e => set('type', e.target.value)}>
                <option value="">—</option>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Geography</label>
              <select className={styles.select} value={fields.geography} onChange={e => set('geography', e.target.value)}>
                <option value="">—</option>
                {GEOGRAPHIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>Public / Private</label>
              <select className={styles.select} value={fields.publicPrivate} onChange={e => set('publicPrivate', e.target.value)}>
                <option value="">—</option>
                {PUBLIC_PRIVATE.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className={styles.label}>CDM</label>
              <input className={styles.input} value={fields.cdm} onChange={e => set('cdm', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>RE AUM (billions)</label>
              <input className={styles.input} type="number" step="0.01" value={fields.reAum ?? ''} onChange={e => set('reAum', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>PE AUM (billions)</label>
              <input className={styles.input} type="number" step="0.01" value={fields.peAum ?? ''} onChange={e => set('peAum', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Number of Sites</label>
              <input className={styles.input} type="number" value={fields.numberOfSites ?? ''} onChange={e => set('numberOfSites', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Rank</label>
              <input className={styles.input} value={fields.rank} onChange={e => set('rank', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>HQ Region</label>
              <input className={styles.input} value={fields.hqRegion} onChange={e => set('hqRegion', e.target.value)} />
            </div>

            <div>
              <label className={styles.label}>Website</label>
              <input className={styles.input} value={fields.website} onChange={e => set('website', e.target.value)} placeholder="www.example.com" />
            </div>

            <div>
              <label className={styles.label}>Email Domain</label>
              <input className={styles.input} value={fields.emailDomain} onChange={e => set('emailDomain', e.target.value)} placeholder="firstname.lastname@domain.com" />
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Asset Types</label>
              <div className={styles.checkGroup}>
                {ASSET_TYPES.map(at => (
                  <label key={at} className={styles.checkItem}>
                    <input className={styles.checkBox} type="checkbox" checked={(fields.assetTypes || []).includes(at)} onChange={() => toggleArrayField('assetTypes', at)} />
                    {at}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Frameworks</label>
              <div className={styles.checkGroup}>
                {FRAMEWORKS.map(fw => (
                  <label key={fw} className={styles.checkItem}>
                    <input className={styles.checkBox} type="checkbox" checked={(fields.frameworks || []).includes(fw)} onChange={() => toggleArrayField('frameworks', fw)} />
                    {fw}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.fieldFull}>
              <label className={styles.label}>Notes</label>
              <textarea className={styles.textarea} value={fields.notes} onChange={e => set('notes', e.target.value)} rows={3} />
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!fields.company.trim()}>
            {isNew ? 'Add Prospect' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

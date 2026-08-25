import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildServiceCatalog } from '../../utils/serviceCoverage';
import {
  newClauseId,
  saveServiceClauses,
  subscribeContractLanguage,
} from '../../utils/contractLanguageStore';

// Which service the tab was last looking at. Local-only: it's a cursor, not
// data, and restoring it saves re-finding your place after a trip to
// another subtab (this component unmounts when you leave it).
const LAST_SERVICE_KEY = 'clients-view:contract-language:service';

const SAVE_DEBOUNCE_MS = 800;

/**
 * "Contract Language" subtab: the library of wording that goes into a
 * contract for each service. A service holds any number of named clauses
 * ("Standard", "Pilot", "3-year term"), so one service can carry the
 * variants it actually needs.
 *
 * This is the service → language half. The Contract Services subtab is the
 * other half — reading a signed contract and mapping the services it names
 * onto a client.
 */
export function ContractLanguageView({ settings = {}, user }) {
  const uid = user?.uid || '';
  // The library as Firestore has it.
  const [remote, setRemote] = useState({});
  // Services edited in this session. Kept separate so the snapshot that
  // echoes back our own write can't yank the textarea out from under
  // someone mid-sentence.
  const [drafts, setDrafts] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle', error: '', code: '' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(LAST_SERVICE_KEY) || ''; } catch { return ''; }
  });

  const catalog = useMemo(() => buildServiceCatalog(settings), [settings]);

  // Signed out there is nothing to subscribe to, and nothing to wait for —
  // `ready` covers that case rather than an effect that sets state on the
  // way past, which would cascade a render for no reason.
  const ready = loaded || !uid;
  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeContractLanguage(
      uid,
      (map) => { setRemote(map); setLoaded(true); },
      (err) => {
        setLoaded(true);
        setSaveState({ status: 'error', error: err?.message || String(err), code: err?.code || '' });
      },
    );
    return unsub;
  }, [uid]);

  const clausesFor = useCallback(
    (service) => drafts[service] ?? remote[service] ?? [],
    [drafts, remote],
  );

  // Debounced write of one service's clauses. Keyed by service so editing
  // two services quickly can't have one save cancel the other's.
  const timersRef = useRef({});
  useEffect(() => {
    const timers = timersRef.current;
    return () => { for (const t of Object.values(timers)) clearTimeout(t); };
  }, []);

  const queueSave = useCallback((service, clauses) => {
    if (!uid) {
      setSaveState({ status: 'error', error: 'Not signed in — nothing was saved.', code: '' });
      return;
    }
    setSaveState({ status: 'dirty', error: '', code: '' });
    clearTimeout(timersRef.current[service]);
    timersRef.current[service] = setTimeout(async () => {
      setSaveState({ status: 'saving', error: '', code: '' });
      const res = await saveServiceClauses(uid, service, clauses);
      setSaveState(res.ok
        ? { status: 'saved', error: '', code: '' }
        : { status: 'error', error: res.error, code: res.code });
    }, SAVE_DEBOUNCE_MS);
  }, [uid]);

  const setClauses = useCallback((service, next) => {
    setDrafts(prev => ({ ...prev, [service]: next }));
    queueSave(service, next);
  }, [queueSave]);

  function selectService(name) {
    setSelected(name);
    try { localStorage.setItem(LAST_SERVICE_KEY, name); } catch { /* private mode */ }
  }

  // Catalogue filtered by the search box, which matches the service name
  // AND its stored wording — so you can find a clause by a phrase in it
  // when you can't remember which service it hangs off.
  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return catalog;
    return catalog
      .map(cat => ({
        ...cat,
        items: cat.items.filter(it => {
          if (it.label.toLowerCase().includes(term)) return true;
          return clausesFor(it.key).some(c =>
            c.label.toLowerCase().includes(term) || c.text.toLowerCase().includes(term));
        }),
      }))
      .filter(cat => cat.items.length > 0);
  }, [catalog, term, clausesFor]);

  const withLanguage = useMemo(() => {
    const names = new Set([...Object.keys(remote), ...Object.keys(drafts)]);
    let n = 0;
    for (const name of names) if (clausesFor(name).length) n += 1;
    return n;
  }, [remote, drafts, clausesFor]);

  const clauses = selected ? clausesFor(selected) : [];

  function addClause() {
    if (!selected) return;
    setClauses(selected, [...clauses, { id: newClauseId(), label: '', text: '' }]);
  }
  function patchClause(id, patch) {
    setClauses(selected, clauses.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeClause(id) {
    setClauses(selected, clauses.filter(c => c.id !== id));
  }

  const saveLabel = {
    idle: '', dirty: 'Unsaved…', saving: 'Saving…', saved: 'Saved', error: '',
  }[saveState.status];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Contract Language</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          The wording that goes into a contract for each service. A service can hold several named
          clauses — a standard one, a pilot, a longer term. {withLanguage > 0
            ? <><strong>{withLanguage}</strong> service{withLanguage === 1 ? '' : 's'} with language saved.</>
            : 'Nothing saved yet — pick a service and add a clause.'}
        </div>
      </div>

      {saveState.status === 'error' && (
        <div style={{
          margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.7rem', borderRadius: 6,
          background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
          fontSize: '0.75rem', lineHeight: 1.45, flexShrink: 0,
        }}>
          <strong>Couldn’t save.</strong>{' '}
          {saveState.code === 'permission-denied'
            ? 'Firestore refused the write. The deployed security rules predate this tab — they need the userSettings/{uid}/contractLanguage rule from firestore.rules.'
            : 'Check your connection and try again — your text is still on screen.'}
          <div style={{ marginTop: 4, opacity: 0.8 }}>{saveState.error}</div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0, gap: '1rem', padding: '0 1.25rem 1rem' }}>
        {/* Service picker */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
          border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff',
        }}>
          <div style={{ padding: '0.5rem', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
            <input
              type="text"
              value={search}
              placeholder="Filter services or wording…"
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '0.35rem 0.5rem',
                border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0.35rem 0' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', fontSize: '0.75rem', color: '#94A3B8' }}>
                No service matches that.
              </div>
            ) : filtered.map(cat => (
              <div key={cat.name} style={{ marginBottom: '0.4rem' }}>
                <div style={{
                  padding: '0.25rem 0.7rem', fontSize: '0.64rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94A3B8',
                }}>{cat.name}</div>
                {cat.items.map(it => {
                  const n = clausesFor(it.key).length;
                  const active = it.key === selected;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => selectService(it.key)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                        width: '100%', textAlign: 'left', padding: '0.3rem 0.7rem',
                        border: 'none', background: active ? '#EFF6FF' : 'transparent',
                        color: active ? '#1E40AF' : '#1E293B',
                        fontWeight: active ? 700 : 400,
                        fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.label}
                      </span>
                      {n > 0 && (
                        <span style={{
                          flexShrink: 0, padding: '0 6px', borderRadius: 999,
                          background: '#DBEAFE', color: '#1E40AF',
                          fontSize: '0.64rem', fontWeight: 700,
                        }}>{n}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Clauses for the picked service */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
          border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff',
        }}>
          {!selected ? (
            <div style={{ padding: '1rem', fontSize: '0.82rem', color: '#64748B' }}>
              {!uid
                ? 'Sign in to read and write the contract-language library.'
                : ready ? 'Pick a service on the left to write its contract language.' : 'Loading…'}
            </div>
          ) : (
            <>
              <div style={{
                padding: '0.6rem 0.8rem', borderBottom: '1px solid #E2E8F0', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1E293B', wordBreak: 'break-word' }}>{selected}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>
                    {clauses.length} clause{clauses.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {saveLabel && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 600,
                      color: saveState.status === 'saved' ? '#15803D' : '#94A3B8',
                    }}>{saveLabel}</span>
                  )}
                  <button
                    type="button"
                    onClick={addClause}
                    style={{
                      padding: '0.3rem 0.7rem', border: '1px solid #BFDBFE', borderRadius: 4,
                      background: '#EFF6FF', color: '#1E40AF',
                      fontSize: '0.74rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >+ Add clause</button>
                </div>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: '0.8rem' }}>
                {clauses.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: '#64748B' }}>
                    No contract language for <strong>{selected}</strong> yet.
                    Click <strong>+ Add clause</strong> to write some.
                  </div>
                ) : clauses.map((c, i) => (
                  <ClauseEditor
                    key={c.id}
                    clause={c}
                    index={i}
                    onPatch={patch => patchClause(c.id, patch)}
                    onRemove={() => removeClause(c.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// One clause: its name, its wording, a copy button for pasting into the
// contract, and a delete. Uncontrolled-ish — the value comes from props but
// the parent debounces the write, so typing stays smooth.
function ClauseEditor({ clause, index, onPatch, onRemove }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const text = String(clause.text || '');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.alert('Could not copy automatically — select the text and copy with Ctrl/Cmd+C.');
    }
  }
  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.6rem',
      marginBottom: '0.7rem', background: '#F8FAFC',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input
          type="text"
          value={clause.label}
          placeholder={`Clause name (e.g. Standard, Pilot, 3-year term)`}
          onChange={e => onPatch({ label: e.target.value })}
          style={{
            flex: 1, minWidth: 0, padding: '0.3rem 0.5rem',
            border: '1px solid #CBD5E1', borderRadius: 4,
            fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', background: '#fff',
          }}
        />
        <button
          type="button"
          onClick={copy}
          disabled={!clause.text}
          title={clause.text ? 'Copy this wording' : 'Nothing to copy yet'}
          style={{
            padding: '0.3rem 0.6rem', borderRadius: 4, flexShrink: 0,
            border: `1px solid ${copied ? '#86EFAC' : '#CBD5E1'}`,
            background: copied ? '#DCFCE7' : '#fff',
            color: copied ? '#15803D' : (clause.text ? '#1E293B' : '#CBD5E1'),
            fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
            cursor: clause.text ? 'pointer' : 'default',
          }}
        >{copied ? '✓ Copied' : 'Copy'}</button>
        <button
          type="button"
          onClick={() => {
            const name = clause.label.trim() || `clause ${index + 1}`;
            if (window.confirm(`Delete ${name}? This can’t be undone.`)) onRemove();
          }}
          title="Delete this clause"
          style={{
            padding: '0.3rem 0.55rem', borderRadius: 4, flexShrink: 0,
            border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C',
            fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}
        >Delete</button>
      </div>
      <textarea
        value={clause.text}
        rows={6}
        placeholder="Paste or type the contract wording for this service…"
        onChange={e => onPatch({ text: e.target.value })}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem',
          border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff',
          fontSize: '0.8rem', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
        }}
      />
    </div>
  );
}

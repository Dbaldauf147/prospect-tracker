import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './EfficiencyTreeView.module.css';
import { DEFAULT_EFFICIENCY_TREE } from '../../data/efficiencyDecisionTree';
import {
  addBranch, addNextStep, addNode, deleteNode, detailBlocks, getNode, moveBranch, normalizeTree,
  orphanIds, outlineRows, pathFromRoot, removeBranch, setRoot, toggleNodeService,
  treeStats, updateBranch, updateNode,
} from '../../utils/decisionTree';
import { edgePath, layoutTree } from '../../utils/treeLayout';
import { pricedServiceRows } from '../../utils/serviceRows';
import {
  LEGACY_KEY, LIBRARY_KEY, activeEntry, addTree, blankTree, duplicateTree, getTreeLibrary,
  hasSavedTrees, putTree, removeTree, renameTree, setActiveTree,
} from '../../utils/treeLibrary';

// The page for the C&I efficiency decision tree: walk it to make a call on a
// measure, or open the map and edit the flow itself.
//
// Two modes rather than one, because the tree is read far more often than it
// is changed. WALK shows one step at a time with its branches as buttons and
// keeps the trail of answers, which is how it gets used in front of a
// customer. MAP shows the whole flow as an outline and is where the yes/no
// wiring gets rearranged.
//
// The tree lives in the user's settings document, so it follows them across
// devices. Until they edit it they're looking at the template in
// src/data/efficiencyDecisionTree.js and nothing is written at all.

const SAVE_DELAY_MS = 800;
// How much of the catalog the picker lists at once. The Solutions list runs
// to a hundred and fifty services, and a dropdown that long is scrolled
// rather than read — so it shows a window and the search box narrows it.
const PICKER_ROWS = 10;

// The services tagged onto a step, as chips.
//
// The tree says what to do; these say which of ours does it. Read-only here
// — this is the row you read off in front of a customer, on the box you have
// landed on, and the editor below is where it gets changed.
//
// A name the Solutions list no longer has is still shown, marked: the
// service may have been renamed or retired since somebody tagged it, and a
// tag that silently disappeared would take a decision with it.
function ServiceTags({ services = [], known = null }) {
  if (services.length === 0) return null;
  return (
    <div className={styles.tagRow}>
      {services.map(name => {
        const gone = known && !known.has(name);
        return (
          <span
            key={name}
            className={gone ? styles.tagChipGone : styles.tagChip}
            title={gone
              ? `${name} - not on the Solutions list any more. Open the step in Edit to swap or remove it.`
              : name}
          >{name}</span>
        );
      })}
    </div>
  );
}

// Tagging services onto one step: the chips already on it, and the catalog
// to add from.
//
// A picker rather than a text box, because a tag typed by hand is a tag
// spelled a second way — and the names here are the ones the rate card and
// the Scope picker are keyed on, so a near-miss is a service that prices
// nothing. Everything is one click: a chip to take it off, a row to put it
// on. The search box narrows the catalog rather than the tags, since the
// list it is narrowing is the long one.
function ServiceTagger({ tree, nodeId, catalog = [], onChange }) {
  const [query, setQuery] = useState('');
  const node = getNode(tree, nodeId);
  // The step's own tags — the stored array, not a `|| []` copy, so it is the
  // same reference from one render to the next and the list below is rebuilt
  // when the tags change rather than on every keystroke in the search box.
  const tagged = node?.services;
  const known = useMemo(() => new Set(catalog.map(s => s.name)), [catalog]);
  const term = query.trim().toLowerCase();

  // The catalog minus what is already on this step, narrowed by the search.
  // The bucket is searched too, so "compliance" offers the whole box of them
  // rather than only the services with the word in their name.
  const { rows, total } = useMemo(() => {
    const chosen = new Set(tagged || []);
    const pool = catalog.filter(s => !chosen.has(s.name));
    const hits = term
      ? pool.filter(s => s.name.toLowerCase().includes(term) || String(s.bucket || '').toLowerCase().includes(term))
      : pool;
    return { rows: hits.slice(0, PICKER_ROWS), total: hits.length };
  }, [catalog, tagged, term]);

  const toggle = (name) => onChange(toggleNodeService(tree, nodeId, name));

  if (!node) return null;

  return (
    <div className={styles.tagBlock}>
      <div className={styles.fieldLabel}>
        Services delivered at this step
        <span className={styles.fieldHint}>
          Click a service to tag it; click a chip to take it off. The names come from the Solutions list on Dropdowns.
        </span>
      </div>

      {!tagged?.length
        ? <div className={styles.emptyNote}>Nothing tagged yet.</div>
        : (
          <div className={styles.tagRow}>
            {tagged.map(name => (
              <button
                key={name}
                type="button"
                className={known.has(name) ? styles.tagChipOn : styles.tagChipGoneOn}
                onClick={() => toggle(name)}
                title={known.has(name)
                  ? `Take "${name}" off this step`
                  : `${name} - not on the Solutions list any more. Click to take it off this step.`}
              >{name}<span className={styles.tagChipX} aria-hidden="true">×</span></button>
            ))}
          </div>
        )}

      <input
        className={styles.input}
        type="text"
        value={query}
        placeholder={catalog.length ? `Search ${catalog.length} services…` : 'No services on the Solutions list yet'}
        onChange={e => setQuery(e.target.value)}
        // Enter takes the top match, so tagging a service you can name is
        // type-three-letters-and-go rather than type-then-aim.
        onKeyDown={e => {
          if (e.key !== 'Enter' || !rows[0]) return;
          e.preventDefault();
          toggle(rows[0].name);
          setQuery('');
        }}
      />

      <div className={styles.tagPicker}>
        {rows.length === 0 && (
          <div className={styles.emptyNote}>
            {catalog.length === 0
              ? 'The Solutions list is empty - add services on Dropdowns and they show up here.'
              : (term ? `Nothing matches "${query}".` : 'Every service is already tagged here.')}
          </div>
        )}
        {rows.map(s => (
          <button key={s.name} type="button" className={styles.tagOption} onClick={() => toggle(s.name)} title={`Tag ${s.name} onto this step`}>
            <span className={styles.tagOptionName}>{s.name}</span>
            {s.bucket && <span className={styles.tagOptionBucket}>{s.bucket}</span>}
          </button>
        ))}
        {total > rows.length && (
          <div className={styles.tagPickerMore}>
            {`${rows.length} of ${total} shown - type to narrow`}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeDetail({ detail }) {
  const blocks = useMemo(() => detailBlocks(detail), [detail]);
  if (blocks.length === 0) return null;
  return (
    <div className={styles.detail}>
      {blocks.map((b, i) => (b.type === 'ul' ? (
        <ul key={i} className={styles.detailList}>
          {b.items.map((item, j) => <li key={j}>{item}</li>)}
        </ul>
      ) : (
        <p key={i} className={styles.detailPara}>{b.text}</p>
      )))}
    </div>
  );
}

// The editor for one node: its text, its kind, and the branches out of it.
// Shown in both modes — in WALK it sits under the step you're standing on, so
// a gate can be corrected at the moment you notice it's wrong, without
// leaving the route you were walking.
function NodeEditor({ tree, nodeId, catalog, onChange, onSelect }) {
  // Every node is a possible branch target, named for the dropdown. A branch
  // may point at any of them — including one already used above, which is how
  // the five tiers all continue at the economics gate. Built before the
  // missing-node bail below, so the hook order is the same on every render.
  const targets = useMemo(() => Object.values(tree.nodes)
    .map(n => ({ id: n.id, label: n.title || '(untitled step)' }))
    .sort((a, b) => a.label.localeCompare(b.label)), [tree.nodes]);

  const node = getNode(tree, nodeId);
  if (!node) return null;

  return (
    <div className={styles.editor}>
      <div className={styles.editorRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Step title</span>
          <input
            className={styles.input}
            value={node.title}
            placeholder="e.g. Gate 4 - Is the economics priced properly?"
            onChange={e => onChange(updateNode(tree, nodeId, { title: e.target.value }))}
          />
        </label>
        <label className={styles.fieldNarrow}>
          <span className={styles.fieldLabel}>Kind</span>
          <select
            className={styles.input}
            value={node.kind}
            onChange={e => onChange(updateNode(tree, nodeId, { kind: e.target.value }))}
          >
            <option value="question">Question - branches out</option>
            <option value="outcome">Outcome - what to do</option>
          </select>
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          Detail
          <span className={styles.fieldHint}>Blank line starts a paragraph; a line starting with * or - becomes a bullet.</span>
        </span>
        <textarea
          className={styles.textarea}
          rows={7}
          value={node.detail}
          placeholder="What this gate actually turns on."
          onChange={e => onChange(updateNode(tree, nodeId, { detail: e.target.value }))}
        />
      </label>

      {/* Between the detail and the branches, which is where it belongs in
          the reading: what this step is, what we sell to do it, then where
          it goes next. */}
      <ServiceTagger tree={tree} nodeId={nodeId} catalog={catalog} onChange={onChange} />

      <div className={styles.branchBlock}>
        <div className={styles.fieldLabel}>Branches out of this step</div>
        {node.branches.length === 0 && (
          <div className={styles.emptyNote}>No branches - this step is an end of the route.</div>
        )}
        {node.branches.map((b, i) => (
          <div key={b.id} className={styles.branchRow}>
            <input
              className={styles.input}
              value={b.label}
              placeholder={i === 0 ? 'Yes - …' : 'No - …'}
              onChange={e => onChange(updateBranch(tree, nodeId, b.id, { label: e.target.value }))}
            />
            <div className={styles.branchTarget}>
              <span className={styles.branchGoes}>goes to</span>
              <select
                className={styles.input}
                value={b.to || ''}
                onChange={e => onChange(updateBranch(tree, nodeId, b.id, { to: e.target.value || null }))}
              >
                <option value="">- nowhere yet -</option>
                {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button
                type="button"
                className={styles.iconBtn}
                title="Create a new step and point this branch at it"
                onClick={() => {
                  const { tree: next, id } = addNode(tree, { parentId: nodeId, branchId: b.id, title: '' });
                  onChange(next);
                  if (id) onSelect?.(id);
                }}
              >+ step</button>
              <button type="button" className={styles.iconBtn} title="Move this branch up" disabled={i === 0}
                onClick={() => onChange(moveBranch(tree, nodeId, b.id, -1))}>↑</button>
              <button type="button" className={styles.iconBtn} title="Move this branch down" disabled={i === node.branches.length - 1}
                onClick={() => onChange(moveBranch(tree, nodeId, b.id, 1))}>↓</button>
              <button type="button" className={styles.iconBtnDanger} title="Remove this branch"
                onClick={() => onChange(removeBranch(tree, nodeId, b.id))}>✕</button>
            </div>
          </div>
        ))}
        <div className={styles.branchActions}>
          <button type="button" className={styles.smallBtn}
            onClick={() => onChange(addBranch(tree, nodeId, { label: '' }))}>+ Add branch</button>
          <button type="button" className={styles.smallBtn}
            onClick={() => {
              const { tree: next, id } = addNode(tree, { parentId: nodeId, title: '' });
              onChange(next);
              if (id) onSelect?.(id);
            }}>+ Add branch and a new step</button>
        </div>
      </div>
    </div>
  );
}

// The popup behind a box in the diagram. A box only has room for a title, so
// this is where the detail lives — plus the two questions you actually have
// when you click one: what leads here, and where does it go next. Both lists
// are clickable, so the popup doubles as a way to move around the flow
// without hunting for the next box on the canvas.
function NodeDetailModal({ tree, nodeId, catalog, knownServices, editing, onClose, onGoTo, onWalkFrom, onChange }) {
  const node = getNode(tree, nodeId);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parents = useMemo(() => {
    if (!node) return [];
    const out = [];
    for (const other of Object.values(tree.nodes)) {
      for (const b of other.branches) {
        if (b.to === node.id) out.push({ id: other.id, title: other.title, label: b.label });
      }
    }
    return out;
  }, [tree, node]);

  if (!node) return null;

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.modalCard} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={node.title}>
        <div className={styles.modalHead}>
          <span className={node.kind === 'outcome' ? styles.kindOutcome : styles.kindQuestion}>
            {node.kind === 'outcome' ? 'Do this' : 'Decide'}
          </span>
          <h2 className={styles.modalTitle}>{node.title || '(untitled step)'}</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.modalBody}>
          {node.detail
            ? <NodeDetail detail={node.detail} />
            : <div className={styles.emptyNote}>No detail on this step yet.{editing ? '' : ' Turn on Edit to write some.'}</div>}

          {/* Above the wiring, because it is about this step rather than
              about the route: what we sell to do the thing this box says. */}
          {node.services.length > 0 && (
            <div className={styles.modalSection}>
              <div className={styles.fieldLabel}>Services delivered here</div>
              <ServiceTags services={node.services} known={knownServices} />
            </div>
          )}

          {parents.length > 0 && (
            <div className={styles.modalSection}>
              <div className={styles.fieldLabel}>Reached from</div>
              {parents.map(p => (
                <button key={`${p.id}-${p.label}`} type="button" className={styles.linkRow} onClick={() => onGoTo(p.id)}>
                  <span className={styles.linkRowLabel}>{p.title || '(untitled step)'}</span>
                  <span className={styles.linkRowNote}>{p.label || '(unlabelled branch)'}</span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.modalSection}>
            <div className={styles.fieldLabel}>Leads to</div>
            {node.branches.length === 0 && <div className={styles.emptyNote}>Nothing - this is an end of the route.</div>}
            {node.branches.map(b => {
              const target = b.to ? getNode(tree, b.to) : null;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={target ? styles.linkRow : styles.linkRowDead}
                  disabled={!target}
                  onClick={() => target && onGoTo(b.to)}
                >
                  <span className={styles.linkRowLabel}>{b.label || '(unlabelled branch)'}</span>
                  <span className={styles.linkRowNote}>{target ? target.title : 'not linked yet'}</span>
                </button>
              );
            })}
          </div>

          {editing && <NodeEditor tree={tree} nodeId={node.id} catalog={catalog} onChange={onChange} onSelect={onGoTo} />}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={styles.primaryBtn} onClick={() => onWalkFrom(node.id)}>Walk from here</button>
          <button type="button" className={styles.smallBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Adding the step that comes after a box, from the diagram itself.
//
// The whole of the choice is what KIND of step it is, because those are the
// two things a flowchart is made of: a decision point that branches, and a
// step that just says what happens. A decision point arrives with its Yes
// and its No already on it - that is wiring you would otherwise open the
// editor to do, and nobody drawing a flowchart wants a diamond with no ways
// out of it.
//
// The one thing it has to ask about the wiring is which way out of the
// previous step leads here, and only when that step has ways out going
// spare: a gate whose Yes is spoken for and whose No is not should offer
// the No rather than quietly repoint the Yes and strand what it reached.
function AddStepModal({ tree, fromId, onCancel, onAdd }) {
  const parent = getNode(tree, fromId);
  const free = useMemo(() => (parent?.branches || []).filter(b => !b.to), [parent]);
  const [kind, setKind] = useState('question');
  const [title, setTitle] = useState('');
  // '' means "on a new branch of its own"; anything else is one of the free
  // branches above. It opens on the branch that was waiting when there is
  // one: that is the answer nine times in ten, and picking it for them is
  // what makes the second press of + fill in a gate's Yes. Read once, at
  // mount - the dialog is thrown away and rebuilt on every press, so there
  // is no later state of the tree for it to be stale against.
  const [branchId, setBranchId] = useState(() => free[0]?.id || '');
  const [branchLabel, setBranchLabel] = useState('');
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (!parent) return null;

  const parentName = parent.title || '(untitled step)';

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onCancel}>
      <form
        className={styles.modalCardNarrow}
        onMouseDown={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          onAdd({ kind, title: title.trim(), branchId: branchId || null, branchLabel: branchLabel.trim() });
        }}
      >
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>Add the next step</h2>
          <button type="button" className={styles.modalClose} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.afterNote}>
            After <strong>{parentName}</strong>
          </div>

          <div className={styles.fieldLabel}>What kind of step?</div>
          <div className={styles.kindChoice}>
            <button
              type="button"
              className={kind === 'question' ? styles.kindCardOn : styles.kindCard}
              aria-pressed={kind === 'question'}
              onClick={() => setKind('question')}
            >
              <span className={styles.kindCardIcon} aria-hidden="true">◇</span>
              <span className={styles.kindCardName}>Decision point</span>
              <span className={styles.kindCardNote}>
                Branches out. Comes with a Yes and a No, ready to point at whatever follows each.
              </span>
            </button>
            <button
              type="button"
              className={kind === 'outcome' ? styles.kindCardOn : styles.kindCard}
              aria-pressed={kind === 'outcome'}
              onClick={() => setKind('outcome')}
            >
              <span className={styles.kindCardIcon} aria-hidden="true">▭</span>
              <span className={styles.kindCardName}>Free text</span>
              <span className={styles.kindCardNote}>
                A step that just says what happens. Nothing to answer, and no branches until you add one.
              </span>
            </button>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Title</span>
            <input
              ref={titleRef}
              className={styles.input}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={kind === 'question'
                ? 'e.g. Is the payback under 2 years?'
                : 'e.g. Scope the retrofit'}
            />
          </label>

          {free.length > 0 && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Reached by
                <span className={styles.fieldHint}>Which way out of &ldquo;{parentName}&rdquo; leads to it.</span>
              </span>
              <select className={styles.input} value={branchId} onChange={e => setBranchId(e.target.value)}>
                {free.map(b => (
                  <option key={b.id} value={b.id}>{b.label || '(unlabelled branch)'}</option>
                ))}
                <option value="">A new branch</option>
              </select>
            </label>
          )}

          {!branchId && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Label for the arrow
                <span className={styles.fieldHint}>
                  {parent.branches.length > 0
                    ? 'Every way out of this step already leads somewhere, so this adds another one.'
                    : 'Optional. A single arrow out of a step reads fine without one.'}
                </span>
              </span>
              <input
                className={styles.input}
                value={branchLabel}
                onChange={e => setBranchLabel(e.target.value)}
                placeholder="e.g. Yes"
              />
            </label>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="submit" className={styles.primaryBtn}>Add step</button>
          <button type="button" className={styles.smallBtn} onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function EfficiencyTreeView({ settings = {}, settingsLoaded = false, updateSettings }) {
  // Every tree the user keeps, and which subtab is open. The shipped C&I
  // flow is one of them; so is anything they build from nothing.
  const [library, setLibrary] = useState(() => getTreeLibrary(settings));
  const entry = activeEntry(library);
  const tree = entry.tree;
  const [mode, setMode] = useState('diagram');
  const [editing, setEditing] = useState(false);
  const [trail, setTrail] = useState([]);           // node ids answered through, root first
  const [selectedId, setSelectedId] = useState(null); // the step the map is inspecting
  const [status, setStatus] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  const [importError, setImportError] = useState('');
  const [zoom, setZoom] = useState(0.8);
  const [popupId, setPopupId] = useState(null);   // the box whose detail is open
  const [addAfterId, setAddAfterId] = useState(null); // the box the + was pressed on
  const [freshId, setFreshId] = useState(null);   // the step just added, to scroll to and mark
  const canvasWrapRef = useRef(null);

  // A save is owed (debounce running) or in the air. While that's true a
  // snapshot arriving from Firestore is older than what's on screen, so the
  // adopt-remote effect below has to leave the local tree alone — otherwise
  // the echo of our own write lands mid-sentence and eats the keystrokes
  // typed after it.
  const pendingRef = useRef(false);
  const timerRef = useRef(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  const save = useCallback((next) => {
    if (!updateSettings) return;
    pendingRef.current = true;
    setStatus('Saving…');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Promise.resolve(updateSettings({ [LIBRARY_KEY]: next }))
        .then(() => setStatus('Saved'))
        .catch(() => setStatus('Save failed'))
        .finally(() => { pendingRef.current = false; });
    }, SAVE_DELAY_MS);
  }, [updateSettings]);

  // Flush a pending save if the page is left mid-debounce.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Every edit goes through here: local state first so typing stays instant,
  // then the debounced write. The whole library is written, not the open
  // tree on its own — it is one field in one settings document, and a
  // partial write of it would be a lost subtab.
  const applyLibrary = useCallback((next) => {
    setLibrary(next);
    save(next);
  }, [save]);

  // The same thing for an edit to the tree in front of you, which is what
  // every editor on the page makes.
  const applyTree = useCallback((next) => {
    applyLibrary(putTree(libraryRef.current, libraryRef.current.activeId, next));
  }, [applyLibrary]);

  // Adopt trees saved elsewhere (another device, another tab), and the ones
  // that arrive when this page opened before the settings document did.
  // Both sides are normalized, so a tree stored under the old single-tree
  // key compares equal to the library it migrates into rather than looking
  // like a change on every render. Skipped while we owe a save: our own
  // write echoing back mid-sentence would eat the keystrokes after it.
  const storedJson = useMemo(
    () => JSON.stringify(getTreeLibrary(settings)),
    [settings?.[LIBRARY_KEY], settings?.[LEGACY_KEY]], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!settingsLoaded || pendingRef.current) return;
    if (storedJson === JSON.stringify(libraryRef.current)) return;
    setLibrary(JSON.parse(storedJson));
  }, [storedJson, settingsLoaded]);

  // The service vocabulary to tag from: the same rows the Services Pricing
  // card prices, minus the retired ones — a service nobody can put in a deal
  // is not one to hang off a step of the flow.
  const catalog = useMemo(() => pricedServiceRows(settings), [settings]);
  const knownServices = useMemo(() => new Set(catalog.map(s => s.name)), [catalog]);

  const stats = useMemo(() => treeStats(tree), [tree]);
  const rows = useMemo(() => outlineRows(tree), [tree]);
  const orphans = useMemo(() => orphanIds(tree), [tree]);
  const layout = useMemo(() => layoutTree(tree), [tree]);

  // How many arrows leave each box. An arrow with no label is readable when
  // it is the only way out - it just continues the flow - but two blank
  // arrows out of one box is a question with its answers rubbed off, so
  // those still show a placeholder to fill in.
  const outDegree = useMemo(() => {
    const out = new Map();
    for (const e of layout.edges) out.set(e.fromId, (out.get(e.fromId) || 0) + 1);
    return out;
  }, [layout]);

  // A step added from the diagram is put on a row of its own, which on a
  // tree of any size is off the bottom of the window. Scroll to it and mark
  // it for a moment, so "add a step" ends with the step in front of you
  // rather than with a canvas that looks unchanged.
  useEffect(() => {
    if (!freshId) return undefined;
    const box = layout.byId.get(freshId);
    const wrap = canvasWrapRef.current;
    if (box && wrap) {
      wrap.scrollLeft = Math.max(0, (box.x + box.w / 2) * zoom - wrap.clientWidth / 2);
      wrap.scrollTop = Math.max(0, (box.y + box.h / 2) * zoom - wrap.clientHeight / 2);
    }
    const timer = setTimeout(() => setFreshId(null), 2000);
    return () => clearTimeout(timer);
  }, [freshId, layout, zoom]);

  // The + on a box: the new step, wired to the one it was added after, and
  // the diagram moved to it. Everything the dialog asked goes straight in;
  // anything it didn't ask about is what addNextStep decides.
  function addStepAfter(fromId, { kind, title, branchId, branchLabel }) {
    const { tree: next, id } = addNextStep(tree, { fromId, branchId, branchLabel, kind, title });
    setAddAfterId(null);
    if (!id) {
      setStatus('This tree is full - 500 steps is the limit.');
      return;
    }
    applyTree(next);
    setSelectedId(id);
    setFreshId(id);
  }

  // Where the walk is standing. The trail holds the ids answered through; an
  // empty trail means the root, and a trail whose last step has been deleted
  // falls back to the root rather than showing nothing.
  const currentId = trail.length ? trail[trail.length - 1] : tree.rootId;
  const current = getNode(tree, currentId) || getNode(tree, tree.rootId);

  function choose(branch) {
    if (!branch?.to || !getNode(tree, branch.to)) return;
    setTrail(prev => [...(prev.length ? prev : [tree.rootId]), branch.to]);
  }

  function rewindTo(index) {
    setTrail(prev => prev.slice(0, index + 1));
  }

  function walkFrom(nodeId) {
    const path = pathFromRoot(tree, nodeId);
    setTrail(path ? path.map(p => p.nodeId) : [nodeId]);
    setPopupId(null);
    setMode('walk');
  }

  // Scale the diagram so the whole flow fits the window it's shown in. The
  // canvas is measured rather than assumed, because how much room there is
  // depends on the browser window, not on the tree.
  function zoomToFit() {
    const box = canvasWrapRef.current?.getBoundingClientRect();
    if (!box || !layout.width || !layout.height) return;
    const fit = Math.min((box.width - 24) / layout.width, (box.height - 24) / layout.height);
    setZoom(Math.max(0.2, Math.min(1.5, fit)));
  }

  // Drag anywhere on the canvas background to pan it, the way every other
  // diagram behaves. Buttons and boxes keep their own clicks: the drag only
  // starts on a primary press that didn't land on one.
  function startPan(e) {
    const wrap = canvasWrapRef.current;
    if (!wrap || e.button !== 0 || e.target.closest('button')) return;
    const startX = e.clientX, startY = e.clientY;
    const fromLeft = wrap.scrollLeft, fromTop = wrap.scrollTop;
    let moved = false;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      wrap.scrollLeft = fromLeft - (ev.clientX - startX);
      wrap.scrollTop = fromTop - (ev.clientY - startY);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      wrap.classList.remove(styles.canvasPanning);
      if (moved) wrap.dataset.panned = '1';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    wrap.classList.add(styles.canvasPanning);
  }

  function resetToTemplate() {
    if (!window.confirm(`Replace "${entry.name}" with the built-in C&I efficiency template? Your edits to this tree will be lost.\n\nYour other trees are untouched.`)) return;
    const next = normalizeTree(DEFAULT_EFFICIENCY_TREE);
    setTrail([]);
    setSelectedId(null);
    setPopupId(null);
    applyTree(next);
  }

  // ── the subtabs ───────────────────────────────────────────────────────
  //
  // Switching trees puts down everything that was about the last one: the
  // route being walked, the step being inspected, the popup. They are ids,
  // and an id from another tree means nothing here.
  function switchTree(id) {
    if (id === library.activeId) return;
    setTrail([]);
    setSelectedId(null);
    setPopupId(null);
    setStatus('');
    applyLibrary(setActiveTree(library, id));
  }

  // A tree built from nothing: one step, and the page set up to add the
  // next one — Map & edit with the editor open, on the step you start from.
  // Landing on a diagram of a single box with the editor off would be a
  // page that looks broken rather than empty.
  function newTree() {
    const label = (window.prompt('Name for the new decision tree:', 'New tree') || '').trim();
    if (!label) return;
    const { library: next, id } = addTree(library, { name: label, tree: blankTree() });
    if (!id) { setStatus(`That is as many trees as this page holds (${library.trees.length}).`); return; }
    setTrail([]);
    setPopupId(null);
    setSelectedId(blankTree().rootId);
    setMode('map');
    setEditing(true);
    setStatus(`Added "${label}" - add steps from the editor on the right.`);
    applyLibrary(setActiveTree(next, id));
  }

  // A copy to change, for a flow that is mostly right for the next job.
  function copyTree() {
    const { library: next, id } = duplicateTree(library, entry.id);
    if (!id) { setStatus(`That is as many trees as this page holds (${library.trees.length}).`); return; }
    setTrail([]);
    setSelectedId(null);
    setPopupId(null);
    applyLibrary(setActiveTree(next, id));
  }

  function renameActiveTree() {
    const label = (window.prompt('Rename this decision tree:', entry.name) || '').trim();
    if (!label || label === entry.name) return;
    applyLibrary(renameTree(library, entry.id, label));
  }

  function deleteActiveTree() {
    if (library.trees.length <= 1) {
      setStatus('This is the only tree - the page needs one. Add another first.');
      return;
    }
    if (!window.confirm(`Delete "${entry.name}" and its ${stats.nodes} step${stats.nodes === 1 ? '' : 's'}? This can't be undone.`)) return;
    setTrail([]);
    setSelectedId(null);
    setPopupId(null);
    applyLibrary(removeTree(library, entry.id));
  }

  async function copyJson() {
    const json = JSON.stringify(tree, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`Copied "${entry.name}" as JSON`);
    } catch {
      setStatus('Clipboard blocked - paste from the import box instead');
    }
  }

  // Paste a tree in as a subtab of its own rather than over the one you are
  // looking at: an import that replaced the open tree was safe when the page
  // held one, and is a tree thrown away now that it holds several.
  function runImport() {
    try {
      const parsed = JSON.parse(importText);
      const imported = normalizeTree(parsed);
      if (Object.keys(imported.nodes).length === 0) throw new Error('no steps found');
      const { library: next, id } = addTree(library, { name: importName.trim() || 'Imported tree', tree: imported });
      if (!id) throw new Error(`that is as many trees as this page holds (${library.trees.length})`);
      setTrail([]);
      setSelectedId(null);
      setPopupId(null);
      applyLibrary(setActiveTree(next, id));
      setImportOpen(false);
      setImportText('');
      setImportName('');
      setImportError('');
    } catch (err) {
      setImportError(err?.message || 'That isn\'t a decision tree');
    }
  }

  const trailSteps = trail.length ? trail : [tree.rootId];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title}>Efficiency Decision Tree</h1>
          <div className={styles.subtitle}>
            C&amp;I efficiency work, sequenced: what to fix in what order, and what gets funded with whose money.
          </div>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.modeSwitch}>
            <button type="button" className={mode === 'diagram' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('diagram')}>Diagram</button>
            <button type="button" className={mode === 'walk' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('walk')}>Walk it</button>
            <button type="button" className={mode === 'map' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('map')}>Map &amp; edit</button>
          </div>
          {mode === 'diagram' && (
            <div className={styles.zoomBar}>
              <button type="button" className={styles.iconBtn} title="Zoom out"
                onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(2)))}>−</button>
              <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
              <button type="button" className={styles.iconBtn} title="Zoom in"
                onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(2)))}>+</button>
              <button type="button" className={styles.smallBtn} onClick={zoomToFit}>Fit</button>
            </div>
          )}
          <label className={styles.editToggle} title="Show the editor for each step">
            <input type="checkbox" checked={editing} onChange={e => setEditing(e.target.checked)} />
            Edit
          </label>
          <button type="button" className={styles.smallBtn} onClick={copyJson} title="Copy the whole tree as JSON">Copy JSON</button>
          <button type="button" className={styles.smallBtn} onClick={() => setImportOpen(v => !v)}>Import</button>
          <button type="button" className={styles.smallBtn} onClick={resetToTemplate}
            title={`Replace "${entry.name}" with the built-in C&I efficiency template`}>Reset to template</button>
        </div>
      </div>

      {/* The subtabs: one per tree the user keeps. The shipped C&I flow is
          one of them and carries no privileges — it can be renamed, copied,
          rebuilt or deleted like any other, as long as one tree is left for
          the page to open on. */}
      <div className={styles.treeTabs} role="tablist" aria-label="Decision trees">
        {library.trees.map(t => {
          const count = Object.keys(t.tree.nodes).length;
          const open = t.id === entry.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={open}
              className={open ? styles.treeTabActive : styles.treeTab}
              onClick={() => switchTree(t.id)}
              title={`${t.name} - ${count} step${count === 1 ? '' : 's'}`}
            >
              {t.name}
              <span className={styles.treeTabCount}>{count}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={styles.treeTabAdd}
          onClick={newTree}
          title="Start a tree from nothing: one step, then add the rest"
        >+ New tree</button>

        <span className={styles.treeTabsSpacer} />

        {/* Acting on the tree that's open, which is the one named to the
            left of them. Deleting asks; renaming and copying don't need to. */}
        <button type="button" className={styles.smallBtn} onClick={renameActiveTree}
          title={`Rename "${entry.name}"`}>Rename</button>
        <button type="button" className={styles.smallBtn} onClick={copyTree}
          title={`Copy "${entry.name}" into a tree of its own`}>Duplicate</button>
        <button type="button" className={styles.smallBtn} onClick={deleteActiveTree}
          disabled={library.trees.length <= 1}
          title={library.trees.length <= 1
            ? 'The page needs one tree - add another before deleting this one'
            : `Delete "${entry.name}"`}>Delete</button>
      </div>

      <div className={styles.statusBar}>
        <span>{stats.nodes} steps · {stats.branches} branches · {stats.ends} ends</span>
        {/* Both ways round: how much of the flow is wired to what we sell,
            and how much of what we sell has a place in the flow. */}
        {stats.tagged > 0 && (
          <span
            className={styles.muted}
            title={`${stats.tagged} of ${stats.nodes} steps carry a service tag, covering ${stats.services} of the ${catalog.length} services on the Solutions list.`}
          >{stats.tagged} step{stats.tagged === 1 ? '' : 's'} tagged · {stats.services} service{stats.services === 1 ? '' : 's'}</span>
        )}
        {stats.unlinked > 0 && <span className={styles.warn}>{stats.unlinked} branch{stats.unlinked === 1 ? '' : 'es'} not pointed anywhere</span>}
        {orphans.length > 0 && <span className={styles.warn}>{orphans.length} step{orphans.length === 1 ? '' : 's'} nothing reaches</span>}
        {!settingsLoaded && <span className={styles.muted}>Loading your saved trees…</span>}
        {settingsLoaded && !hasSavedTrees(settings) && <span className={styles.muted}>Showing the built-in template - your first edit saves a copy of your own.</span>}
        {/* A tree you just made is one box and no branches, which reads as a
            broken page unless it says what it is waiting for. */}
        {stats.nodes <= 1 && (
          <span className={styles.muted}>
            {editing
              ? 'Empty tree - write this step, then “+ Add branch and a new step” to grow it.'
              : 'Empty tree - turn on Edit to build it.'}
          </span>
        )}
        {mode === 'diagram' && (
          <span className={styles.muted}>
            Click a box for the detail · drag to pan · {editing
              ? 'hover a box for the + that adds the step after it'
              : 'turn on Edit to add steps here'}
          </span>
        )}
        {status && <span className={styles.muted}>{status}</span>}
      </div>

      {importOpen && (
        <div className={styles.importPanel}>
          <div className={styles.fieldLabel}>Paste a tree exported with Copy JSON - it comes in as a new tree of its own</div>
          <input
            className={styles.input}
            type="text"
            value={importName}
            placeholder="Name for the imported tree"
            onChange={e => setImportName(e.target.value)}
          />
          <textarea className={styles.textarea} rows={5} value={importText}
            onChange={e => { setImportText(e.target.value); setImportError(''); }} />
          {importError && <div className={styles.warn}>Couldn&apos;t read that: {importError}</div>}
          <div className={styles.branchActions}>
            <button type="button" className={styles.primaryBtn} onClick={runImport} disabled={!importText.trim()}>Add it as a tree</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setImportOpen(false); setImportError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'diagram' ? (
        <div
          className={styles.canvasWrap}
          ref={canvasWrapRef}
          onMouseDown={startPan}
          title="Drag to pan · click a box for the detail"
        >
          <div className={styles.canvas} style={{ width: layout.width * zoom, height: layout.height * zoom }}>
            <div className={styles.canvasInner} style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
              <svg className={styles.edges} width={layout.width} height={layout.height} aria-hidden="true">
                <defs>
                  <marker id="eff-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>
                {layout.edges.map(e => {
                  // An edge lights up when both ends are consecutive steps on
                  // the route currently being walked, so the diagram shows
                  // where you are rather than just what exists.
                  const i = trailSteps.indexOf(e.fromId);
                  const onTrail = i !== -1 && trailSteps[i + 1] === e.toId;
                  return (
                    <path
                      key={`${e.fromId}-${e.branchId}`}
                      d={edgePath(e)}
                      className={onTrail ? styles.edgeOnTrail : (e.back ? styles.edgeBack : styles.edge)}
                      markerEnd="url(#eff-arrow)"
                    />
                  );
                })}
              </svg>

              {layout.edges.map(e => {
                const label = e.label || ((outDegree.get(e.fromId) || 0) > 1 ? '-' : '');
                if (!label) return null;
                return (
                  <span
                    key={`label-${e.fromId}-${e.branchId}`}
                    className={e.back ? styles.edgeLabelBack : styles.edgeLabel}
                    style={{ left: e.labelX, top: e.labelY }}
                    title={e.label}
                  >{label}</span>
                );
              })}

              {layout.nodes.map(box => {
                const node = getNode(tree, box.id);
                if (!node) return null;
                const onTrail = trailSteps.includes(box.id);
                const here = trailSteps[trailSteps.length - 1] === box.id;
                const cls = [
                  node.kind === 'outcome' ? styles.boxOutcome : styles.boxQuestion,
                  box.orphan ? styles.boxOrphan : '',
                  onTrail ? styles.boxOnTrail : '',
                  here ? styles.boxHere : '',
                  popupId === box.id ? styles.boxOpen : '',
                  freshId === box.id ? styles.boxFresh : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={box.id}
                    className={styles.boxWrap}
                    style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                  >
                  <button
                    type="button"
                    className={cls}
                    style={{ left: 0, top: 0, width: '100%', height: '100%' }}
                    onClick={(ev) => {
                      // A click that ended a pan isn't a click on the box.
                      const wrap = canvasWrapRef.current;
                      if (wrap?.dataset.panned) { delete wrap.dataset.panned; ev.preventDefault(); return; }
                      setPopupId(box.id);
                      setSelectedId(box.id);
                    }}
                    title={node.detail ? `${node.title}\n\nClick for the detail` : node.title}
                  >
                    <span className={styles.boxTitle}>{node.title || '(untitled step)'}</span>
                    <span className={styles.boxMeta}>
                      {box.id === tree.rootId && <span className={styles.rootChip}>start</span>}
                      {box.orphan && <span className={styles.repeatChip}>unreachable</span>}
                      {node.branches.length === 0 && !box.orphan && <span className={styles.repeatChip}>end</span>}
                      {/* The count, not the names: the box has room for a
                          title and little else, and the names are one click
                          away in the popup. The tooltip lists them for the
                          scan that doesn't want to click. */}
                      {node.services.length > 0 && (
                        <span
                          className={styles.serviceChip}
                          title={`Services delivered here:\n${node.services.join('\n')}`}
                        >{node.services.length} service{node.services.length === 1 ? '' : 's'}</span>
                      )}
                    </span>
                  </button>
                  {/* Where a flowchart tool puts it: on the edge the next
                      arrow leaves from. Counter-scaled, because a handle
                      that shrinks with the zoom is a handle nobody can hit
                      on a tree big enough to need zooming out. */}
                  {editing && (
                    <button
                      type="button"
                      className={addAfterId === box.id ? styles.addHandleOn : styles.addHandle}
                      style={{ transform: `translate(-50%, 50%) scale(${Math.min(3, 1 / zoom).toFixed(2)})` }}
                      aria-label={`Add the step after ${node.title || 'this step'}`}
                      title={`Add the step that comes after "${node.title || '(untitled step)'}"`}
                      onClick={(ev) => {
                        const wrap = canvasWrapRef.current;
                        if (wrap?.dataset.panned) { delete wrap.dataset.panned; ev.preventDefault(); return; }
                        setAddAfterId(box.id);
                      }}
                    >+</button>
                  )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : mode === 'walk' ? (
        <div className={styles.body}>
          <div className={styles.trail}>
            {trailSteps.map((id, i) => {
              const node = getNode(tree, id);
              const label = node?.title || '(untitled step)';
              const last = i === trailSteps.length - 1;
              return (
                <span key={`${id}-${i}`} className={styles.trailItem}>
                  {i > 0 && <span className={styles.trailArrow}>→</span>}
                  <button type="button" className={last ? styles.trailHere : styles.trailLink}
                    onClick={() => rewindTo(i)} title={last ? 'You are here' : 'Go back to this step'}>{label}</button>
                </span>
              );
            })}
            {trail.length > 1 && (
              <button type="button" className={styles.smallBtn} onClick={() => setTrail([])}>Start over</button>
            )}
          </div>

          {current ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={current.kind === 'outcome' ? styles.kindOutcome : styles.kindQuestion}>
                  {current.kind === 'outcome' ? 'Do this' : 'Decide'}
                </span>
                <h2 className={styles.cardTitle}>{current.title || '(untitled step)'}</h2>
              </div>
              <NodeDetail detail={current.detail} />

              {/* The point of the tags, on the screen they are for: you are
                  standing on a step in front of a customer and this is what
                  we sell to do it. */}
              {current.services.length > 0 && (
                <div className={styles.tagBlock}>
                  <div className={styles.fieldLabel}>Services delivered here</div>
                  <ServiceTags services={current.services} known={knownServices} />
                </div>
              )}

              {current.branches.length > 0 ? (
                <div className={styles.choices}>
                  {current.branches.map(b => {
                    const target = b.to ? getNode(tree, b.to) : null;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={target ? styles.choiceBtn : styles.choiceBtnDead}
                        disabled={!target}
                        onClick={() => choose(b)}
                        title={target ? `Go to: ${target.title}` : 'This branch isn\'t pointed anywhere yet - turn on Edit to link it'}
                      >
                        <span className={styles.choiceLabel}>{b.label || '(unlabelled branch)'}</span>
                        <span className={styles.choiceNext}>{target ? target.title : 'not linked yet'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.endNote}>End of this route.</div>
              )}

              {editing && (
                <NodeEditor tree={tree} nodeId={current.id} catalog={catalog} onChange={applyTree} onSelect={() => {}} />
              )}
            </div>
          ) : (
            <div className={styles.emptyNote}>This tree has no steps. Turn on Edit to add one, or reset to the template.</div>
          )}
        </div>
      ) : (
        <div className={styles.mapBody}>
          <div className={styles.outline}>
            {rows.map((row, i) => {
              const node = row.nodeId ? getNode(tree, row.nodeId) : null;
              const isSelected = node && node.id === selectedId;
              return (
                <div
                  key={`${row.parentId || 'root'}-${row.branchId || 'x'}-${row.nodeId || 'none'}-${i}`}
                  className={styles.outlineRow}
                  // Indent stops paying its way past a point: this flow is
                  // mostly one long chain, so a straight depth × indent runs
                  // the far end off the right edge. Capped — the branch chip
                  // on each row already says which way you came.
                  style={{ paddingLeft: `${Math.min(row.depth, 10) * 0.95}rem` }}
                >
                  {row.branchLabel || row.branchId ? (
                    <span className={styles.branchChip}>{row.branchLabel || '(unlabelled)'}</span>
                  ) : null}
                  {node ? (
                    <>
                      <button
                        type="button"
                        className={isSelected ? styles.outlineNodeActive : styles.outlineNode}
                        onClick={() => setSelectedId(node.id)}
                        title="Select this step"
                      >
                        <span className={node.kind === 'outcome' ? styles.dotOutcome : styles.dotQuestion} />
                        {node.title || '(untitled step)'}
                        {node.id === tree.rootId && <span className={styles.rootChip}>start</span>}
                      </button>
                      {row.repeat && <span className={styles.repeatChip} title="Drawn in full higher up - the flow rejoins here">↩ rejoins above</span>}
                      {editing && !row.repeat && (
                        <span className={styles.rowActions}>
                          <button type="button" className={styles.iconBtn} title="Add a step under this one"
                            onClick={() => {
                              const { tree: next, id } = addNode(tree, { parentId: node.id, title: '' });
                              applyTree(next);
                              if (id) setSelectedId(id);
                            }}>+</button>
                          {row.parentId && (
                            <>
                              <button type="button" className={styles.iconBtn} title="Move this branch up"
                                onClick={() => applyTree(moveBranch(tree, row.parentId, row.branchId, -1))}>↑</button>
                              <button type="button" className={styles.iconBtn} title="Move this branch down"
                                onClick={() => applyTree(moveBranch(tree, row.parentId, row.branchId, 1))}>↓</button>
                            </>
                          )}
                          <button type="button" className={styles.iconBtn} title="Start the walk from here"
                            onClick={() => walkFrom(node.id)}>▶</button>
                          {node.id !== tree.rootId && (
                            <button
                              type="button"
                              className={styles.iconBtnDanger}
                              title="Delete this step"
                              onClick={() => {
                                const cascade = window.confirm(`Delete "${node.title || 'this step'}".\n\nOK also deletes the steps only it led to.\nCancel keeps them - they'll be listed as unreachable.`);
                                applyTree(deleteNode(tree, node.id, { cascade }));
                                if (selectedId === node.id) setSelectedId(null);
                              }}
                            >🗑</button>
                          )}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className={styles.outlineDead}>
                      not linked yet
                      {editing && row.parentId && (
                        <button type="button" className={styles.iconBtn} title="Create the step this branch goes to"
                          onClick={() => {
                            const { tree: next, id } = addNode(tree, { parentId: row.parentId, branchId: row.branchId, title: '' });
                            applyTree(next);
                            if (id) setSelectedId(id);
                          }}>+ step</button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}

            {orphans.length > 0 && (
              <div className={styles.orphanBlock}>
                <div className={styles.fieldLabel}>Nothing reaches these - link them from a branch, or delete them</div>
                {orphans.map(id => {
                  const node = getNode(tree, id);
                  return (
                    <div key={id} className={styles.outlineRow}>
                      <button type="button" className={selectedId === id ? styles.outlineNodeActive : styles.outlineNode}
                        onClick={() => setSelectedId(id)}>
                        <span className={node.kind === 'outcome' ? styles.dotOutcome : styles.dotQuestion} />
                        {node.title || '(untitled step)'}
                      </button>
                      {editing && (
                        <span className={styles.rowActions}>
                          <button type="button" className={styles.iconBtn} title="Make this the step the tree starts at"
                            onClick={() => applyTree(setRoot(tree, id))}>make start</button>
                          <button type="button" className={styles.iconBtnDanger} title="Delete this step"
                            onClick={() => { applyTree(deleteNode(tree, id)); if (selectedId === id) setSelectedId(null); }}>🗑</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.inspector}>
            {selectedId && getNode(tree, selectedId) ? (
              <>
                <div className={styles.inspectorHead}>
                  <h2 className={styles.inspectorTitle}>{getNode(tree, selectedId).title || '(untitled step)'}</h2>
                  <button type="button" className={styles.smallBtn} onClick={() => walkFrom(selectedId)}>Walk from here</button>
                </div>
                {editing ? (
                  <NodeEditor tree={tree} nodeId={selectedId} catalog={catalog} onChange={applyTree} onSelect={setSelectedId} />
                ) : (
                  <>
                    <NodeDetail detail={getNode(tree, selectedId).detail} />
                    {getNode(tree, selectedId).services.length > 0 && (
                      <div className={styles.tagBlock}>
                        <div className={styles.fieldLabel}>Services delivered here</div>
                        <ServiceTags services={getNode(tree, selectedId).services} known={knownServices} />
                      </div>
                    )}
                    <div className={styles.muted}>Turn on Edit to change this step.</div>
                  </>
                )}
              </>
            ) : (
              <div className={styles.muted}>Pick a step on the left to read or edit it.</div>
            )}
          </div>
        </div>
      )}

      {addAfterId && (
        <AddStepModal
          tree={tree}
          fromId={addAfterId}
          onCancel={() => setAddAfterId(null)}
          onAdd={picked => addStepAfter(addAfterId, picked)}
        />
      )}

      {popupId && (
        <NodeDetailModal
          tree={tree}
          nodeId={popupId}
          catalog={catalog}
          knownServices={knownServices}
          editing={editing}
          onClose={() => setPopupId(null)}
          onGoTo={(id) => { setPopupId(id); setSelectedId(id); }}
          onWalkFrom={walkFrom}
          onChange={applyTree}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './EfficiencyTreeView.module.css';
import { DEFAULT_EFFICIENCY_TREE } from '../../data/efficiencyDecisionTree';
import {
  addBranch, addNode, deleteNode, detailBlocks, getNode, moveBranch, normalizeTree,
  orphanIds, outlineRows, pathFromRoot, removeBranch, setRoot, treeStats,
  updateBranch, updateNode,
} from '../../utils/decisionTree';

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

const SETTINGS_KEY = 'efficiencyDecisionTree';
const SAVE_DELAY_MS = 800;

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
function NodeEditor({ tree, nodeId, onChange, onSelect }) {
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
            placeholder="e.g. Gate 4 — Is the economics priced properly?"
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
            <option value="question">Question — branches out</option>
            <option value="outcome">Outcome — what to do</option>
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

      <div className={styles.branchBlock}>
        <div className={styles.fieldLabel}>Branches out of this step</div>
        {node.branches.length === 0 && (
          <div className={styles.emptyNote}>No branches — this step is an end of the route.</div>
        )}
        {node.branches.map((b, i) => (
          <div key={b.id} className={styles.branchRow}>
            <input
              className={styles.input}
              value={b.label}
              placeholder={i === 0 ? 'Yes — …' : 'No — …'}
              onChange={e => onChange(updateBranch(tree, nodeId, b.id, { label: e.target.value }))}
            />
            <div className={styles.branchTarget}>
              <span className={styles.branchGoes}>goes to</span>
              <select
                className={styles.input}
                value={b.to || ''}
                onChange={e => onChange(updateBranch(tree, nodeId, b.id, { to: e.target.value || null }))}
              >
                <option value="">— nowhere yet —</option>
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

export function EfficiencyTreeView({ settings = {}, settingsLoaded = false, updateSettings }) {
  const saved = settings[SETTINGS_KEY];
  const [tree, setTree] = useState(() => normalizeTree(saved || DEFAULT_EFFICIENCY_TREE));
  const [mode, setMode] = useState('walk');
  const [editing, setEditing] = useState(false);
  const [trail, setTrail] = useState([]);           // node ids answered through, root first
  const [selectedId, setSelectedId] = useState(null); // the step the map is inspecting
  const [status, setStatus] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  // A save is owed (debounce running) or in the air. While that's true a
  // snapshot arriving from Firestore is older than what's on screen, so the
  // adopt-remote effect below has to leave the local tree alone — otherwise
  // the echo of our own write lands mid-sentence and eats the keystrokes
  // typed after it.
  const pendingRef = useRef(false);
  const timerRef = useRef(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const save = useCallback((next) => {
    if (!updateSettings) return;
    pendingRef.current = true;
    setStatus('Saving…');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Promise.resolve(updateSettings({ [SETTINGS_KEY]: next }))
        .then(() => setStatus('Saved'))
        .catch(() => setStatus('Save failed'))
        .finally(() => { pendingRef.current = false; });
    }, SAVE_DELAY_MS);
  }, [updateSettings]);

  // Flush a pending save if the page is left mid-debounce.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Every edit goes through here: local state first so typing stays instant,
  // then the debounced write.
  const applyTree = useCallback((next) => {
    setTree(next);
    save(next);
  }, [save]);

  // Adopt a tree saved elsewhere (another device, another tab). Skipped while
  // we owe a save, and skipped when it matches what's already on screen —
  // which is what our own write comes back as.
  const savedJson = useMemo(() => (saved ? JSON.stringify(saved) : ''), [saved]);
  useEffect(() => {
    if (!settingsLoaded || pendingRef.current || !savedJson) return;
    if (savedJson === JSON.stringify(treeRef.current)) return;
    setTree(normalizeTree(JSON.parse(savedJson)));
  }, [savedJson, settingsLoaded]);

  const stats = useMemo(() => treeStats(tree), [tree]);
  const rows = useMemo(() => outlineRows(tree), [tree]);
  const orphans = useMemo(() => orphanIds(tree), [tree]);

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
    setMode('walk');
  }

  function resetToTemplate() {
    if (!window.confirm('Replace your decision tree with the built-in C&I efficiency template? Your edits will be lost.')) return;
    const next = normalizeTree(DEFAULT_EFFICIENCY_TREE);
    setTrail([]);
    setSelectedId(null);
    applyTree(next);
  }

  async function copyJson() {
    const json = JSON.stringify(tree, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus('Copied the tree as JSON');
    } catch {
      setStatus('Clipboard blocked — paste from the import box instead');
    }
  }

  function runImport() {
    try {
      const parsed = JSON.parse(importText);
      const next = normalizeTree(parsed);
      if (Object.keys(next.nodes).length === 0) throw new Error('no steps found');
      setTrail([]);
      setSelectedId(null);
      applyTree(next);
      setImportOpen(false);
      setImportText('');
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
            <button type="button" className={mode === 'walk' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('walk')}>Walk it</button>
            <button type="button" className={mode === 'map' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('map')}>Map &amp; edit</button>
          </div>
          <label className={styles.editToggle} title="Show the editor for each step">
            <input type="checkbox" checked={editing} onChange={e => setEditing(e.target.checked)} />
            Edit
          </label>
          <button type="button" className={styles.smallBtn} onClick={copyJson} title="Copy the whole tree as JSON">Copy JSON</button>
          <button type="button" className={styles.smallBtn} onClick={() => setImportOpen(v => !v)}>Import</button>
          <button type="button" className={styles.smallBtn} onClick={resetToTemplate}>Reset to template</button>
        </div>
      </div>

      <div className={styles.statusBar}>
        <span>{stats.nodes} steps · {stats.branches} branches · {stats.ends} ends</span>
        {stats.unlinked > 0 && <span className={styles.warn}>{stats.unlinked} branch{stats.unlinked === 1 ? '' : 'es'} not pointed anywhere</span>}
        {orphans.length > 0 && <span className={styles.warn}>{orphans.length} step{orphans.length === 1 ? '' : 's'} nothing reaches</span>}
        {!settingsLoaded && <span className={styles.muted}>Loading your saved tree…</span>}
        {settingsLoaded && !saved && <span className={styles.muted}>Showing the built-in template — your first edit saves a copy of your own.</span>}
        {status && <span className={styles.muted}>{status}</span>}
      </div>

      {importOpen && (
        <div className={styles.importPanel}>
          <div className={styles.fieldLabel}>Paste a tree exported with Copy JSON</div>
          <textarea className={styles.textarea} rows={5} value={importText}
            onChange={e => { setImportText(e.target.value); setImportError(''); }} />
          {importError && <div className={styles.warn}>Couldn&apos;t read that: {importError}</div>}
          <div className={styles.branchActions}>
            <button type="button" className={styles.primaryBtn} onClick={runImport} disabled={!importText.trim()}>Replace my tree</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setImportOpen(false); setImportError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {mode === 'walk' ? (
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
                        title={target ? `Go to: ${target.title}` : 'This branch isn\'t pointed anywhere yet — turn on Edit to link it'}
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
                <NodeEditor tree={tree} nodeId={current.id} onChange={applyTree} onSelect={() => {}} />
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
                      {row.repeat && <span className={styles.repeatChip} title="Drawn in full higher up — the flow rejoins here">↩ rejoins above</span>}
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
                                const cascade = window.confirm(`Delete "${node.title || 'this step'}".\n\nOK also deletes the steps only it led to.\nCancel keeps them — they'll be listed as unreachable.`);
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
                <div className={styles.fieldLabel}>Nothing reaches these — link them from a branch, or delete them</div>
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
                  <NodeEditor tree={tree} nodeId={selectedId} onChange={applyTree} onSelect={setSelectedId} />
                ) : (
                  <>
                    <NodeDetail detail={getNode(tree, selectedId).detail} />
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
    </div>
  );
}

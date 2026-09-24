import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './EfficiencyTreeView.module.css';
import { DEFAULT_EFFICIENCY_TREE } from '../../data/efficiencyDecisionTree';
import {
  addBranch, addNextStep, deleteNode, detailBlocks, getNode, moveBranch, normalizeTree,
  orphanIds, outlineRows, pathFromRoot, removeBranch, setRoot, strandedByDelete,
  toggleNodeService, treeStats, updateBranch, updateNode,
} from '../../utils/decisionTree';
import {
  answerRoutes, answeredSteps, prunedTree, rewindRoute, routeArrows, routeEnds, routeSteps,
} from '../../utils/decisionWalk';
import { edgePath, LAYOUT, layoutTree } from '../../utils/treeLayout';
import { SavingsPanel } from './SavingsPanel.jsx';
import { pricedServiceRows } from '../../utils/serviceRows';
import {
  LEGACY_KEY, LIBRARY_KEY, MAX_NAME, activeEntry, addTree, blankTree, duplicateTree,
  getTreeLibrary, hasSavedTrees, putTree, removeTree, renameTree, setActiveTree,
} from '../../utils/treeLibrary';

// Service Deep Dives: two areas under one sidebar entry, each with its own
// subtabs.
//
//   EFFICIENCY   the decision trees that sequence a service. One subtab per
//                tree the user keeps, including the shipped C&I flow.
//   SOURCING     what the gas behind it costs. Contract savings prices one
//                term against the NYMEX record; Consumption is the volume
//                that term burns, month by month; Site pricing runs a whole
//                pasted list of renewals through the same tables.
//
// Two levels rather than one long strip, because the two areas answer
// different questions and share nothing but the page: the tree says which
// measure, Sourcing says what the gas behind it is worth. A strip that ran
// five trees and two gas subtabs together read as one list of seven
// unrelated things, and the tree verbs on the right of it (rename,
// duplicate, delete) applied to two of them.
//
// Which area is open is view state and not saved: the page opens on
// Efficiency, which is the job it is named for.
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

// Sourcing's subtabs, in the order they get used: price the one term first,
// give it the volume it actually burns, then run the list of renewals
// through the same tables. The ids are what SavingsPanel reads as its
// `section`.
//
// Consumption earns a subtab rather than a block inside Contract savings
// because of what it is: a year of somebody's meter reads, entered a cell at
// a time off a stack of bills. That is a sitting-down job with a spreadsheet
// open, and it was happening in a box wedged between the hedge layers and
// the savings tiles.
const SOURCING_TABS = [
  {
    id: 'steps',
    label: 'Step by step',
    title: 'Enter a site one step at a time: the site, the contract type, its consumption, the contract details, then the savings',
    blurb: 'Enter a site one step at a time: the site, how the gas is bought, what it burns and the contract, then what it saves measured every way. Everything entered here is the same scenario Contract savings and Consumption show.',
  },
  {
    id: 'contract',
    label: 'Contract savings',
    title: 'Historical NYMEX settles, contract pricing, hedge layers and term length, and what the hedge is worth',
    blurb: 'What a gas contract and its hedge layers are worth against the NYMEX record: load the settles and the forward curve, describe the term, and see the saving month by month.',
  },
  {
    id: 'consumption',
    label: 'Consumption',
    title: 'What the term burns, month by month and year by year, against the annual volume and the shape it falls back on',
    blurb: 'What the term actually burns: a cell per month and a column per year, with a total under each. Every month left empty prices off the annual volume and the shape, and the page says per month which it used.',
  },
  {
    id: 'sites',
    label: 'Site pricing',
    title: 'A pasted renewal comparison, every term priced off the same tables, with the change split into market and deal',
    blurb: 'A whole list of renewals against the same record: paste the comparison out of Excel and every term is priced, with the change split into what the market did and what the deal did.',
  },
];
const sourcingBlurb = (id) => (SOURCING_TABS.find(t => t.id === id) || SOURCING_TABS[0]).blurb;

// What each kind of step looks like, in one place: the diagram box, the dot
// on an outline row, the badge in Walk it, and what that badge says. Five
// places used to read the kind with a ternary, which is how a third kind
// gets added everywhere but the one spot nobody remembered.
const KIND_UI = {
  question: { box: styles.boxQuestion, dot: styles.dotQuestion, badge: styles.kindQuestion, label: 'Decide' },
  outcome: { box: styles.boxOutcome, dot: styles.dotOutcome, badge: styles.kindOutcome, label: 'Do this' },
  end: { box: styles.boxEnd, dot: styles.dotEnd, badge: styles.kindEnd, label: 'Stop here' },
};
// A tree saved by an older version can carry a kind this one doesn't know;
// normalizeTree already reads that as a question, and so does this.
const kindUi = (kind) => KIND_UI[kind] || KIND_UI.question;

// Said in three places - the two shut buttons in the editor and the status
// line when something tries anyway - so it is said the same way each time.
const END_NO_NEXT = 'This step is an End, so nothing comes after it. Change its Kind to give it a way out.';
// How much of the catalog the picker lists at once. The Solutions list runs
// to a hundred and fifty services, and a dropdown that long is scrolled
// rather than read — so it shows a window and the search box narrows it.
const PICKER_ROWS = 10;

// A box in the diagram names the services delivered at the step rather than
// counting them: the diagram gets read out in front of a customer, and "4
// services" is a number you then have to click to use.
//
// Five names is what a box this wide carries before the flow disappears
// under a service catalogue; past that it says how many are left, and the
// popup and the side panel carry the full list either way.
const BOX_SERVICE_LINES = 5;
// One line per name, in step with .boxService's line-height, plus the gap
// above the list. The layout has to know the height before the browser has
// laid anything out, so the two are kept level by hand - change one and
// change the other.
const BOX_SERVICE_LINE_H = 15;
const BOX_SERVICE_GAP = 4;

/** How tall the box for one step has to be to list what it delivers. */
function boxHeight(node) {
  const count = node?.services?.length || 0;
  if (count === 0) return LAYOUT.nodeHeight;
  const lines = Math.min(count, BOX_SERVICE_LINES) + (count > BOX_SERVICE_LINES ? 1 : 0);
  return LAYOUT.nodeHeight + BOX_SERVICE_GAP + lines * BOX_SERVICE_LINE_H;
}

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
//
// `onAddStep(fromId, branchId?)` opens the page's add-step dialog rather than
// making a step here. Every button on the page that adds one goes through
// that dialog, so the choice between a decision point and a plain step is
// offered wherever a step is added rather than only on the diagram.
function NodeEditor({ tree, nodeId, catalog, onChange, onAddStep }) {
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
            <option value="end">End - the route stops here</option>
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
          <div className={styles.emptyNote}>
            {node.kind === 'end'
              ? 'An end of the route - nothing comes after it. Change Kind above to give it a way out.'
              : 'No branches - this step is an end of the route.'}
          </div>
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
                title="Create the step this branch goes to"
                onClick={() => onAddStep?.(nodeId, b.id)}
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
        {/* An end is a claim that the route stops here, so the two buttons
            that would give it a way out are shut rather than left to
            contradict it. Changing Kind above opens them again. */}
        <div className={styles.branchActions}>
          <button type="button" className={styles.smallBtn}
            disabled={node.kind === 'end'}
            title={node.kind === 'end' ? END_NO_NEXT : 'Another way out of this step'}
            onClick={() => onChange(addBranch(tree, nodeId, { label: '' }))}>+ Add branch</button>
          <button type="button" className={styles.primaryBtn}
            disabled={node.kind === 'end'}
            title={node.kind === 'end' ? END_NO_NEXT : 'A decision point that branches, or a step that just says what happens'}
            onClick={() => onAddStep?.(nodeId)}>+ Add the next step</button>
        </div>
      </div>
    </div>
  );
}

// Deleting a step, asked properly.
//
// Two questions, and the second one only when it is a real one: is this step
// to go, and then - if it is the only route to anything - do the steps under
// it go too. They used to be one prompt, with OK and Cancel both meaning
// delete and neither meaning stop, which is a dialog you can't answer wrong
// slowly enough. It also asked about a limb on every delete, including the
// leaf steps that have nothing under them at all.
//
// Returns the options to hand deleteNode, or null when the answer was no.
function confirmDeleteStep(tree, id) {
  const node = getNode(tree, id);
  if (!node) return null;
  const name = node.title || '(untitled step)';
  if (!window.confirm(
    `Delete "${name}"?\n\nBranches that point at it keep their label and stop pointing anywhere.`,
  )) return null;
  const stranded = strandedByDelete(tree, id);
  if (stranded.length === 0) return { cascade: false };
  const many = stranded.length > 1;
  return {
    cascade: window.confirm(
      `"${name}" is the only route to ${stranded.length} other step${many ? 's' : ''}.\n\n`
      + `OK deletes ${many ? 'them' : 'it'} as well.\n`
      + `Cancel keeps ${many ? 'them' : 'it'}, listed under "Nothing reaches these".`,
    ),
  };
}

// The popup behind a box in the diagram. A box only has room for a title, so
// this is where the detail lives — plus the two questions you actually have
// when you click one: what leads here, and where does it go next. Both lists
// are clickable, so the popup doubles as a way to move around the flow
// without hunting for the next box on the canvas.
function NodeDetailModal({ tree, nodeId, catalog, knownServices, editing, onClose, onGoTo, onWalkFrom, onChange, onAddStep }) {
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
        // branchId so the row can unlink the arrow it stands for: two steps
        // can be joined by more than one branch, and "the one this row is"
        // is the only one it may remove.
        if (b.to === node.id) out.push({ id: other.id, title: other.title, label: b.label, branchId: b.id });
      }
    }
    return out;
  }, [tree, node]);

  // Delete a step from one of the lists below, then leave the popup where it
  // is: the step it is about has not gone, only one of its neighbours.
  const deleteStep = (id) => {
    const opts = confirmDeleteStep(tree, id);
    if (opts) onChange(deleteNode(tree, id, opts));
  };

  if (!node) return null;

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.modalCard} onMouseDown={e => e.stopPropagation()} role="dialog" aria-label={node.title}>
        <div className={styles.modalHead}>
          <span className={kindUi(node.kind).badge}>
            {kindUi(node.kind).label}
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
                <div key={`${p.id}-${p.branchId}`} className={styles.linkRowWrap}>
                  <button type="button" className={styles.linkRow} onClick={() => onGoTo(p.id)}>
                    <span className={styles.linkRowLabel}>{p.title || '(untitled step)'}</span>
                    <span className={styles.linkRowNote}>{p.label || '(unlabelled branch)'}</span>
                  </button>
                  {editing && (
                    <>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title={`Unlink: the arrow from "${p.title || '(untitled step)'}" goes, both steps stay`}
                        aria-label="Unlink this arrow"
                        onClick={() => onChange(removeBranch(tree, p.id, p.branchId))}
                      >✕</button>
                      {p.id !== tree.rootId && (
                        <button
                          type="button"
                          className={styles.iconBtnDanger}
                          title={`Delete the step "${p.title || '(untitled step)'}"`}
                          aria-label="Delete this step"
                          onClick={() => deleteStep(p.id)}
                        >🗑</button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={styles.modalSection}>
            <div className={styles.fieldLabel}>Leads to</div>
            {node.branches.length === 0 && <div className={styles.emptyNote}>Nothing - this is an end of the route.</div>}
            {node.branches.map(b => {
              const target = b.to ? getNode(tree, b.to) : null;
              return (
                <div key={b.id} className={styles.linkRowWrap}>
                  <button
                    type="button"
                    className={target ? styles.linkRow : styles.linkRowDead}
                    disabled={!target}
                    onClick={() => target && onGoTo(b.to)}
                  >
                    <span className={styles.linkRowLabel}>{b.label || '(unlabelled branch)'}</span>
                    <span className={styles.linkRowNote}>{target ? target.title : 'not linked yet'}</span>
                  </button>
                  {/* Two different things to throw away, so two buttons. The
                      arrow out of this step is one; the step on the end of
                      it, which other branches may also reach, is another. */}
                  {editing && (
                    <>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        title={target
                          ? `Remove this branch: the arrow goes, "${target.title || '(untitled step)'}" stays`
                          : 'Remove this branch. It points nowhere, so nothing else changes.'}
                        aria-label="Remove this branch"
                        onClick={() => onChange(removeBranch(tree, node.id, b.id))}
                      >✕</button>
                      {target && target.id !== tree.rootId && (
                        <button
                          type="button"
                          className={styles.iconBtnDanger}
                          title={`Delete the step "${target.title || '(untitled step)'}"`}
                          aria-label="Delete this step"
                          onClick={() => deleteStep(target.id)}
                        >🗑</button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {!editing && (
              <div className={styles.fieldHint}>
                Turn on Edit to delete steps or remove branches from here.
              </div>
            )}
          </div>

          {editing && <NodeEditor tree={tree} nodeId={node.id} catalog={catalog} onChange={onChange} onAddStep={onAddStep} />}
        </div>

        <div className={styles.modalFoot}>
          {/* The step this popup is about. Deleting it closes the popup,
              because there is nothing left for it to be about. The start of
              the tree has no button at all: the page would have nothing to
              open on, and deleteNode refuses it anyway.

              Far left, away from the two buttons that get clicked by habit -
              this is the only thing in the popup that cannot be undone. */}
          {editing && node.id !== tree.rootId && (
            <button
              type="button"
              className={styles.dangerBtn}
              title={`Delete "${node.title || '(untitled step)'}" from this tree`}
              onClick={() => {
                const opts = confirmDeleteStep(tree, node.id);
                if (!opts) return;
                onChange(deleteNode(tree, node.id, opts));
                onClose();
              }}
            >Delete this step</button>
          )}
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
// When the press itself named a branch - the + on one branch row, or on an
// outline row reading "not linked yet" - there is nothing left to ask and it
// says which branch instead.
function AddStepModal({ tree, fromId, lockedBranchId = null, onCancel, onAdd }) {
  const parent = getNode(tree, fromId);
  const free = useMemo(() => (parent?.branches || []).filter(b => !b.to), [parent]);
  // Some callers already know the answer: the + on a gate's Yes, or on an
  // outline row that reads "not linked yet", is a press on ONE branch. The
  // dialog states which rather than asking, because re-asking a question the
  // click already answered is how the wrong branch gets filled in.
  //
  // Every branch, not just the free ones: pressing + on a branch that already
  // leads somewhere means "put a step here instead", and offering some OTHER
  // free branch because this one was taken is how you repoint the wrong arrow.
  const locked = useMemo(
    () => (lockedBranchId ? (parent?.branches || []).find(b => b.id === lockedBranchId) || null : null),
    [parent, lockedBranchId],
  );
  const displaced = locked?.to ? getNode(tree, locked.to) : null;
  const [kind, setKind] = useState('question');
  const [title, setTitle] = useState('');
  // '' means "on a new branch of its own"; anything else is one of the free
  // branches above. It opens on the branch that was waiting when there is
  // one: that is the answer nine times in ten, and picking it for them is
  // what makes the second press of + fill in a gate's Yes. Read once, at
  // mount - the dialog is thrown away and rebuilt on every press, so there
  // is no later state of the tree for it to be stale against.
  const [branchId, setBranchId] = useState(() => locked?.id || free[0]?.id || '');
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
            <button
              type="button"
              className={kind === 'end' ? styles.kindCardOn : styles.kindCard}
              aria-pressed={kind === 'end'}
              onClick={() => setKind('end')}
            >
              <span className={styles.kindCardIcon} aria-hidden="true">⬭</span>
              <span className={styles.kindCardName}>End</span>
              <span className={styles.kindCardNote}>
                Where the route stops. Drawn as a stadium, and nothing hangs off it.
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
                : kind === 'end'
                  ? 'e.g. Nothing further - close it out'
                  : 'e.g. Scope the retrofit'}
            />
          </label>

          {locked ? (
            <div className={styles.afterNote}>
              Reached by <strong>{locked.label || '(unlabelled branch)'}</strong>
              {displaced && (
                <span className={styles.fieldHint}>
                  {`That branch goes to "${displaced.title || '(untitled step)'}" today - the new step takes its place, and the old one stays in the tree as a step nothing reaches.`}
                </span>
              )}
            </div>
          ) : free.length > 0 && (
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
  // Which area is open, and which Sourcing subtab within it. The tree
  // subtab is the library's own activeId, because a tree is a saved thing
  // and follows the user across devices; these two are where you happen to
  // be looking, so they live here and reset on reload.
  const [area, setArea] = useState('efficiency');
  const [sourcingTab, setSourcingTab] = useState('steps');
  const onSourcing = area === 'sourcing';
  const [mode, setMode] = useState('diagram');
  const [editing, setEditing] = useState(false);
  // The pathways picked through the tree: each one a list of node ids
  // answered through, root first, and several of them at once because one
  // account is several pathways. `active` is the one Walk it is walking and
  // the one an answer carries on; every one of them lights up the diagram.
  const [routes, setRoutes] = useState([]);
  const [activeRoute, setActiveRoute] = useState(0);
  const [selectedId, setSelectedId] = useState(null); // the step the map is inspecting
  const [status, setStatus] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importName, setImportName] = useState('');
  const [importError, setImportError] = useState('');
  // Whether the ways out the answers ruled out are being shown anyway. Off,
  // which is the point of narrowing the diagram; on, it is the whole tree
  // again, which is how a second pathway out of a step already answered is
  // picked after the first one hid it.
  const [showRuledOut, setShowRuledOut] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  const [popupId, setPopupId] = useState(null);   // the box whose detail is open
  // The add-step dialog: which step the new one comes after, and - when the
  // press already said so - which way out of it leads there.
  const [addAfter, setAddAfter] = useState(null);
  const [freshId, setFreshId] = useState(null);   // the step just added, to scroll to and mark
  // Renaming a tree happens in its own subtab: the label turns into an input
  // where it sits, so the name is edited in the place it is read rather than
  // in a prompt box floating over the page. `renamingId` is the tree being
  // renamed, `renameDraft` what has been typed so far.
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
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
  // What the diagram is drawing. Answering a question rules out its other
  // ways out, and the diagram closes up around what is left: the arrow you
  // didn't take goes, and so does every step that hung off it. In front of a
  // customer that is the point - the flow on the screen is the one they are
  // being walked through, not the whole catalogue of what might have been.
  //
  // Nothing is lost by it: the status bar counts what went and puts it back,
  // which is how a second pathway out of a step already answered gets picked
  // once the first answer hid the other way out.
  //
  // Not while Edit is on either: the rearranging is done by wiring branches
  // between boxes, and a box you can't see is a box you can't wire up. So
  // ticking Edit brings the whole tree back, and the walk is undisturbed
  // underneath it.
  const pruned = useMemo(() => prunedTree(tree, routes), [tree, routes]);
  const ruledOutCount = Object.keys(tree.nodes).length - Object.keys(pruned.nodes).length;
  const shownTree = editing || showRuledOut ? tree : pruned;
  const layout = useMemo(() => layoutTree(shownTree, { heightOf: boxHeight }), [shownTree]);

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

  // Every "add a step" on the page opens the same dialog, so the choice
  // between a decision point - which arrives with its Yes and its No - and a
  // step that just says what happens is offered wherever a step is added,
  // rather than only on the diagram's hover handle where it used to live.
  //
  // It turns Edit on rather than requiring it first: pressing a button that
  // says "add a step" has already said what the checkbox asks, and the popup
  // is closed because the dialog would otherwise open behind it.
  const openAddStep = useCallback((fromId, branchId = null) => {
    if (!fromId) return;
    // Every way in comes through here - the toolbar, the + on a box, the
    // editor, an outline row - so an end refuses them all in one place
    // rather than in four.
    if (getNode(activeEntry(libraryRef.current).tree, fromId)?.kind === 'end') {
      setStatus(END_NO_NEXT);
      return;
    }
    setPopupId(null);
    setEditing(true);
    setAddAfter({ fromId, branchId });
  }, []);

  // The + on a box: the new step, wired to the one it was added after, and
  // the diagram moved to it. Everything the dialog asked goes straight in;
  // anything it didn't ask about is what addNextStep decides.
  function addStepAfter(fromId, { kind, title, branchId, branchLabel }) {
    const { tree: next, id } = addNextStep(tree, { fromId, branchId, branchLabel, kind, title });
    setAddAfter(null);
    if (!id) {
      setStatus('This tree is full - 500 steps is the limit.');
      return;
    }
    applyTree(next);
    setSelectedId(id);
    setFreshId(id);
  }

  // Where the walk is standing. No routes at all means the root, and the
  // active index is clamped so a pathway dropped out from under it falls
  // back to the first rather than to nothing.
  const routeList = routes.length ? routes : [[tree.rootId]];
  const activeIdx = Math.min(activeRoute, routeList.length - 1);
  const trailSteps = routeList[activeIdx];
  const currentId = trailSteps[trailSteps.length - 1];
  const current = getNode(tree, currentId) || getNode(tree, tree.rootId);
  // What the diagram draws: every arrow any pathway has answered, every step
  // one of them has gone past, and where each is standing. Unions, so two
  // pathways sharing their first half light it once and the step they part
  // at reads as answered rather than as two places you are at the same time.
  const pickedArrows = routeArrows(routeList);
  const answeredIds = answeredSteps(routeList);
  const endIds = routeEnds(routeList);
  const walkedIds = routeSteps(routeList);
  const answerCount = pickedArrows.size;
  // Where the picked pathways have got to, in words. Three of them read; past
  // that the line is longer than the toolbar it sits in and the rest are
  // counted, since the boxes themselves say it on the diagram below.
  const endList = [...endIds].map(id => `“${getNode(tree, id)?.title || '(untitled step)'}”`);
  const endTitles = endList.slice(0, 3).join(', ')
    + (endList.length > 3 ? ` +${endList.length - 3} more` : '');

  // Answering on the diagram moves you down the flow, and on a tree of any
  // size the step you land on is off the bottom of the window. Bring it into
  // view when it isn't in it - and leave the canvas exactly where it is when
  // it already is, so answering a question in the middle of the screen
  // doesn't jerk the whole diagram under the pointer.
  useEffect(() => {
    if (mode !== 'diagram' || routes.length === 0) return;
    const wrap = canvasWrapRef.current;
    const box = layout.byId.get(currentId);
    if (!wrap || !box) return;
    const left = box.x * zoom;
    const top = box.y * zoom;
    const right = (box.x + box.w) * zoom;
    const bottom = (box.y + box.h) * zoom;
    const inView = left >= wrap.scrollLeft && right <= wrap.scrollLeft + wrap.clientWidth
      && top >= wrap.scrollTop && bottom <= wrap.scrollTop + wrap.clientHeight;
    if (inView) return;
    wrap.scrollTo({
      left: Math.max(0, (box.x + box.w / 2) * zoom - wrap.clientWidth / 2),
      top: Math.max(0, (box.y + box.h / 2) * zoom - wrap.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [currentId, mode, routes.length, layout, zoom]);

  // Answering one question, from either screen: the walk's big buttons and
  // the diagram's Yes / No labels both land here. What the routes become -
  // carry on, take the answer back, or open a second pathway from a step
  // already answered - is decided in utils/decisionWalk, where it can be
  // tested.
  function answerBranch(fromId, branch) {
    const next = answerRoutes(tree, routeList, fromId, branch, activeIdx);
    if (!next) return;
    setRoutes(next.routes);
    setActiveRoute(next.active);
  }

  function choose(branch) {
    answerBranch(currentId, branch);
  }

  // Back up the pathway being walked, leaving the others where they are.
  function rewindTo(index) {
    const next = rewindRoute(routeList, activeIdx, index);
    if (!next) return;
    setRoutes(next.routes);
    setActiveRoute(next.active);
  }

  // "Walk from here": the way in to that step as a pathway of its own,
  // alongside anything already picked rather than instead of it. Already on
  // one of them, and that one is simply the one walked.
  function walkFrom(nodeId) {
    const at = routeList.findIndex(route => route[route.length - 1] === nodeId);
    if (at !== -1) setActiveRoute(at);
    else {
      const path = pathFromRoot(tree, nodeId);
      const route = path ? path.map(p => p.nodeId) : [nodeId];
      if (route.length > 1) {
        const next = [...routes, route];
        setRoutes(next);
        setActiveRoute(next.length - 1);
      } else {
        setRoutes([]);
        setActiveRoute(0);
      }
    }
    setPopupId(null);
    setMode('walk');
  }

  function startOver() {
    setRoutes([]);
    setActiveRoute(0);
    setShowRuledOut(false);
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
    startOver();
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
    setArea('efficiency');
    if (id === library.activeId) return;
    startOver();
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
    setArea('efficiency');
    const label = (window.prompt('Name for the new decision tree:', 'New tree') || '').trim();
    if (!label) return;
    const { library: next, id } = addTree(library, { name: label, tree: blankTree() });
    if (!id) { setStatus(`That is as many trees as this page holds (${library.trees.length}).`); return; }
    startOver();
    setPopupId(null);
    setSelectedId(blankTree().rootId);
    setMode('map');
    setEditing(true);
    setStatus(`Added "${label}" - add steps from the editor on the right.`);
    applyLibrary(setActiveTree(next, id));
  }

  // A copy to change, for a flow that is mostly right for the next job.
  function copyTree() {
    setArea('efficiency');
    const { library: next, id } = duplicateTree(library, entry.id);
    if (!id) { setStatus(`That is as many trees as this page holds (${library.trees.length}).`); return; }
    startOver();
    setSelectedId(null);
    setPopupId(null);
    applyLibrary(setActiveTree(next, id));
  }

  // Start, keep, or drop an in-place rename. Double-clicking a subtab starts
  // one, as does the Rename button on the tree that's open and F2 on a
  // focused tab; Enter or clicking away keeps what was typed, Escape puts the
  // old name back. An empty name is a cancel rather than an error, because a
  // tab with no label is not a thing the strip can show.
  function startRename(id) {
    const target = library.trees.find(t => t.id === id);
    if (!target) return;
    setRenamingId(id);
    setRenameDraft(target.name);
  }

  function commitRename() {
    if (!renamingId) return;
    const target = library.trees.find(t => t.id === renamingId);
    const label = renameDraft.trim();
    setRenamingId(null);
    setRenameDraft('');
    if (!target || !label || label === target.name) return;
    applyLibrary(renameTree(library, renamingId, label));
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  function renameActiveTree() {
    startRename(entry.id);
  }

  function deleteActiveTree() {
    if (library.trees.length <= 1) {
      setStatus('This is the only tree - the page needs one. Add another first.');
      return;
    }
    if (!window.confirm(`Delete "${entry.name}" and its ${stats.nodes} step${stats.nodes === 1 ? '' : 's'}? This can't be undone.`)) return;
    startOver();
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
    setArea('efficiency');
    try {
      const parsed = JSON.parse(importText);
      const imported = normalizeTree(parsed);
      if (Object.keys(imported.nodes).length === 0) throw new Error('no steps found');
      const { library: next, id } = addTree(library, { name: importName.trim() || 'Imported tree', tree: imported });
      if (!id) throw new Error(`that is as many trees as this page holds (${library.trees.length})`);
      startOver();
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title}>Service Deep Dives</h1>
          <div className={styles.subtitle}>
            {!onSourcing
              ? 'C&I efficiency work, sequenced: what to fix in what order, and what gets funded with whose money.'
              : sourcingBlurb(sourcingTab)}
          </div>
        </div>
        {/* Every control up here acts on the tree in front of you, so in
            Sourcing there is no tree for them to act on and they are gone
            rather than disabled. Not rendered rather than hidden: the strip
            is a flex row, and `hidden` loses to that. */}
        {!onSourcing && (
        <div className={styles.headerActions}>
          <div className={styles.modeSwitch}>
            <button type="button" className={mode === 'diagram' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('diagram')}>Diagram</button>
            <button type="button" className={mode === 'walk' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('walk')}>Walk it</button>
            <button type="button" className={mode === 'map' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('map')}>Map &amp; edit</button>
          </div>
          {/* Adding a step used to be a handle that stayed invisible until
              you hovered the right box with Edit already on, which is a
              control you have to be told about. This one is always on the
              toolbar, and it is where the decision point with its Yes and
              its No is chosen. */}
          {mode === 'diagram' && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => openAddStep(getNode(tree, selectedId) ? selectedId : tree.rootId)}
              title="Add a decision point that branches, or a step that just says what happens"
            >+ Add step</button>
          )}
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
          {/* Undoing the answers. Taking back the last one is also a click on
              its own tick out on the diagram; this is the version you can
              find without hunting for the arrow it was given on. Only there
              once something has been answered, since neither does anything
              from the top of the flow. */}
          {mode === 'diagram' && routes.length > 0 && (
            <div className={styles.zoomBar}>
              <button type="button" className={styles.smallBtn}
                onClick={() => rewindTo(trailSteps.length - 2)}
                disabled={trailSteps.length < 2}
                title={routeList.length > 1
                  ? `Take back the last answer on the pathway to “${current?.title || 'here'}”`
                  : 'Take back the last answer'}>Back</button>
              <button type="button" className={styles.smallBtn}
                onClick={startOver}
                title="Clear every answer on every pathway and start again at the top">Start over</button>
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
        )}
      </div>

      {/* The two areas. Pills rather than folder tabs, so this level never
          looks like the strip under it: the subtabs below always belong to
          the pill that is lit here. */}
      <div className={styles.areaTabs} role="tablist" aria-label="Areas">
        <button
          type="button"
          role="tab"
          aria-selected={!onSourcing}
          className={!onSourcing ? styles.areaTabActive : styles.areaTab}
          onClick={() => setArea('efficiency')}
          title="Walk a service decision tree, or open the map and edit the flow itself"
        >
          Efficiency
          <span className={styles.areaTabNote}>
            {library.trees.length} tree{library.trees.length === 1 ? '' : 's'}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={onSourcing}
          className={onSourcing ? styles.areaTabActive : styles.areaTab}
          onClick={() => setArea('sourcing')}
          title="Price gas against the NYMEX settles and the forward curve: one contract, or a whole list of site renewals"
        >
          Sourcing
          <span className={styles.areaTabNote}>gas pricing</span>
        </button>
      </div>

      {/* Efficiency's subtabs: one per tree the user keeps. The shipped C&I
          flow is one of them and carries no privileges — it can be renamed,
          copied, rebuilt or deleted like any other, as long as one tree is
          left for the page to open on. */}
      {!onSourcing && (
      <div className={styles.treeTabs} role="tablist" aria-label="Decision trees">
        {library.trees.map(t => {
          const count = Object.keys(t.tree.nodes).length;
          const open = t.id === entry.id;
          // Being renamed: the tab is the input, sized to what's in it so the
          // strip doesn't jump when the editing starts.
          if (t.id === renamingId) {
            return (
              <input
                key={t.id}
                type="text"
                className={styles.treeTabInput}
                value={renameDraft}
                size={Math.max(10, renameDraft.length + 1)}
                maxLength={MAX_NAME}
                aria-label={`Rename "${t.name}"`}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                }}
              />
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={open}
              className={open ? styles.treeTabActive : styles.treeTab}
              onClick={() => switchTree(t.id)}
              onDoubleClick={() => startRename(t.id)}
              onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); startRename(t.id); } }}
              title={`${t.name} - ${count} step${count === 1 ? '' : 's'} - double-click to rename`}
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
            left of them. Deleting asks; renaming and copying don't need to.
            They live in this strip rather than the one above because every
            one of them is a tree verb. */}
        <button type="button" className={styles.smallBtn} onClick={renameActiveTree}
          title={`Rename "${entry.name}" - or double-click its tab`}>Rename</button>
        <button type="button" className={styles.smallBtn} onClick={copyTree}
          title={`Copy "${entry.name}" into a tree of its own`}>Duplicate</button>
        <button type="button" className={styles.smallBtn} onClick={deleteActiveTree}
          disabled={library.trees.length <= 1}
          title={library.trees.length <= 1
            ? 'The page needs one tree - add another before deleting this one'
            : `Delete "${entry.name}"`}>Delete</button>
      </div>
      )}

      {/* Sourcing's subtabs: three readings of one set of numbers. All of
          them sit on the settles and the curve, which stay on screen in
          each - Consumption included, because how far back the look-back
          reaches comes out of the settle table. */}
      {onSourcing && (
      <div className={styles.treeTabs} role="tablist" aria-label="Sourcing">
        {SOURCING_TABS.map(t => {
          const open = sourcingTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={open}
              className={open ? styles.treeTabActive : styles.treeTab}
              onClick={() => setSourcingTab(t.id)}
              title={t.title}
            >{t.label}</button>
          );
        })}
      </div>
      )}

      {onSourcing ? (
        <SavingsPanel
          settings={settings}
          settingsLoaded={settingsLoaded}
          updateSettings={updateSettings}
          section={sourcingTab}
          onOpenSection={setSourcingTab}
        />
      ) : (
      <>

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
            {mode === 'diagram'
              ? 'Empty tree - “+ Add step” builds it out.'
              : editing
                ? 'Empty tree - write this step, then “+ Add the next step” to grow it.'
                : 'Empty tree - turn on Edit to build it.'}
          </span>
        )}
        {mode === 'diagram' && (
          <span className={styles.muted}>
            Click Yes or No on an arrow to answer it and carry on down · what the answer rules out leaves the diagram, and “show them” in this bar brings it back · answer a second way out of a step to open another pathway beside the first, as many as the account needs · click a ticked answer to take it back · click a box for the detail · drag to pan · hover a box for the + that adds the step after it
          </span>
        )}
        {/* How far down the flow the answers have got you. The routes are
            the same ones Walk it keeps, so a pathway answered here is a
            pathway that page can walk, and the other way round. With more
            than one picked it says where each of them has got to, because
            "standing on" is then several places at once. */}
        {mode === 'diagram' && routes.length > 0 && (
          <span className={styles.muted}>
            {answerCount} answered · {routeList.length > 1 ? `${routeList.length} pathways · ` : ''}
            standing on {endTitles}
          </span>
        )}
        {/* What the answers took off the diagram, and the way to have it
            back. Counted rather than silent: a step that disappeared is
            still the user's flow, and the second pathway out of a question
            already answered is picked on the arrow this hid. */}
        {mode === 'diagram' && !editing && ruledOutCount > 0 && (
          <button
            type="button"
            className={styles.ruledOutBtn}
            aria-pressed={showRuledOut}
            title={showRuledOut
              ? 'Hide the steps your answers ruled out, and leave the diagram on the pathways you picked.'
              : 'Show the steps your answers ruled out. Answer another way out of a step to open a second pathway beside the first.'}
            onClick={() => setShowRuledOut(v => !v)}
          >
            {ruledOutCount} step{ruledOutCount === 1 ? '' : 's'} ruled out
            <span className={styles.ruledOutDo}>{showRuledOut ? 'hide them' : 'show them'}</span>
          </button>
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
                  // An edge lights up when it is one of the answers given, so
                  // the diagram shows the route taken rather than just what
                  // exists.
                  const onTrail = pickedArrows.has(`${e.fromId}->${e.toId}`);
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

              {/* The answers, on the arrows they belong to. Clicking “Yes”
                  here is the same act as pressing it on Walk it: it ticks,
                  the route lights up to it, and the step it leads to becomes
                  the one you are standing on. Clicking a tick takes that
                  answer back. */}
              {layout.edges.map(e => {
                const from = getNode(tree, e.fromId);
                const branch = from?.branches.find(b => b.id === e.branchId);
                const target = getNode(tree, e.toId);
                const forkHere = (outDegree.get(e.fromId) || 0) > 1;
                const standingHere = currentId === e.fromId;
                // An arrow with no label just continues the flow, and reads
                // fine unlabelled - until you are standing on the box and
                // need a way to move on. Then it offers “Next”, so a step
                // nobody wrote an answer onto is still walkable.
                const label = e.label || (forkHere ? '-' : (standingHere ? 'Next' : ''));
                if (!label || !branch || !target) return null;
                const picked = pickedArrows.has(`${e.fromId}->${e.toId}`);
                const cls = picked
                  ? styles.edgeLabelPicked
                  : (e.back ? styles.edgeLabelBtnBack : styles.edgeLabelBtn);
                return (
                  <button
                    key={`label-${e.fromId}-${e.branchId}`}
                    type="button"
                    className={cls}
                    aria-pressed={picked}
                    style={{ left: e.labelX, top: e.labelY }}
                    title={picked
                      ? `Answered “${e.label || label}” on “${from.title || 'this step'}”. Click to take it back.`
                      : `Answer “${e.label || label}” on “${from.title || 'this step'}” and carry on to “${target.title || 'the next step'}”.`}
                    onClick={(ev) => {
                      // A click that ended a pan isn't a click on the answer.
                      const wrap = canvasWrapRef.current;
                      if (wrap?.dataset.panned) { delete wrap.dataset.panned; ev.preventDefault(); return; }
                      answerBranch(e.fromId, branch);
                    }}
                  >{picked ? `✓ ${label}` : label}</button>
                );
              })}

              {layout.nodes.map(box => {
                const node = getNode(tree, box.id);
                if (!node) return null;
                const onTrail = walkedIds.has(box.id);
                const here = endIds.has(box.id);
                // Answered and behind you: the box that drove the answer has
                // done its job, so it greys out and lets the step you are
                // standing on carry the eye.
                const spent = answeredIds.has(box.id) && !here;
                const cls = [
                  kindUi(node.kind).box,
                  box.orphan ? styles.boxOrphan : '',
                  onTrail ? styles.boxOnTrail : '',
                  spent ? styles.boxSpent : '',
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
                    {/* What we deliver here, named. The box was measured for
                        exactly these lines, so anything past the fifth is a
                        count with the rest in its tooltip. */}
                    {node.services.length > 0 && (
                      <span className={styles.boxServices}>
                        {node.services.slice(0, BOX_SERVICE_LINES).map(name => {
                          const gone = !knownServices.has(name);
                          return (
                            <span
                              key={name}
                              className={gone ? styles.boxServiceGone : styles.boxService}
                              title={gone
                                ? `${name} - not on the Solutions list any more. Open the step in Edit to swap or remove it.`
                                : name}
                            >{name}</span>
                          );
                        })}
                        {node.services.length > BOX_SERVICE_LINES && (
                          <span
                            className={styles.boxServiceMore}
                            title={`Also delivered here:\n${node.services.slice(BOX_SERVICE_LINES).join('\n')}`}
                          >+{node.services.length - BOX_SERVICE_LINES} more</span>
                        )}
                      </span>
                    )}
                    <span className={styles.boxMeta}>
                      {/* Checked off: a step the route has been through, and
                          the one it is standing on. The tick is the record of
                          the answers given - take one back on the arrow above
                          it and the tick goes with it. */}
                      {spent && (
                        <span className={styles.doneChip} title="Answered. Click the ticked answer on an arrow to take it back.">&#10003; done</span>
                      )}
                      {/* One per pathway: with two picked, two boxes say it,
                          which is what having picked two of them means. */}
                      {here && routes.length > 0 && (
                        <span
                          className={styles.hereChip}
                          title={routeList.length > 1
                            ? 'Where one of the pathways you have picked has got to'
                            : 'Where the walk has got to'}
                        >you are here</span>
                      )}
                      {box.id === tree.rootId && <span className={styles.rootChip}>start</span>}
                      {box.orphan && <span className={styles.repeatChip}>unreachable</span>}
                      {node.branches.length === 0 && !box.orphan && <span className={styles.repeatChip}>end</span>}
                    </span>
                  </button>
                  {/* Below and to the right of the box, on hover: where you
                      look for "and then what?", and clear of the arrow that
                      leaves from the bottom edge. Not gated on Edit, since
                      the toolbar's own "+ Add step" isn't either and the
                      dialog turns Edit on anyway. Counter-scaled, because a
                      handle that shrinks with the zoom is a handle nobody
                      can hit on a tree big enough to need zooming out.

                      Not on an end: nothing comes after one, so a + there
                      would offer something it then refuses. */}
                  {node.kind !== 'end' && (
                  <button
                    type="button"
                    className={addAfter?.fromId === box.id ? styles.addHandleOn : styles.addHandle}
                    style={{ transform: `translate(-30%, -30%) scale(${Math.min(3, 1 / zoom).toFixed(2)})` }}
                    aria-label={`Add the step after ${node.title || 'this step'}`}
                    title={`Add the step that comes after "${node.title || '(untitled step)'}"`}
                    onClick={(ev) => {
                      const wrap = canvasWrapRef.current;
                      if (wrap?.dataset.panned) { delete wrap.dataset.panned; ev.preventDefault(); return; }
                      openAddStep(box.id);
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
          {/* Which pathway this screen is walking. Only once there are two:
              with one picked it is the walk, and a switcher offering a
              choice of one is a control that does nothing. The tooltip reads
              the whole route out, because the button has room for where it
              ended and that is not always enough to tell two apart. */}
          {routeList.length > 1 && (
            <div className={styles.routeBar}>
              <span className={styles.fieldLabel}>Pathways</span>
              <div className={styles.modeSwitch}>
                {routeList.map((route, i) => {
                  const end = getNode(tree, route[route.length - 1]);
                  return (
                    <button
                      key={`route-${i}-${route.join('>')}`}
                      type="button"
                      className={i === activeIdx ? styles.modeBtnActive : styles.modeBtn}
                      onClick={() => setActiveRoute(i)}
                      title={route.map(id => getNode(tree, id)?.title || '(untitled step)').join(' → ')}
                    >{i + 1}. {end?.title || '(untitled step)'}</button>
                  );
                })}
              </div>
              <span className={styles.muted}>
                {routeList.length} pathways picked · {answerCount} answered across them
              </span>
            </div>
          )}
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
            {routes.length > 0 && (
              <button
                type="button"
                className={styles.smallBtn}
                onClick={startOver}
                title={routeList.length > 1
                  ? 'Clear every answer on every pathway and start again at the top'
                  : 'Clear every answer and start again at the top'}
              >Start over</button>
            )}
          </div>

          {current ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={kindUi(current.kind).badge}>
                  {kindUi(current.kind).label}
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
                <NodeEditor tree={tree} nodeId={current.id} catalog={catalog} onChange={applyTree} onAddStep={openAddStep} />
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
                        <span className={kindUi(node.kind).dot} />
                        {node.title || '(untitled step)'}
                        {node.id === tree.rootId && <span className={styles.rootChip}>start</span>}
                      </button>
                      {row.repeat && <span className={styles.repeatChip} title="Drawn in full higher up - the flow rejoins here">↩ rejoins above</span>}
                      {editing && !row.repeat && (
                        <span className={styles.rowActions}>
                          <button type="button" className={styles.iconBtn} title="Add the step that comes after this one"
                            onClick={() => openAddStep(node.id)}>+</button>
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
                                const opts = confirmDeleteStep(tree, node.id);
                                if (!opts) return;
                                applyTree(deleteNode(tree, node.id, opts));
                                if (selectedId === node.id) setSelectedId(null);
                                if (popupId === node.id) setPopupId(null);
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
                          onClick={() => openAddStep(row.parentId, row.branchId)}>+ step</button>
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
                        <span className={kindUi(node.kind).dot} />
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
                  <NodeEditor tree={tree} nodeId={selectedId} catalog={catalog} onChange={applyTree} onAddStep={openAddStep} />
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

      {addAfter && (
        <AddStepModal
          tree={tree}
          fromId={addAfter.fromId}
          lockedBranchId={addAfter.branchId}
          onCancel={() => setAddAfter(null)}
          onAdd={picked => addStepAfter(addAfter.fromId, picked)}
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
          onAddStep={openAddStep}
        />
      )}
      </>
      )}
    </div>
  );
}

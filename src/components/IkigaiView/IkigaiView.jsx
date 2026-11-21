import { useEffect, useMemo, useState } from 'react';
import {
  CIRCLES, OVERLAPS, RATING_LABELS, IKIGAI_SETTINGS_KEY, CIRCLE_DIRECTION,
  sanitizeAnswers, scoreIkigai, readStanding, markerOffset, parsePastedAnswers, ownerSeedUpdates,
} from '../../utils/ikigai';
import styles from './IkigaiView.module.css';

// Diagram geometry. Four circles of radius R whose centers sit SPREAD from
// the middle, so neighbours overlap in a lens and all four share the center.
const SIZE = 440;
const MID = SIZE / 2;
const SPREAD = 78;
const R = 118;
const center = (id) => ({
  x: MID + CIRCLE_DIRECTION[id][0] * SPREAD,
  y: MID + CIRCLE_DIRECTION[id][1] * SPREAD,
});
// Circle names sit in the part of each circle nothing else covers. The side
// circles' names are wider than they are tall, so they sit a little further in.
const nameAt = (id) => ({
  x: MID + CIRCLE_DIRECTION[id][0] * (SPREAD + 62),
  y: MID + CIRCLE_DIRECTION[id][1] * (SPREAD + 76),
});
// A pairing's label sits in the lens its two circles share.
const lensAt = (ids) => ({
  x: MID + (CIRCLE_DIRECTION[ids[0]][0] + CIRCLE_DIRECTION[ids[1]][0]) * 58,
  y: MID + (CIRCLE_DIRECTION[ids[0]][1] + CIRCLE_DIRECTION[ids[1]][1]) * 58,
});

const showScore = (s) => (s == null ? 'Not rated' : `${s}%`);

function Diagram({ scores }) {
  const marker = markerOffset(scores);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.diagram} role="img" aria-label="Ikigai diagram: four overlapping circles shaded by how strong each one is">
      <g className={styles.blend}>
        {CIRCLES.map(c => {
          const s = scores.circles[c.id].score;
          const { x, y } = center(c.id);
          return (
            <circle
              key={c.id}
              cx={x} cy={y} r={R}
              fill={c.color}
              // A stronger circle is a deeper fill; an unrated one is an outline.
              fillOpacity={s == null ? 0.05 : 0.12 + 0.4 * (s / 100)}
              stroke={c.color}
              strokeWidth={2}
              strokeDasharray={s == null ? '5 5' : undefined}
            >
              <title>{`${c.label}: ${showScore(s)}`}</title>
            </circle>
          );
        })}
      </g>
      {CIRCLES.map(c => {
        const { x, y } = nameAt(c.id);
        return (
          <text key={c.id} x={x} y={y} textAnchor="middle" className={styles.circleName}>
            <tspan x={x} dy="-0.2em">{c.short}</tspan>
            <tspan x={x} dy="1.25em" className={styles.circleScore}>{showScore(scores.circles[c.id].score)}</tspan>
          </text>
        );
      })}
      {OVERLAPS.map(o => {
        const { x, y } = lensAt(o.of);
        const s = scores.overlaps[o.id];
        return (
          <text key={o.id} x={x} y={y} textAnchor="middle" className={styles.lensName}>
            <tspan x={x} dy="-0.2em">{o.label}</tspan>
            {s != null && <tspan x={x} dy="1.25em" className={styles.lensScore}>{s}%</tspan>}
          </text>
        );
      })}
      {/* The label rides above the middle so a balanced marker, which lands
          dead center, sits under it instead of on it. */}
      <text x={MID} y={MID - 16} textAnchor="middle" className={styles.centerName}>
        Ikigai{scores.ikigai != null && <tspan className={styles.lensScore}>{` ${scores.ikigai}%`}</tspan>}
      </text>
      {marker && (
        <g transform={`translate(${MID + marker.x * SPREAD} ${MID + marker.y * SPREAD})`}>
          <title>You are here: pulled toward your strongest circles</title>
          <circle r={7} className={styles.marker} />
        </g>
      )}
    </svg>
  );
}

function Meter({ label, score, color, sub }) {
  return (
    <div className={styles.meterRow}>
      <span className={styles.meterLabel}>
        {color && <span className={styles.swatch} style={{ background: color }} />}
        {label}
        {sub && <span className={styles.meterSub}>{sub}</span>}
      </span>
      <span className={styles.meterTrack}>
        {score != null && <span className={styles.meterFill} style={{ width: `${score}%`, background: color || undefined }} />}
      </span>
      <span className={styles.meterValue}>{showScore(score)}</span>
    </div>
  );
}

function Question({ q, answer, onSave }) {
  // The box holds its own text while it is being typed in, and saves on blur.
  const [draft, setDraft] = useState(null);
  const text = draft ?? answer?.text ?? '';
  const rating = answer?.rating ?? null;
  return (
    <div className={styles.question}>
      <div className={styles.questionText}>{q.text}</div>
      <textarea
        className={styles.notes}
        rows={2}
        placeholder="Your answer / notes"
        value={text}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          if (draft != null && draft !== (answer?.text ?? '')) onSave({ text: draft, rating });
          setDraft(null);
        }}
      />
      <div className={styles.ratingRow}>
        <span className={styles.ratingPrompt}>In my work today:</span>
        <span className={styles.ratingBtns} role="radiogroup" aria-label="How much your work today delivers on this">
          {RATING_LABELS.map((label, i) => {
            const value = i + 1;
            const on = rating === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                title={on ? `${label} (click to clear)` : label}
                className={on ? styles.ratingBtnOn : styles.ratingBtn}
                // Clicking the chosen rating again clears it.
                onClick={() => onSave({ text, rating: on ? null : value })}
              >
                {value}
              </button>
            );
          })}
        </span>
        <span className={styles.ratingLabel}>{rating ? RATING_LABELS[rating - 1] : 'Not rated'}</span>
      </div>
    </div>
  );
}

export function IkigaiView({ settings, settingsLoaded = true, updateSettingsPath, isAdmin = false }) {
  const answers = useMemo(
    () => sanitizeAnswers(settings?.[IKIGAI_SETTINGS_KEY]?.answers),
    [settings],
  );
  // The owner's first answers go in once, the first time the page opens
  // with settings loaded. The flag it writes stops it running again, so
  // clearing one of those answers later stays cleared.
  const stored = settings?.[IKIGAI_SETTINGS_KEY];
  useEffect(() => {
    if (!isAdmin || !settingsLoaded) return;
    const updates = ownerSeedUpdates(stored);
    if (updates) updateSettingsPath?.(updates);
  }, [isAdmin, settingsLoaded, stored, updateSettingsPath]);

  const scores = useMemo(() => scoreIkigai(answers), [answers]);
  const standing = useMemo(() => readStanding(scores), [scores]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteNote, setPasteNote] = useState('');

  const path = (id) => `${IKIGAI_SETTINGS_KEY}.answers.${id}`;
  const save = (id, next) => {
    const empty = !next.text.trim() && !next.rating;
    updateSettingsPath?.({ [path(id)]: empty ? null : next });
  };

  function importPaste() {
    const found = parsePastedAnswers(pasteText);
    const ids = Object.keys(found);
    if (!ids.length) {
      setPasteNote('No answers found. Copy the rows from your sheet with the question and answer columns included.');
      return;
    }
    const updates = {};
    for (const id of ids) updates[path(id)] = { text: found[id], rating: answers[id]?.rating ?? null };
    updateSettingsPath?.(updates);
    setPasteText('');
    setPasteNote(`Imported ${ids.length} answer${ids.length === 1 ? '' : 's'}. Rate each one to score it.`);
  }

  const focusCircle = CIRCLES.find(c => c.id === standing.focus);
  const totalRated = CIRCLES.reduce((n, c) => n + scores.circles[c.id].rated, 0);
  const totalQuestions = CIRCLES.reduce((n, c) => n + c.questions.length, 0);

  if (!settingsLoaded) return <div className={styles.wrapper}><div className={styles.loading}>Loading...</div></div>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ikigai</h1>
          <div className={styles.subtitle}>
            Answer each question, then rate how much your work today delivers on it. The diagram updates as you go.
          </div>
        </div>
        <button type="button" className={styles.pasteBtn} onClick={() => { setPasteOpen(v => !v); setPasteNote(''); }}>
          {pasteOpen ? 'Close paste' : 'Paste from spreadsheet'}
        </button>
      </div>

      {pasteOpen && (
        <div className={styles.pastePanel}>
          <div className={styles.pasteHelp}>
            Copy rows from your Ikigai sheet (the question column and the answer column) and paste them here. Answers are matched to their questions and replace what is in the box for those questions.
          </div>
          <textarea
            className={styles.pasteBox}
            rows={5}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste rows here"
          />
          <div className={styles.pasteActions}>
            <button type="button" className={styles.primaryBtn} onClick={importPaste} disabled={!pasteText.trim()}>Import answers</button>
            {pasteNote && <span className={styles.pasteNote}>{pasteNote}</span>}
          </div>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.visuals}>
          <div className={styles.card}>
            <Diagram scores={scores} />
            <div className={styles.legend}>
              <span className={styles.legendItem}><span className={styles.legendRing} /> You are here</span>
              <span className={styles.legendItem}>Deeper color = stronger circle</span>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>Where you stand</div>
            <div className={styles.standingHeadline}>{standing.headline}</div>
            <div className={styles.standingDetail}>{standing.detail}</div>
            {focusCircle && (
              <div className={styles.focus}>
                <span className={styles.swatch} style={{ background: focusCircle.color }} />
                <span><strong>Work on next:</strong> {focusCircle.label}</span>
              </div>
            )}
            <div className={styles.progress}>{totalRated} of {totalQuestions} questions rated</div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardLabel}>The four circles</div>
            {CIRCLES.map(c => (
              <Meter
                key={c.id}
                label={c.label}
                color={c.color}
                score={scores.circles[c.id].score}
                sub={`${scores.circles[c.id].rated}/${scores.circles[c.id].total} rated`}
              />
            ))}
            <div className={styles.cardLabelGap}>Where they overlap</div>
            {OVERLAPS.map(o => (
              <Meter
                key={o.id}
                label={o.label}
                score={scores.overlaps[o.id]}
                sub={o.of.map(id => CIRCLES.find(c => c.id === id).short).join(' + ')}
              />
            ))}
            <Meter label="Ikigai" score={scores.ikigai} sub="all four" />
            <div className={styles.footnote}>
              An overlap is only as strong as its weaker circle, and Ikigai is only as strong as the weakest of the four.
            </div>
          </div>
        </div>

        <div className={styles.questions}>
          {CIRCLES.map((c, i) => (
            <section key={c.id} className={styles.circleCard} style={{ borderTopColor: c.color }}>
              <div className={styles.circleHead}>
                <h2 className={styles.circleTitle}>
                  <span className={styles.swatch} style={{ background: c.color }} />
                  {i + 1}. {c.label}
                </h2>
                <span className={styles.circleHeadScore}>{showScore(scores.circles[c.id].score)}</span>
              </div>
              {c.questions.map(q => (
                <Question key={q.id} q={q} answer={answers[q.id]} onSave={(next) => save(q.id, next)} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

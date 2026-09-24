import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import styles from './SitePricingPanel.module.css';
import { NYMEX_UNIT } from '../../data/nymexHistory.js';
import {
  SITE_PRICING_KEY, getSitePricing, normalizeSitePricing, parseSitePricing, priceSitePricing,
  buildSite, addSite, renameSite, removeSite,
} from '../../utils/sitePricing.js';

// The Site pricing subtab under Sourcing: the renewal comparison pasted in
// from Excel, a row per site, the deal it was on and the deal it moved to.
//
// It shares SavingsPanel's settle table and forward curve - they sit above
// this on the same subtab, and the props carry them in - so a month costs
// the same here as it does on Contract savings.
//
// The sheet arrives with its NYMEX and Total columns empty, because working
// those out is the tedious part and nobody had done it. That is exactly what
// this page already holds the tables for, so it fills them in: every term is
// averaged across the settles and the forward curve, and the totals fall out
// of that plus the $/Dth in the sheet.
//
// The number it adds that the sheet cannot produce is the SPLIT. A renewal
// priced better than the deal before it for two quite different reasons -
// gas got cheaper, and somebody negotiated - and only one of those is
// anybody's doing. Showing the net alone lets a good market look like good
// work, and a bad market bury good work. So every row carries both, and they
// add back up to the net.

const MARKET_COLOR = '#C2410C';   // the index moved
const DEAL_COLOR = '#0369A1';     // the contract moved
const SAVED_COLOR = '#0D9488';
const COST_COLOR = '#B91C1C';
const GRID = '#E2E8F0';
const AXIS_TEXT = '#64748B';
const SAVE_DELAY_MS = 800;

const BLANK_SITE = {
  name: '',
  previous: { start: '', end: '', adder: '' },
  updated: { start: '', end: '', adder: '' },
  volume: '',
};

const price = (n, dp = 3) => (n == null || !Number.isFinite(n) ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(dp)}`);
const signed = (n, dp = 3) => (n == null || !Number.isFinite(n) ? '-' : `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toFixed(dp)}`);
const usd = (n) => (n == null || !Number.isFinite(n) ? '-' : `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`);
const vol = (n) => (n == null || !Number.isFinite(n) ? '-' : Math.round(n).toLocaleString('en-US'));

// A term is worth flagging when enough of it is the flat assumption to move
// the answer. One assumed month in sixty is not that, and colouring it like
// it is spends the reader's attention on nothing and leaves nothing left for
// the term that really is mostly guesswork.
const FLAT_SHARE_WORTH_FLAGGING = 0.2;

/** How a term's months were priced, short enough to sit in a cell. */
function SourceMix({ counts, months, forwardAsOf }) {
  if (!counts) return null;
  const parts = [];
  if (counts.settled) parts.push(`${counts.settled} settled`);
  if (counts.forward) parts.push(`${counts.forward} curve`);
  if (counts.assumed) parts.push(`${counts.assumed} flat`);
  const flagged = months > 0 && counts.assumed / months >= FLAT_SHARE_WORTH_FLAGGING;
  return (
    <span
      className={flagged ? styles.mixWarn : styles.mix}
      title={`Where this term's months were priced from${counts.forward ? `. The curve was ${forwardAsOf}` : ''}${counts.assumed ? '. The flat months sit past both tables and are the weakest of the three' : ''}.`}
    >{parts.join(' · ')}</span>
  );
}

function Tile({ label, value, sub, tone = 'plain', title }) {
  return (
    <div className={styles.tile} title={title}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={
        tone === 'good' ? styles.tileValueGood
          : tone === 'bad' ? styles.tileValueBad
            : tone === 'market' ? styles.tileValueMarket
              : tone === 'deal' ? styles.tileValueDeal
                : styles.tileValue
      }>{value}</div>
      {sub && <div className={styles.tileSub}>{sub}</div>}
    </div>
  );
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className={styles.tip}>
      <div className={styles.tipHead}>{row?.name}</div>
      {payload.map(p => (
        <div key={p.dataKey} className={styles.tipRow}>
          <span className={styles.tipSwatch} style={{ background: p.color }} aria-hidden="true" />
          <span className={styles.tipName}>{p.name}</span>
          <span className={styles.tipValue}>{signed(p.value)}</span>
        </div>
      ))}
      <div className={styles.tipTotal}>
        <span className={styles.tipName}>Net per Dth</span>
        <span className={styles.tipValue}>{signed(row?.net)}</span>
      </div>
      {row?.annualSaving != null && (
        <div className={styles.tipNote}>{usd(row.annualSaving)} a year on {vol(row.volume)} Dth</div>
      )}
    </div>
  );
}

export function SitePricingPanel({
  settings = {}, settingsLoaded = false, updateSettings,
  series, forward, flatPrice, forwardAsOf,
}) {
  const [table, setTable] = useState(() => getSitePricing(settings));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [status, setStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [siteForm, setSiteForm] = useState(BLANK_SITE);
  const [addError, setAddError] = useState('');
  // The row whose name is being typed over, by index, and the draft.
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Set by Escape so a blur the browser fires as the input goes away
  // doesn't commit the draft that was just thrown out.
  const cancelRenameRef = useRef(false);

  const pendingRef = useRef(false);
  const timerRef = useRef(null);

  const save = useCallback((next) => {
    if (!updateSettings) return;
    pendingRef.current = true;
    setStatus('Saving…');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Promise.resolve(updateSettings({ [SITE_PRICING_KEY]: next }))
        .then(() => setStatus('Saved'))
        .catch(() => setStatus('Save failed'))
        .finally(() => { pendingRef.current = false; });
    }, SAVE_DELAY_MS);
  }, [updateSettings]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const savedRaw = settings?.[SITE_PRICING_KEY];
  const storedJson = useMemo(() => JSON.stringify(normalizeSitePricing(savedRaw)), [savedRaw]);

  // Adopt a table saved elsewhere: another device, another tab, or the
  // settings document arriving after this panel rendered.
  //
  // `table` is a dependency here, which SavingsPanel cannot afford but
  // this one can: the only things that change it are the paste and the
  // clear, and both mark a save owed in the same tick, so the guard is
  // already up before this could run against a snapshot that has not caught
  // up. Depending on it is what keeps the comparison out of a ref.
  useEffect(() => {
    if (!settingsLoaded || pendingRef.current) return;
    if (storedJson === JSON.stringify(table)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTable(JSON.parse(storedJson));
  }, [storedJson, settingsLoaded, table]);

  const priced = useMemo(
    () => (table ? priceSitePricing(table, series, forward, flatPrice) : null),
    [table, series, forward, flatPrice],
  );

  function loadPaste() {
    const parsed = parseSitePricing(pasteText);
    if (parsed.error === 'no-header') {
      setPasteError('No header row found. One row needs to carry "Start Date" for each block of columns, the way it comes off the sheet.');
      return;
    }
    if (!parsed.sites.length) {
      setPasteError('The header read, but no row under it carried a name and a term.');
      return;
    }
    const next = normalizeSitePricing({ ...parsed, loadedAt: new Date().toISOString().slice(0, 10) });
    setTable(next);
    save(next);
    setPasteOpen(false);
    setPasteText('');
    setPasteError('');
    setStatus(`Read ${parsed.sites.length} site${parsed.sites.length === 1 ? '' : 's'} across ${parsed.blocks} block${parsed.blocks === 1 ? '' : 's'}${parsed.skipped.length ? `, skipping ${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'}` : ''}.`);
  }

  function commit(next, message) {
    setTable(next);
    save(next);
    if (message) setStatus(message);
  }

  function setTermField(term, field, value) {
    setSiteForm(f => ({ ...f, [term]: { ...f[term], [field]: value } }));
    setAddError('');
  }

  function addTypedSite() {
    const { site, error } = buildSite(siteForm);
    if (error) { setAddError(error); return; }
    commit(addSite(table, site), `Added ${site.name}.`);
    setSiteForm(BLANK_SITE);
    setAddError('');
    setAddOpen(false);
  }

  function startRename(index, name) {
    cancelRenameRef.current = false;
    setRenaming(index);
    setRenameDraft(name);
  }

  function finishRename() {
    if (renaming == null || cancelRenameRef.current) return;
    const next = renameSite(table, renaming, renameDraft);
    if (next !== table) commit(next);
    setRenaming(null);
  }

  function deleteSite(index, name) {
    if (!window.confirm(`Remove ${name} from the comparison?`)) return;
    setRenaming(null);
    commit(removeSite(table, index), `Removed ${name}.`);
  }

  function clearTable() {
    if (!window.confirm('Clear the pasted comparison? The settles, curve and contract on this page are kept.')) return;
    setTable(null);
    save(null);
    setStatus('Cleared.');
  }

  async function copyTable() {
    if (!priced) return;
    const header = ['Site', 'Previous term', 'Previous NYMEX', 'Previous $/Dth', 'Previous all-in',
      'Updated term', 'Updated NYMEX', 'Updated $/Dth', 'Updated all-in',
      'Change per Dth', 'Market', 'Deal'];
    const lines = [header.join('\t')];
    for (const row of priced.rows) {
      lines.push([
        row.name,
        row.previous ? `${row.previous.startLabel} to ${row.previous.endLabel}` : '',
        row.previous ? row.previous.nymex.toFixed(3) : '',
        row.previous ? row.previous.adder.toFixed(3) : '',
        row.previous ? row.previous.total.toFixed(3) : '',
        row.updated ? `${row.updated.startLabel} to ${row.updated.endLabel}` : '',
        row.updated ? row.updated.nymex.toFixed(3) : '',
        row.updated ? row.updated.adder.toFixed(3) : '',
        row.updated ? row.updated.total.toFixed(3) : '',
        row.savingPerDth != null ? row.savingPerDth.toFixed(3) : '',
        row.nymexChange != null ? (-row.nymexChange).toFixed(3) : '',
        row.adderChange != null ? (-row.adderChange).toFixed(3) : '',
      ].join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setStatus('Copied, ready to paste back into the sheet.');
    } catch {
      setStatus('Clipboard blocked. Select the table and copy it instead.');
    }
  }

  // Market and deal as their own bars rather than one stacked net: the two
  // regularly pull in opposite directions, and a stack would draw them as if
  // they reinforced each other.
  const chartData = (priced?.rows || [])
    .filter(r => r.savingPerDth != null)
    .map(r => ({
      name: r.name,
      market: -r.nymexChange,
      deal: -r.adderChange,
      net: r.savingPerDth,
      annualSaving: r.annualSaving,
      volume: r.volume,
    }));

  const totals = priced?.totals;

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Site pricing</div>
          <div className={styles.note}>
            Paste the renewal comparison straight out of Excel. The NYMEX and Total columns can stay
            empty: every term is averaged across the settles and the curve above, and the $/Dth in
            the sheet is applied to it. A figure already filled in is used as written rather than
            overruled.
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.smallBtn} onClick={() => { setAddOpen(v => !v); setPasteOpen(false); setAddError(''); }}>
            {addOpen ? 'Close' : 'Add a site'}
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => { setPasteOpen(v => !v); setAddOpen(false); setPasteError(''); }}>
            {pasteOpen ? 'Close' : table ? 'Paste another' : 'Paste a comparison'}
          </button>
          {table && <button type="button" className={styles.smallBtn} onClick={copyTable}>Copy the table</button>}
          {table && <button type="button" className={styles.smallBtn} onClick={clearTable}>Clear</button>}
          {status && <span className={styles.muted}>{status}</span>}
        </div>
      </div>

      {pasteOpen && (
        <div className={styles.pastePanel}>
          <div className={styles.fieldLabel}>
            Paste the block, header rows and all
            <span className={styles.fieldHint}>
              One row per site: the name, then a Start Date and End Date for each deal, with the
              $/Dth beside them. Values in parentheses are read as negative, so a discount stays a
              discount. Blank cells stay blank. A banner row above the headers and any subtotal
              lines below are skipped and reported rather than read as sites. Add a Volume column
              and the change comes back in dollars as well as per Dth.
            </span>
          </div>
          <textarea
            className={styles.textarea}
            rows={7}
            value={pasteText}
            placeholder={'\tPrevious Pricing\t\t\t\t\tUpdated Pricing\n\tStart Date\tEnd Date\tNYMEX Price\t$/Dth\tTotal Price\tStart Date\tEnd Date\tNYMEX Price\t$/Dth\tTotal Price\nSyracuse Main (SYR)\tDec-25\tNov-26\t\t($0.276)\t\tDec-26\tNov-28\t\t($0.092)'}
            onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
          />
          {pasteError && <div className={styles.warn}>{pasteError}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={loadPaste} disabled={!pasteText.trim()}>Read it</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setPasteOpen(false); setPasteError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {addOpen && (
        <div className={styles.pastePanel}>
          <div className={styles.fieldLabel}>
            Add a site by hand
            <span className={styles.fieldHint}>
              The site name, then the deal it was on and the deal it moved to. Leave NYMEX to the
              page: each term is averaged across the settles and the curve above. A $/Dth in
              parentheses is a discount. Fill in one term alone and the site is listed with nothing
              to compare it to yet.
            </span>
          </div>
          <div className={styles.addGrid}>
            <label className={styles.addField} style={{ gridColumn: '1 / -1' }}>
              <span>Site name</span>
              <input
                className={styles.input}
                value={siteForm.name}
                placeholder="Syracuse Main (SYR)"
                autoFocus
                onChange={e => { setSiteForm(f => ({ ...f, name: e.target.value })); setAddError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') addTypedSite(); }}
              />
            </label>
            {[['previous', 'Previous'], ['updated', 'Updated']].map(([term, label]) => (
              <Fragment key={term}>
                <div className={styles.addTermLabel}>{label}</div>
                <label className={styles.addField}>
                  <span>Start</span>
                  <input type="month" className={styles.input} value={siteForm[term].start}
                    onChange={e => setTermField(term, 'start', e.target.value)} />
                </label>
                <label className={styles.addField}>
                  <span>End</span>
                  <input type="month" className={styles.input} value={siteForm[term].end}
                    onChange={e => setTermField(term, 'end', e.target.value)} />
                </label>
                <label className={styles.addField}>
                  <span>$/Dth</span>
                  <input className={styles.input} value={siteForm[term].adder} placeholder="(0.276)"
                    onChange={e => setTermField(term, 'adder', e.target.value)} />
                </label>
              </Fragment>
            ))}
            <label className={styles.addField} style={{ gridColumn: '2 / 3' }}>
              <span>Volume, Dth/yr (optional)</span>
              <input className={styles.input} value={siteForm.volume} placeholder="12,000"
                onChange={e => { setSiteForm(f => ({ ...f, volume: e.target.value })); setAddError(''); }} />
            </label>
          </div>
          {addError && <div className={styles.warn}>{addError}</div>}
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={addTypedSite} disabled={!siteForm.name.trim()}>Add site</button>
            <button type="button" className={styles.smallBtn} onClick={() => { setAddOpen(false); setAddError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {!table && !pasteOpen && !addOpen && (
        <div className={styles.empty}>
          Nothing here yet. Add a site by name, or paste the comparison. Contract savings prices one term in detail; this prices a whole list
          of sites at once, off the same tables, and says for each how much of the change was the
          market and how much was the deal.
        </div>
      )}

      {table && priced && (
        <>
          <div className={styles.tiles}>
            <Tile
              label="Sites"
              value={totals.sites}
              sub={totals.comparable === totals.sites
                ? 'all with two terms to compare'
                : `${totals.comparable} with two terms to compare`}
            />
            <Tile
              label="Renewed better"
              value={`${totals.better} of ${totals.comparable}`}
              sub={totals.worse ? `${totals.worse} came out worse` : 'none came out worse'}
              tone={totals.worse ? 'plain' : 'good'}
            />
            <Tile
              label="Average change"
              value={signed(totals.avgSavingPerDth)}
              sub={`a Dth, across the ${totals.comparable} compared`}
              tone={totals.avgSavingPerDth > 0 ? 'good' : totals.avgSavingPerDth < 0 ? 'bad' : 'plain'}
              title="Down is a saving: the renewal costs less per Dth than the deal it replaced. An unweighted average across sites, since the sheet carries no volumes to weight by."
            />
            <Tile
              label="Of which the market"
              value={signed(totals.avgNymexChange == null ? null : -totals.avgNymexChange)}
              sub="the index moved on its own"
              tone="market"
              title="How much of the average change came from NYMEX moving between the two terms. Nobody negotiated this."
            />
            <Tile
              label="Of which the deal"
              value={signed(totals.avgAdderChange == null ? null : -totals.avgAdderChange)}
              sub="the $/Dth that was negotiated"
              tone="deal"
              title="How much of the average change came from the $/Dth itself. This is the part that was won or lost at the table."
            />
            {totals.annualSaving != null && (
              <Tile
                label="Annual saving"
                value={usd(totals.annualSaving)}
                sub={`across ${totals.volumeSites} site${totals.volumeSites === 1 ? '' : 's'} with a volume`}
                tone={totals.annualSaving >= 0 ? 'good' : 'bad'}
              />
            )}
          </div>

          {chartData.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>What moved the price, site by site</div>
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ background: MARKET_COLOR }} aria-hidden="true" />
                    The market
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendSwatch} style={{ background: DEAL_COLOR }} aria-hidden="true" />
                    The deal
                  </span>
                </div>
              </div>
              <div className={styles.cardNote}>
                Bars to the right are a saving. The two add up to the net change, and they often
                pull against each other: a renewal can price better purely because gas got cheaper.
              </div>
              <div className={styles.chartBox}>
                <ResponsiveContainer width="100%" height={Math.max(150, chartData.length * 54 + 50)}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 28, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: AXIS_TEXT }}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                      tickFormatter={v => signed(v, 2)}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: AXIS_TEXT }}
                      tickLine={false}
                      axisLine={false}
                      width={150}
                    />
                    <ReferenceLine x={0} stroke={AXIS_TEXT} strokeWidth={1} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }} />
                    <Legend wrapperStyle={{ display: 'none' }} />
                    <Bar dataKey="market" name="The market" fill={MARKET_COLOR} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                    <Bar dataKey="deal" name="The deal" fill={DEAL_COLOR} radius={[0, 3, 3, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th rowSpan={2} className={styles.thSite}>Site</th>
                  <th colSpan={4} className={styles.thGroup}>Previous</th>
                  <th colSpan={4} className={styles.thGroupAlt}>Updated</th>
                  <th colSpan={3} className={styles.thGroupNet}>Change per Dth</th>
                </tr>
                <tr>
                  <th>Term</th>
                  <th className={styles.thNum}>NYMEX</th>
                  <th className={styles.thNum}>$/Dth</th>
                  <th className={styles.thNum}>All-in</th>
                  <th>Term</th>
                  <th className={styles.thNum}>NYMEX</th>
                  <th className={styles.thNum}>$/Dth</th>
                  <th className={styles.thNum}>All-in</th>
                  <th className={styles.thNum}>Net</th>
                  <th className={styles.thNum}>Market</th>
                  <th className={styles.thNum}>Deal</th>
                </tr>
              </thead>
              <tbody>
                {priced.rows.map((row, index) => (
                  <tr key={row.id}>
                    <th scope="row" className={styles.thSite}>
                      {renaming === index ? (
                        <input
                          className={styles.input}
                          value={renameDraft}
                          autoFocus
                          aria-label="Site name"
                          onChange={e => setRenameDraft(e.target.value)}
                          onBlur={finishRename}
                          onKeyDown={e => {
                            if (e.key === 'Enter') finishRename();
                            if (e.key === 'Escape') { cancelRenameRef.current = true; setRenaming(null); }
                          }}
                        />
                      ) : (
                        <span className={styles.siteNameRow}>
                          <button type="button" className={styles.siteName} title="Rename this site" onClick={() => startRename(index, row.name)}>
                            {row.name}
                          </button>
                          <button type="button" className={styles.removeBtn} title={`Remove ${row.name}`} aria-label={`Remove ${row.name}`} onClick={() => deleteSite(index, row.name)}>×</button>
                        </span>
                      )}
                      {row.volume != null && <span className={styles.volNote}>{vol(row.volume)} Dth/yr</span>}
                    </th>
                    {[row.previous, row.updated].map((term, i) => (
                      term ? (
                        <Fragment key={i}>
                          <td className={styles.tdTerm}>
                            <span>{term.startLabel} to {term.endLabel}</span>
                            <span className={styles.termMonths}>{term.months} mo</span>
                            <SourceMix counts={term.counts} months={term.months} forwardAsOf={forwardAsOf} />
                          </td>
                          <td className={term.nymexGiven ? styles.tdGiven : styles.tdNum}
                            title={term.nymexGiven
                              ? `From the sheet. This page would have said ${price(term.computedNymex)} over that term.`
                              : 'Averaged across the settles and the curve above.'}>
                            {price(term.nymex)}
                          </td>
                          <td className={styles.tdNum}>{term.hasAdder ? price(term.adder) : '-'}</td>
                          <td className={term.totalGiven ? styles.tdGiven : styles.tdNum}
                            title={term.totalGiven ? 'From the sheet, used as written.' : 'NYMEX with the $/Dth applied.'}>
                            {price(term.total)}
                          </td>
                        </Fragment>
                      ) : (
                        <td key={i} colSpan={4} className={styles.tdNone}>no term</td>
                      )
                    ))}
                    <td className={row.savingPerDth == null ? styles.tdNum : row.savingPerDth >= 0 ? styles.tdGood : styles.tdBad}>
                      {signed(row.savingPerDth)}
                    </td>
                    <td className={styles.tdMarket}>{signed(row.nymexChange == null ? null : -row.nymexChange)}</td>
                    <td className={styles.tdDeal}>{signed(row.adderChange == null ? null : -row.adderChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.footNote}>
            Down is a saving: a positive change means the renewal costs less per Dth than the deal it
            replaced. The all-in price is the NYMEX for the term with the $/Dth applied, so a value in
            parentheses on the sheet is a discount off the index. Terms run through their end month, so
            Dec-25 to Nov-26 is twelve months. Where a term reaches past the settles and the curve, those
            months price at the flat assumption and the term says so.
            {priced.counts.assumed > 0 && ` ${priced.counts.assumed} month${priced.counts.assumed === 1 ? '' : 's'} across this table sit past both tables.`}
          </div>
        </>
      )}
    </div>
  );
}

export default SitePricingPanel;

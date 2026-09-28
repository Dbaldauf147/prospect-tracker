import { useMemo, useState } from 'react';
import styles from './ServicesTab.module.css';
import { SERVICE_STATUS } from '../../utils/pricingServices';

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '');

const STATUS_CLASS = {
  [SERVICE_STATUS.ACTIVE]: 'statusActive',
  [SERVICE_STATUS.RETIRED]: 'statusRetired',
  [SERVICE_STATUS.HIDDEN]: 'statusHidden',
  [SERVICE_STATUS.OFF_LIST]: 'statusOffList',
};

// Services subtab: the Dropdowns tab's service catalog, each service's
// status carried over, with the ones the loaded SIA covers pinned to the
// top. Picking a service shows the cost lines mapped to it (Linked To ›
// Line Item → Services) and the fee rows those costs price, as the
// Alternative Fee schedule has them or would build them.
//
//   services   buildPricingServiceList rows
//   detailFor  (serviceName) => { items, fees } for the active option
export function ServicesTab({
  workbook, activeOption, setActiveOption, services = [], detailFor, numYears = 1, onOpenLinkedTo,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [showInactive, setShowInactive] = useState(true);

  const opt = workbook?.options?.find(o => o.optionNumber === activeOption) || workbook?.options?.[0] || null;
  const scopeCount = services.filter(s => s.inScope).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter(s => {
      if (!showInactive && !s.inScope && (s.status === SERVICE_STATUS.RETIRED || s.status === SERVICE_STATUS.HIDDEN)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || String(s.bucket || '').toLowerCase().includes(q);
    });
  }, [services, query, showInactive]);

  const current = services.find(s => s.name === selected) || null;
  const detail = current && detailFor ? detailFor(current.name) : null;

  return (
    <div className={styles.wrapper}>
      <p className={styles.intro}>
        Every service on the Dropdowns tab, with its status there. Services tied to a cost line on the
        attached SIA are tagged <span className={styles.scopeTag}>In SIA scope</span> and listed first.
        A cost line is tied to a service on the <strong>Linked To</strong> subtab (Line Item → Services).
      </p>

      {workbook && workbook.options.length > 1 && (
        <div className={styles.optionStrip}>
          {workbook.options.map(o => (
            <button
              key={o.sheetName}
              type="button"
              className={o.optionNumber === opt?.optionNumber ? styles.optionActive : styles.option}
              onClick={() => setActiveOption(o.optionNumber)}
            >
              {o.sheetName}
            </button>
          ))}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.listPane}>
          <div className={styles.listTools}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className={styles.toggle}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show retired / hidden
            </label>
          </div>
          <div className={styles.listSummary}>
            {workbook
              ? `${scopeCount} of ${services.length} service${services.length === 1 ? '' : 's'} in SIA scope${opt ? ` (${opt.sheetName})` : ''}`
              : `${services.length} service${services.length === 1 ? '' : 's'}. Upload an SIA on the Pricing subtab to see which are in scope.`}
          </div>
          <ul className={styles.list}>
            {visible.map((s, i) => {
              const prev = visible[i - 1];
              const divider = i > 0 && prev.inScope && !s.inScope;
              return (
                <li key={s.name} className={divider ? styles.dividerItem : undefined}>
                  <button
                    type="button"
                    className={`${styles.serviceBtn} ${s.name === selected ? styles.serviceBtnActive : ''} ${s.status === SERVICE_STATUS.RETIRED || s.status === SERVICE_STATUS.HIDDEN ? styles.serviceMuted : ''}`}
                    onClick={() => setSelected(s.name === selected ? null : s.name)}
                  >
                    <span className={styles.serviceName}>{s.name}</span>
                    <span className={styles.serviceTags}>
                      {s.inScope && <span className={styles.scopeTag}>In SIA scope</span>}
                      <span className={styles[STATUS_CLASS[s.status]]}>{s.status}</span>
                    </span>
                    {s.bucket && <span className={styles.bucket}>{s.bucket}</span>}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && <li className={styles.empty}>No services match.</li>}
          </ul>
        </div>

        <div className={styles.detailPane}>
          {!current ? (
            <div className={styles.placeholder}>Pick a service to see its cost line items and fee structure.</div>
          ) : (
            <ServiceDetail
              service={current}
              detail={detail}
              hasWorkbook={!!workbook}
              optionName={opt?.sheetName}
              numYears={numYears}
              onOpenLinkedTo={onOpenLinkedTo}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ServiceDetail({ service, detail, hasWorkbook, optionName, numYears, onOpenLinkedTo }) {
  const items = detail?.items || [];
  const fees = detail?.fees || [];
  const costTotal = items.reduce((s, it) => s + (typeof it.cts === 'number' ? it.cts : 0), 0);
  const meta = service.meta || {};
  const facts = [
    service.bucket && ['Group', service.bucket],
    meta.productLine && ['Product line', meta.productLine],
    meta.serviceType && ['Service type', meta.serviceType],
    meta.years && ['Contract years', meta.years],
  ].filter(Boolean);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{service.name}</h3>
        {service.inScope && <span className={styles.scopeTag}>In SIA scope</span>}
        <span className={styles[STATUS_CLASS[service.status]]}>{service.status}</span>
      </div>
      {facts.length > 0 && (
        <div className={styles.facts}>
          {facts.map(([k, v]) => <span key={k}><span className={styles.factKey}>{k}:</span> {String(v)}</span>)}
        </div>
      )}

      {!hasWorkbook ? (
        <div className={styles.placeholder}>Upload an SIA on the Pricing subtab to see the cost lines and fees behind this service.</div>
      ) : (
        <>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>
              Cost line items{optionName ? ` on ${optionName}` : ''} ({items.length})
            </h4>
            {items.length === 0 ? (
              <div className={styles.note}>
                No cost line on this option is tied to this service.
                {onOpenLinkedTo && (
                  <> Tie one on the <button type="button" className={styles.linkBtn} onClick={onOpenLinkedTo}>Linked To</button> subtab.</>
                )}
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Line Item</th>
                    <th>Type</th>
                    <th className={styles.num}>CTS</th>
                    <th className={styles.num}>Start Month</th>
                    <th>Fee Name</th>
                    <th>Unit</th>
                    <th>Pass-through</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.id}>
                      <td>
                        {it.description}
                        {it.otherServices.length > 0 && (
                          <div className={styles.subNote}>Also covers {it.otherServices.join(', ')}</div>
                        )}
                      </td>
                      <td>{it.type}</td>
                      <td className={styles.num}>{fmtMoney(it.cts)}</td>
                      <td className={styles.num}>{it.startMonth || ''}</td>
                      <td>
                        {it.feeName || <span className={styles.muted}>none</span>}
                        {it.automatedName && it.automatedName.toLowerCase() !== it.feeName.toLowerCase() && (
                          <div className={styles.subNote}>Automated Fee Name: {it.automatedName}</div>
                        )}
                      </td>
                      <td>{it.unit}</td>
                      <td>{it.passThrough ? 'Yes' : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total CTS</td>
                    <td className={styles.num}>{fmtMoney(costTotal)}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            )}
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Fee structure ({fees.filter(f => !f.missing).length})</h4>
            <p className={styles.note}>
              Fees come from the fee names on the cost lines above. A fee already on the
              Alternative Fee schedule shows as it is there; one that isn't yet shows what
              Build from Automated Fee Names would add.
            </p>
            {fees.length === 0 ? (
              <div className={styles.note}>No fee name on these cost lines, so no fee is set up for this service.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fee</th>
                    <th>Source</th>
                    <th>Type</th>
                    <th className={styles.num}>Fee / Unit</th>
                    <th>Unit</th>
                    <th className={styles.num}>Unit Count</th>
                    <th className={styles.num}>Start Month</th>
                    {Array.from({ length: numYears }, (_, i) => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>)}
                    <th className={styles.num}>Fee GM%</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((f, i) => f.missing ? (
                    <tr key={`m-${i}`}>
                      <td>{f.name}</td>
                      <td colSpan={6 + numYears + 1} className={styles.muted}>
                        No cost behind this name yet, so there is no fee to derive.
                      </td>
                    </tr>
                  ) : (
                    <tr key={`${f.name}-${f.type}-${i}`}>
                      <td>
                        {f.name}
                        {f.sharedWith.length > 0 && (
                          <div className={styles.subNote}>Shared with {f.sharedWith.join(', ')}</div>
                        )}
                      </td>
                      <td>
                        <span className={f.onSchedule ? styles.srcSchedule : styles.srcAuto}>
                          {f.onSchedule ? 'On schedule' : 'Would be built'}
                        </span>
                      </td>
                      <td>{f.type}</td>
                      <td className={styles.num}>
                        {fmtMoney(f.feePerUnit)}
                        {f.feePerUnit != null && <div className={styles.subNote}>{f.feeIsManual ? 'typed' : 'auto'}</div>}
                      </td>
                      <td>{f.unit}</td>
                      <td className={styles.num}>{f.unitCount}</td>
                      <td className={styles.num}>{f.startMonth || ''}</td>
                      {Array.from({ length: numYears }, (_, yi) => (
                        <td key={yi} className={styles.num}>{f.years[yi] > 0 ? fmtMoney(f.years[yi]) : ''}</td>
                      ))}
                      <td className={styles.num}>{f.passThrough ? 'pass' : fmtPct(f.gmPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

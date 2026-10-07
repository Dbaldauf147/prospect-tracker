// The Prospecting page's bulk Service Status: one status set on the listed
// service (the row's Biggest Deal Service) across every row picked.
//
// The write is the same one the row's own Service Status dropdown makes and
// the same one Deal Sizing's bulk bar makes: the company card's Services
// Explored map, through withServiceStatus. planBulkStatus decides who it
// actually changes, so the count the button offers is the count it writes,
// and a company already carrying that status is left alone.
//
// Each row names its own service, so one bulk set can touch a different
// service on every company: Bill Pay here, GRESB there. That is what "the
// listed services" means on this page. A company listed twice (it can't be
// today, but a PC row and a prospect row share a record) is written once,
// with every service its rows name.
import { planBulkStatus } from './clientDealSizing.js';

/**
 * rows: the picked table rows, each { prospect, deal }.
 * Returns planBulkStatus's { change, same, skipped } over the companies
 * behind them, plus `services`: the distinct services the write names.
 */
export function planProspectingBulkStatus(rows, status) {
  const byId = new Map();
  for (const r of rows || []) {
    const p = r?.prospect;
    const name = String(r?.deal?.name || '').trim();
    if (!p?.id || !name) continue;
    const entry = byId.get(p.id) || { prospect: p, names: new Set() };
    entry.names.add(name);
    byId.set(p.id, entry);
  }
  const entries = [...byId.values()];
  const namesFor = new Map(entries.map(e => [e.prospect, [...e.names]]));
  const plan = status
    ? planBulkStatus({ clients: entries.map(e => e.prospect), status, servicesOf: c => namesFor.get(c) || [] })
    : { change: [], same: [], skipped: [] };
  const services = [...new Set(entries.flatMap(e => [...e.names]))].sort((a, b) => a.localeCompare(b));
  return { ...plan, companies: entries.length, services };
}

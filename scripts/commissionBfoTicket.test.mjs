// Commissions BFO opp popup: the Commission Ticket link. Run:
//   node scripts/commissionBfoTicket.test.mjs
import assert from 'node:assert/strict';
const { bfoTicketPatch, ticketHref, BFO_TICKET_SETTINGS_KEY, bfoNotesPatch } = await import('../src/utils/commissionBfoSchedule.js');

const cur = { [BFO_TICKET_SETTINGS_KEY]: { other: 'https://t/1' } };
assert.deepEqual(bfoTicketPatch(cur, 'opp a', ' https://t/2 '), { commissionBfoTicket: { other: 'https://t/1', 'opp a': 'https://t/2' } }, 'saves, keeps other opps');
assert.deepEqual(bfoTicketPatch(cur, 'other', ''), { commissionBfoTicket: {} }, 'blank removes it');
assert.deepEqual(bfoTicketPatch(null, 'x', 'u'), { commissionBfoTicket: { x: 'u' } }, 'no settings yet');
assert.equal(ticketHref('jira.example.com/browse/COM-12'), 'https://jira.example.com/browse/COM-12', 'bare host gets https');
assert.equal(ticketHref('http://x.y/z'), 'http://x.y/z', 'a scheme is kept');
assert.equal(ticketHref('javascript:alert(1)'), '', 'non-web schemes are not linked');
assert.equal(ticketHref('  '), '', 'nothing, no link');

// Notes on the opp, kept the same way.
const at = new Date('2026-11-10T20:00:00Z');
assert.deepEqual(bfoNotesPatch({ commissionBfoNotes: { b: { text: 'x', updatedAt: 'y' } } }, 'a', 'Waiting on PO\n', at),
  { commissionBfoNotes: { b: { text: 'x', updatedAt: 'y' }, a: { text: 'Waiting on PO', updatedAt: at.toISOString() } } }, 'notes saved, trailing space trimmed, others kept');
assert.deepEqual(bfoNotesPatch({ commissionBfoNotes: { a: { text: 'x' } } }, 'a', '   '), { commissionBfoNotes: {} }, 'blank notes removed');
console.log('PASS  commissionBfoTicket (ticket link and notes)');

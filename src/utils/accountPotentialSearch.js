/**
 * What the Account Potential table's search box looks through.
 *
 * The box used to read four fields: the service name, its bucket, the
 * pricing basis and the rate card notes. Everything else the table prints
 * is a number - the rate, the units, the setup fee, the Year 1 fee - and
 * numbers are exactly what somebody scanning 117 rows is looking for.
 * "Which service is the 133,500 one?" and "what else is quoted at $6-30?"
 * are both questions the table can answer and the search box could not.
 *
 * So the row is folded into one string of everything its cells print, and
 * the term is folded the same way. The folding is the whole trick: money
 * on this page is printed with a dollar sign, thousands commas and, for a
 * range, an en dash, and none of those survive being typed into a search
 * box the way they were printed. Drop them from both sides and "$1,435,951",
 * "1435951" and "1,435" all land on the same service.
 */
import { formatMoneyRange, formatRate } from './servicePricing.js';

/**
 * One side of the comparison, folded: case away, the en dash of a range
 * turned into a plain hyphen, and the dollar signs and thousands commas
 * dropped so a fee reads as its digits. Takes a string or a list of cells,
 * and skips the empty ones so a blank cell doesn't pad the string with a
 * space that a search for two words could then match across.
 */
export function searchable(parts) {
  const text = Array.isArray(parts)
    ? parts.filter(v => v !== null && v !== undefined && v !== '').join(' ')
    : String(parts ?? '');
  return text
    .toLowerCase()
    .replace(/–/g, '-')
    .replace(/[$,]/g, '');
}

/**
 * Every column of one table row, as the one string the search runs over.
 *
 * Cells are searched as they are PRINTED: the rate in the card's own words,
 * the units with their thousands separator, the fee as the range it shows.
 * A cell the table leaves blank draws a muted "-", and that is punctuation
 * rather than content, so it stays out - a search for "-" finding every
 * unpriced service would be an accident, not a feature.
 */
export function rowSearchText(row, bases) {
  return searchable([
    row._rank,
    row.name,
    row.serviceBucket,
    row.basisLabel,
    formatRate(row._entry, bases),
    row.units === null || row.units === undefined ? '' : row.units.toLocaleString('en-US'),
    // What an empty units cell offers as its placeholder ("Sites",
    // "Accounts"), which is the only thing it shows.
    row._unitLabel,
    row.setupLines?.length > 0
      ? (formatMoneyRange(row._setupFee, row._setupFeeHigh) || '$0')
      : '',
    row.fee === null || row.fee === undefined ? '' : formatMoneyRange(row.fee, row.feeHigh),
    row.notes,
  ]);
}

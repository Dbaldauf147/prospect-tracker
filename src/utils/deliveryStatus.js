// Did the email actually arrive?
//
// This is the question "opens" was being asked to answer and couldn't. A
// tracking pixel fires after delivery, so a load proves arrival — but a
// missing load proves nothing, because Outlook blocks images by default. Read
// as a delivery metric, the pixel says "delivered" for some arrivals and
// "unknown" for the rest, which is useless.
//
// Delivery has its own evidence, and it is the bounce. api/_lib/autoReply.js
// classifies delivery-failure notifications out of a campaign's incoming mail
// and attributes them to a send. That gives a genuine three-state answer:
//
//   FAILED     a bounce came back — the address is bad, nobody saw it
//   DELIVERED  it went out and nothing bounced
//   UNKNOWN    no campaign is watching this send, so nothing would have told us
//
// The honest part is UNKNOWN. A send no campaign claims has no bounce evidence
// either way, and calling that "delivered" would turn silence into a fact —
// exactly the mistake the old "opens" wording made.
//
// Two smaller states sit alongside: a send whose campaign has no send date is
// NOT SENT (drafted, never mailed), and a load or click on a send with no
// bounce is delivery CONFIRMED — the mail demonstrably arrived, not merely
// failed to bounce.

export const DELIVERY = {
  CONFIRMED: 'confirmed',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  NOT_SENT: 'not-sent',
  UNKNOWN: 'unknown',
};

// Short labels, and what each actually claims.
export const DELIVERY_LABEL = {
  [DELIVERY.CONFIRMED]: 'Confirmed',
  [DELIVERY.DELIVERED]: 'Delivered',
  [DELIVERY.FAILED]: 'Failed',
  [DELIVERY.NOT_SENT]: 'Not sent',
  [DELIVERY.UNKNOWN]: 'Unknown',
};

export const DELIVERY_TITLE = {
  [DELIVERY.CONFIRMED]: 'It arrived — the message was fetched or a link in it was followed, which can only happen after delivery. The strongest delivery evidence there is.',
  [DELIVERY.DELIVERED]: 'It went out and nothing bounced. No positive confirmation it was seen — plenty of clients never load the image — but no delivery failure either.',
  [DELIVERY.FAILED]: 'A delivery failure came back for this address. Nobody saw the email, and every future send to it is wasted — fix or remove the address.',
  [DELIVERY.NOT_SENT]: 'The tracked draft exists but the campaign has no record of it going out.',
  [DELIVERY.UNKNOWN]: 'No saved campaign claims this send, so nothing was watching for a bounce. Not the same as delivered — we simply would not have been told.',
};

/**
 * Delivery state for one tracked send.
 *
 * Reads only the campaign's record of the recipient and whatever activity the
 * caller found, so both the tracking dashboard (which joins a tracking doc to
 * a campaign) and the campaign roster itself (where every contact is watched
 * by definition) can ask the same question and get the same answer.
 *
 * @param reply   the campaign's per-recipient record, or null when no campaign
 *                claims this send — { bounced } shape
 * @param options.hasActivity whether anything was recorded against the send
 *                (an image load or a click). Passed in rather than read off the
 *                row so the caller can use its own counted-loads figure, which
 *                excludes the sender's own draft previews — a pre-send preview
 *                is not evidence the recipient's server accepted anything.
 * @returns one of DELIVERY
 */
export function deliveryStatus(reply, { hasActivity = false, sentAt = null } = {}) {
  // A bounce is the only hard negative, and it outranks everything: a message
  // that bounced never arrived, whatever else was recorded against it.
  if (reply?.bounced) return DELIVERY.FAILED;
  // Anything fetched or clicked can only have happened after the mail landed.
  if (hasActivity) return DELIVERY.CONFIRMED;
  // Past here we need a campaign watching, or we know nothing.
  if (!reply) return DELIVERY.UNKNOWN;
  if (!sentAt) return DELIVERY.NOT_SENT;
  return DELIVERY.DELIVERED;
}

// True where the send is known to have reached the recipient — the two states
// that count toward a delivery rate. UNKNOWN and NOT_SENT are excluded from
// both halves of that fraction rather than counted either way.
export function isDelivered(status) {
  return status === DELIVERY.CONFIRMED || status === DELIVERY.DELIVERED;
}

// Sends a delivery rate can honestly be measured over: those a campaign is
// watching AND that actually went out.
export function isDeliveryKnown(status) {
  return status === DELIVERY.CONFIRMED
    || status === DELIVERY.DELIVERED
    || status === DELIVERY.FAILED;
}

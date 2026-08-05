---
description: Recap a Granola meeting and file it against the right opportunity in Prospect Tracker.
---

# /meeting-notes

Turn a meeting Granola already captured into a recap, and land that recap on
the opportunity it belongs to in Prospect Tracker.

Granola has done the transcribing and its own summarising before this command
runs. So the work here is not "write notes" — it is **decide what mattered,
work out which deal it mattered to, and put it somewhere the deal will be
worked from.** A recap that never reaches the opp is a recap nobody reads.

Follow the format standards in the `meeting-recap` skill for everything you
write. Load it before drafting.

---

## Step 1 — Find the meeting

If the user named a meeting or pasted notes, skip to Step 2.

Otherwise use the Granola connector. Its tools are typically
`list_meetings`, `get_meetings`, `get_meeting_transcript`, and
`query_granola`; find them with ToolSearch (`granola`) rather than assuming
the exact names — the connector's surface changes.

1. List recent meetings (default: the last 7 days).
2. Show them as a short numbered list — title, date, attendees — and ask which
   one. Do not pick for the user, even when there is an obvious candidate:
   the whole downstream chain writes to a customer record, and the cost of
   recapping the wrong call onto the wrong deal is high.
3. Fetch that meeting's notes **and** its transcript. Granola's own summary is
   a starting point, not the recap — it is written for the person who was
   there, not for the deal file.

**If the Granola connector is not available**, say so plainly and offer the
paste path: the user pastes notes or a transcript and the rest of the command
runs unchanged. Do not silently fall back — the user should know why they are
being asked to paste.

**If the meeting is too recent**, Granola may not have finished processing it.
Say that rather than recapping a partial transcript.

## Step 2 — Read it for what actually happened

Before writing anything, work out:

- **What kind of meeting was this?** Sales/prospect, client account, or
  internal. The `meeting-recap` skill has the tell-tales and the section set
  for each. Get this wrong and every heading below is wrong.
- **Who was on it, and from where?** Attendee email domains are what tell the
  other side from colleagues, and they are also how the company gets matched
  in Step 4.
- **What was decided, and what was merely discussed?** These are not the same
  and the recap must not blur them.

## Step 3 — Draft the recap

Per the `meeting-recap` skill. Show it in chat first. Nothing is written
anywhere until the user has read it.

The one rule that overrides everything: **do not invent commitments.** If
nobody stated an owner, a date, or a number, leave it out. An honest short
recap beats a padded one, and a fabricated due date in a deal record is worse
than no recap at all.

## Step 4 — Work out which opportunity it belongs to

A recap has to land on a deal. To find the candidates:

```bash
node scripts/pushGranolaRecap.mjs --list-opps "<company>" --email <user email>
```

That returns `{oppId, account, label}` for each match. Then:

- **One clear match** → propose it and ask the user to confirm.
- **Several** → show them and ask which.
- **None** → say so. Offer to file the recap untagged (it still lands on the
  Call Recordings page and can be tagged there), or to stop.

Never guess a tag silently. A recap on the wrong opportunity is worse than an
untagged one, because the next person to read that deal believes it.

If the repo is not checked out, or `--list-opps` cannot reach Firestore, skip
to the paste path in Step 5 rather than inventing an `oppId`.

## Step 5 — File it

Confirm with the user before writing. Then, preferred path:

```bash
node scripts/pushGranolaRecap.mjs --push recap.json --email <user email>
```

Write `recap.json` first — the script's `--help` documents every field. It
must carry the Granola `noteId`, because that is what makes a re-run update
the same record instead of creating a second one.

Use `--dry-run` first if anything about the tag is uncertain; it prints the
document and writes nothing.

The recap lands as a call record at `callRecordings/{uid}/items/{docId}` — the
same document the Call Recordings page writes. So it shows up:

- on the **Call Recordings** page, with Granola's notes and yours side by side
- in the **Calls** section of the tagged opportunity's popup

**The script does not edit the opportunity's Notes field**, deliberately —
Notes lives inside the chunked `opps2Data` blob that the browser
read-modify-writes whole, and a second writer racing an open tab can drop an
edit the user just made in the app. Instead the script prints the Notes block.
Tell the user to push it onto the deal from the Call Recordings page, where
the existing merge de-duplicates a re-push.

**Fallback path** (no repo checkout, no service-account credentials, or
running from Cowork rather than Claude Code):

```bash
node scripts/pushGranolaRecap.mjs --notes recap.json
```

This needs no credentials and no `npm install`. It prints the block to paste
into the opp's Notes by hand. The block carries a `[call:granola:<noteId>]`
marker, so a later push from the app replaces it rather than duplicating it.

If even that is unavailable, output the recap in chat in the skill's format
and say plainly that nothing was written.

## Step 6 — Report what happened

State which opportunity it landed on, whether the record was created or
updated, and anything you could not resolve — an unmatched company, a
follow-up with no owner, a transcript that was still processing. Name the
gaps; do not paper over them.

---

## Guardrails

- **Nothing is written without confirmation.** Not the record, not the tag.
- **Internal only.** This produces internal deal notes. It does not draft
  anything client-facing unless the user asks for that separately.
- **No invented commitments, owners, dates, or numbers.** Ever.
- **The tag is confirmed, never assumed.** Attendee-domain matching proposes;
  the user decides.
- **Say when a step degraded.** A missing connector, a clipped transcript, an
  unmatched company — each changes how much the recap can be trusted, so each
  gets said out loud rather than quietly absorbed.

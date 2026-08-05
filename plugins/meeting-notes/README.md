# meeting-notes

Turn a meeting Granola already captured into a recap, and file that recap
against the right opportunity in Prospect Tracker.

```
/meeting-notes
```

## What it does

1. **Finds the meeting** — lists recent Granola meetings and asks which one,
   or takes pasted notes.
2. **Detects the meeting type** — sales, client, or internal — and picks the
   section set that fits. A prospect call and an internal stand-up do not want
   the same recap.
3. **Writes the recap** — summary, key items, follow-ups grouped by owner,
   next step, sentiment, risks.
4. **Matches it to an opportunity** — proposes a deal from the attendees, and
   asks before tagging.
5. **Files it into the tracker** — as a call record, so it appears on the Call
   Recordings page and in the Calls section of the tagged opp.

## What you need

| | Why | Required? |
|---|---|---|
| Granola connector | Reading meetings and transcripts | Recommended |
| Prospect Tracker checkout | Running the write-back script | For the push path |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Writing the call record | For the push path |

None of it is strictly required. Without the Granola connector you paste
notes; without credentials you get a paste-ready block for the opp's Notes
field. The command tells you which path it took rather than degrading
silently.

The Granola connector is set up in your Claude connector settings, not here.

## Install

Copy the `meeting-notes` folder into your Claude plugins directory, keeping
its internal structure — the command references files by relative path.
Reload Claude, then type `/` and look for `meeting-notes`.

If it does not appear, the usual cause is an extra nesting level. Flatten it
so `.claude-plugin/plugin.json` sits one level below the plugins directory.

## Filing paths

**Push** (repo checked out, credentials available):

```bash
node scripts/pushGranolaRecap.mjs --push recap.json --email you@example.com
```

Writes `callRecordings/{uid}/items/{docId}` — the same document the Call
Recordings page writes. Add `--dry-run` to see the document without writing.

**Paste** (no credentials, no `npm install` needed):

```bash
node scripts/pushGranolaRecap.mjs --notes recap.json
```

Prints the block to paste into the opp's Notes.

Either way the block carries a `[call:granola:<noteId>]` marker, so re-running
on the same meeting updates the existing entry instead of stacking a second
copy.

Find the opp to tag with:

```bash
node scripts/pushGranolaRecap.mjs --list-opps "acme" --email you@example.com
```

## What it deliberately does not do

- **It does not edit the opportunity's Notes field directly.** Notes lives
  inside the chunked `opps2Data` blob that the browser read-modify-writes
  whole; a script writing it while a tab is open can drop an edit made in the
  app. The recap lands as a call record and the Notes block is printed —
  push it onto the deal from the Call Recordings page.
- **It does not write anything without confirmation**, including the tag.
- **It does not invent owners, dates, or commitments.** If nobody said it, it
  is not in the recap.
- **It does not produce client-facing text.** These are internal deal notes.

## Adapting it

Two files control almost everything:

- `commands/meeting-notes.md` — the workflow: how the meeting is found, the
  order of steps, what gets asked when.
- `skills/meeting-recap/SKILL.md` — the format: meeting-type detection, the
  section set per type, bullet and owner conventions.

Common changes: adjusting the key-item target, adding a section your team
expects, or changing which meeting types get which sections. Edit, reload,
rerun.

## Known limitations

- Granola only serves notes it has finished processing, so a meeting from the
  last few minutes may not be there yet.
- Long transcripts compress toward decisions, commitments, and blockers, so
  nuance in long discussions is lost. The recap says when it was working from
  a clipped transcript — take that seriously before filing.
- Company matching keys on attendee email domains. Meetings with no external
  attendees, or where the only external address is free-mail, will not match a
  prospect and need tagging by hand.
- The push path needs a service-account key, which is a deployment secret. If
  you do not have one, use the paste path — it produces the same text.

## Relationship to the app's own Granola sync

Prospect Tracker already syncs Granola notes on the Call Recordings page,
where you can tag, summarise, and push to an opp by clicking. That path is
better when you are working through several calls at once.

This plugin is the conversational path for one meeting: it adapts the recap
to the meeting type, which the app's fixed summarise prompt does not, and it
asks about the tag rather than guessing from attendee domains. The two write
the same record, so they can be used interchangeably on the same meeting.

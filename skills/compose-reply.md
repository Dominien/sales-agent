# Skill — compose-reply

> **Mode:** one-shot for a single high-value thread.
> **Uses ALL enabled channels** to assemble context (email history + LinkedIn history + CRM notes + dossier).

## When to use

A strategic, nuanced reply where the agent should think carefully and assemble
the full situation. User specifies ONE identifier.

## Inputs

- `identifier` (required) — email, LinkedIn URL, or contact_id
- `channel` (required) — `email` | `linkedin` (where to reply)
- `extra_context` (optional) — paragraph the user wants considered (call notes, internal intel)

## Loop (one target only)

1. **Resolve** the contact via `tracker.ts find <identifier>`.

2. **Assemble history** (best-effort from enabled channels):
   - Email: search Gmail for messages from/to the contact's email, read last 3 threads.
   - LinkedIn: `get_conversation` for the active thread + recent posts for tone reference.
   - CRM: `crm.listNotes(id)` + `crm.listDeals({contact_id: id})` if available.
   - Dossier: `output/prospect-dossiers/<slug>.md` if exists.

3. **Think** about the right angle:
   - What did the contact most recently express? (openness / hesitation / question)
   - What specific fact from the assembled history can you reference?
   - What CTA makes sense for this moment?

4. **Compose reply** per `CLAUDE.md` but with higher care:
   - 4–8 sentences (slightly longer than standard follow-up).
   - Reference the most recent concrete thread point.
   - Integrate `extra_context` naturally.
   - Single specific CTA.
   - If proposing meeting times, use `<sender.timezone>` from config as the tz label. If `sender.timezone` is empty, drop the specific slots and point to `<sender.scheduling_link>` instead.
   - **German formal greetings:** use `src/honorifics.ts` (`formalGreeting({firstname, lastname, gender}, 'de')`) to avoid double-rendering when the tracker's `firstname` contains a stored honorific (Dr., Prof. Dr., Dipl.-Ing., ...).
   - **Bridge re-engagement** (prior commercial conversation → silence): prefer commercial *Verbleib* fragments over aesthetic details. See learnings.md §C.1.

5. **Rate-limit check** for the chosen channel.

6. **Send:**
   - Email: `gmail_create_draft` — DRAFT. Show the user the full text before asking for confirmation.
   - LinkedIn: pause 10 s (show text to user), then `send_message` unless interrupted.

7. **Update tracker** + `crm.addNote` with a 1-line summary; `notes_summary` prefix `COMPOSE:`.

## End of run

Observation is common: what assembled context actually shaped the reply? Note it.

## Does NOT do

- Does not handle batches (use `follow-up-loop`).
- Does not classify replies you expect back (that's `inbox-classifier`).
- Does not overwrite a draft silently — always show the user the final text first.

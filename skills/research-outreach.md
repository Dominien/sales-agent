# Skill — research-outreach

> **Mode:** one-shot per curated list. Higher effort, lower volume than cold-outreach.
> **Prerequisite:** ideally `prospect-research` has produced dossiers for the list.

## When to use

Evidence-backed personalized touch. For email: a warmer cold email with a specific
research-based hook. For LinkedIn: a tailored message to an EXISTING 1st-degree
connection.

## Inputs

- Curated list of identifiers
- `audit_type` (inherited from dossier's audit type)
- `channel` — usually `email` for cold research campaigns, `linkedin` for warm connection nurture

## Loop

For each target:

1. **Load dossier** from `output/prospect-dossiers/<slug>.md`. If missing, run the
   `prospect-research` steps inline (ideally avoid).

2. **Verify eligibility:**
   - LinkedIn channel: tracker row must have `linkedin_connection_status = CONNECTED`. If not → note and skip (or downgrade to `cold-outreach`).
   - Email channel: target must have an `email` identifier.

3. **Rate-limit check** for the chosen action.

4. **Compose message:**
   - Lead with the SINGLE strongest hook from the dossier.
   - Email: 6–8 sentences, subject line that references the hook.
   - LinkedIn: 4–6 sentences.
   - Offer one specific piece of value tied to `audit_type`.
   - Single narrow CTA.
   - Log the hook used in `notes_summary` with prefix `RES: <hook-type>`.

5. **Send:**
   - Email: `gmail_create_draft` (DRAFT).
   - LinkedIn: `send_message` (autonomous).

6. **Record:** rate-limiter + tracker update + CRM note (`crm.addNote`) with 1-line summary.

7. Sleep 60–180 s (longer than cold — higher-effort signal, less volume).

## End of run

Observation is common here — which hook type drove reply? Record with evidence.

## Does NOT do

- Does not replace `cold-outreach` for non-dossier'd targets.
- Does not generate dossiers on the fly as a default.

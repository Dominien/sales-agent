# CRM Field Mapping

How the canonical sales-agent `Contact` / `Deal` / `Note` shape maps to each
supported CRM. Use this as a reference when skills need CRM-specific arguments
or when adding a new adapter.

---

## Contact

| Canonical field | HubSpot | Close | Attio | Salesforce | SQLite (tracker column) |
|---|---|---|---|---|---|
| `id` | `hs_object_id` (contacts) | `lead_id` (primary) | `record_id` (people) | `Id` (Contact / Lead) | `contact_id` (UUID) |
| `email` | `email` | `contact.emails[0].email` | `email_addresses[0]` | `Email` | `email` |
| `linkedin_url` | custom: `linkedin_url` | `contact.urls[type=linkedin]` | custom: `linkedin` | custom: `LinkedIn_URL__c` | `linkedin_url` |
| `firstname` | `firstname` | `contact.name` (split) | `name.first_name` | `FirstName` | `firstname` |
| `lastname` | `lastname` | `contact.name` (split) | `name.last_name` | `LastName` | `lastname` |
| `company` | `company` (inline) or `Company` assoc | `lead.name` (Close models by lead=company) | `company` (relation) | `Account.Name` | `company` |
| `job_title` | `jobtitle` | `contact.title` | `job_title` | `Title` | `job_title` |
| `lead_status` | `hs_lead_status` | `lead.status_label` | custom: `lead_status` | `LeadSource` or `Lead.Status` | `lead_status` |

## Deal / Opportunity

| Canonical field | HubSpot | Close | Attio | Salesforce | SQLite |
|---|---|---|---|---|---|
| `id` | `dealId` | `opportunity_id` | `record_id` (deals) | `Opportunity.Id` | `id` (deals table) |
| `name` | `dealname` | `note` | `name` | `Name` | `name` |
| `amount` | `amount` | `value` (cents) | `value` | `Amount` | `amount` |
| `stage` | `dealstage` | `status_label` | `stage` | `StageName` | `stage` |
| `close_date` | `closedate` | `date_won` | `close_date` | `CloseDate` | `close_date` |
| `contact_id` | via assoc | `lead_id` | `associated_people[0]` | `OpportunityContactRole.ContactId` | `contact_id` |

## Note

| Canonical | HubSpot | Close | Attio | Salesforce | SQLite |
|---|---|---|---|---|---|
| body | `hs_note_body` | `activity.note` | `note.content` | `Task.Description` (Type='Note') | `notes.body` |
| created_at | `hs_createdate` | `activity.date_created` | `note.created_at` | `Task.CreatedDate` | `notes.created_at` |
| author | `hubspot_owner_id` | `activity.user_id` | `note.created_by` | `Task.CreatedById` | `notes.source` |

## Task

| Canonical | HubSpot | Close | Attio | Salesforce | SQLite |
|---|---|---|---|---|---|
| title | `hs_task_subject` | `task.text` | `task.content` | `Task.Subject` | `tasks.title` |
| due_date | `hs_timestamp` | `task.date` | `task.due_at` | `Task.ActivityDate` | `tasks.due_date` |
| contact_id | assoc | `task.lead_id` | `linked_records` | `Task.WhoId` | `tasks.contact_id` |
| status | `hs_task_status` | `task.is_complete` | `task.status` | `Task.Status` | `tasks.status` |

---

## Custom-field caveats

Two fields require **manual CRM-side setup** if you want LinkedIn integration
to work end-to-end:

- **HubSpot:** create a custom contact property `linkedin_url` (single-line text).
- **Salesforce:** create a custom field `LinkedIn_URL__c` on the Contact object
  (URL type).

Close and Attio handle LinkedIn URLs natively. SQLite stores them in the
dedicated `linkedin_url` column.

---

## Lead status mapping

Each CRM uses its own status string set. The sales-agent stores the raw string
from the CRM in `tracker.lead_status` — no normalization is done. Scoring
does NOT use `lead_status` directly; it uses `linkedin_connection_status`
and `reply_classification` which are agent-controlled.

If you need to transform a CRM status into an agent-normalized one, do it in
your skill before calling `crm.setLeadStatus`. Example: "CONNECTED" on
LinkedIn might correspond to HubSpot `hs_lead_status = CONNECTED`, or to
Close `status_label = "Engaged"` — your call.

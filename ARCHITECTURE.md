# DeptDocs architecture

## Overview

```mermaid
graph TD
    Browser[Browser: Next.js client pages] -->|Supabase JS + user JWT| SupaDB[(Postgres + RLS)]
    Browser -->|signed URLs| SupaStorage[(Storage: reports, signatures, private)]
    Browser -->|POST /api/ai/extract| API[Next.js API routes]
    Browser -->|POST /api/drive/approve| API
    API -->|user JWT: download files| SupaStorage
    API -->|service role, admin only| SupaDB
    API --> Gemini[Gemini API]
    API -->|renderToBuffer| PDF[@react-pdf/renderer]
    API -->|service account| Drive[Google Drive]
    SupaDB -->|Realtime| Browser
```

Most reads and writes go **directly from the browser to Supabase** with the signed-in user's token.
Security therefore lives in the database: every table has row level security, defined in
`supabase/migrations/`. The Next.js `proxy.ts` only decides which *pages* to show. It is not the security
boundary.

The two API routes exist because they need secrets the browser must not have:

| Route | Who | What |
|---|---|---|
| `POST /api/drive/approve` | admins (`profiles.role = 'admin'`, checked server-side) | renders the PDF with the service role, uploads it to Drive, sets status `approved`, notifies the owner |
| `POST /api/ai/extract` | any signed-in user | takes notes/dictation + *storage references*, downloads the files **as that user** (storage policies apply; no arbitrary URLs), asks Gemini to fill the report's template, validates the answer against the template |
| `GET /api/health` | anyone | liveness probe for Docker |

## Data model

| Table | Purpose | Access (RLS) |
|---|---|---|
| `profiles` | name, designation, department, signature reference, `role` (`faculty`/`admin`) | everyone signed in can read; users edit their own row; `role` and `email` are protected by a trigger |
| `reports` | `title`, `status` (`draft` → `completed` → `approved`), `data` (JSONB form payload), `admin_feedback` | owner, collaborators and admins read; drafts are editable by the owner and accepted *Editor* collaborators; only admins/server set `approved` or feedback |
| `collaborators` | invitations (`pending`/`accepted`/`declined`, role `Viewer`/`Editor`) | owner invites and sets roles; the invitee accepts or declines |
| `notifications` | in-app notifications (Realtime) | private to the recipient; only admins/server notify others; links must be internal paths |
| `activity_logs` | audit feed | append-only; admins read |
| `signup_allowlist` | allowed email domains/addresses | service role only; enforced by a trigger on `auth.users` |
| `report_templates` | versions of the report format; one `is_active` | everyone signed in reads; admins insert/delete; no updates (activation via `activate_report_template()`) |

`supabase/tests/run.sh` applies the migrations to a scratch Postgres and checks these rules.

### Report formats (templates)

The structure of a report is data, not code: `lib/template.ts` defines a `ReportTemplate` (header lines, title,
sections → fields of 13 types, including tables). `report_templates` stores admin-edited versions. Versions are immutable,
exactly one is active, and `reports.template_id` pins each report to its version (`NULL` = `DEFAULT_TEMPLATE`, the
original format). Field ids are the keys inside `reports.data`.

One template drives everything:

| Consumer | Code |
|---|---|
| Editor sidebar + forms | `components/template/SectionForm.tsx` and the field components next to it |
| PDF (live preview, download, archived copy) | `components/ReportPDF.tsx` |
| Required-field check before submitting | `missingRequired()` |
| AI auto-fill prompt + answer validation | `lib/aiFill.ts` |
| Admin editor with live preview | `app/admin/templates`, `components/template/TemplateEditor.tsx` |

`validateTemplate()` cleans any definition (unique ids, reserved ids, options, limits). An invalid stored
definition falls back to the built-in template instead of breaking the editor.

### AI Assistant

`components/AiAssistant.tsx` collects the organiser's notes (typed, Web Speech API dictation, or a recorded voice
note uploaded to storage) plus document references, and calls `/api/ai/extract` with the report's template id.
The server builds the prompt from the template, downloads the files as the user, sends everything to Gemini, and
validates the JSON against the template (`sanitizeAiValues`). `mergeAiValues` fills only empty fields unless the user
chooses to overwrite. Notes (`aiNotes`) and reference files (`aiReferenceFiles`) are saved with the draft but never printed.

### Notifications and email

Workflow notifications are created by **database triggers** (`reports_notify`, `collaborators_notify`): on
submit (all admins), revision request, approval and assignment (owner), and on invite and invite accepted.
Each row is queued for email (`notifications.email_status = 'pending'`). After an action, the browser calls
`POST /api/notifications/dispatch` (`lib/notifyClient.ts`). The server atomically claims queued rows
(`claim_notification_emails()`) and sends them over SMTP (`lib/email.ts`, `lib/notificationDispatch.ts`),
respecting `profiles.email_notifications`. A scheduler can call the same endpoint with `CRON_SECRET` to retry.

### Accounts

`profiles.role` (`faculty`/`admin`) and `profiles.is_active` are changed only by admins through
`/api/admin/users/[id]`, which also bans or unbans the Supabase Auth login. `is_admin()` requires an active account,
and `proxy.ts` signs deactivated users out. The sign-up allow-list is edited through `/api/admin/signup-allowlist`.

### The report payload (`reports.data`)

Typed in `lib/reportData.ts` (`ReportData`). `normalizeReportData()` upgrades older payloads (e.g. the
`participantsProfile` key, speaker `photoUrl`, attachments saved as `{url}`), and every reader goes through it:
the editor, the live preview and the server PDF.

### Files

Uploads go to two **private** buckets. The database stores *references* (`sb://<bucket>/<path>`), never
public URLs (`lib/storage.ts`). Before something is displayed or rendered, references are exchanged for
short-lived signed URLs: in the browser by `lib/storageClient.ts` (cached), on the server by
`utils/supabase/admin.ts`. Legacy public URLs in old rows are recognised and signed the same way.

Report files live under the report id (the editor creates the draft before the first upload). Signatures live
under the user's id. The storage policies use that first folder to decide who may read or write a file. When the
server renders the final PDF with the service role, it only signs files from the report's own folder or its
members' folders (`isPathAllowedForReport`), so an author cannot embed someone else's file. PDFs are converted to one JPEG per page in the browser
(`lib/files.ts`), so the report PDF can embed them; spreadsheets are parsed into rows.

## Report lifecycle

1. Faculty create a draft (`/home/new`), optionally invite collaborators (Document Library → Manage Access).
2. **Submit** sets `completed`; the editor and the database lock the report.
3. The admin reviews it in `/admin` (same `ReportPDF` template as the faculty preview):
   - **Request revision**: status back to `draft`, comment in `admin_feedback`, notification to the owner.
   - **Approve & Push**: `/api/drive/approve` renders and archives the PDF, sets `approved`, stores the Drive link
     in `data.drive_link`.

## Project structure

```text
app/
├── admin/                 Admin dashboard (review queue, drafts, approved, assign, feed)
│   └── templates/         Report Format editor (versions, live preview)
├── api/                   approve (Drive), ai/extract (Gemini), health
├── auth/                  OAuth/email callback, password reset
├── home/                  Faculty dashboard, report editor (new), document library (open)
├── onboarding/ settings/  Profile + signature
components/
├── template/              Generic section/field inputs + the admin template editor
├── AiAssistant.tsx        Notes, dictation, voice notes, uploads, "Fill report with AI"
├── ReportPDF.tsx          PDF renderer for any template
├── LivePreview.tsx        Debounced in-browser render of ReportPDF
lib/                       Report data model, storage refs, uploads, auth, redirects
utils/supabase/            Browser, server (user) and admin (service role) clients
supabase/migrations/       Schema + RLS + storage policies
supabase/tests/            Migration and RLS tests
proxy.ts                   Session refresh + page gating (Next.js 16 "proxy", formerly middleware)
Dockerfile, docker-compose.yml
```

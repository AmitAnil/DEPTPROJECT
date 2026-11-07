# Handoff notes

Status of DeptDocs at handoff: what is done, what still needs a human to verify, and what is left to build.
Keep this file up to date when you finish or start something.

## Done

- Security audit fixes: authenticated/admin-only API routes, open-redirect fix, row level security on every
  table, guard triggers, private storage with signed URLs, sign-up allow-list, patched dependencies.
- Report workflow: draft → submit → revision/approve → Google Drive archive, locked submitted reports,
  Viewer/Editor collaborators, admin feedback shown in the editor.
- **Configurable report format** (Admin → Report Format): versioned templates with 13 field types including
  **tables** (fixed rows, totals). Reports are pinned to their version, and the built-in format matches the original PDF.
- **AI Assistant**: typed, dictated or voice-note description plus documents → fills the template's fields.
- **Email notifications** (database triggers + SMTP queue), per-user opt-out.
- **Autosave** with save status and unsaved-changes warnings.
- **Users & Access** admin tab: roles, deactivate/reactivate, sign-up allow-list.
- Docker image + Compose, CI (lint, types, unit tests, build, audit, migration/RLS tests, Docker build),
  [DEPLOYMENT.md](DEPLOYMENT.md), [STUDENT_SETUP.md](STUDENT_SETUP.md), [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Must be verified on a real Supabase project before going live

These were tested with unit tests, a plain-Postgres copy of the schema and the Docker image, but **not**
end-to-end against a real Supabase project, Google Drive, Gemini or an SMTP server:

1. Apply `supabase/migrations/` to a **copy** of production first, then click through: sign-up, onboarding,
   create/save/autosave, upload photos and PDFs, submit, revision, approve to Drive, collaborator invite and accept,
   Report Format edit and activate, AI Assistant (typed, dictation in Chrome, voice note), Users & Access.
2. The trigger on `auth.users` (sign-up allow-list): confirm Supabase allows it on your plan. If not, use an
   Auth "before user created" hook instead.
3. Old reports: open a few existing reports and check that images and signatures still appear (legacy public URLs
   are converted to signed URLs once the buckets are private). Files uploaded long ago into `temp_uploads/` are
   admin-only.
4. Email: send yourself a test by submitting a report; check spam folders; check `notifications.email_error`.
5. `GEMINI_MODEL` defaults to `gemini-2.5-flash`. Change it if Google has retired that model.

## Known limitations

- Two people editing the same draft at the same time: the last save wins (no live merge). Autosave makes
  overwrites more likely if collaborators work simultaneously.
- Changing a field's id in Report Format means new reports store the value under the new id. Old reports keep
  theirs. Ids of existing fields are locked in the editor for this reason.
- Deactivating a user does not reassign their drafts; use "Assign Tasks" to create a replacement.
- Files uploaded by an earlier build before a report's first save sit in the uploader's personal folder. Owners
  and admins still see them, but collaborators don't. New uploads always go into the report's folder.
- No automated browser (end-to-end) tests yet.

## Recommended next work (not started)

| Priority | Item | Notes |
|---|---|---|
| High | Delete / duplicate drafts; search and filters in the Document Library | `app/home/open/page.tsx`; deleting must also remove storage files |
| High | Submission checklist page before submit (instead of an alert) | uses `missingRequired()` |
| Medium | Invite by name (people picker) instead of exact email | `components/ManageAccessModal.tsx`; profiles are readable to signed-in users |
| Medium | Per-report history: who changed what, previous submitted versions | new `report_versions` table, written on submit |
| Medium | Several report types at once (e.g. Activity vs FDP report), chosen when creating a report | templates already support many versions; add a "type" and allow several active |
| Medium | End-to-end tests (Playwright) for the main flow | run against a local Supabase (`npx supabase start`) |
| Low | Account deletion / data export for people who leave | must respect university record-keeping rules |
| Low | Accessibility pass and mobile layout for the editor | |

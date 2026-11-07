# Deploying and operating DeptDocs

This guide is written for the team taking over DeptDocs. It covers a first installation, moving the
existing production data over, day-to-day administration and upgrades.

DeptDocs has two parts:

1. **The web app**: one Docker container (this repository).
2. **Supabase**: database, logins and file storage. Use a hosted project at <https://supabase.com>, or a
   self-hosted Supabase if the university requires on-premise hosting.

---

## 1. Supabase project

1. Create a project (or use the existing one).
2. **Authentication → Providers**: enable *Email*. Optionally enable *Google* (it needs a Google OAuth client;
   add `https://<your-domain>/auth/callback` as an authorised redirect URL).
3. **Authentication → URL Configuration**: set *Site URL* to the public address of DeptDocs and add
   `https://<your-domain>/auth/callback` to *Redirect URLs*. Do the same for `http://localhost:3000` if you
   develop locally.
4. Recommended: **Authentication → Providers → Email → Secure password change**, so changing a password
   requires a recent login.

### Apply the database migration

All tables, security rules (row level security) and storage buckets are defined in
`supabase/migrations/`. **Without this step the app is insecure or will not work.**

With the Supabase CLI (preferred):

```bash
npx supabase login
```

```bash
npx supabase init        # only once, if supabase/config.toml does not exist yet
```

```bash
npx supabase link --project-ref <project-ref>
```

```bash
npx supabase db push
```

Without the CLI: open **SQL Editor** in the dashboard and run each file in `supabase/migrations/` in name order.

The migration can be re-run. On the **existing production project** it:

- adds the `role`, `admin_feedback` and `is_read` columns and the `collaborators` table if they are missing,
- adds the new `approved` report status,
- **replaces all existing access policies** on the DeptDocs tables with the tested set,
- makes the `reports` and `signatures` storage buckets **private**. Old reports keep working: the app turns
  old public links into short-lived signed links.
- restricts sign-ups to `christuniversity.in` addresses (see §3),
- makes the two previous administrators admins.

> Test it on a copy first: create a Supabase branch or a second project, restore a backup into it, run the
> migration, and click through the app. `supabase/tests/run.sh` runs the same migration against a scratch
> Postgres and checks 27 access rules (CI does this on every push).

One limitation: files that the very first version uploaded into a `temp_uploads/` folder are only readable by
admins after the buckets become private. Re-upload them if a faculty member needs them.

## 2. Configuration (`.env`)

Copy `.env.example` to `.env` next to `docker-compose.yml` and fill it in:

| Variable | Required | Where to find it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | same page, `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | same page, `service_role` key. **Secret.** |
| `SITE_URL` | **yes for emails** | public address, e.g. `https://deptdocs.christuniversity.in`. Email links are built only from this (never from request headers); without it emails have no link |
| `TRUST_PROXY_HEADERS` | optional | `true` only behind a reverse proxy that sets `X-Forwarded-Host`/`-Proto` and `SITE_URL` is not set |
| `GOOGLE_DRIVE_FOLDER_ID` | for approvals | ID in the Drive folder URL |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | for approvals | service-account key JSON, on one line |
| `GOOGLE_GEMINI_API_KEY` | optional | Google AI Studio. Without it, AI auto-fill is disabled. |
| `GEMINI_MODEL` | optional | default `gemini-2.5-flash`; change when Google retires a model |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | for emails | your mail provider (see below) |
| `CRON_SECRET` | optional | random string; lets a scheduler retry unsent emails |
| `APP_PORT` | optional | host port, default `3000` |

`NEXT_PUBLIC_*` values are compiled into the browser code when the image is built. **If you change them,
rebuild** (`docker compose up -d --build`). The other values are read when the container starts.

### Email notifications

In-app notifications always work. To also send emails, fill in the `SMTP_*` values:

| Provider | `SMTP_HOST` | `SMTP_PORT` | Notes |
|---|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | `587` | use an **App Password** (Google account → Security → App passwords) |
| Microsoft 365 | `smtp.office365.com` | `587` | the mailbox must allow authenticated SMTP |
| University mail server | ask IT | usually `587` | |

Emails are sent for: report submitted (to all admins), revision requested, approved, assigned, collaboration
invite, and invite accepted. Users can switch emails off under Settings → Settings. The database queues each email
(`notifications.email_status`). The app sends it right after the action, and failed ones show `failed` with
the error in `email_error`. To retry automatically, call the dispatch endpoint every few minutes from any
scheduler, for example a cron job on the server:

```bash
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/notifications/dispatch
```

### Google Drive archive

1. Google Cloud Console → create a project → enable the **Google Drive API**.
2. Create a **service account** and a JSON key for it.
3. Service accounts have no storage of their own, so use a folder inside a **Shared Drive**. Add the service
   account's email as *Content manager*, then put the folder ID into `GOOGLE_DRIVE_FOLDER_ID`.
4. Put the key JSON on one line into `GOOGLE_SERVICE_ACCOUNT_KEY`.

## 3. Run it

```bash
docker compose up -d --build
```

```bash
docker compose ps        # STATUS should become "healthy"
```

```bash
docker compose logs -f app
```

The container listens on port 3000 and exposes `GET /api/health` for monitoring. In production, put it behind
the university's reverse proxy (nginx, Traefik, IIS…) with HTTPS and set `SITE_URL` to the public address.

The container runs as a non-root user with a read-only filesystem. It keeps no state, so all data lives in
Supabase and the container can be recreated at any time.

## 4. Administration

**Users & Access** (Admin dashboard → *Users & Access*):

- **Make admin / Remove admin.** There must always be one active admin, and you cannot change your own account.
- **Deactivate** someone who has left. They are signed out and cannot sign in again (their Supabase login is
  banned). Their reports are kept. **Reactivate** reverses it.
- **Who can sign up**: email domains (sub-domains included) or individual addresses. With an empty list anyone
  can sign up.

The very first admin has to be set in the SQL Editor, after they have signed up:

```sql
update public.profiles set role = 'admin' where email = 'name@christuniversity.in';
```

**Changing the report format**: Admin dashboard → **Report Format**. You can add, remove, rename and
reorder sections and fields (text, paragraph, number, date/time ranges, dropdowns, repeating groups such as
speakers, photos, file attachments, "prepared by" with signature), set required fields, and change the PDF
header and headings. A live PDF preview with sample data updates as you edit. **Save as new version** stores
an immutable version. When "Use for new reports" is ticked, every *new* report uses it, while existing reports keep
the version they were created with. You can switch back to any older version, or to the built-in format, at
any time. No rebuild or redeploy is needed.

**AI Assistant** (editor → *AI Assistant* tab, needs `GOOGLE_GEMINI_API_KEY`): faculty describe the event in
their own words, either typed, dictated (live speech-to-text in Chrome/Edge/Safari) or as a recorded voice note,
and attach the brochure, notice, attendance and feedback documents. **Fill report with AI** fills every field
of the report's format; by default it only fills empty fields. Faculty review the result before submitting.

**Report statuses**: `draft` (editable) → `completed` (submitted, locked) → `approved` (archived in Drive).
"Request revision" sends a report back to `draft` with the admin's comment.

## 5. Upgrades and maintenance

```bash
git pull
```

```bash
npx supabase db push            # if supabase/migrations changed
```

```bash
docker compose up -d --build
```

- **Backups**: Supabase Pro takes daily backups. On the free tier, schedule `supabase db dump` and download the
  storage buckets regularly.
- **Dependencies**: CI fails when `pnpm audit` finds a high-severity issue. To update: `pnpm update`, then run
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build` and commit the new `pnpm-lock.yaml`.
- **Schema changes**: always add a *new* file in `supabase/migrations/`; never edit one that has been applied.
  Add tests to `supabase/tests/rls_test.sql` for new rules.

## 6. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails: "NEXT_PUBLIC_SUPABASE_URL … build args are required" | `.env` missing or empty next to `docker-compose.yml` |
| Everyone is sent back to `/onboarding` | profile has no name or signature: finish onboarding |
| Images/signatures missing in the preview | migration not applied (storage policies), or the file belongs to a report the user cannot access |
| "Approve & Push" says Drive is not configured | `GOOGLE_*` variables missing; restart the container after setting them |
| "Approve" uploads but fails to update the report | migration not applied (`approved` status missing) |
| Sign-up fails with "restricted to Christ University addresses" | add the address/domain to `signup_allowlist` |
| Login redirects to a wrong host | set `SITE_URL`, or have the proxy forward `X-Forwarded-Host`/`-Proto` |

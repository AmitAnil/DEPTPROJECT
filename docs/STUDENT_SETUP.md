# DeptDocs: setup guide for student developers

Welcome! This guide takes you from a fresh laptop to running DeptDocs locally, making a change and getting it
merged. Budget about an hour the first time.

If you only want to *deploy* DeptDocs for the department, read [DEPLOYMENT.md](DEPLOYMENT.md) instead.
For how the code fits together, read [../ARCHITECTURE.md](../ARCHITECTURE.md) after this guide.

---

## 0. What you are working on

DeptDocs is a web app where faculty write activity reports. They see the official PDF update live, submit it,
and an admin reviews and approves it; approved reports are archived to Google Drive.

- **Next.js 16 + React 19 + TypeScript**: the website and a few server API routes (`app/`).
- **Supabase**: the database (Postgres), logins, file storage and realtime notifications. Most security
  rules live **in the database** (`supabase/migrations/`), not in the React code.
- **@react-pdf/renderer**: draws the report PDF (`components/ReportPDF.tsx`).
- The report *format* (sections and fields) is data, editable by admins in the browser; see `lib/template.ts`.

## 1. Install the tools

| Tool | Version | How |
|---|---|---|
| Git | any recent | <https://git-scm.com/downloads> |
| Node.js | **22 LTS** (20.9+ works) | <https://nodejs.org> (Windows/macOS installer) or `nvm install 22` |
| pnpm | 10 (pinned in `package.json`) | run `corepack enable` once after installing Node |
| VS Code | recommended | extensions: *ESLint*, *Tailwind CSS IntelliSense*, *PostgreSQL* (optional) |
| Docker Desktop | optional | only needed for the Docker build, local Supabase, or the database tests |

Check your setup:

```bash
node --version
```

```bash
corepack enable && pnpm --version
```

> **Windows:** use *Git Bash* or WSL for the commands in this guide. PowerShell works for everything except the
> `.sh` scripts.

## 2. Get the code

```bash
git clone <repository URL> deptdocs
```

```bash
cd deptdocs
```

```bash
pnpm install
```

Never commit to `main` directly. Create a branch per task (see §7).

## 3. Get a Supabase database for development

**Never develop against the department's real (production) Supabase project.** Use your own.

### Option A (recommended): your own free Supabase cloud project

1. Sign up at <https://supabase.com> and create a project, e.g. `deptdocs-dev-<yourname>`. Note the database
   password.
2. **Apply the schema**: in the dashboard open **SQL Editor** and run every file in `supabase/migrations/`,
   **one by one in name order** (copy the file contents, paste, *Run*). You should see "Success" each time.
   (Or with the CLI: `npx supabase init` once, then `npx supabase link --project-ref <ref>` and `npx supabase db push`.)
3. **Authentication → URL Configuration**: Site URL `http://localhost:3000`; add
   `http://localhost:3000/auth/callback` to *Redirect URLs*.
4. Optional, saves time: **Authentication → Providers → Email**: turn off *Confirm email*, so new test
   accounts don't need email confirmation.
5. **Project Settings → API**: copy the *Project URL*, the `anon` key and the `service_role` key for the next
   step.

### Option B: Supabase on your laptop (needs Docker)

```bash
npx supabase init        # once; creates supabase/config.toml (answer "no" to the VS Code prompts)
```

```bash
npx supabase start       # first start downloads images and takes a few minutes
```

It applies `supabase/migrations/` automatically and prints the *API URL*, *anon key* and *service_role key*.
It also gives you Studio (database UI) at <http://localhost:54323> and a fake inbox for auth emails at
<http://localhost:54324>. Stop it with `npx supabase stop`.

## 4. Configure the app

```bash
cp .env.example .env
```

Open `.env` and fill in at least:

```bash
NEXT_PUBLIC_SUPABASE_URL=...        # from step 3
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # secret: never share it or put it in client code
SITE_URL=http://localhost:3000
```

Everything else is optional for development:

- `GOOGLE_GEMINI_API_KEY`: get a free key at <https://aistudio.google.com/apikey> to try the AI Assistant.
- `SMTP_*`: leave empty; notifications then appear only in the app's bell.
- `GOOGLE_DRIVE_*`: leave empty; "Approve & Push" then explains that Drive isn't configured.

`.env` is git-ignored. **Never commit it.**

## 5. Run it

```bash
pnpm dev
```

Open <http://localhost:3000>.

1. **Sign up.** Sign-ups are limited to `christuniversity.in` addresses by default. To use another email in
   your dev project, allow it in the SQL Editor:
   ```sql
   insert into public.signup_allowlist (entry) values ('you@gmail.com');
   ```
2. Confirm the email (or turn confirmation off, step 3.4), log in, and finish **onboarding**: name plus a
   signature image (any PNG works).
3. **Make yourself admin** (SQL Editor):
   ```sql
   update public.profiles set role = 'admin' where email = 'you@christuniversity.in';
   ```
   Reload. The *Admin* dashboard is at <http://localhost:3000/admin>.
4. Try the main flow: create a report → fill a few sections → submit → as admin, *Request revision* → fix →
   submit → approve (needs Drive settings).

Tip: create a second account in a private browser window to test collaborators and the faculty view.

## 6. Checks to run before every push

```bash
pnpm lint          # ESLint
```

```bash
pnpm typecheck     # TypeScript
```

```bash
pnpm test          # unit tests (Vitest), about 5 seconds
```

```bash
pnpm build         # production build (catches some errors dev mode doesn't)
```

If you changed anything in `supabase/`, also run the **database tests**. They apply all migrations to a throwaway
Postgres and check the security rules. With Docker:

```bash
docker run -d --name deptdocs-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:16
```

```bash
PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres ./supabase/tests/run.sh
```

It must end with `All migration/RLS tests passed.` (it needs `psql`: on macOS `brew install libpq`, on Ubuntu
`sudo apt install postgresql-client`). GitHub runs all of these automatically on every push and pull request.
A red ❌ on your PR means something failed, so click it to see the log.

To check the Docker image: `docker compose up -d --build`, then open <http://localhost:3000>
(`docker compose down` to stop).

## 7. How to contribute

1. Pick or get assigned an issue. Create a branch: `git switch -c feature/short-description` (or `fix/...`).
2. Make small commits with clear messages ("Add totals row to budget table", not "changes").
3. Run the checks from §6.
4. Push and open a **pull request** into `main`. Describe *what* changed, *why*, and *how you tested it*;
   add screenshots for UI changes.
5. Another person reviews it. Fix the comments, then merge once CI is green.

## 8. Where to change what

| I want to… | Look at |
|---|---|
| Change the report format (sections/fields/labels) | Usually **no code**: Admin → Report Format in the app. The built-in default lives in `lib/template.ts` (`DEFAULT_TEMPLATE`) |
| Add a new *kind* of field | `lib/template.ts` (types + validation), `components/template/` (form input), `components/ReportPDF.tsx` (PDF), `lib/aiFill.ts` (AI), `components/template/TemplateEditor.tsx` (admin options), tests in `tests/` |
| Change how the PDF looks | `components/ReportPDF.tsx` (`styles` at the top) |
| Change a page | `app/<route>/page.tsx` (e.g. `app/home/new/page.tsx` is the report editor) |
| Add a server API | `app/api/<name>/route.ts`, start with `getAuthContext()` from `lib/auth.ts` and check permissions |
| Change who can see/do what | a **new** file in `supabase/migrations/` + tests in `supabase/tests/rls_test.sql` |
| Change notifications/emails | triggers in `supabase/migrations/*notifications*`, email text in `lib/email.ts` |
| File uploads / images | `lib/files.ts` (upload), `lib/storage.ts` (`sb://` references and signed URLs) |
| AI Assistant | `components/AiAssistant.tsx` (UI), `app/api/ai/extract/route.ts` + `lib/aiFill.ts` (server) |
| Admin dashboard | `app/admin/page.tsx`, `components/admin/` |

## 9. Rules that keep the app safe (please read)

1. **Security is enforced in the database.** Hiding a button is not security. If users must not do something,
   there must be a row level security policy or trigger that blocks it, plus a test in `supabase/tests/rls_test.sql`.
2. **Every new table** gets `enable row level security` and explicit policies in a migration.
3. **Never edit a migration that has already been applied** to the real project. Add a new file with a later
   timestamp, e.g. `supabase/migrations/20270115000000_add_event_categories.sql`.
4. **The service role key bypasses all security.** It may only be used in server code (`utils/supabase/admin.ts`,
   API routes), never in files with `"use client"` and never in a `NEXT_PUBLIC_*` variable.
5. **API routes must check who is calling** (`getAuthContext()`, and `isAdmin` for admin actions) and validate
   their input.
6. **Files are private.** Store `sb://bucket/path` references (see `lib/storage.ts`), never public URLs.
7. **No secrets in git.** `.env` stays local. If you leak a key, tell the maintainer so it can be rotated.
8. **Data from users and from the AI is untrusted.** Validate it (see `validateTemplate`, `sanitizeAiValues`).

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm: command not found` | run `corepack enable`, then open a new terminal |
| "Supabase is not configured" error | `.env` is missing or `NEXT_PUBLIC_*` values are empty; restart `pnpm dev` after editing `.env` |
| Sign-up says "restricted to Christ University addresses" | add your address to `signup_allowlist` (§5.1) |
| Always redirected to `/onboarding` | finish onboarding: name **and** signature are required |
| `/admin` sends you back to `/home` | your profile is not admin (§5.3); reload after the SQL update |
| Images/signatures don't show | migrations not applied to your project (storage policies), or the file belongs to someone else's report |
| "relation … does not exist" errors | a migration was skipped; run the missing files from `supabase/migrations/` in order |
| AI Assistant: "not configured" | set `GOOGLE_GEMINI_API_KEY` in `.env` and restart |
| Port 3000 in use | `pnpm dev -p 3001` (and use that port in the Supabase redirect URL and `SITE_URL`) |
| Weird build errors after pulling | `pnpm install` (dependencies changed), then delete the `.next` folder |

Still stuck? Write down what you did, what you expected and the exact error message (screenshot of the browser
console / terminal), and ask the maintainer.

# DeptDocs 📄

DeptDocs is the activity-report portal of the **Department of AI & Data Science, CHRIST (Deemed to be University)**.
Faculty fill in a guided form, see the official PDF update live, and submit it for review. Admins review,
request changes or approve. Approved reports are rendered on the server and archived in Google Drive.

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript |
| Backend | Supabase: Postgres + row level security, Auth, Storage, Realtime |
| PDF | `@react-pdf/renderer` (same template for the live preview and the archived file) |
| Integrations | Google Drive (service account), Gemini (optional AI auto-fill) |
| Packaging | Docker image (`Dockerfile`) + Docker Compose |

## Highlights

- **Configurable report format**: admins edit sections, fields (including tables) and the PDF layout in
  the browser (Admin → Report Format), versioned, with a live preview. No code change or rebuild needed.
- **AI Assistant**: type or dictate what happened, attach the documents, and the AI fills the report.
- Live PDF preview, collaborators (viewer/editor), submit → review → revise/approve → Google Drive archive.
- Email + in-app notifications, autosave, admin user management (roles, deactivation, sign-up allow-list).
- Database-enforced permissions (row level security), private file storage with signed links.

## Documentation

| Document | For |
|---|---|
| **[docs/STUDENT_SETUP.md](docs/STUDENT_SETUP.md)** | **Students / new developers**: set up your laptop, run the app, contribute |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying and running DeptDocs for the department |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Current status, what to verify, known limitations, next work |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is organised |

## Quick start with Docker (recommended)

You need Docker and a Supabase project.

```bash
git clone <this repository> deptdocs && cd deptdocs
```

```bash
cp .env.example .env    # then fill in the values
```

```bash
docker compose up -d --build
```

Open <http://localhost:3000>. Before the first start, apply the database migration. See
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**, the step-by-step handoff guide (Supabase setup,
admins, Google Drive, upgrades, backups).

## Local development

Full walkthrough: [docs/STUDENT_SETUP.md](docs/STUDENT_SETUP.md). In short:

```bash
corepack enable && pnpm install
```

```bash
cp .env.example .env    # Next.js reads the same file
```

```bash
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Development server on port 3000 |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | ESLint, TypeScript, unit tests (Vitest) |
| `pnpm build` && `pnpm start` | Production build |
| `./supabase/tests/run.sh` | Applies the migrations to a throwaway Postgres and tests every access rule (needs `psql` + `PGHOST`/`PGUSER`) |

CI (`.github/workflows/ci.yml`) runs all of the above plus the Docker build on every push.

## Where things are

- `app/`: pages and API routes (`api/drive/approve`, `api/ai/extract`, `api/health`)
- `components/`: report editor, form sections, PDF template (`ReportPDF.tsx`)
- `lib/`: report data model, storage references, uploads, auth helpers
- `supabase/migrations/`: **the database schema and all security rules**
- `docs/`: deployment / handoff guide
- `ARCHITECTURE.md`: how the pieces fit together

## Roles

- **Faculty**: create reports, invite collaborators (Viewer or Editor), submit for review.
- **Admin**: sees every report, requests revisions, approves (renders the PDF and archives it in Drive), assigns
  reports to faculty. Admins are set in the database (`profiles.role = 'admin'`), see the deployment guide.

---
Built for CHRIST (Deemed to be University).

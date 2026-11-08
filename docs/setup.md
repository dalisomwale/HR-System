# Local Development Setup

## Requirements

- Node.js 20.11 or later (developed on Node 22)
- MySQL 8.0.16 or later (CHECK constraints are enforced from 8.0.16)

## 1. Databases

Development and tests use separate databases and separate MySQL accounts. The test database name must end in `_test`; the application refuses any other combination.

```sql
CREATE DATABASE hr_system  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE hr_system_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'hr_system'@'localhost'  IDENTIFIED BY '<choose a password>';
CREATE USER 'hr_system_test'@'localhost' IDENTIFIED BY '<choose a password>';
GRANT ALL ON hr_system.*  TO 'hr_system'@'localhost';
GRANT ALL ON hr_system_test.* TO 'hr_system_test'@'localhost';
```

### MariaDB (for example XAMPP on Windows)

MariaDB 10.11 also works: every migration and test passes on it. Use `utf8mb4_unicode_ci` in place of `utf8mb4_0900_ai_ci` (MariaDB does not have it) and `SET GLOBAL` in place of `SET PERSIST`. MariaDB older than 10.6 is not supported.

### Ubuntu: do not connect the app as root

On Ubuntu, MySQL's `root` account usually authenticates through the operating system socket (`sudo mysql`). That works in a terminal but the application, which connects over TCP with a password, is refused with `Access denied for user 'root'@'localhost'`. Use the dedicated account above instead, and set `DB_HOST=127.0.0.1` in `.env` and `.env.test`.

Check the account before running migrations:

```bash
mysql -u hr_system -p -h 127.0.0.1 -e "SELECT 1"
```

### Trigger permission

Migration `006` creates triggers that make the balance ledger, audit log and approval history append-only. With binary logging on (the MySQL 8 default), creating triggers needs either:

- the server setting `log_bin_trust_function_creators = 1` (run once as an administrator: `SET PERSIST log_bin_trust_function_creators = 1;`), or
- running migrations with an account that has the `SUPER` privilege, set through `MIGRATION_DB_USER` and `MIGRATION_DB_PASSWORD`.

The migration stops with an explanatory message if neither is in place.

## 2. Environment files

```bash
cp .env.example .env        # development
cp .env.example .env.test   # tests
```

Fill in at least: `NODE_ENV`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `APP_BASE_URL` (`http://localhost:4000`), `CLIENT_ORIGIN` (`http://localhost:5173`) and `SESSION_SECRET` (`openssl rand -hex 32`). In `.env.test` set `NODE_ENV=test` and point at the `_test` database; it needs no session secret or Microsoft settings.

Supporting documents are stored in `storage/documents` inside the project when `DOCUMENT_STORAGE_DIR` is empty (that folder is not in git). In production set `DOCUMENT_STORAGE_DIR` to a private folder outside the web root that is included in backups.

Microsoft sign-in is the only way in, so `.env` also needs the four `ENTRA_` values. [`entra-setup.md`](entra-setup.md) explains how to get them. Until they are set the system runs, but the sign-in page says sign-in is not available.

## 3. Install and migrate

```bash
npm install
npm run migrate
```

Migrations create the schema and required configuration only: two roles (HR Officer, System Administrator), system settings with documented defaults, and the company default working week (Monday to Friday). They create no companies, employees, departments, leave types, holidays or balances.

## 4. First administrator

The first System Administrator is created from the command line. The command runs only while no System Administrator exists; all later role grants happen inside the application and are audited.

You need the person's Entra **object ID** (Entra admin centre → Users → the user → Object ID).

```bash
npm run bootstrap:admin -- \
  --oid <entra-object-id> \
  --email <work email> \
  --employee-number <employee number> \
  --first-name <first name> \
  --last-name <last name> \
  --start-date <YYYY-MM-DD> \
  --job-title "<job title>"
```

The identity is linked to the tenant in `ENTRA_TENANT_ID`.

## 5. Run

```bash
npm run dev
```

This starts the API on port 4000 and the web app on port 5173. Open **http://localhost:5173** and select **Sign in with Microsoft**. Always use port 5173: it forwards `/api` to the API so the browser sees one address, which sign-in relies on.

The API refuses to start if the configuration is invalid or migrations are pending. To run the two halves in separate terminals: `npm run dev --workspace server` and `npm run dev --workspace client`.

After a `git pull`, run `npm install` and `npm run migrate` before `npm run dev`.

## 6. Tests

```bash
npm test
```

The test runner rolls back and re-applies all migrations on the `_test` database, then runs the suite. Test fixtures are created inside the test database and cleared before each test.

## 7. Lint and format

```bash
npm run lint
npm run format:check
```

## Publishing a Windows server through Cloudflare Tunnel

Used for `https://hrdesktop.online` (D81). The system runs as the production build on the server and listens only on `127.0.0.1:4000`; Cloudflare's `cloudflared` service carries traffic from the domain to it, so no router port needs opening and Cloudflare provides the certificate.

1. In Cloudflare: Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared), choose Windows, and run the install command it gives on the server (it installs `cloudflared` as a Windows service). Add a public hostname: the domain, service type HTTP, URL `localhost:4000`.
2. Settings, with `npm run set-env` so nothing else in `.env` changes:
   `NODE_ENV=production HOST=127.0.0.1 TRUST_PROXY=1 COOKIE_SECURE=true MAIL_OFF_IN_PRODUCTION=true`, the three URLs on the domain, and `DOCUMENT_STORAGE_DIR` outside the project; remove `DEV_NETWORK_HOST`.
3. Add `https://<domain>/api/auth/callback` to the app registration in Entra.
4. `npm run build`, then `npm start`.

## Requisitions (D105, D106)

The Requisitions module (requisitions and stock, brought in from the Altus inventory system) needs
three things set up by the System Administrator, in Requisitions › Administration:

1. **Requisition departments**: tick the departments that do the IT, Accounts and Stores steps.
   Staff in those departments get those steps; the Department Manager (or line manager) of an
   Accounts department is the Accounts Manager. Directors approve, and the Accounts Director gives
   final approval as CFO.
2. **Branches**: add the branches (stock locations) of each company. Stock is received at and
   issued from a branch.
3. Categories start with the inventory system's seven; Stores can change them under Categories.

### Copying the data from the inventory system

The import reads the inventory database and copies its branches, categories, items, stock,
deliveries, issues, requisitions, files and history. Companies are matched by name, departments by
name within their company, and people by email. Nothing is created in Employee management; a
department or person with no match keeps their name on the records.

On the Windows server, from `C:\Users\Administrator\HR-System`, first a dry run (it changes
nothing and lists what does not match):

```
npm run import-inventory -- --database inventory_system --user root --password "your-root-password" --files "C:\xampp\htdocs\inventory_system\storage\requisitions"
```

If a company is named differently in the two systems, add `--map "Inventory name=HR name"` (once
per company). When the report looks right, run the same command with `--apply` at the end. The
import runs once; running it again is refused.

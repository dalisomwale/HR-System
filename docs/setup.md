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

Microsoft sign-in is the only way in, so `.env` also needs the four `ENTRA_` values. [`entra-setup.md`](entra-setup.md) explains how to get them. Until they are set the system runs, but the sign-in page says sign-in is not available.

## 3. Install and migrate

```bash
npm install
npm run migrate
```

Migrations create the schema and required configuration only: two roles (HR Officer, HR Administrator), system settings with documented defaults, and the company default working week (Monday to Friday). They create no employees, departments, leave types, holidays or balances.

## 4. First administrator

The first HR Administrator is created from the command line. The command runs only while no HR Administrator exists; all later role grants happen inside the application and are audited.

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

#!/usr/bin/env node
/**
 * Create the first HR Administrator.
 *
 *   npm run bootstrap:admin -- --oid <entra-object-id> --email <email> \
 *     --employee-number <number> --first-name <name> --last-name <name> \
 *     --start-date <YYYY-MM-DD> [--job-title <title>]
 *
 * Runs only while no HR Administrator exists. See docs/setup.md.
 */
import { parseArgs } from 'node:util';
import { getConfig } from '../src/config/env.js';
import { getDb, closeDb } from '../src/db/index.js';
import { bootstrapAdmin, BootstrapError } from '../src/modules/setup/bootstrap-admin.service.js';

const { values } = parseArgs({
  options: {
    oid: { type: 'string' },
    email: { type: 'string' },
    'employee-number': { type: 'string' },
    'first-name': { type: 'string' },
    'last-name': { type: 'string' },
    'job-title': { type: 'string' },
    'start-date': { type: 'string' },
  },
  strict: true,
});

let exitCode = 0;
try {
  const config = getConfig();
  const { employeeId } = await bootstrapAdmin(
    getDb(),
    {
      oid: values.oid,
      email: values.email,
      employeeNumber: values['employee-number'],
      firstName: values['first-name'],
      lastName: values['last-name'],
      jobTitle: values['job-title'],
      startDate: values['start-date'],
    },
    { tenantId: config.entra.tenantId },
  );
  console.log(`HR Administrator created (employee id ${employeeId}). They can now sign in with Microsoft.`);
} catch (err) {
  exitCode = 1;
  if (err instanceof BootstrapError) console.error(`Bootstrap refused: ${err.message}`);
  else console.error(err);
} finally {
  await closeDb();
}
process.exit(exitCode);

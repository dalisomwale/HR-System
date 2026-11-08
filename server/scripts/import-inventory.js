#!/usr/bin/env node
/**
 * Copy the Altus inventory system's data into the Requisitions module (D106).
 *
 *   npm run import-inventory -- --database inventory_system --user root --password "..." \
 *     [--host 127.0.0.1] [--port 3306] [--files "C:\xampp\htdocs\inventory_system\storage\requisitions"] \
 *     [--map "Inventory company name=HR company name"] [--apply]
 *
 * Without --apply it is a dry run: it reads both databases and reports how companies,
 * departments and people line up, and changes nothing. See docs/setup.md.
 */
import { parseArgs } from 'node:util';
import knex from 'knex';
import { getConfig } from '../src/config/env.js';
import { getDb, closeDb } from '../src/db/index.js';
import { planImport, runImport } from '../src/modules/requisitions/inventory-import.js';
import { requisitionFilesDir } from '../src/modules/requisitions/files.js';

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string' },
    user: { type: 'string' },
    password: { type: 'string' },
    database: { type: 'string', default: 'inventory_system' },
    files: { type: 'string' },
    map: { type: 'string', multiple: true, default: [] },
    apply: { type: 'boolean', default: false },
  },
  strict: true,
});

const list = (title, items) => {
  if (!items.length) return;
  console.log(`\n${title} (${items.length}):`);
  for (const i of items.slice(0, 50)) console.log(`  - ${i}`);
  if (items.length > 50) console.log(`  ... and ${items.length - 50} more`);
};

let exitCode = 0;
let src;
try {
  const config = getConfig({ forTool: true });
  src = knex({
    client: 'mysql2',
    connection: {
      host: values.host ?? config.db.host,
      port: Number(values.port ?? config.db.port ?? 3306),
      user: values.user ?? config.db.user,
      password: values.password ?? config.db.password,
      database: values.database,
      dateStrings: false,
    },
    pool: { min: 0, max: 2 },
  });
  const maps = Object.fromEntries(
    values.map.map((m) => {
      const i = m.indexOf('=');
      if (i < 1) throw new Error(`--map needs "Inventory name=HR name", got "${m}"`);
      return [m.slice(0, i).trim(), m.slice(i + 1).trim()];
    }),
  );
  const db = getDb();
  const options = { maps, filesFrom: values.files ?? null, filesTo: requisitionFilesDir(config) };
  const report = values.apply
    ? await runImport(db, src, options)
    : (await planImport(db, src, options)).report;

  console.log(values.apply ? 'Inventory data imported.' : 'Dry run: nothing has been changed.');
  console.log('\nIn the inventory database:');
  for (const [k, v] of Object.entries(report.counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\nCompanies matched: ${report.companiesMatched.join(', ') || 'none'}`);
  list('Companies with no match in the HR system', report.unmatchedCompanies);
  list('Departments with no match (their name is kept on the records)', report.unmatchedDepartments);
  list(
    'People with no HR employee of the same email (their name is kept on the records)',
    report.unmatchedPeople,
  );
  list('Files not found in the --files folder', report.missingFiles);
  list('Notes', report.warnings);
  if (values.apply) console.log(`\nFiles copied: ${report.filesCopied ?? 0}`);
  if (report.blockingCompanies.length) {
    console.log(
      `\nCannot import yet: ${report.blockingCompanies.join(', ')} ha${report.blockingCompanies.length === 1 ? 's' : 've'} no match. Add ${report.blockingCompanies.length === 1 ? 'it' : 'them'} in Employee management, or use --map "Inventory name=HR name".`,
    );
    exitCode = values.apply ? 1 : 0;
  } else if (!values.apply) {
    console.log('\nRun again with --apply to import.');
  }
} catch (err) {
  console.error(`Import failed: ${err.message}`);
  exitCode = 1;
} finally {
  await src?.destroy();
  await closeDb();
}
process.exit(exitCode);

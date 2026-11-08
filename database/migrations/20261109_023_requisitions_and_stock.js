/**
 * Project owner, 9 Nov 2026 (D105): the Requisitions module, brought in from the Altus inventory
 * system (dalisomwale/inventory_system). Stock lives at branches (stock locations) under each
 * company; departments are the HR system's own. The people in each step are the HR system's
 * employees, by role or by the departments chosen for IT, Accounts and Stores.
 *
 * Imported rows keep the original inventory id in legacy_id, and the name of a person or place
 * that had no match in the HR system in a *_name column, so nothing from the old records is lost.
 */
export async function up(knex) {
  // Which departments do the IT, Accounts and Stores steps (set by the System Administrator).
  await knex.schema.createTable('requisition_departments', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('department_id').unsigned().notNullable().references('id').inTable('departments');
    t.enu('function_code', ['IT', 'ACCOUNTS', 'STORES']).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['department_id', 'function_code']);
  });

  await knex.schema.createTable('stock_branches', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('company_id').unsigned().notNullable().references('id').inTable('companies');
    t.string('name', 150).notNullable();
    t.string('location', 200).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('legacy_id').unsigned().nullable();
    t.timestamps(true, true);
    t.unique(['company_id', 'name']);
  });

  await knex.schema.createTable('stock_categories', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable().unique();
    t.string('description', 255).nullable();
    t.integer('legacy_id').unsigned().nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('stock_items', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('category_id').unsigned().notNullable().references('id').inTable('stock_categories');
    t.string('name', 200).notNullable();
    t.string('description', 500).nullable();
    t.integer('quantity').notNullable().defaultTo(0); // total across branches
    t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
    t.integer('reorder_level').unsigned().notNullable().defaultTo(10);
    t.integer('legacy_id').unsigned().nullable();
    t.timestamps(true, true);
    t.unique(['category_id', 'name']);
  });

  await knex.schema.createTable('branch_stock', (t) => {
    t.integer('item_id').unsigned().notNullable().references('id').inTable('stock_items').onDelete('CASCADE');
    t.integer('branch_id').unsigned().notNullable().references('id').inTable('stock_branches');
    t.integer('quantity').notNullable().defaultTo(0);
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['item_id', 'branch_id']);
  });

  await knex.schema.createTable('stock_receipts', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('item_id').unsigned().notNullable().references('id').inTable('stock_items');
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.string('supplier', 200).nullable();
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
    t.date('date_received').notNullable();
    t.integer('received_by').unsigned().nullable().references('id').inTable('employees');
    t.string('received_by_name', 150).nullable();
    t.integer('requisition_id').unsigned().nullable();
    t.integer('old_stock').nullable();
    t.integer('new_stock').nullable();
    t.integer('legacy_id').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['item_id', 'created_at']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('stock_issues', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('item_id').unsigned().notNullable().references('id').inTable('stock_items');
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.integer('department_id').unsigned().nullable().references('id').inTable('departments');
    t.string('issued_to', 200).nullable(); // department label at the time, or old free text
    t.string('recipient', 150).nullable();
    t.string('purpose', 255).nullable();
    t.integer('quantity').notNullable();
    t.date('date_issued').notNullable();
    t.integer('issued_by').unsigned().nullable().references('id').inTable('employees');
    t.string('issued_by_name', 150).nullable();
    t.integer('old_stock').nullable();
    t.integer('new_stock').nullable();
    t.integer('legacy_id').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['item_id', 'created_at']);
    t.index(['department_id', 'created_at']);
    t.index(['created_at']);
  });

  await knex.schema.createTable('requisitions', (t) => {
    t.increments('id').unsigned().primary();
    t.string('item_name', 200).notNullable();
    t.integer('item_id').unsigned().nullable().references('id').inTable('stock_items').onDelete('SET NULL');
    t.integer('category_id').unsigned().nullable().references('id').inTable('stock_categories');
    t.integer('quantity').unsigned().notNullable();
    t.text('reason').nullable();
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies');
    t.integer('branch_id').unsigned().nullable().references('id').inTable('stock_branches');
    t.integer('department_id').unsigned().nullable().references('id').inTable('departments');
    t.string('department_name', 150).nullable(); // imported, with no HR department to match
    t.boolean('is_it').notNullable().defaultTo(false);
    t.string('status', 20).notNullable();
    t.integer('quote_id').unsigned().nullable();
    t.string('supplier', 200).nullable();
    t.text('last_note').nullable();
    t.dateTime('stage_at').notNullable();
    t.dateTime('director_at').nullable();
    t.dateTime('paid_at').nullable();
    t.dateTime('received_at').nullable();
    t.integer('requested_by').unsigned().nullable().references('id').inTable('employees');
    t.string('requested_by_name', 150).nullable();
    t.integer('approved_by').unsigned().nullable().references('id').inTable('employees');
    t.integer('legacy_id').unsigned().nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
    t.index(['company_id', 'status']);
    t.index(['department_id']);
  });

  await knex.schema.createTable('requisition_files', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('requisition_id').unsigned().notNullable().references('id').inTable('requisitions').onDelete('CASCADE');
    t.enu('kind', ['DOC', 'QUOTE', 'POP']).notNullable();
    t.string('supplier', 200).nullable();
    t.decimal('amount', 15, 2).nullable();
    t.string('original_name', 255).notNullable();
    t.string('stored_name', 80).notNullable();
    t.string('mime_type', 120).notNullable();
    t.integer('size_bytes').unsigned().notNullable();
    t.integer('uploaded_by').unsigned().nullable().references('id').inTable('employees');
    t.string('uploaded_by_name', 150).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['requisition_id', 'kind']);
  });

  await knex.schema.createTable('requisition_events', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('requisition_id').unsigned().notNullable().references('id').inTable('requisitions').onDelete('CASCADE');
    t.integer('actor_id').unsigned().nullable().references('id').inTable('employees');
    t.string('actor_name', 150).nullable();
    t.string('action', 40).notNullable();
    t.string('from_status', 20).nullable();
    t.string('to_status', 20).nullable();
    t.text('note').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['requisition_id', 'created_at']);
  });

  // Starting categories, as in the inventory system (edit them on Categories).
  await knex('stock_categories').insert([
    { name: 'IT Equipment', description: 'Laptops, desktops, monitors, peripherals' },
    { name: 'Networking', description: 'Switches, routers, cables, access points' },
    { name: 'Printer Consumables', description: 'Toner, ink cartridges, drums' },
    { name: 'Stationery', description: 'Paper, pens, files, office supplies' },
    { name: 'Furniture', description: 'Desks, chairs, cabinets' },
    { name: 'Kitchen & Cleaning', description: 'Tea, coffee, sugar, cleaning supplies' },
    { name: 'Other', description: 'Miscellaneous items not fitting other categories' },
  ]);
}

export async function down(knex) {
  for (const t of [
    'requisition_events',
    'requisition_files',
    'requisitions',
    'stock_issues',
    'stock_receipts',
    'branch_stock',
    'stock_items',
    'stock_categories',
    'stock_branches',
    'requisition_departments',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
}

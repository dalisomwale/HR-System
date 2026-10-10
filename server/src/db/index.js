import knex from 'knex';
import { getConfig } from '../config/env.js';
import { knexConfigFrom } from './knex-config.js';

let instance;

/** Shared Knex instance for the running process. */
export function getDb() {
  if (!instance) instance = knex(knexConfigFrom(getConfig()));
  return instance;
}

export async function closeDb() {
  if (instance) {
    await instance.destroy();
    instance = undefined;
  }
}

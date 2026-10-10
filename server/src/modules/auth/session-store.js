import session from 'express-session';

/**
 * express-session store backed by the `sessions` table, using the app's own Knex connection.
 * Each row records the owning employee so their sessions can be revoked at once.
 */
export class KnexSessionStore extends session.Store {
  constructor(db, { pruneIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    if (pruneIntervalMs > 0) {
      this.pruneTimer = setInterval(() => {
        this.prune().catch(() => {});
      }, pruneIntervalMs);
      this.pruneTimer.unref();
    }
  }

  static expiresFor(sess) {
    const ms = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000;
    return Math.floor(ms / 1000);
  }

  get(sid, cb) {
    this.db('sessions')
      .where({ session_id: sid })
      .first()
      .then((row) => {
        if (!row || row.expires < Math.floor(Date.now() / 1000)) return cb(null, null);
        try {
          cb(null, JSON.parse(row.data));
        } catch (err) {
          cb(err);
        }
      })
      .catch(cb);
  }

  set(sid, sess, cb) {
    const row = {
      session_id: sid,
      employee_id: sess.employeeId ?? null,
      expires: KnexSessionStore.expiresFor(sess),
      data: JSON.stringify(sess),
    };
    this.db('sessions')
      .insert(row)
      .onConflict('session_id')
      .merge(['employee_id', 'expires', 'data'])
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  touch(sid, sess, cb) {
    this.db('sessions')
      .where({ session_id: sid })
      .update({ expires: KnexSessionStore.expiresFor(sess) })
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  destroy(sid, cb) {
    this.db('sessions')
      .where({ session_id: sid })
      .del()
      .then(() => cb?.(null))
      .catch((err) => cb?.(err));
  }

  prune() {
    return this.db('sessions')
      .where('expires', '<', Math.floor(Date.now() / 1000))
      .del();
  }

  close() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}

/** Sign out every session belonging to an employee (deactivation, identity unlinked). */
export async function revokeEmployeeSessions(trx, employeeId) {
  return trx('sessions').where({ employee_id: employeeId }).del();
}

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getAppConfig } from '../config.js';
import { SCHEMA_STATEMENTS } from './schema.sql.js';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface DbClient extends DbExecutor {
  engine: 'postgres' | 'pglite';
  withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface PGliteQueryRes {
  rows: unknown[];
  affectedRows?: number;
}

interface PGliteTxLike {
  query(sql: string, params?: unknown[]): Promise<PGliteQueryRes>;
}

interface PGliteInstance extends PGliteTxLike {
  transaction<T>(fn: (tx: PGliteTxLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createDbClient(options?: {
  databaseUrl?: string;
  pgliteDataDir?: string;
  runMigrations?: boolean;
}): Promise<DbClient> {
  const cfg = getAppConfig();
  const databaseUrl = options?.databaseUrl ?? cfg.databaseUrl;
  const pgliteDataDir = options?.pgliteDataDir ?? cfg.pgliteDataDir;
  const shouldMigrate = options?.runMigrations ?? true;

  let db: DbClient;

  if (databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl)) {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err);
    });

    // 验证连通性
    const probe = await pool.connect();
    probe.release();

    db = {
      engine: 'postgres',
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
        const res = await pool.query(sql, params);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? res.rows.length,
        };
      },
      async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx: DbExecutor = {
            async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
              const res = await client.query(sql, params);
              return {
                rows: res.rows as R[],
                rowCount: res.rowCount ?? res.rows.length,
              };
            },
          };
          const out = await fn(tx);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };
  } else {
    const pgliteModuleName = '@electric-sql/pglite';
    const { PGlite } = (await import(pgliteModuleName)) as {
      PGlite: new (dir?: string) => PGliteInstance;
    };
    let pglite: PGliteInstance;
    if (pgliteDataDir === ':memory:') {
      pglite = new PGlite();
    } else {
      const resolvedDir = path.resolve(process.cwd(), pgliteDataDir);
      fs.mkdirSync(resolvedDir, { recursive: true });
      pglite = new PGlite(resolvedDir);
    }

    db = {
      engine: 'pglite',
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
        const res = await pglite.query(sql, params);
        return {
          rows: res.rows as T[],
          rowCount: res.affectedRows ?? res.rows.length,
        };
      },
      async withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
        return pglite.transaction(async (pgTx: PGliteTxLike) => {
          const tx: DbExecutor = {
            async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
              const res = await pgTx.query(sql, params);
              return {
                rows: res.rows as R[],
                rowCount: res.affectedRows ?? res.rows.length,
              };
            },
          };
          return fn(tx);
        });
      },
      async close(): Promise<void> {
        await pglite.close();
      },
    };
  }

  if (shouldMigrate) {
    for (const stmt of SCHEMA_STATEMENTS) {
      await db.query(stmt);
    }
  }

  return db;
}

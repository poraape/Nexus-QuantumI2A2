import { Pool, PoolConfig, PoolClient } from 'pg';

export interface PostgresConfig extends PoolConfig {
    connectionString?: string;
}

class PostgresClient {
    private pool: Pool;

    constructor(config: PostgresConfig = {}) {
        const { connectionString, ...rest } = config;
        this.pool = new Pool({
            connectionString: connectionString ?? process.env.DATABASE_URL,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            ...rest,
        });
    }

    async getClient(): Promise<PoolClient> {
        return this.pool.connect();
    }

    async query<T = any>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
        return this.pool.query<T>(sql, params);
    }

    async migrate(): Promise<void> {
        await this.query(`
            CREATE TABLE IF NOT EXISTS integration_runs (
                id UUID PRIMARY KEY,
                erp VARCHAR(50) NOT NULL,
                action VARCHAR(30) NOT NULL,
                status VARCHAR(20) NOT NULL,
                message TEXT,
                payload JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS integration_state (
                erp VARCHAR(50) PRIMARY KEY,
                last_run_at TIMESTAMPTZ,
                last_success_at TIMESTAMPTZ,
                last_error TEXT,
                pending_jobs INTEGER NOT NULL DEFAULT 0,
                last_payload JSONB,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
    }
}

export const postgresClient = new PostgresClient();

export const bootstrapPostgres = async () => {
    try {
        await postgresClient.migrate();
    } catch (error) {
        console.error('[PostgresClient] Failed to run migrations', error);
        throw error;
    }
};


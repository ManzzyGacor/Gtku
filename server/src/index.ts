/**
 * Start the API: read server/.env, connect to MongoDB, listen on 127.0.0.1:3000.
 *
 * Only the Cloudflare Tunnel reaches it (api.varesa.mom → 127.0.0.1:3000); nothing listens on a
 * public interface. Configuration errors and connection failures are reported by *name* — the
 * value of MONGODB_URI never reaches the terminal or the log.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ConfigError, loadConfig, redact } from './config';
import { connectMongo } from './repo.mongo';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`[lentera-malam] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  let db;
  try {
    db = await connectMongo(config.mongoUri, config.mongoDb);
  } catch (e) {
    const err = e as { name?: string; code?: string | number };
    // the driver's message can quote hosts; only the error's kind is printed, never the URI
    console.error(`[lentera-malam] Tidak bisa terhubung ke MongoDB (${err.name ?? 'Error'}${err.code ? ` ${err.code}` : ''}). Periksa MONGODB_URI di server/.env dan akses jaringan database.`);
    process.exit(1);
  }

  const app = await buildApp({ config, repos: db.repos, logger: true });
  const stop = async (): Promise<void> => {
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  await app.listen({ host: config.host, port: config.port });
}

main().catch((e: unknown) => {
  console.error(`[lentera-malam] Gagal memulai: ${redact(String((e as Error)?.message ?? e), [process.env.MONGODB_URI ?? ''])}`);
  process.exit(1);
});

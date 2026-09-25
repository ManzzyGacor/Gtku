/**
 * Give an account a role, from the VPS: `npm run set-role -- manzzy dev`.
 *
 * The safe way to make the developer account: register "manzzy"… is blocked over the API unless
 * DEV_SETUP_CODE is set, so the usual path is to register it with the code, or to register first
 * and promote here. Running this needs shell access to the server — which is the point.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config';
import { connectMongo } from '../src/repo.mongo';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [name, role] = process.argv.slice(2);
if (!name || (role !== 'dev' && role !== 'player')) {
  console.error('Pakai: npm run set-role -- <nama-akun> <dev|player>');
  process.exit(1);
}
const config = loadConfig(process.env);
const db = await connectMongo(config.mongoUri, config.mongoDb).catch(() => {
  console.error('Tidak bisa terhubung ke MongoDB. Periksa MONGODB_URI di server/.env.');
  process.exit(1);
});
try {
  const ok = await db.repos.users.setRole(name.toLowerCase(), role);
  console.log(ok ? `Peran ${name} sekarang: ${role}` : `Akun ${name} tidak ditemukan.`);
} finally {
  await db.close();
}

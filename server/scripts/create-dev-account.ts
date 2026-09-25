/**
 * Create (or repair) the developer account "manzzy", from the VPS:
 *
 *   npm run create-dev-account
 *
 * The API refuses to register protected names, so this — shell access to the server — is the only
 * way the developer account comes to exist. The password is typed at a hidden prompt: it never
 * appears on screen, in the shell history, or in the process list. If the account already exists,
 * its role is set to "dev" and, if a password is entered, the password is replaced.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';
import { validPassword } from '../../shared/api';
import { DEV_USERNAME, loadConfig } from '../src/config';
import { hashPassword } from '../src/app';
import { connectMongo } from '../src/repo.mongo';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Read a line without echoing it. */
function hidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = '';
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData);
          if (raw) stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const config = loadConfig(process.env);
const password = await hidden(`Kata sandi untuk ${DEV_USERNAME} (tidak ditampilkan): `);
if (!validPassword(password)) {
  console.error('Kata sandi harus 8–128 karakter.');
  process.exit(1);
}
if ((await hidden('Ulangi kata sandi: ')) !== password) {
  console.error('Kedua kata sandi tidak sama.');
  process.exit(1);
}

const db = await connectMongo(config.mongoUri, config.mongoDb).catch(() => {
  console.error('Tidak bisa terhubung ke MongoDB. Periksa MONGODB_URI di server/.env.');
  process.exit(1);
});
try {
  const passwordHash = await hashPassword(password);
  const existing = await db.repos.users.byLower(DEV_USERNAME);
  if (existing) {
    await db.repos.users.setRole(DEV_USERNAME, 'dev');
    await db.repos.users.setPassword(DEV_USERNAME, passwordHash);
    console.log(`Akun ${DEV_USERNAME} sudah ada: peran diatur ke dev dan kata sandi diganti.`);
  } else {
    await db.repos.users.create({ username: DEV_USERNAME, usernameLower: DEV_USERNAME, passwordHash, role: 'dev', createdAt: new Date(), lastLogin: null });
    console.log(`Akun pengembang ${DEV_USERNAME} dibuat.`);
  }
} finally {
  await db.close();
}

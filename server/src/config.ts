/**
 * Server configuration, from the environment only (server/.env on the VPS, never committed).
 *
 * Errors name the *variable*, never its value: a config mistake must not print a connection string
 * into a terminal, a log file or a screenshot.
 */
export interface ServerConfig {
  mongoUri: string;
  mongoDb: string;
  jwtSecret: Uint8Array;
  corsOrigin: string;
  host: string;
  port: number;
  /** Access token lifetime, seconds. */
  accessTtl: number;
  /** Refresh token lifetime, seconds. */
  refreshTtl: number;
  /** Code that allows registering the reserved developer name over the API; '' = not allowed. */
  devSetupCode: string;
  /** Behind Cloudflare Tunnel the socket is always 127.0.0.1; the real client IP is in a header. */
  trustCfHeader: boolean;
  /** Secure cookies (true everywhere but the test suite, which runs over plain inject()). */
  secureCookies: boolean;
}

export class ConfigError extends Error {}

/** The one account allowed developer mode (docs/BACKEND.md "Peran"). */
export const DEV_USERNAME = 'manzzy';

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const need = (name: string): string => {
    const v = env[name];
    if (!v || !v.trim()) throw new ConfigError(`Variabel ${name} belum diisi di server/.env`);
    return v.trim();
  };
  const secret = need('JWT_SECRET');
  if (secret.length < 32) throw new ConfigError('JWT_SECRET terlalu pendek (minimal 32 karakter acak)');
  return {
    mongoUri: need('MONGODB_URI'),
    mongoDb: env.MONGODB_DB?.trim() || 'lentera_malam',
    jwtSecret: new TextEncoder().encode(secret),
    corsOrigin: env.CORS_ORIGIN?.trim() || 'https://game.varesa.mom',
    // loopback only: the tunnel is the one way in
    host: '127.0.0.1',
    port: 3000,
    accessTtl: 15 * 60,
    refreshTtl: 30 * 24 * 60 * 60,
    devSetupCode: env.DEV_SETUP_CODE?.trim() ?? '',
    trustCfHeader: true,
    secureCookies: true,
  };
}

/**
 * Remove anything that looks like a MongoDB connection string (and the configured one, verbatim)
 * from text before it is logged. Driver errors can quote the host list; this makes sure a
 * credential-bearing URI can never end up in a log line even if one does.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(/mongodb(\+srv)?:\/\/[^\s"'<>]+/gi, 'mongodb://[disembunyikan]');
  for (const s of secrets) if (s) out = out.split(s).join('[disembunyikan]');
  return out;
}

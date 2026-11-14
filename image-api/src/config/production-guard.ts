/**
 * The production server must not start with the Dev machine's secrets or without its isolation check.
 * Dev keeps working on the compose defaults; only DEPLOY_ENV=production is held to this.
 * Messages name the variable, never its value.
 */
const SECRETS = ['JWT_SECRET', 'ENCRYPTION_KEY', 'SERVICE_API_KEY', 'MEDIA_WEBHOOK_SECRET'] as const;
const PLACEHOLDER = /change-?me|change-in-production|^dev-|-dev$|example|placeholder/i;
export const MIN_SECRET_LENGTH = 32;

export function productionProblems(env: Record<string, string | undefined>): string[] {
  if (env.DEPLOY_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of SECRETS) {
    const value = env[name] ?? '';
    if (!value) problems.push(`${name} is not set`);
    else if (PLACEHOLDER.test(value)) problems.push(`${name} is still a placeholder or Dev value`);
    else if (value.length < MIN_SECRET_LENGTH) problems.push(`${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  if (new Set(SECRETS.map((n) => env[n]).filter(Boolean)).size < SECRETS.filter((n) => env[n]).length) {
    problems.push(`${SECRETS.join(', ')} must all be different`);
  }
  const dbPassword = (() => { try { return decodeURIComponent(new URL(env.DATABASE_URL ?? '').password); } catch { return ''; } })();
  if (!dbPassword || dbPassword === 'image_pass' || PLACEHOLDER.test(dbPassword)) problems.push('the database password (POSTGRES_PASSWORD) is a default or placeholder');
  if (env.CCTV_ISOLATION_VERIFIED !== 'true') problems.push('CCTV_ISOLATION_VERIFIED is not true (check this server cannot reach legacy production first)');
  if (env.ALLOW_DATA_LOSS === 'true') problems.push('ALLOW_DATA_LOSS must not be true');
  return problems;
}

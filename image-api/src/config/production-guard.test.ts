import { describe, it, expect } from 'vitest';
import { productionProblems } from './production-guard.js';

const strong = (c: string) => c.repeat(40);
const good = {
  DEPLOY_ENV: 'production',
  JWT_SECRET: strong('a'), ENCRYPTION_KEY: strong('b'), SERVICE_API_KEY: strong('c'), MEDIA_WEBHOOK_SECRET: strong('d'),
  DATABASE_URL: 'postgresql://cctv:Zq9%40long-real-pw@postgres:5432/cctv',
  CCTV_ISOLATION_VERIFIED: 'true', ALLOW_DATA_LOSS: 'false',
};

describe('production start-up guard', () => {
  it('leaves Dev alone, even on the compose defaults', () => {
    expect(productionProblems({ JWT_SECRET: 'dev-jwt-secret-change-in-production' })).toEqual([]);
    expect(productionProblems({ ...good, DEPLOY_ENV: 'dev', JWT_SECRET: '' })).toEqual([]);
  });

  it('passes a production set-up with real secrets', () => {
    expect(productionProblems(good)).toEqual([]);
  });

  it('refuses the Dev compose defaults on production', () => {
    const p = productionProblems({
      ...good,
      JWT_SECRET: 'dev-jwt-secret-change-in-production', ENCRYPTION_KEY: 'dev-encryption-key-32chars!!',
      DATABASE_URL: 'postgresql://image_user:image_pass@postgres:5432/image_db',
    });
    expect(p.join('\n')).toMatch(/JWT_SECRET is still a placeholder/);
    expect(p.join('\n')).toMatch(/ENCRYPTION_KEY is still a placeholder/);
    expect(p.join('\n')).toMatch(/POSTGRES_PASSWORD/);
    expect(p.join('\n')).not.toMatch(/MINIO_SECRET_KEY/); // MinIO no longer ships with the system
  });

  it('refuses short, missing, repeated secrets and the .env.example placeholders', () => {
    expect(productionProblems({ ...good, SERVICE_API_KEY: 'short' })).toEqual(['SERVICE_API_KEY is shorter than 32 characters']);
    expect(productionProblems({ ...good, MEDIA_WEBHOOK_SECRET: undefined })).toEqual(['MEDIA_WEBHOOK_SECRET is not set']);
    expect(productionProblems({ ...good, ENCRYPTION_KEY: good.JWT_SECRET })[0]).toMatch(/must all be different/);
    expect(productionProblems({ ...good, JWT_SECRET: 'changeme-generate-a-long-random-value' })[0]).toMatch(/placeholder/);
  });

  it('needs the isolation check and never allows data loss', () => {
    expect(productionProblems({ ...good, CCTV_ISOLATION_VERIFIED: 'false' })[0]).toMatch(/CCTV_ISOLATION_VERIFIED/);
    expect(productionProblems({ ...good, ALLOW_DATA_LOSS: 'true' })).toEqual(['ALLOW_DATA_LOSS must not be true']);
  });

  it('never puts a secret value in a message', () => {
    const secret = 'dev-' + 'x'.repeat(50);
    expect(productionProblems({ ...good, JWT_SECRET: secret }).join(' ')).not.toContain(secret);
  });
});

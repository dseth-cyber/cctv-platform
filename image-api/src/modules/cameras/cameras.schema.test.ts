import { describe, it, expect } from 'vitest';
import { createCameraSchema, updateCameraSchema } from './cameras.schema.js';

// Seeded rows use non-RFC ids (e.g. the default retention policy 00000000-...-0001). zod v4's
// z.uuid() rejects those, so id fields use z.guid() — this guards against a silent switch back.
describe('camera schemas (zod v4)', () => {
  it('accepts seeded non-RFC ids for references', () => {
    const r = updateCameraSchema.safeParse({ retentionPolicyId: '00000000-0000-0000-0000-000000000001' });
    expect(r.success).toBe(true);
  });

  it('rejects ids that are not 8-4-4-4-12 hex', () => {
    expect(updateCameraSchema.safeParse({ retentionPolicyId: 'not-a-uuid' }).success).toBe(false);
  });

  it('does not inject create defaults into an update', () => {
    const r = updateCameraSchema.parse({ name: 'x' });
    expect(r).not.toHaveProperty('timezone');
    expect(r).not.toHaveProperty('metadata');
  });

  it('fills create defaults', () => {
    const r = createCameraSchema.safeParse({ name: 'cam', retentionPolicyId: '00000000-0000-0000-0000-000000000001' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ timezone: 'UTC', metadata: {} });
  });
});

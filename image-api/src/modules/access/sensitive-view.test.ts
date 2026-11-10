import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import { dueForLog, forgetSensitive, logSensitiveView, viewLogHook, VIEW_LOG_WINDOW_MS } from './sensitive-view.js';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: vi.fn() }));
vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn(async () => ({})) }));

const SENSITIVE = '11111111-1111-4111-8111-111111111111';
const PLAIN = '22222222-2222-4222-8222-222222222222';
function prismaMock() {
  vi.mocked(getPrisma).mockReturnValue({
    camera: { findUnique: vi.fn(async ({ where }: any) => ({ sensitive: where.id === SENSITIVE, name: where.id === SENSITIVE ? 'HR room' : 'Gate' })) },
  } as any);
}
const req = (userId: string) => ({ user: { id: userId, username: userId }, ip: '1.2.3.4', params: {}, query: {} }) as any;

describe('sensitive camera views', () => {
  beforeEach(() => { vi.clearAllMocks(); prismaMock(); forgetSensitive(SENSITIVE); forgetSensitive(PLAIN); });

  it('once per person, camera and kind inside the window', () => {
    const t = 1_000_000;
    expect(dueForLog('k1', t)).toBe(true);
    expect(dueForLog('k1', t + VIEW_LOG_WINDOW_MS - 1)).toBe(false);
    expect(dueForLog('k1', t + VIEW_LOG_WINDOW_MS)).toBe(true);
  });

  it('only cameras marked sensitive are logged, with who and how', async () => {
    await logSensitiveView(req('u-a'), PLAIN, 'live');
    expect(createAuditLog).not.toHaveBeenCalled();
    await logSensitiveView(req('u-a'), SENSITIVE, 'live', { profile: 'main' });
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'camera_sensitive_view', entityId: SENSITIVE, userId: 'u-a', metadata: expect.objectContaining({ kind: 'live', profile: 'main', camera: 'HR room' }) }));
  });

  it('a failed request is not a view', async () => {
    const hook = viewLogHook('playback', () => SENSITIVE);
    await hook(req('u-b'), { statusCode: 403 } as any);
    expect(createAuditLog).not.toHaveBeenCalled();
    await hook(req('u-b'), { statusCode: 200 } as any);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('a log that cannot be written does not break the view', async () => {
    vi.mocked(createAuditLog).mockRejectedValueOnce(new Error('db down'));
    await expect(viewLogHook('still', () => SENSITIVE)(req('u-c'), { statusCode: 200 } as any)).resolves.toBeUndefined();
  });
});

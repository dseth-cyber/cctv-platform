import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordSignoff, listSignoffs, getPreflightReadiness } from './release.service.js';
import { getPrisma } from '../../lib/prisma.js';

describe('Release Sign-off Persistence & Audit Log [AUDIT-HIGH-04 & AUDIT-HIGH-05]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should persist sign-off record and create audit log with valid schema fields', async () => {
    const mockSignoffCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({
      id: 'mock-signoff-uuid',
      ...data,
      createdAt: new Date(),
    }));

    const mockAuditCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({
      id: 'mock-audit-uuid',
      ...data,
    }));

    vi.mocked(getPrisma).mockReturnValue({
      signoffRecord: {
        create: mockSignoffCreate,
        findMany: vi.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: mockAuditCreate,
      },
      cameraRecording: {
        count: vi.fn().mockResolvedValue(10),
      },
      camera: {
        count: vi.fn().mockResolvedValue(5),
      },
      mediaNode: {
        count: vi.fn().mockResolvedValue(1),
      },
    } as any);

    const result = await recordSignoff(
      'Lead Auditor',
      'staging',
      'Phase 6 Pilot',
      'All criteria met for wave 1',
      true
    );

    expect(result).toBeDefined();
    expect(mockSignoffCreate).toHaveBeenCalled();
    expect(mockAuditCreate).toHaveBeenCalled();

    // Verify valid AuditLog schema fields
    const auditArg = mockAuditCreate.mock.calls[0][0].data;
    expect(auditArg.action).toBe('RELEASE_SIGNOFF');
    expect(auditArg.entity).toBe('PILOT_RELEASE'); // Not entityType
    expect(auditArg.entityType).toBeUndefined();
    expect(auditArg.description).toBeDefined(); // Not details
    expect(auditArg.metadata).toBeDefined();
  });

  it('should list signoffs ordered by signedAt desc', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      { id: '1', signedBy: 'Auditor A', signedAt: new Date() },
    ]);
    vi.mocked(getPrisma).mockReturnValue({
      signoffRecord: { findMany: mockFindMany },
    } as any);

    const list = await listSignoffs();
    expect(list.length).toBe(1);
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 50 });
  });

  it('should fail instead of keeping an unsaved sign-off in memory', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      signoffRecord: { create: vi.fn().mockRejectedValue(new Error('value too long')) },
      auditLog: { create: vi.fn() },
    } as any);

    await expect(recordSignoff('admin', 'staging', 'Wave 1', '', true)).rejects.toThrow('value too long');
  });

  it('should not treat a stored row without the checklist flag as passed', async () => {
    vi.mocked(getPrisma).mockReturnValue({
      signoffRecord: {
        findMany: vi.fn().mockResolvedValue([
          { id: '1', signoffBy: 'admin', role: 'staging', phase: 'Wave 1', createdAt: new Date(), metadata: {} },
        ]),
      },
    } as any);

    const [row] = await listSignoffs();
    expect(row.checklistPassed).toBe(false);
  });

  it('should not report ready while isolation is unconfirmed', async () => {
    delete process.env.CCTV_ISOLATION_VERIFIED;
    vi.mocked(getPrisma).mockReturnValue({
      $queryRaw: vi.fn().mockResolvedValue([1]),
      cameraRecording: { count: vi.fn().mockResolvedValue(0) },
    } as any);

    const report = await getPreflightReadiness();
    expect(report.isolationVerified).toBe(false);
    expect(report.items.find((i) => i.id === 'iso-fail-closed')?.status).toBe('warning');
    expect(report.overallStatus).not.toBe('ready');
  });
});

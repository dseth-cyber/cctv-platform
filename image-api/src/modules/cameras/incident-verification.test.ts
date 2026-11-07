import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitForVerification, verifyIncident, VerificationError } from './camera-incident.service.js';

const incidentTable = { findUnique: vi.fn(), update: vi.fn() };
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => ({ cameraIncident: incidentTable }) }));

const pending = (over = {}) => ({ id: 'i1', status: 'pending', closedBy: 'tech', closedAt: new Date('2026-11-07T01:00:00Z'), rootCause: 'network', verificationLog: [], ...over });
const dataOf = () => incidentTable.update.mock.calls[0][0].data;

describe('submitForVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incidentTable.update.mockImplementation(({ data }) => Promise.resolve({ id: 'i1', ...data }));
  });

  it('records when the work was finished and waits for someone to check it', async () => {
    incidentTable.findUnique.mockResolvedValue(pending({ status: 'open', closedBy: null, closedAt: null }));
    await submitForVerification('i1', { resolution: 'cable', submittedBy: 'tech' });
    expect(dataOf()).toMatchObject({ status: 'pending', closedBy: 'tech', resolution: 'cable', autoResolved: false });
    expect(dataOf().closedAt).toBeInstanceOf(Date);
    expect(dataOf().verificationLog[0]).toMatchObject({ action: 'submitted', by: 'tech' });
  });

  it('refuses one that is not open', async () => {
    incidentTable.findUnique.mockResolvedValue(pending());
    await expect(submitForVerification('i1', { submittedBy: 'tech' })).rejects.toMatchObject({ code: 'NOT_OPEN' });
  });
});

describe('verifyIncident', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incidentTable.findUnique.mockResolvedValue(pending());
    incidentTable.update.mockImplementation(({ data }) => Promise.resolve({ id: 'i1', ...data }));
  });

  it('closes it on approval, keeping the time the work was finished', async () => {
    await verifyIncident('i1', { decision: 'approve', user: { username: 'it', role: 'it' } });
    expect(dataOf()).toMatchObject({ status: 'resolved', verifiedBy: 'it' });
    expect(dataOf().closedAt).toBeUndefined();
    expect(dataOf().verifiedAt).toBeInstanceOf(Date);
  });

  it('will not let someone approve their own work', async () => {
    await expect(verifyIncident('i1', { decision: 'approve', user: { username: 'tech', role: 'it' } })).rejects.toMatchObject({ code: 'SELF_VERIFY', statusCode: 403 });
    expect(incidentTable.update).not.toHaveBeenCalled();
  });

  it('lets an administrator approve their own work only with a reason', async () => {
    const admin = { username: 'tech', role: 'admin' };
    await expect(verifyIncident('i1', { decision: 'approve', user: admin })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await expect(verifyIncident('i1', { decision: 'approve', note: '  ', user: admin })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await verifyIncident('i1', { decision: 'approve', note: 'only one on site', user: admin });
    expect(dataOf()).toMatchObject({ status: 'resolved', verificationNote: 'only one on site' });
    expect(dataOf().verificationLog.at(-1)).toMatchObject({ action: 'approved_own', note: 'only one on site' });
  });

  it('needs a reason to send work back', async () => {
    await expect(verifyIncident('i1', { decision: 'reject', user: { username: 'it', role: 'it' } })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('sends work back open, with the finish time cleared and the reason kept', async () => {
    await verifyIncident('i1', { decision: 'reject', note: 'still no picture', user: { username: 'it', role: 'it' } });
    expect(dataOf()).toMatchObject({ status: 'open', closedAt: null, closedBy: null, actualFinish: null, workflowStage: 'in_progress', verificationNote: 'still no picture' });
    expect(dataOf().verificationLog.at(-1)).toMatchObject({ action: 'rejected', by: 'it', note: 'still no picture' });
  });

  it('lets someone send back their own work, since that closes nothing', async () => {
    await verifyIncident('i1', { decision: 'reject', note: 'not finished', user: { username: 'tech', role: 'it' } });
    expect(dataOf().status).toBe('open');
  });

  it('refuses one that is not waiting', async () => {
    incidentTable.findUnique.mockResolvedValue(pending({ status: 'resolved' }));
    await expect(verifyIncident('i1', { decision: 'approve', user: { username: 'it', role: 'it' } })).rejects.toBeInstanceOf(VerificationError);
  });
});

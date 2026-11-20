import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => ({}) }));
vi.mock('../../lib/telegram-translate-th.js', () => ({ translateCameraAlertToThai: async (title: string, message: string) => ({ title, message }) }));

const { batchMessage, reminderLine } = await import('./escalation.service.js');

describe('batched reminders', () => {
  it('one message lists every alert of the round, capped with a count of the rest', () => {
    const lines = Array.from({ length: 27 }, (_, i) => `line ${i + 1}`);
    const text = batchMessage(lines);
    expect(text).toContain('เรื่องที่ยังค้าง 27 เรื่อง');
    expect(text).toContain('line 20');
    expect(text).not.toContain('line 21');
    expect(text).toContain('และอีก 7 เรื่อง');
  });

  it('a line says what happened, how long it has been open, the step and who owns it', async () => {
    const now = new Date('2026-11-21T08:00:00Z');
    const line = await reminderLine({
      reason: 'escalate', stepNumber: 2, stepCount: 3, now,
      alert: { title: 'Camera <Ch 12> is offline', message: '', severity: 'critical', createdAt: new Date('2026-11-19T03:00:00Z'), acknowledgedBy: null },
    });
    expect(line).toBe('⏫🚨 Camera &lt;Ch 12&gt; is offline · 2 วัน 5 ชม. · ขั้น 2/3 · ยังไม่มีผู้รับ ⚠');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextDocumentNumber } from './camera-incident.service.js';

const counter = { update: vi.fn(), create: vi.fn() };
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => ({ documentCounter: counter }) }));

const coded = (code: string) => Object.assign(new Error(code), { code });

describe('nextDocumentNumber', () => {
  beforeEach(() => vi.clearAllMocks());

  it('goes up from the counter, whatever exists now', async () => {
    counter.update.mockResolvedValue({ value: 14 });
    const highest = vi.fn();
    await expect(nextDocumentNumber('INC-2026', highest)).resolves.toBe(14);
    expect(highest).not.toHaveBeenCalled();
    expect(counter.update).toHaveBeenCalledWith({ where: { key: 'INC-2026' }, data: { value: { increment: 1 } } });
  });

  it('starts a series after the highest number known', async () => {
    counter.update.mockRejectedValue(coded('P2025'));
    counter.create.mockResolvedValue({ value: 14 });
    await expect(nextDocumentNumber('INC-2026', async () => 13)).resolves.toBe(14);
    expect(counter.create).toHaveBeenCalledWith({ data: { key: 'INC-2026', value: 14 } });
  });

  it('joins a series someone else started in the same moment', async () => {
    counter.update.mockRejectedValueOnce(coded('P2025')).mockResolvedValueOnce({ value: 2 });
    counter.create.mockRejectedValue(coded('P2002'));
    await expect(nextDocumentNumber('WO-2026', async () => 0)).resolves.toBe(2);
  });

  it('does not hide any other failure', async () => {
    counter.update.mockRejectedValue(new Error('database down'));
    await expect(nextDocumentNumber('WO-2026', async () => 0)).rejects.toThrow('database down');
  });
});

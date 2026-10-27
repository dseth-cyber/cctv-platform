import { beforeAll, afterAll, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
  getPrisma: vi.fn(),
  checkDatabaseConnection: vi.fn(),
  disconnectPrisma: vi.fn(),
}));

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

afterAll(() => {
  vi.clearAllMocks();
});

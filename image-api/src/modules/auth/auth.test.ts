import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import * as authService from './auth.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { UnauthorizedError } from '../../lib/errors.js';

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mocked(getPrisma).mockReturnValue(mockPrisma as unknown as ReturnType<typeof getPrisma>);

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should return user on valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
        enabled: true,
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await authService.login({
        username: 'admin',
        password: 'password123',
      });

      expect(result).toMatchObject({
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.com',
        role: 'admin',
      });
    });

    it('should throw on wrong password', async () => {
      const hashedPassword = await bcrypt.hash('correct-password', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        password: hashedPassword,
        enabled: true,
      });

      await expect(
        authService.login({ username: 'admin', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw on disabled user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'disabled',
        password: 'hash',
        enabled: false,
      });

      await expect(
        authService.login({ username: 'disabled', password: 'any' }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw on non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'nobody', password: 'any' }),
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('createRefreshToken', () => {
    it('should create a refresh token', async () => {
      mockPrisma.refreshToken.create.mockResolvedValue({
        id: 'rt-1',
        token: 'hex-token',
      });

      const token = await authService.createRefreshToken('user-1');

      expect(token).toBeDefined();
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify and rotate refresh token', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: 'valid-token',
        userId: 'user-1',
        expiresAt: futureDate,
        revokedAt: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.com',
        role: 'admin',
        enabled: true,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      const result = await authService.verifyRefreshToken({ refreshToken: 'valid-token' });

      expect(result).toMatchObject({ id: 'user-1', username: 'admin' });
    });

    it('should throw on expired token', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        token: 'expired-token',
        expiresAt: pastDate,
        revokedAt: null,
      });

      await expect(
        authService.verifyRefreshToken({ refreshToken: 'expired-token' }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw on revoked token', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        token: 'revoked-token',
        expiresAt: futureDate,
        revokedAt: new Date(),
      });

      await expect(
        authService.verifyRefreshToken({ refreshToken: 'revoked-token' }),
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});

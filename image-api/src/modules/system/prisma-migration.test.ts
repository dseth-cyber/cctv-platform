import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Prisma Migrations Tracking [AUDIT-HIGH-03]', () => {
  const migrationsDir = path.resolve(__dirname, '../../../prisma/migrations');

  it('should have prisma/migrations directory tracked', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });

  it('should have migration_lock.toml with postgresql provider', () => {
    const lockPath = path.join(migrationsDir, 'migration_lock.toml');
    expect(fs.existsSync(lockPath)).toBe(true);
    const content = fs.readFileSync(lockPath, 'utf8');
    expect(content).toContain('provider = "postgresql"');
  });

  it('should have baseline migration SQL file', () => {
    const initMigrationDir = path.join(migrationsDir, '20261027000000_init_cctv_platform');
    expect(fs.existsSync(initMigrationDir)).toBe(true);
    const sqlPath = path.join(initMigrationDir, 'migration.sql');
    expect(fs.existsSync(sqlPath)).toBe(true);
    const stat = fs.statSync(sqlPath);
    expect(stat.size).toBeGreaterThan(1000);
  });
});

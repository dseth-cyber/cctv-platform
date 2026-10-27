import { z } from 'zod';

export const createMigrationSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  fileType: z.string().optional(),
});

export const migrationQuerySchema = z.object({
  status: z.string().optional(),
});

export type CreateMigrationInput = z.infer<typeof createMigrationSchema>;

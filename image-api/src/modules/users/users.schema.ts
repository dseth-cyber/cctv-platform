import { cameraScopeSchema } from '../access/camera-scope.js';
import { z } from 'zod';
import { strongPasswordSchema } from '../../lib/password-policy.js';

export const createUserSchema = z.object({
  username: z.string().min(1).max(128),
  email: z.string().email().max(256),
  password: strongPasswordSchema,
  role: z.string().min(1).max(64).default('viewer'),
  customPermissions: z.array(z.string()).optional(),
  cameraScope: cameraScopeSchema.optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(256).optional(),
  password: strongPasswordSchema.optional(),
  role: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  customPermissions: z.array(z.string()).optional(),
  cameraScope: cameraScopeSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

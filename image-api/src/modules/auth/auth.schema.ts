import { z } from 'zod';
import { strongPasswordSchema } from '../../lib/password-policy.js';

export const loginSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: strongPasswordSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
    role: z.string(),
    lastLogin: z.string().nullable(),
  }),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});

export const userResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  role: z.string(),
  lastLogin: z.string().nullable(),
});

export const updateMenuPreferencesSchema = z.object({
  hiddenMenuItems: z.array(z.string()),
});

// Partial preferences to shallow-merge, keyed by page id (e.g. { imageSearch: {...} }).
export const updatePreferencesSchema = z.object({
  patch: z.record(z.unknown()),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type UpdateMenuPreferencesInput = z.infer<typeof updateMenuPreferencesSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

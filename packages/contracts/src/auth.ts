import { z } from 'zod';
import { Uuid } from './common';
import { Role } from './vocabulary';

export const SignInRequest = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(256),
});
export type SignInRequest = z.infer<typeof SignInRequest>;

export const ProjectRef = z.object({ id: Uuid, key: z.string(), name: z.string() });
export type ProjectRef = z.infer<typeof ProjectRef>;

export const Me = z.object({
  user: z.object({ id: Uuid, displayName: z.string(), role: Role }),
  organization: z.object({ id: Uuid, name: z.string(), isDemo: z.boolean() }),
  projects: z.array(ProjectRef),
  canCreateRequirement: z.boolean(),
});
export type Me = z.infer<typeof Me>;

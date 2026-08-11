import { z } from 'zod';

export const CreateSignupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(3, { message: 'Email must be at least 3 characters.' })
      .max(320, { message: 'Email must not exceed 320 characters.' })
      .email({ message: 'Invalid email address format.' }),
    fullName: z
      .string()
      .trim()
      .min(1)
      .max(120, { message: 'Full name must not exceed 120 characters.' })
      .optional(),
  })
  .strict();

export type CreateSignupDto = z.infer<typeof CreateSignupSchema>;

export const DiscoveryQuerySchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .email({ message: 'Invalid email address format.' }),
});

export type DiscoveryQueryDto = z.infer<typeof DiscoveryQuerySchema>;

export const SignupResponseSchema = z.object({
  status: z.literal('accepted'),
  authMode: z.enum(['sso', 'email_verification', 'pending_approval']),
  ssoRedirectUrl: z.string().url().optional(),
  traceId: z.string(),
});

export type SignupResponseDto = z.infer<typeof SignupResponseSchema>;

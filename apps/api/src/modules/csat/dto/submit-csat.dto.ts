import { z } from 'zod';

/** Maximum length for a CSAT comment (Confidential-tier free text). */
export const COMMENT_MAX_LENGTH = 2000;

/** Control character regex — strips chars 0x00–0x1F except tab/newline/CR. */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strips control characters and caps length for safe storage.
 * Input is stored as plain text and always rendered escaped downstream.
 */
function sanitiseComment(raw: string): string {
  return raw.replace(CONTROL_CHARS_RE, '').slice(0, COMMENT_MAX_LENGTH);
}

export const SubmitCsatSchema = z
  .object({
    score: z.number().int().min(1).max(5, { message: 'score must be between 1 and 5' }),
    comment: z
      .string()
      .max(COMMENT_MAX_LENGTH, { message: `comment must be at most ${COMMENT_MAX_LENGTH} characters` })
      .transform(sanitiseComment)
      .optional(),
  })
  .strict();

export type SubmitCsatDto = z.infer<typeof SubmitCsatSchema>;

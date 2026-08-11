/**
 * EmailSenderPort — the outbound email delivery interface.
 *
 * SesEmailSender is the production adapter.
 * InMemoryEmailSender is the test-double (no infrastructure mocks).
 *
 * Recipient email addresses are Confidential-tier data.
 * Adapters must never log the full address — only a hashed reference is safe.
 */

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  /** Source trace ID for correlated logging; never appears in SES headers. */
  traceId?: string;
}

export interface SendEmailResult {
  /** Provider-assigned message ID (SES MessageId). */
  messageId: string;
}

export interface EmailSenderPort {
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
}

/** SES error codes that indicate a permanent failure — never retry. */
export const PERMANENT_SES_ERROR_CODES = new Set([
  'MessageRejected',
  'InvalidParameterValue',
  'InvalidParameterException',
  'MailFromDomainNotVerifiedException',
  'AccountSendingPausedException',
  'SendingPausedException',
]);

/** SES error codes that indicate a transient failure — SQS requeue. */
export const RETRYABLE_SES_ERROR_CODES = new Set([
  'Throttling',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'InternalFailure',
]);

export function classifySesError(errorName: string | undefined): 'permanent' | 'retryable' {
  if (!errorName) return 'retryable';
  if (PERMANENT_SES_ERROR_CODES.has(errorName)) return 'permanent';
  if (RETRYABLE_SES_ERROR_CODES.has(errorName)) return 'retryable';
  // Treat unknown errors as retryable to avoid data loss
  return 'retryable';
}

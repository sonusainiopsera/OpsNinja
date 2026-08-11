export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  traceId?: string;
}

export interface SendEmailResult {
  messageId: string;
}

export interface EmailSenderPort {
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
}

export const PERMANENT_SES_ERROR_CODES = new Set([
  'MessageRejected',
  'InvalidParameterValue',
  'InvalidParameterException',
  'MailFromDomainNotVerifiedException',
  'AccountSendingPausedException',
  'SendingPausedException',
]);

export const RETRYABLE_SES_ERROR_CODES = new Set([
  'Throttling',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'InternalFailure',
]);

export function classifySesError(errorName: string | undefined): 'permanent' | 'retryable' {
  if (!errorName) return 'retryable';
  if (PERMANENT_SES_ERROR_CODES.has(errorName)) return 'permanent';
  return 'retryable';
}

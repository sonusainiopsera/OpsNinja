/**
 * Classifies SES errors into retryable vs terminal for DLQ routing.
 *
 * Retryable: return message to queue via visibility timeout extension.
 * Terminal: update notification row to 'failed', do not retry.
 */

import { SESv2ServiceException } from '@aws-sdk/client-sesv2';

export enum SesErrorClass {
  /** Transient — return to SQS queue, will be retried up to max attempts. */
  RETRYABLE = 'RETRYABLE',
  /** Permanent — mark notification failed, do not retry. */
  TERMINAL = 'TERMINAL',
}

const RETRYABLE_ERROR_NAMES = new Set([
  'TooManyRequestsException',
  'SendingPausedException',
  'ServiceUnavailableException',
  'ThrottlingException',
  'RequestTimeoutException',
]);

const TERMINAL_ERROR_NAMES = new Set([
  'MessageRejected',
  'InvalidParameterValueException',
  'InvalidParameterException',
  'AccountSendingPausedException',
  'MailFromDomainNotVerifiedException',
  'ConfigurationSetDoesNotExistException',
  'SendingQuotaExceededException', // treat quota exhaustion as terminal for this message
]);

export function classifySesError(err: SESv2ServiceException): SesErrorClass {
  if (RETRYABLE_ERROR_NAMES.has(err.name)) {
    return SesErrorClass.RETRYABLE;
  }
  if (TERMINAL_ERROR_NAMES.has(err.name)) {
    return SesErrorClass.TERMINAL;
  }
  // Default: treat unknown 5xx as retryable, 4xx as terminal.
  const status = err.$response?.statusCode ?? 0;
  return status >= 500 ? SesErrorClass.RETRYABLE : SesErrorClass.TERMINAL;
}

/**
 * EmailSenderPort – ports-and-adapters interface for email delivery.
 *
 * Concrete adapters: SesEmailSender (production), InMemoryEmailSender (tests).
 * Injected via EMAIL_SENDER_PORT DI token so no infrastructure leaks into
 * the notification handler.
 */

export const EMAIL_SENDER_PORT = 'EMAIL_SENDER_PORT';

export interface EmailMessage {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  /** Opaque reference used to correlate the send with the notification row. */
  referenceId: string;
}

export interface SendResult {
  /** Provider-assigned message ID (e.g. SES MessageId). */
  messageId: string;
}

export interface EmailSenderPort {
  send(message: EmailMessage): Promise<SendResult>;
}

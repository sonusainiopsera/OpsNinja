import type { EmailSenderPort, SendEmailParams, SendEmailResult } from '../ports/email-sender.port';

export interface CapturedEmail {
  params: Omit<SendEmailParams, 'htmlBody' | 'textBody'>;
}

export class InMemoryEmailSender implements EmailSenderPort {
  readonly captured: CapturedEmail[] = [];
  private nextError?: Error;

  queueError(err: Error): void {
    this.nextError = err;
  }

  reset(): void {
    this.captured.length = 0;
    this.nextError = undefined;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = undefined;
      throw err;
    }
    // Store params without htmlBody/textBody to avoid capturing PII in test output.
    this.captured.push({
      params: { from: params.from, to: params.to, subject: params.subject, traceId: params.traceId },
    });
    return { messageId: `in-memory-${this.captured.length}` };
  }
}

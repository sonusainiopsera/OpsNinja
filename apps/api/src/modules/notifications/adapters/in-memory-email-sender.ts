import { Injectable } from '@nestjs/common';

import type { EmailSenderPort, SendEmailParams, SendEmailResult } from '../ports/email-sender.port';

export interface CapturedEmail {
  params: SendEmailParams;
  messageId: string;
  sentAt: Date;
}

/**
 * InMemoryEmailSender — test double for EmailSenderPort.
 *
 * Accumulates sent emails in memory so unit tests can assert on delivery
 * without any infrastructure dependency. No network calls are made.
 */
@Injectable()
export class InMemoryEmailSender implements EmailSenderPort {
  private readonly _sent: CapturedEmail[] = [];
  private _nextMessageId = 1;

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const messageId = `in-memory-${this._nextMessageId++}`;
    this._sent.push({ params, messageId, sentAt: new Date() });
    return { messageId };
  }

  get sent(): readonly CapturedEmail[] {
    return this._sent;
  }

  reset(): void {
    this._sent.length = 0;
    this._nextMessageId = 1;
  }
}

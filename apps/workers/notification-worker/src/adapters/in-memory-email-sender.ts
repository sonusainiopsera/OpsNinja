/**
 * InMemoryEmailSender – test double for EmailSenderPort.
 *
 * Captures sent messages in an in-process array so unit and integration
 * tests can assert send counts and message content without infrastructure.
 */

import { Injectable } from '@nestjs/common';
import { EmailSenderPort, EmailMessage, SendResult } from '../ports/email-sender.port';

@Injectable()
export class InMemoryEmailSender implements EmailSenderPort {
  private readonly _sent: EmailMessage[] = [];
  private _shouldThrow: Error | null = null;

  get sent(): readonly EmailMessage[] {
    return this._sent;
  }

  reset(): void {
    this._sent.length = 0;
    this._shouldThrow = null;
  }

  /** Configure the next send() to throw the given error (for failure tests). */
  failWith(err: Error): void {
    this._shouldThrow = err;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    if (this._shouldThrow) {
      const err = this._shouldThrow;
      this._shouldThrow = null;
      throw err;
    }
    this._sent.push(message);
    return { messageId: `in-memory-${Date.now()}-${this._sent.length}` };
  }
}

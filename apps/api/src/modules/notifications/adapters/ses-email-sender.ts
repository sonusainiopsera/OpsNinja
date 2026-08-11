/**
 * SesEmailSender — production adapter that sends via Amazon SES v2.
 *
 * Uses IRSA (IAM Roles for Service Accounts) for credential resolution;
 * no access keys are accepted in configuration. The ConfigurationSetName
 * wires SES event publishing (bounces, complaints) to the SNS/SQS pipeline.
 *
 * PII constraint: the recipient address is Confidential-tier data. We never
 * log it. The only externally observable reference is the SHA-256 hash used
 * in the suppression list (not computed here).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';

import type { EmailSenderPort, SendEmailParams, SendEmailResult } from '../ports/email-sender.port';

export interface SesEmailSenderConfig {
  region: string;
  fromAddress: string;
  configurationSetName?: string;
}

@Injectable()
export class SesEmailSender implements EmailSenderPort {
  private readonly client: SESv2Client;
  private readonly logger = new Logger(SesEmailSender.name);

  constructor(private readonly config: SesEmailSenderConfig) {
    this.client = new SESv2Client({
      region: config.region,
      // IRSA resolves credentials from the pod's service account token.
      // No explicit credentials are passed.
    });
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const input: SendEmailCommandInput = {
      FromEmailAddress: this.config.fromAddress,
      Destination: {
        ToAddresses: [params.to],
      },
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: params.htmlBody, Charset: 'UTF-8' },
            Text: { Data: params.textBody, Charset: 'UTF-8' },
          },
        },
      },
      ...(this.config.configurationSetName && {
        ConfigurationSetName: this.config.configurationSetName,
      }),
    };

    const command = new SendEmailCommand(input);
    const response = await this.client.send(command);

    const messageId = response.MessageId ?? 'unknown';

    // Do NOT log the recipient address — it is Confidential-tier PII.
    this.logger.debug('Email sent via SES', {
      messageId,
      traceId: params.traceId,
      subject: params.subject,
    });

    return { messageId };
  }
}

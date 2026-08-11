/**
 * SesEmailSender — production EmailSenderPort backed by Amazon SES v2.
 *
 * IRSA credentials: no explicit credentials are passed; the pod's service
 * account annotations cause the AWS SDK to pick up a web identity token.
 *
 * NEVER logs the recipient email address or the rendered body.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailSenderPort, SendEmailParams, SendEmailResult } from '../ports/email-sender.port';

@Injectable()
export class SesEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(SesEmailSender.name);
  private readonly ses = new SESv2Client({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    // IRSA: rely on pod service account web identity token — no explicit creds.
  });

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const configSet = process.env['SES_CONFIGURATION_SET'];
    const command = new SendEmailCommand({
      FromEmailAddress: params.from,
      Destination: { ToAddresses: [params.to] },
      Content: {
        Simple: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: params.htmlBody, Charset: 'UTF-8' },
            Text: { Data: params.textBody, Charset: 'UTF-8' },
          },
        },
      },
      ...(configSet ? { ConfigurationSetName: configSet } : {}),
    });

    const result = await this.ses.send(command);
    const messageId = result.MessageId ?? '';

    // Log delivery confirmation — never the address or body.
    this.logger.log('SES email dispatched', {
      messageId,
      traceId: params.traceId,
    });

    return { messageId };
  }
}

/**
 * SesEmailSender – production adapter using @aws-sdk/client-sesv2.
 *
 * Credentials come from the pod's IRSA (IAM Roles for Service Accounts).
 * No credentials may be hard-coded or committed.
 *
 * A ConfigurationSetName is attached to every send so SES publishes bounce
 * and complaint events to the SNS topic specified in the configuration set.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SESv2Client,
  SendEmailCommand,
  SendEmailCommandInput,
  SESv2ServiceException,
} from '@aws-sdk/client-sesv2';
import { EmailSenderPort, EmailMessage, SendResult } from '../ports/email-sender.port';
import { classifySesError, SesErrorClass } from './ses-error-classifier';

@Injectable()
export class SesEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(SesEmailSender.name);
  private readonly client: SESv2Client;
  private readonly fromAddress: string;
  private readonly configurationSetName: string;

  constructor(private readonly config: ConfigService) {
    this.client = new SESv2Client({
      region: config.get<string>('AWS_REGION', 'us-east-1'),
    });
    this.fromAddress = config.getOrThrow<string>('SES_FROM_ADDRESS');
    this.configurationSetName = config.get<string>('SES_CONFIGURATION_SET', 'opsninja-notifications');
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const input: SendEmailCommandInput = {
      FromEmailAddress: this.fromAddress,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: message.htmlBody, Charset: 'UTF-8' },
            Text: { Data: message.textBody, Charset: 'UTF-8' },
          },
        },
      },
      ConfigurationSetName: this.configurationSetName,
      EmailTags: [{ Name: 'referenceId', Value: message.referenceId }],
    };

    try {
      const response = await this.client.send(new SendEmailCommand(input));
      if (!response.MessageId) {
        throw new Error('SES returned no MessageId');
      }
      return { messageId: response.MessageId };
    } catch (err) {
      if (err instanceof SESv2ServiceException) {
        const classification = classifySesError(err);
        this.logger.warn('SES send failed', {
          classification,
          code: err.name,
          referenceId: message.referenceId,
        });
        throw err;
      }
      throw err;
    }
  }
}

export { SesErrorClass, classifySesError };

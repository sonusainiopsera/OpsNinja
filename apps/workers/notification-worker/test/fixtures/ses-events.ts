/**
 * Sample SES bounce and complaint SNS payload fixtures.
 */

export const permanentBounceEvent = {
  Type: 'Notification',
  Message: JSON.stringify({
    notificationType: 'Bounce',
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: [
        { emailAddress: 'bounce@example.com', status: '5.1.1', action: 'failed' },
      ],
      timestamp: '2024-01-01T00:00:00.000Z',
    },
    mail: {
      messageId: 'ses-msg-001',
      destination: ['bounce@example.com'],
    },
  }),
};

export const transientBounceEvent = {
  Type: 'Notification',
  Message: JSON.stringify({
    notificationType: 'Bounce',
    bounce: {
      bounceType: 'Transient',
      bounceSubType: 'MailboxFull',
      bouncedRecipients: [{ emailAddress: 'full@example.com' }],
    },
  }),
};

export const complaintEvent = {
  Type: 'Notification',
  Message: JSON.stringify({
    notificationType: 'Complaint',
    complaint: {
      complainedRecipients: [{ emailAddress: 'spam@example.com' }],
      complaintFeedbackType: 'abuse',
      timestamp: '2024-01-01T00:00:00.000Z',
    },
  }),
};

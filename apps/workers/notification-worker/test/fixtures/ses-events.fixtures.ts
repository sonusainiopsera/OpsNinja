export const BOUNCE_SNS_BODY = JSON.stringify({
  notificationType: 'Bounce',
  bounce: {
    bounceType: 'Permanent',
    bouncedRecipients: [{ emailAddress: 'bounced@example.com' }],
  },
  mail: { tags: {} },
});

export const COMPLAINT_SNS_BODY = JSON.stringify({
  notificationType: 'Complaint',
  complaint: {
    complainedRecipients: [{ emailAddress: 'complained@example.com' }],
  },
  mail: { tags: {} },
});

export const DELIVERY_SNS_BODY = JSON.stringify({
  notificationType: 'Delivery',
  mail: { tags: {} },
});

export const MALFORMED_SNS_BODY = '{ bad json }';

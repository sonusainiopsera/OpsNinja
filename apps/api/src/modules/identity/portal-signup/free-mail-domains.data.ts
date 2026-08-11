/**
 * Free-mail and disposable domain deny-list.
 *
 * Purpose:
 *   Portal signup is intended for business-email addresses only. Free-mail
 *   providers (gmail, yahoo, outlook, …) and known disposable-address services
 *   are rejected at the submission step so they never enter the verification
 *   pipeline.
 *
 * Maintenance:
 *   Add entries to the appropriate section when a new provider is reported.
 *   All entries must be lowercase, dot-separated, without leading/trailing dots.
 *   Submit a PR with a brief comment explaining why the domain was added.
 *
 * Validation:
 *   The deny-list check runs against the punycode-normalised domain extracted
 *   from the email address AFTER plus-address and subaddress stripping.
 *
 * Last updated: 2026-08 (initial list)
 */

// ---------------------------------------------------------------------------
// Free-mail providers
// ---------------------------------------------------------------------------

export const FREE_MAIL_DOMAINS = new Set<string>([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft / Hotmail / Outlook
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'hotmail.es', 'hotmail.ca', 'hotmail.com.br', 'hotmail.co.nz',
  'outlook.com', 'outlook.co.uk', 'outlook.de', 'outlook.fr', 'outlook.es',
  'outlook.com.br', 'live.com', 'live.co.uk', 'live.fr', 'live.com.au',
  'msn.com',
  // Yahoo
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.it', 'yahoo.es',
  'yahoo.ca', 'yahoo.com.br', 'yahoo.co.in', 'yahoo.com.au', 'yahoo.co.jp',
  'ymail.com', 'rocketmail.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // AOL
  'aol.com', 'aim.com',
  // Mail.com / GMX
  'mail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch',
  // ProtonMail
  'protonmail.com', 'proton.me',
  // Tutanota
  'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io',
  // Fastmail
  'fastmail.com', 'fastmail.fm', 'fastmail.net',
  // Zoho (free tier)
  'zohomail.com',
  // Russian / CIS
  'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'yandex.ru', 'yandex.com',
  'rambler.ru',
  // Chinese
  'qq.com', '163.com', '126.com', 'sina.com', 'sina.cn', '21cn.com',
  'sohu.com',
  // Other popular free providers
  'freenet.de', 'web.de', 't-online.de', 'arcor.de',
  'laposte.net', 'libero.it', 'virgilio.it', 'alice.it',
  'orange.fr', 'sfr.fr', 'free.fr', 'wanadoo.fr',
  'terra.com.br', 'uol.com.br', 'bol.com.br', 'ig.com.br',
]);

// ---------------------------------------------------------------------------
// Known disposable / temporary address providers
// ---------------------------------------------------------------------------

export const DISPOSABLE_DOMAINS = new Set<string>([
  // Major disposable providers
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.de', 'guerrillamail.info', 'grr.la', 'guerrillamailblock.com',
  'throwam.com', 'throwaway.email', 'trashmail.com', 'trashmail.at',
  'trashmail.io', 'trashmail.me', 'trashmail.net', 'trash-mail.at',
  'mailnull.com', 'dispostable.com', 'yopmail.com', 'yopmail.fr', 'cool.fr.nf',
  'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj',
  'speed.1s.fr', 'courriel.fr.nf', 'moncourrier.fr.nf',
  'tempr.email', 'temp-mail.org', 'temp-mail.io', 'tempmail.com',
  'tempinbox.com', 'tempmailaddress.com',
  'fakeinbox.com', 'maildrop.cc', 'mailnesia.com', 'spamgourmet.com',
  'spamgourmet.net', 'spamgourmet.org', 'spamhereplease.com',
  'notmailinator.com', 'spamavert.com', 'mailmetrash.com',
  'throwam.com', 'throwEmail.com', 'nwldx.com', 'discard.email',
  'discardmail.com', 'discardmail.de', 'mailboxy.fun', 'inboxkitten.com',
  'getnada.com', 'owlpic.com', 'moakt.ws', 'moakt.co',
  'tempmailo.com', 'tempm.com', 'tempemailco.com',
  '10minutemail.com', '10minutemail.net', '10minutemail.org',
  '20minutemail.com', 'sharklasers.com', 'guerrillamail.biz',
  'spam4.me', 'mailnew.com', 'spamfree24.org',
  'mailbolt.com', 'mailc.net', 'mailcat.biz', 'mailexpire.com',
  'mailfa.tk', 'mailforspam.com', 'mailfreeonline.com', 'mailguard.me',
  'mailimate.com', 'mailme.ir', 'mailme.lv', 'mailmetrash.com',
  'mailmoat.com', 'mailnew.com', 'mailnull.com', 'mailplug.info',
  'mailquack.com', 'mailrock.biz', 'mailscrap.com', 'mailseal.de',
  'mailsiphon.com', 'mailslapping.com', 'mailslite.com', 'mailsroom.com',
  'mailsucker.net', 'mailt.net', 'mailtemp.net', 'mailtome.de',
  'mailzilla.com', 'mailzilla.org',
  // Burner services
  'burnermail.io', 'burnthespam.info', 'anonaddy.com', 'anonaddy.me',
  'simplelogin.io', 'simplelogin.co',
]);

/**
 * Returns true if the domain is on the free-mail or disposable deny-list.
 * Checks both the exact domain and the eTLD+1 (e.g. 'mail.yahoo.com' → 'yahoo.com').
 */
export function isDeniedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (FREE_MAIL_DOMAINS.has(d) || DISPOSABLE_DOMAINS.has(d)) return true;

  // Check eTLD+1 for subdomains of deny-listed providers
  const parts = d.split('.');
  if (parts.length > 2) {
    const tldPlus1 = parts.slice(-2).join('.');
    if (FREE_MAIL_DOMAINS.has(tldPlus1) || DISPOSABLE_DOMAINS.has(tldPlus1)) return true;
  }

  return false;
}

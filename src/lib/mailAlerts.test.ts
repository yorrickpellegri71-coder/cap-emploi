// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToText, isAlertSender } from './mailAlerts';

describe('alertes e-mail', () => {
  it('reconnaît les expéditeurs des sites d’emploi', () => {
    expect(isAlertSender('jobs.lu <alerts@jobs.lu>')).toBe(true);
    expect(isAlertSender('LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>')).toBe(true);
    expect(isAlertSender('L’Hôtellerie Restauration <news@lhotellerie-restauration.fr>')).toBe(true);
    expect(isAlertSender('Maman <maman@example.org>')).toBe(false);
  });
  it('garde le texte et les liens des offres, sans styles ni scripts', () => {
    const text = htmlToText('<html><head><style>p{}</style></head><body><p>Chef de rang</p><script>x()</script><a href="https://www.jobs.lu/1">Voir</a></body></html>');
    expect(text).toContain('Chef de rang');
    expect(text).toContain('Voir (https://www.jobs.lu/1)');
    expect(text).not.toContain('x()');
    expect(text).not.toContain('p{}');
  });
});

import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import { MailService, MailTransport } from './mail.service';

const cfg = { nodeEnv: 'test', mail: { from: 'Jabali <no-reply@jabali.co.ke>', replyTo: 'help@jabali.co.ke', storeUrl: 'https://shop.example.com' } } as unknown as AppConfig;
const msg = { to: 'amina@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };

function make(transport: MailTransport): MailService {
  const s = new MailService(transport, cfg);
  s.retryDelaysMs = [0, 0, 0];
  return s;
}

describe('MailService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends once with the configured From and Reply-To', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id1' });
    expect(await make({ sendMail }).send(msg)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: cfg.mail.from, replyTo: 'help@jabali.co.ke', to: msg.to, subject: 'Hello', html: msg.html, text: msg.text });
  });

  it('retries and succeeds on the third attempt', async () => {
    const sendMail = jest.fn().mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockResolvedValue({ messageId: 'id' });
    expect(await make({ sendMail }).send(msg)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('gives up after three failures without throwing', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('down'));
    await expect(make({ sendMail }).send(msg)).resolves.toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('skips an invalid recipient without calling the transport', async () => {
    const sendMail = jest.fn();
    for (const to of ['', 'nope', 'a@b', 'a b@c.co', 'a@b.co,c@d.co', 'a@b.co\r\nBcc: x@y.z']) {
      expect(await make({ sendMail }).send({ ...msg, to })).toBe(false);
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('strips line breaks from the subject so it cannot inject headers', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await make({ sendMail }).send({ ...msg, subject: 'Order\r\nBcc: evil@example.com' });
    expect(sendMail.mock.calls[0][0].subject).toBe('Order Bcc: evil@example.com');
  });

  it('queue never throws and never blocks, even when the transport fails', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('down'));
    expect(() => make({ sendMail }).queue(msg)).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(sendMail).toHaveBeenCalled();
  });

  it('does not log the message body or the full address', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    await make({ sendMail: jest.fn().mockResolvedValue({ messageId: 'id' }) }).send({ ...msg, html: '<p>SECRET-BODY</p>', text: 'SECRET-BODY' });
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('SECRET-BODY');
    expect(logged).not.toContain('amina@example.com');
    expect(logged).toContain('a***@example.com');
  });
});

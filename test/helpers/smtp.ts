import { AddressInfo } from 'node:net';
import { ParsedMail, simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

export interface TestSmtp {
  url: string;
  messages: ParsedMail[];
  waitFor(count: number, timeoutMs?: number): Promise<ParsedMail[]>;
  close(): Promise<void>;
}

/** A real SMTP server on a random local port that parses whatever it receives. Used to prove mail actually goes over the wire. */
export async function startSmtp(): Promise<TestSmtp> {
  const messages: ParsedMail[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onData(stream, _session, done) {
      simpleParser(stream).then(
        (m) => {
          messages.push(m);
          done();
        },
        (e: Error) => done(e),
      );
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.server.address() as AddressInfo).port;
  return {
    url: `smtp://127.0.0.1:${port}`,
    messages,
    async waitFor(count, timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      while (messages.length < count) {
        if (Date.now() > end) throw new Error(`expected ${count} message(s), received ${messages.length}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      return messages;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

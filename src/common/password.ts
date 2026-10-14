import * as argon2 from 'argon2';

export const ARGON_OPTS = { type: argon2.argon2id } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, ARGON_OPTS);

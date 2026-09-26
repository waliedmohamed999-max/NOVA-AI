import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to equalize timing when the user does not exist.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("nova-timing-equalizer");
  await verifyPassword(await dummyHash, password);
  return false;
}

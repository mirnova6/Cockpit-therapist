import { describe, expect, it } from 'vitest';
import {
  decryptBytes,
  decryptJson,
  deriveWrappingKey,
  encryptBytes,
  encryptJson,
  fromBase64,
  generateDataKey,
  randomSalt,
  toBase64,
  unwrapDataKey,
  wrapDataKey,
} from './cryptoService';

const FAST_PARAMS = () => ({ salt: randomSalt(), iterations: 1000 });

describe('cryptoService', () => {
  it('round-trips JSON through AES-GCM', async () => {
    const dek = await generateDataKey();
    const value = { name: 'Test Client', diagnoses: ['F41.1'], nested: { risk: 'low' } };
    const payload = await encryptJson(dek, value);
    expect(payload.iv).not.toEqual(payload.data);
    const decrypted = await decryptJson<typeof value>(dek, payload);
    expect(decrypted).toEqual(value);
  });

  it('round-trips binary attachments', async () => {
    const dek = await generateDataKey();
    const bytes = crypto.getRandomValues(new Uint8Array(4096));
    const payload = await encryptBytes(dek, bytes);
    const decrypted = await decryptBytes(dek, payload);
    expect(decrypted).toEqual(bytes);
  });

  it('produces unique IVs per encryption', async () => {
    const dek = await generateDataKey();
    const a = await encryptJson(dek, 'same');
    const b = await encryptJson(dek, 'same');
    expect(a.iv).not.toEqual(b.iv);
    expect(a.data).not.toEqual(b.data);
  });

  it('rejects decryption with a different key', async () => {
    const dek1 = await generateDataKey();
    const dek2 = await generateDataKey();
    const payload = await encryptJson(dek1, { secret: true });
    await expect(decryptJson(dek2, payload)).rejects.toThrow();
  });

  it('rejects tampered ciphertext (GCM authentication)', async () => {
    const dek = await generateDataKey();
    const payload = await encryptJson(dek, { secret: true });
    const raw = fromBase64(payload.data);
    raw[0] ^= 0xff;
    await expect(decryptJson(dek, { ...payload, data: toBase64(raw) })).rejects.toThrow();
  });

  it('wraps and unwraps the DEK with a passphrase-derived KEK', async () => {
    const dek = await generateDataKey();
    const params = FAST_PARAMS();
    const kek = await deriveWrappingKey('correct horse battery staple', params);
    const wrapped = await wrapDataKey(dek, kek);

    const kekAgain = await deriveWrappingKey('correct horse battery staple', params);
    const unwrapped = await unwrapDataKey(wrapped, kekAgain);

    const payload = await encryptJson(dek, 'hello');
    expect(await decryptJson(unwrapped, payload)).toBe('hello');
  });

  it('fails to unwrap the DEK with a wrong passphrase', async () => {
    const dek = await generateDataKey();
    const params = FAST_PARAMS();
    const kek = await deriveWrappingKey('right-passphrase', params);
    const wrapped = await wrapDataKey(dek, kek);
    const wrongKek = await deriveWrappingKey('wrong-passphrase', params);
    await expect(unwrapDataKey(wrapped, wrongKek)).rejects.toThrow();
  });
});

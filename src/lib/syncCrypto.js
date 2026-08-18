/**
 * Everything sent to the sync server is encrypted here first.
 *
 * One sync code is the whole credential. From it we derive two things with
 * HKDF: an account id, which the server sees, and an AES-GCM key, which never
 * leaves the device. The account id is a hash, so holding it does not get you
 * the code — the server can count records and see when they change, and that is
 * all it can ever know.
 */

// Crockford-style base32: no I, L, O or U, so codes are hard to misread aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUPS = 5;
const GROUP_LEN = 5; // 25 chars x 5 bits = 125 bits of entropy

export function generateSyncCode() {
  const bytes = new Uint8Array(CODE_GROUPS * GROUP_LEN);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const groups = [];
  for (let i = 0; i < CODE_GROUPS; i += 1) {
    groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(''));
  }
  return groups.join('-');
}

/** Accepts a code however it was typed: spaces, dashes, lower case. */
export function normaliseSyncCode(code) {
  const cleaned = (code || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // The letters base32 leaves out are almost always these misreadings.
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  if (cleaned.length !== CODE_GROUPS * GROUP_LEN) return null;
  return cleaned.match(new RegExp(`.{1,${GROUP_LEN}}`, 'g')).join('-');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hkdf(code, info, length) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'HKDF', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        // A fixed salt: the code is already 125 random bits, and both devices
        // have to derive the same values from the code alone.
        salt: encoder.encode('marginalia-sync-v1'),
        info: encoder.encode(info),
      },
      material,
      length * 8,
    ),
  );
}

/** The id the server files records under. A hash — it reveals nothing. */
export async function deriveAccountId(code) {
  const bits = await hkdf(code, 'account-id', 32);
  return [...bits].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveKey(code) {
  const raw = await hkdf(code, 'record-key', 32);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function deriveIdentity(code) {
  const [accountId, key] = await Promise.all([deriveAccountId(code), deriveKey(code)]);
  return { accountId, key };
}

export async function encryptRecord(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return bytesToBase64(packed);
}

export async function decryptRecord(key, payload) {
  const packed = base64ToBytes(payload);
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(decoder.decode(plain));
}

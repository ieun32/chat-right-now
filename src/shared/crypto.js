/**
 * Group end-to-end encryption — "A안": a single symmetric room session key,
 * distributed to each joiner over a per-peer asymmetric box.
 *
 *   identity  : nacl.box keypair (Curve25519), regenerated every launch
 *   session   : 32 random bytes, used with nacl.secretbox (XSalsa20-Poly1305)
 *   handoff   : sessionKey sealed with nacl.box(theirPublic, mySecret)
 *
 * Trade-off (accepted, per spec): there is no forward secrecy across membership
 * changes. Someone who leaves keeps the session key and could still decrypt
 * traffic if they could observe it. They can't — they're out of the mesh and
 * the DataChannels are gone — but the key itself isn't rotated on leave.
 * Since the app keeps no history and delivers nothing to offline peers, the
 * practical exposure is nil.
 */

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } = util;

export { encodeBase64, decodeBase64 };

export function createIdentity() {
  const kp = nacl.box.keyPair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyB64: encodeBase64(kp.publicKey),
  };
}

export function createSessionKey() {
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

/** Short, stable fingerprint of a session key — lets peers detect/resolve key conflicts. */
export function keyIdOf(sessionKey) {
  return encodeBase64(nacl.hash(sessionKey).subarray(0, 9));
}

/** Seal the session key for one specific recipient. */
export function sealSessionKey(sessionKey, recipientPublicKeyB64, identity) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    sessionKey,
    nonce,
    decodeBase64(recipientPublicKeyB64),
    identity.secretKey,
  );
  if (!box) throw new Error('sealSessionKey failed');
  return { n: encodeBase64(nonce), c: encodeBase64(box) };
}

/** Open a sealed session key from a known sender. Returns null on failure. */
export function openSessionKey(sealed, senderPublicKeyB64, identity) {
  try {
    const out = nacl.box.open(
      decodeBase64(sealed.c),
      decodeBase64(sealed.n),
      decodeBase64(senderPublicKeyB64),
      identity.secretKey,
    );
    return out && out.length === nacl.secretbox.keyLength ? out : null;
  } catch {
    return null;
  }
}

/**
 * Encrypt an application message with the room session key.
 * The keyId travels in the clear so a peer holding a different key can drop the
 * packet silently instead of logging a decrypt failure.
 */
export function encryptMessage(obj, session) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(decodeUTF8(JSON.stringify(obj)), nonce, session.key);
  return { k: session.id, n: encodeBase64(nonce), c: encodeBase64(box) };
}

/** Returns the decrypted object, or null if the packet isn't for our key / is forged. */
export function decryptMessage(envelope, session) {
  if (!session || envelope.k !== session.id) return null;
  try {
    const out = nacl.secretbox.open(
      decodeBase64(envelope.c),
      decodeBase64(envelope.n),
      session.key,
    );
    if (!out) return null;
    return JSON.parse(encodeUTF8(out));
  } catch {
    return null;
  }
}

/**
 * Deterministic tiebreak when two peers independently generate a key for the
 * same room (possible if two people create the room within the same instant).
 * Everyone converges on the lexicographically smallest keyId.
 */
export function shouldAdoptKey(currentSession, incomingKeyId) {
  if (!currentSession) return true;
  return incomingKeyId < currentSession.id;
}

export function makeSession(key) {
  return { key, id: keyIdOf(key) };
}

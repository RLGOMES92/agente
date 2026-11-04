import crypto from 'node:crypto';

/**
 * Validates Meta's X-Hub-Signature-256 header against the exact raw request body.
 * Missing secrets/signatures always fail closed.
 */
export function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature || typeof appSecret !== 'string' || !appSecret) {
    return false;
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = Buffer.from(signature);
  const calculated = Buffer.from(expected);
  return received.length === calculated.length && crypto.timingSafeEqual(received, calculated);
}

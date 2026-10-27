// Temporary evidence envelope. This file accepts a PUBLIC key only.
import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const [input, publicKeyFile, output] = process.argv.slice(2);
if (!input || !publicKeyFile || !output) throw new Error('input_public_key_output_required');
const publicKey = readFileSync(publicKeyFile);
if (!publicKey.toString().includes('BEGIN PUBLIC KEY') || publicKey.toString().includes('PRIVATE KEY')) {
  throw new Error('public_key_required');
}
const expected = 'f69f2874d13ae977b48e2947dc7ef1004079dee5e0f6bcf35152cec12755a31f';
const actualPublicKeySha256 = createHash('sha256').update(publicKey).digest('hex');
if (actualPublicKeySha256 !== expected) {
  // Public-key metadata only: preserve the exact byte pin and identify checkout conversion.
  process.stderr.write(`${JSON.stringify({ error: 'evidence_public_key_changed', expectedSha256: expected,
    actualSha256: actualPublicKeySha256, bytes: publicKey.length,
    crlfCount: publicKey.toString('ascii').split('\r\n').length - 1 })}\n`);
  throw new Error('evidence_public_key_changed');
}
const key = randomBytes(32), iv = randomBytes(12);
const aad = Buffer.from('koto-native-observation-evidence-v1');
const cipher = createCipheriv('aes-256-gcm', key, iv);
cipher.setAAD(aad);
const plaintextHash = createHash('sha256');
const source = createReadStream(input);
source.on('data', chunk => plaintextHash.update(chunk));
await pipeline(source, cipher, createWriteStream(output, { flags: 'wx', mode: 0o600 }));
writeFileSync(`${output}.json`, `${JSON.stringify({
  schemaVersion: 1, kind: 'koto-native-observation-encrypted-evidence',
  cipher: 'aes-256-gcm', wrapping: 'rsa-oaep-sha256',
  key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
  iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), aad: aad.toString('base64'),
  publicKeySha256: expected, plaintextSha256: plaintextHash.digest('hex'),
}, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
key.fill(0);

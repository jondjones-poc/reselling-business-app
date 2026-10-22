/**
 * eBay "Digital Signatures for APIs" (RFC 9421 HTTP Message Signatures),
 * required for the Finances API (and some other calls) for EU/UK-domiciled
 * sellers. Independent of OAuth scopes entirely.
 *
 * Setup (one-time, from Settings > Site Settings > Integrations):
 *  1. Click "Create Signing Key". This calls eBay's Key Management API
 *     (createSigningKey) and saves the result — including the private key,
 *     which eBay returns ONLY this once — into the ebay_signing_key table.
 *  2. From then on, signRequestHeaders() below reads it from the database
 *     (cached in memory) to sign outgoing Finances/Fulfillment requests.
 */

const crypto = require('crypto');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SIGNING_KEY_URL = 'https://apiz.ebay.com/developer/key_management/v1/signing_key';
const INTEGRATION_KEY = 'default';

let cachedSigningKey = null;

/**
 * Calls eBay's Key Management API to create a brand-new ED25519 signing
 * keypair, and persists it into ebay_signing_key. Requires a 2-legged
 * (client-credentials) access token.
 */
async function createSigningKey(pool, appAccessToken, cipher = 'ED25519') {
  const res = await fetch(SIGNING_KEY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ signingKeyCipher: cipher }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`createSigningKey ${res.status}: ${text.slice(0, 700)}`);
  }
  const signingKey = JSON.parse(text);

  const expirationTime = signingKey.expirationTime != null ? new Date(Number(signingKey.expirationTime) * 1000) : null;

  await pool.query(
    `INSERT INTO ebay_signing_key (integration_key, signing_key_id, signing_key_cipher, jwe, private_key, public_key, expiration_time, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (integration_key) DO UPDATE SET
       signing_key_id = EXCLUDED.signing_key_id,
       signing_key_cipher = EXCLUDED.signing_key_cipher,
       jwe = EXCLUDED.jwe,
       private_key = EXCLUDED.private_key,
       public_key = EXCLUDED.public_key,
       expiration_time = EXCLUDED.expiration_time,
       updated_at = NOW()`,
    [
      INTEGRATION_KEY,
      signingKey.signingKeyId,
      signingKey.signingKeyCipher,
      signingKey.jwe,
      signingKey.privateKey,
      signingKey.publicKey || null,
      expirationTime,
    ]
  );

  cachedSigningKey = { jwe: signingKey.jwe, privateKey: signingKey.privateKey };

  return {
    signingKeyId: signingKey.signingKeyId,
    signingKeyCipher: signingKey.signingKeyCipher,
    expirationTime,
  };
}

/** Returns { jwe, privateKey } from cache/DB, or null if no key has been created yet. */
async function getActiveSigningKey(pool) {
  if (cachedSigningKey) return cachedSigningKey;
  const { rows } = await pool.query(
    `SELECT jwe, private_key FROM ebay_signing_key WHERE integration_key = $1`,
    [INTEGRATION_KEY]
  );
  if (rows.length === 0) return null;
  cachedSigningKey = { jwe: rows[0].jwe, privateKey: rows[0].private_key };
  return cachedSigningKey;
}

/** Latest stored signing key's metadata (no private key), for display in Settings. */
async function getSigningKeyInfo(pool) {
  const { rows } = await pool.query(
    `SELECT signing_key_id, signing_key_cipher, expiration_time, created_at, updated_at
     FROM ebay_signing_key WHERE integration_key = $1`,
    [INTEGRATION_KEY]
  );
  return rows[0] || null;
}

/**
 * eBay's Key Management API returns `privateKey` as base64-encoded raw
 * PKCS8 DER bytes (not a base64-encoded PEM text block), so it must be
 * parsed as DER — passing it as PEM text fails with an OpenSSL decoder
 * error.
 */
function parsePrivateKey(privateKeyValue) {
  if (privateKeyValue.includes('BEGIN')) {
    return crypto.createPrivateKey(privateKeyValue);
  }
  return crypto.createPrivateKey({
    key: Buffer.from(privateKeyValue, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Builds the x-ebay-signature-key / Content-Digest / Signature-Input /
 * Signature headers for a single outgoing request, per RFC 9421.
 *
 * @param {object} opts
 * @param {string} opts.method
 * @param {string} opts.url - full request URL (query string included; the
 *   query string itself is NOT a signed component, only @path is).
 * @param {Buffer} [opts.bodyBuffer] - omit/undefined for a bodyless request.
 * @param {{jwe: string, privateKey: string}} opts.signingKey - from getActiveSigningKey().
 */
function signRequestHeaders({ method, url, bodyBuffer, signingKey }) {
  const { jwe, privateKey: privateKeyPem } = signingKey;

  const parsedUrl = new URL(url);
  const headers = {};
  const components = [];

  if (bodyBuffer) {
    const digest = crypto.createHash('sha256').update(bodyBuffer).digest('base64');
    headers['Content-Digest'] = `sha-256=:${digest}:`;
    components.push(['content-digest', headers['Content-Digest']]);
  }

  components.push(['x-ebay-signature-key', jwe]);
  components.push(['@method', method.toUpperCase()]);
  components.push(['@path', parsedUrl.pathname]);
  components.push(['@authority', parsedUrl.host.toLowerCase()]);

  const created = Math.floor(Date.now() / 1000);
  const signatureParams = `(${components.map(([name]) => `"${name}"`).join(' ')});created=${created}`;
  const signatureBase = [...components.map(([name, value]) => `"${name}": ${value}`), `"@signature-params": ${signatureParams}`].join(
    '\n'
  );

  const key = parsePrivateKey(privateKeyPem);
  const digestAlg = key.asymmetricKeyType === 'ed25519' ? null : 'sha256';
  const signature = crypto.sign(digestAlg, Buffer.from(signatureBase, 'utf8'), key).toString('base64');

  headers['x-ebay-signature-key'] = jwe;
  headers['Signature-Input'] = `sig1=${signatureParams}`;
  headers['Signature'] = `sig1=:${signature}:`;

  return headers;
}

module.exports = {
  createSigningKey,
  getActiveSigningKey,
  getSigningKeyInfo,
  signRequestHeaders,
};

#!/usr/bin/env node
/**
 * Generates the VAPID key pair for the speaking reminders (Web Push).
 * Prints the values to set:
 *   VAPID_PUBLIC_KEY  → "vars" in wrangler.jsonc (public)
 *   VAPID_PRIVATE_KEY → npx wrangler secret put VAPID_PRIVATE_KEY (secret)
 *   VAPID_SUBJECT     → "vars", a mailto: address of yours
 */
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY=${Buffer.from(raw).toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

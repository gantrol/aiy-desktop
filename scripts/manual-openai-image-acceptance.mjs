#!/usr/bin/env node
/**
 * MANUAL, PAID acceptance check. Not a test.
 *
 * Deliberately lives outside every Vitest and Playwright glob, and is never
 * reachable from `npm test`, `npm run test:*`, or `npm run verify`. It exists
 * only to answer questions that a stub cannot: does this specific account have
 * image-generation permission, and does the live service still match the
 * documented protocol.
 *
 * Run it only when one of these is true:
 *   - onboarding a new production account for the first time
 *   - a major SDK upgrade
 *   - the provider changed its interface or model snapshot
 *   - live behaviour is suspected to diverge from the documented protocol
 *   - a release owner explicitly asks to verify image permission
 *
 * Usage:
 *   OPENAI_LIVE_TEST=1 OPENAI_API_KEY=sk-... node scripts/manual-openai-image-acceptance.mjs --confirm-paid
 *
 * Cost controls are hard-coded, not configurable: one request, lowest quality,
 * no partial images, no reference images, no edit, no retry.
 */
const LIMITS = {
  requests: 1,
  model: 'gpt-image-2',
  quality: 'low',
  size: '1024x1024',
  partialImages: 0,
  retries: 0,
};

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (process.env.OPENAI_LIVE_TEST !== '1') {
  fail('Refusing to run: set OPENAI_LIVE_TEST=1 to acknowledge this makes a paid request.');
}
if (!process.argv.includes('--confirm-paid')) {
  fail('Refusing to run: pass --confirm-paid to acknowledge this makes a paid request.');
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  fail('Refusing to run: OPENAI_API_KEY is not set.');
}

console.log('\nMANUAL PAID ACCEPTANCE — this will bill your OpenAI account.\n');
console.table(LIMITS);
console.log('Use a dedicated Project and API key with a platform-enforced spend cap.\n');

const response = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENAI_PROJECT_ID ? { 'OpenAI-Project': process.env.OPENAI_PROJECT_ID } : {}),
  },
  body: JSON.stringify({
    model: LIMITS.model,
    prompt: 'A plain grey ceramic mug on a white table.',
    n: LIMITS.requests,
    quality: LIMITS.quality,
    size: LIMITS.size,
    output_format: 'png',
  }),
});

const requestId = response.headers.get('x-request-id') ?? '(none)';
if (!response.ok) {
  const body = await response.text();
  console.error(`\nFAILED  HTTP ${response.status}  request-id=${requestId}`);
  console.error(body.slice(0, 2_000));
  process.exit(2);
}

const body = await response.json();
const image = body.data?.[0];
console.log(`OK      HTTP ${response.status}  request-id=${requestId}`);
console.log(`bytes   ${image?.b64_json ? Buffer.from(image.b64_json, 'base64').length : 0}`);
console.log(`usage   ${JSON.stringify(body.usage ?? {})}`);
console.log('\nImage generation permission verified for this account.');
console.log('Note: a credentials or model-list check alone can NOT verify this.\n');

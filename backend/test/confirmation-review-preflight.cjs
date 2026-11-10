const assert = require('node:assert/strict');
assert.ok(
  ['development', 'test'].includes(process.env.NODE_ENV),
  'Solo development/test.',
);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.protocol, 'mysql:');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
  'Solo MySQL local.',
);
for (const key of [
  'ZOHO_WRITE_PAYMENTS_ENABLED',
  'ZOHO_AUTO_SYNC_PAYMENTS_ENABLED',
]) {
  assert.equal(process.env[key]?.trim(), 'false', `${key} debe ser false.`);
}
console.log('Entorno local verificado.');

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyNoAnalyticsInjection, verifySecurityHeaders } from './check-security-headers.mjs';

test('both public apps protect their HTML against CDN analytics injection', () => {
  assert.ok(verifySecurityHeaders() > 0);
});

test('a policy on another path or inside a comment does not protect the document', () => {
  const policy = '# Cache-Control: no-transform\n/alpr/\n  Cache-Control: public, no-transform\n';
  assert.doesNotThrow(() => verifyNoAnalyticsInjection(policy, ['/alpr/']));
  assert.throws(() => verifyNoAnalyticsInjection(policy, ['/']), /no-transform/);
  assert.throws(() => verifyNoAnalyticsInjection('/\n  Cache-Control: public, max-age=0\n', ['/']), /no-transform/);
});

test('existing caching directives can coexist with the injection protection', () => {
  assert.doesNotThrow(() => verifyNoAnalyticsInjection('/\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n', ['/']));
});

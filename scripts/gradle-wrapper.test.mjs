import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PROPERTIES = new URL(
  '../apps/android/gradle/wrapper/gradle-wrapper.properties',
  import.meta.url,
);
const WRAPPER_JAR = new URL('../apps/android/gradle/wrapper/gradle-wrapper.jar', import.meta.url);
const GRADLE_LICENSE = new URL('../apps/android/gradle/LICENSE', import.meta.url);

const EXPECTED_DISTRIBUTION = 'gradle-8.14.5-bin.zip';
const EXPECTED_DISTRIBUTION_SHA256 =
  '6f74b601422d6d6fc4e1f9a1ab6522f642c2fdcbc15ae33ebd30ba3d7198e854';
const EXPECTED_WRAPPER_JAR_SHA256 =
  '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172';
const EXPECTED_GRADLE_LICENSE_SHA256 =
  '9536d88ea948603d18e232a13f5958d67807cd80828036b082bff171d2cf0703';

function properties() {
  return Object.fromEntries(
    readFileSync(PROPERTIES, 'utf8')
      .split(/\r?\n/u)
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        assert.notEqual(separator, -1, `malformed Gradle wrapper property: ${line}`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

test('pins the Gradle distribution URL and its official SHA-256 digest together', () => {
  const config = properties();
  assert.equal(config.distributionUrl.endsWith(EXPECTED_DISTRIBUTION), true);
  assert.equal(config.distributionSha256Sum, EXPECTED_DISTRIBUTION_SHA256);
});

test('ships the Gradle 8.14.5 wrapper JAR whose upstream digest was reviewed', () => {
  const digest = createHash('sha256').update(readFileSync(WRAPPER_JAR)).digest('hex');
  assert.equal(digest, EXPECTED_WRAPPER_JAR_SHA256);
});

test('ships the exact Gradle 8.14.5 licence and bundled-component notices', () => {
  const digest = createHash('sha256').update(readFileSync(GRADLE_LICENSE)).digest('hex');
  assert.equal(digest, EXPECTED_GRADLE_LICENSE_SHA256);
});

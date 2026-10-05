import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// shared/ runs unchanged in Node and in the browser, so it may only import
// other shared files and must not touch Node or DOM globals.
test('shared modules stay environment-neutral', () => {
  const files = fs.readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  for (const f of files) {
    const file = path.join(dir, f);
    const src = fs.readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), spec);
      assert.ok(spec.startsWith('.') && target.startsWith(dir + path.sep), `${f} imports ${spec}`);
    }
    assert.doesNotMatch(src, /\b(?:window|document|process|require)\s*[.(]/, `${f} uses a Node or DOM global`);
  }
});

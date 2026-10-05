import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeClient } from './protocol.js';

test('malformed or untyped messages decode to null', () => {
  for (const raw of ['', '{', 'null', '42', '[]', '"join"', '{"t":"nope"}', '{"name":"Sam"}']) {
    assert.equal(decodeClient(raw), null, raw);
  }
});

test('join trims the name and accepts 1 to 16 characters', () => {
  assert.deepEqual(decodeClient('{"t":"join","name":"  Sam  "}'), { t: 'join', name: 'Sam', bot: false });
  assert.deepEqual(decodeClient('{"t":"join","name":"bot3","bot":true}'), { t: 'join', name: 'bot3', bot: true });
  assert.equal(decodeClient('{"t":"join","name":"abcdefghijklmnop"}').name, 'abcdefghijklmnop');
  for (const name of ['', '   ', 'abcdefghijklmnopq', 'a\u0007b', 42, null]) {
    assert.equal(decodeClient(JSON.stringify({ t: 'join', name })), null, String(name));
  }
});

test('start carries no payload', () => {
  assert.deepEqual(decodeClient('{"t":"start","extra":1}'), { t: 'start' });
});

// Run from packages/contracts after building VeydriftCombatCutover.t.sol.
// Inspects independently compiled historical and current structs, including all nested
// arrays/maps/structs. Only Battle's terminal combatMathVersion field may be appended.
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const inspect = name => JSON.parse(execFileSync('forge', ['inspect', name, 'storage-layout', '--json'], {encoding:'utf8'}));
const old = inspect('CutoverLayoutV1');
const current = inspect('CutoverLayoutV2');
const seen = new Set();
let fields = 0;
function compare(a, b, path) {
  const pair = a + '|' + b;
  if (seen.has(pair)) return;
  seen.add(pair);
  const x = old.types[a], y = current.types[b];
  const root = path === 'battle';
  assert.equal(y.encoding, x.encoding, path + ' encoding');
  if (!root) assert.equal(y.numberOfBytes, x.numberOfBytes, path + ' size');
  for (const key of ['key', 'value', 'base']) if (x[key]) compare(x[key], y[key], path + '.' + key);
  if (!x.members) return;
  assert.equal(y.members.length, x.members.length + (root ? 1 : 0), path + ' member count');
  x.members.forEach((m,i) => {
    const n = y.members[i];
    for (const key of ['label', 'slot', 'offset']) assert.equal(n[key], m[key], path + '.' + m.label + ' ' + key);
    ++fields;
    compare(m.type, n.type, path + '.' + m.label);
  });
  if (root) {
    const last = y.members.at(-1);
    assert.equal(last.label, 'combatMathVersion');
    assert.equal(last.slot, '106');
    assert.equal(last.offset, 0);
    assert.equal(current.types[last.type].label, 'uint8');
    assert.equal(Number(y.numberOfBytes), Number(x.numberOfBytes) + 32);
  }
}
assert.equal(old.storage[0].slot, current.storage[0].slot);
assert.equal(old.storage[0].offset, current.storage[0].offset);
compare(old.storage[0].type, current.storage[0].type, 'battle');
console.log('Combat cutover layout: ' + fields + ' old fields / ' + seen.size + ' recursive types unchanged; version appended at slot106.');

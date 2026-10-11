import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options, percentile, dockerSample } from '../load-session-server.mjs';

test('rejects loads above the real room limit and invalid arguments', () => {
  for (const args of [['--clients', '21'], ['--rooms', '-1'], ['--seconds', 'NaN'], ['--url', 'http://localhost'], ['--unknown', '1'], ['--rooms']]) {
    assert.throws(() => options(args));
  }
  assert.equal(options(['--clients', '20']).clients, 20);
});
test('Docker sampling handles binary and decimal units and rejects missing stats', () => {
  assert.deepEqual(dockerSample('12.5%|32MiB / 512MiB'), { cpu_percent: 12.5, memory_mib: 32 });
  assert.equal(dockerSample('0%|1GiB / 2GiB').memory_mib, 1024);
  assert.throws(() => dockerSample('unavailable'));
});
test('reports percentiles without changing samples or inventing empty results', () => {
  const values = [100, 2, 3, 1];
  assert.equal(percentile(values, .5), 2);
  assert.equal(percentile(values, .99), 100);
  assert.equal(percentile([], .99), null);
  assert.deepEqual(values, [100, 2, 3, 1]);
});

#!/usr/bin/env node
/**
 * tests/pick_presence_selftest.mjs —— v2.2「点选无人应答快速失败」的纯逻辑自检。
 *
 * 覆盖：
 *   · 从未有面板轮询 → age_ms=null、seen=false；
 *   · 宽限期内不判死（给 TUI auto-open + 首次轮询留时间）；
 *   · TTL 内轮询 → seen=true；超过 TTL → seen=false；
 *   · `kind` 标签透传；
 *   · 请求发出后才开始轮询（auto-open 晚到）不会被误杀；
 *   · 生产判定 `shouldFailFast(watching, startedAt, now)` 与测试共用。
 *
 * 不需要 Blender / 后端 / 网络，直接 import runtime/host_presence.mjs。
 */
import assert from 'node:assert/strict';
import {
  createHostPresence,
  shouldFailFast,
  UI_POLL_TTL_MS,
  PICK_NO_UI_GRACE_MS,
} from '../runtime/host_presence.mjs';

let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failures.push(name + ' :: ' + (error && error.message ? error.message : String(error)));
    console.log('FAIL ' + name + ' :: ' + (error && error.message ? error.message : String(error)));
  }
}

test('无 watcher：age=null、seen=false，宽限后 fail-fast', () => {
  let now = 10_000;
  const p = createHostPresence(() => now);
  assert.deepEqual(p.snapshot(), { seen: false, age_ms: null, kind: null });
  const watching = p.snapshot();
  assert.equal(shouldFailFast(watching, 10_000, now), false, '宽限期内不判死');
  now += PICK_NO_UI_GRACE_MS - 1;
  assert.equal(shouldFailFast(watching, 10_000, now), false, '宽限前 1ms 不判死');
  now += 2;
  assert.equal(shouldFailFast(watching, 10_000, now), true, '宽限后仍无 watcher → fail-fast');
  assert.equal(shouldFailFast(null, 0, now), false, '旧后端没有 watching 字段 → 不判死');
});

test('TTL 内轮询 seen=true，超 TTL 变 false', () => {
  let now = 1_000;
  const p = createHostPresence(() => now);
  assert.deepEqual(p.note('tui'), { seen: true, age_ms: 0, kind: 'tui' });
  now += UI_POLL_TTL_MS;
  assert.deepEqual(p.snapshot(), { seen: true, age_ms: UI_POLL_TTL_MS, kind: 'tui' }, 'TTL 边界仍算 seen');
  now += 1;
  assert.deepEqual(p.snapshot(), { seen: false, age_ms: UI_POLL_TTL_MS + 1, kind: 'tui' }, '超过 TTL 变 false');
});

test('有新鲜 watcher 时不判死；过期后才判死', () => {
  let now = 0;
  const p = createHostPresence(() => now);
  p.note('web');
  now = PICK_NO_UI_GRACE_MS + 100;
  assert.equal(shouldFailFast(p.snapshot(), 0, now), false, '有新鲜 watcher 不判死');
  now += UI_POLL_TTL_MS + 1;
  assert.equal(shouldFailFast(p.snapshot(), 0, now), true, 'watcher 过期后才判死');
});

test('auto-open 晚到：请求后 2s 才开始轮询，不被误杀', () => {
  let now = 0;
  const p = createHostPresence(() => now);
  const startedAt = 0;
  now = 2_000;
  p.note('tui');
  now = PICK_NO_UI_GRACE_MS; // 已过宽限，但 watcher age=500ms
  assert.equal(shouldFailFast(p.snapshot(), startedAt, now), false, '宽限刚过但有新鲜 watcher → 继续等');
});

test('kind 透传与缺失归 null', () => {
  let now = 0;
  const p = createHostPresence(() => now);
  p.note('web');
  assert.equal(p.snapshot().kind, 'web');
  p.note(undefined);
  assert.equal(p.snapshot().kind, null);
});

const total = pass + failures.length;
console.log(JSON.stringify({ suite: 'pick-presence', total, pass, fail: failures.length, failures }, null, 2));
process.exit(failures.length === 0 ? 0 : 1);

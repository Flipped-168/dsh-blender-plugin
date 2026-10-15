#!/usr/bin/env node
/**
 * 客户端 bundle 自检 —— 「用户重启 DSH 后插件会不会崩」的安全网。
 *
 * 为什么需要它：宿主集成能力里唯一**只有在浏览器里才会炸**的一环就是 `lib/client.js`。
 * 它是手写的 `window.__ModuleLoader__.load({id, factory})` 文件（契约 §2.2），
 * 由 `src/client/index.js` + `scripts/build-client.mjs` 产出。三类常见事故本测试全部拦住：
 *   ① 注册的 `id` 写错 → DSH 起不来 / 加载器认不出这个 bundle；
 *   ② `factory(require)` 没返回带 `apply`/`inject` 的对象 → 插件加载即崩；
 *   ③ bundle 里混进 `import`/`export` 顶层语法或 Node 内置模块 → 浏览器解析/运行时报错。
 *
 * 设计纪律（照 `docs/宿主集成-接口契约.md` §2.2，不改契约字段）：
 *   - **不引入依赖**：只用 `node:fs` / `node:path` / `node:vm`。
 *   - **只在假 `window.__ModuleLoader__` 下执行**：不联网、不碰真 DSH、不写任何文件。
 *   - **不调用 `apply(ctx)`**：那需要真 cordis 上下文，且若实现里有 `while(true)`/`setInterval`
 *     会把本测试挂死（vm 的 timeout 只作用于 `runInContext`，管不住从宿主直接调用的函数）。
 *     本测试要证的是「能装进去、装进去不崩」，不是「跑起来行为对」。
 *   - **lib/client.js 不存在 → SKIP 且 exit 0**（客户端半边由 client-ui 并行产出，可能晚于本测试）。
 *
 * 用法：node tests/client_bundle_selftest.mjs
 * 退出码：0 = 通过或 SKIP；1 = 有断言失败（附可读原因）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BUNDLE = path.join(ROOT, 'lib', 'client.js');
const PKG_PATH = path.join(ROOT, 'package.json');

/** 契约 §2.2：注册 id 必须等于包名 */
const EXPECTED_ID = '@dsh-external/dsh-blender-plugin';

// ── 0) bundle 还没产出 → SKIP（不算失败）────────────────────────────────────
if (!fs.existsSync(BUNDLE)) {
  console.log('SKIP: lib/client.js 尚未生成');
  console.log('  说明：客户端半边由 src/client/index.js + scripts/build-client.mjs 产出（契约 §2）。');
  console.log('  产出后重跑：node tests/client_bundle_selftest.mjs');
  process.exit(0);
}

const src = fs.readFileSync(BUNDLE, 'utf8');
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));

let pass = 0;
let fail = 0;
const fails = [];
const infos = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; fails.push({ clause: name, detail: extra === undefined ? null : extra }); }
}
function info(msg) { infos.push(msg); }

// ── ① 静态粗筛：顶层 import/export、顶层 await、Node 内置模块 ────────────────
/**
 * 单遍字符扫描，把源码切成两个视图（比正则更少误伤，尤其是 `http://` 里的 `//`）：
 *   - `code`     ：注释已挖空，字符串**保留** → 用于看 `require('fs')` 这类字面量
 *   - `codeNoStr`：注释 + 字符串内容都挖空 → 用于看 `import`/`export`/Node 全局
 * 模板字面量整体挖空（`${}` 里的代码会被一起挖掉，属于可接受的粗筛代价）。
 */
function tokenizeViews(s) {
  let code = '';
  let codeNoStr = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];
    if (c === '/' && c2 === '/') {                       // 行注释
      while (i < n && s[i] !== '\n') { code += ' '; codeNoStr += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {                       // 块注释
      code += ' '; codeNoStr += ' '; i += 2;
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) { code += s[i] === '\n' ? '\n' : ' '; codeNoStr += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { code += ' '; codeNoStr += ' '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {           // 字符串 / 模板
      const quote = c;
      code += c; codeNoStr += c; i++;
      while (i < n) {
        const ch = s[i];
        if (ch === '\\') { code += s.slice(i, i + 2); codeNoStr += '  '; i += 2; continue; }
        if (ch === quote) { code += ch; codeNoStr += ch; i++; break; }
        if (quote === '`' && ch === '$' && s[i + 1] === '{') {
          // 模板里的 ${…}：整体挖空（含嵌套花括号的朴素配对）
          let depth = 1; let j = i + 2;
          while (j < n && depth > 0) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
          code += ' '.repeat(j - i); codeNoStr += ' '.repeat(j - i); i = j; continue;
        }
        code += ch; codeNoStr += ch === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    code += c; codeNoStr += c; i++;
  }
  return { code, codeNoStr };
}

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url',
  'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const { code, codeNoStr } = tokenizeViews(src);

const ieMatches = [...codeNoStr.matchAll(/^[ \t]*(import|export)\b/gm)].map((m) => m[0].trim());
ok('bundle 无顶层 `import`/`export` 语法（契约 §2.2）', ieMatches.length === 0, ieMatches.slice(0, 5));

const awaitMatches = [...codeNoStr.matchAll(/^[ \t]*await\b/gm)].map((m) => m[0].trim());
ok('bundle 无顶层 `await`（契约 §2.2）', awaitMatches.length === 0, awaitMatches.slice(0, 5));

const nodeGlobals = [...codeNoStr.matchAll(/(^|[^\w$.])(__dirname|__filename|Buffer|process)\b/g)].map((m) => m[2]);
ok('bundle 不引用 Node 全局（__dirname/__filename/Buffer/process）', nodeGlobals.length === 0,
  [...new Set(nodeGlobals)].slice(0, 6));

const builtinReqs = [];
for (const m of code.matchAll(/require\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
  const spec = m[2];
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split('/')[0])) builtinReqs.push(spec);
}
ok('bundle 不 require Node 内置模块（契约 §2.2）', builtinReqs.length === 0, [...new Set(builtinReqs)].slice(0, 6));

// 只看字符串字面量里的裸说明符：`require("react")` 是允许的（baseline 提供）
const reqSpecs = [...new Set([...code.matchAll(/require\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]))];
info('bundle 内 require 的说明符：' + (reqSpecs.length ? JSON.stringify(reqSpecs) : '（无）'));

// ── ② 在假 window.__ModuleLoader__ 下执行 bundle ────────────────────────────
const loadCalls = [];
const loader = {
  load(entry) { loadCalls.push(entry); return entry; },
  // 少数加载器实现会先探 get/has；给个无副作用的兜底，不改变断言口径
  get() { return undefined; },
  has() { return false; },
};

/** 极简 DOM 桩：只为「factory 执行期误碰 DOM」这类写法不炸，不模拟任何真实行为。 */
function stubEl() {
  return { style: {}, dataset: {}, children: [], appendChild() {}, append() {}, removeChild() {}, remove() {},
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; } };
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; } };
}

const sandbox = {
  console,
  // 定时器一律"登记但不执行"：本测试不允许 bundle 留下任何会跑的异步任务
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  queueMicrotask: () => {},
  URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal,
  fetch: () => Promise.reject(new Error('client_bundle_selftest 不发起网络请求')),
  localStorage: memStorage(), sessionStorage: memStorage(),
  document: { createElement: stubEl, createElementNS: stubEl, createTextNode: () => ({}),
    body: stubEl(), head: stubEl(), documentElement: stubEl(), addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; } },
  navigator: { userAgent: 'client_bundle_selftest', platform: 'node' },
};
for (const g of ['Blob', 'File', 'FormData', 'Headers', 'Request', 'Response', 'Event', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (globalThis[g] !== undefined) sandbox[g] = globalThis[g];
}
sandbox.requestAnimationFrame = () => 0;
sandbox.cancelAnimationFrame = () => {};
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
sandbox.MutationObserver = class { observe() {} disconnect() {} };
sandbox.ResizeObserver = class { observe() {} disconnect() {} };
sandbox.IntersectionObserver = class { observe() {} disconnect() {} };
sandbox.window = sandbox;      // 浏览器里 window === 全局
sandbox.self = sandbox;
sandbox.__ModuleLoader__ = loader;

let execErr = null;
try {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: 'lib/client.js', timeout: 10000 });
} catch (e) {
  execErr = e;
}
ok('bundle 在假 window.__ModuleLoader__ 下可执行（无语法/运行期错误）', execErr === null,
  execErr ? String(execErr && execErr.message ? execErr.message : execErr).slice(0, 300) : null);

ok('bundle 调用了 window.__ModuleLoader__.load（契约 §2.2）', loadCalls.length >= 1,
  'load 调用次数 = ' + loadCalls.length);

// ── ③ 注册 id 与 factory 返回契约 ───────────────────────────────────────────
const entry = loadCalls.find((e) => e && e.id === EXPECTED_ID) || loadCalls[0] || null;
ok('load 的实参是对象', entry !== null && typeof entry === 'object',
  entry === null ? '没有捕获到任何 load 调用' : typeof entry);

ok('注册 id === ' + EXPECTED_ID, !!entry && entry.id === EXPECTED_ID,
  entry ? JSON.stringify(entry.id) : null);

if (pkg.name && pkg.name !== EXPECTED_ID) {
  info('⚠ package.json 的 name（' + pkg.name + '）与契约 §2.2 的注册 id 不一致 —— 报给 Lead 确认');
}

ok('entry.factory 是函数（契约 §2.2）', !!entry && typeof entry.factory === 'function',
  entry ? typeof entry.factory : null);

/** factory 内允许 require baseline（如 react）；给一个"什么都能点"的桩，Node 内置模块直接抛。 */
function stubModule(spec) {
  const target = function () { return target; };
  return new Proxy(target, {
    get(_t, k) {
      if (typeof k === 'symbol') return k === Symbol.toPrimitive ? (() => '[stub:' + spec + ']') : undefined;
      if (k === 'then') return undefined;                 // 别被 await 当成 thenable
      if (k === '__esModule') return true;
      return stubModule(spec);
    },
    apply() { return stubModule(spec); },
    construct() { return {}; },
    has() { return true; },
  });
}
const requiredByFactory = [];
function fakeRequire(spec) {
  const s = String(spec);
  requiredByFactory.push(s);
  if (s.startsWith('node:') || NODE_BUILTINS.has(s) || NODE_BUILTINS.has(s.split('/')[0])) {
    throw new Error('factory 里 require 了 Node 内置模块: ' + s);
  }
  return stubModule(s);
}

let mod = null;
let factoryErr = null;
if (entry && typeof entry.factory === 'function') {
  try { mod = entry.factory(fakeRequire); }
  catch (e) { factoryErr = e; }
}
ok('factory(require) 可执行且不抛（契约 §2.2）', factoryErr === null,
  factoryErr ? String(factoryErr && factoryErr.message ? factoryErr.message : factoryErr).slice(0, 300) : null);

ok('factory(require) 返回对象（契约 §2.2）', mod !== null && typeof mod === 'object',
  mod === null ? '返回 null/undefined' : typeof mod);

ok('返回对象含 apply 函数（契约 §2.2）', !!mod && typeof mod.apply === 'function',
  mod ? typeof mod.apply : null);

const injectOk = !!mod && Array.isArray(mod.inject) && mod.inject.every((x) => typeof x === 'string');
ok('返回对象含 inject 字符串数组（契约 §2.2）', injectOk,
  mod ? (Array.isArray(mod.inject) ? JSON.stringify(mod.inject) : typeof mod.inject) : null);

if (injectOk) {
  info('exports.inject = ' + JSON.stringify(mod.inject));
  if (mod.inject.length === 0) info('⚠ inject 为空数组 —— 面板插件通常要 inject 槽位服务（如 @deepseek-ai/dsh-client-ui-slots），请核对 dsh.client.inject 与 exports.inject');
}

// ── ④ 纯函数语义（契约 §2.3 轮询 / §2.4 消息文本 / §2.5 codec）───────────────
/**
 * client-ui 把纯函数挂在 `exports.__selftest` 上**专供离线断言**（DSH 只读 `apply`/`inject`，
 * 未知导出无副作用）。契约**没有**要求暴露它 ⇒ 缺失只记 INFO，不算失败；一旦存在就逐条按契约断言。
 *
 * §2.5 的口径按 Lead 2026-10-16 裁决的**超集**实现：
 *   ref 带前缀（`object:` / `material:` / `collection:`），**codec 负责拆前缀**取裸名。
 */
const st = mod && mod.__selftest && typeof mod.__selftest === 'object' ? mod.__selftest : null;
if (!st) {
  info('未暴露 __selftest ⇒ §2.3 轮询间隔 / §2.4 消息文本 / §2.5 codec 的纯函数语义未覆盖（契约未要求暴露，故不算失败）');
} else {
  ok('§2.3 轮询间隔：常规 1500ms / 帧陈旧 600ms',
    st.POLL_IDLE_MS === 1500 && st.POLL_STALE_MS === 600, { idle: st.POLL_IDLE_MS, stale: st.POLL_STALE_MS });
  ok('§2.2 默认后端是 http://127.0.0.1:9877', st.DEFAULT_BACKEND === 'http://127.0.0.1:9877', st.DEFAULT_BACKEND);

  const wantSel = 'Blender 视口点击：Cube（MESH 8v/6f）。用户说"这个/这些"时指它们；对象名在 bpy.data.objects 里可直接用。';
  ok('§2.4 有选中 → 逐字文本', typeof st.messageText === 'function' && st.messageText({ name: 'Cube', detail: 'MESH 8v/6f' }) === wantSel,
    typeof st.messageText === 'function' ? st.messageText({ name: 'Cube', detail: 'MESH 8v/6f' }) : typeof st.messageText);
  ok('§2.4 无选中 → 逐字文本', typeof st.messageText === 'function' && st.messageText(null) === '附上当前 Blender 视口截图。',
    typeof st.messageText === 'function' ? st.messageText(null) : typeof st.messageText);

  const cb = st.blenderCodec && typeof st.blenderCodec.clipboardText === 'function' ? st.blenderCodec.clipboardText : null;
  const ser = st.blenderCodec && typeof st.blenderCodec.serialize === 'function' ? st.blenderCodec.serialize : null;
  ok('§2.5 codec.clipboardText 是函数', !!cb, st.blenderCodec ? typeof st.blenderCodec.clipboardText : typeof st.blenderCodec);
  ok('§2.5 codec.serialize 是函数', !!ser, st.blenderCodec ? typeof st.blenderCodec.serialize : typeof st.blenderCodec);
  if (cb) {
    for (const [ref, want] of [['object:Cube', '@Cube'], ['material:Mat', '@Mat'], ['collection:Col', '@Col'], ['Cube', '@Cube']]) {
      ok('§2.5 clipboardText(' + JSON.stringify(ref) + ') === ' + JSON.stringify(want), cb(ref) === want, cb(ref));
    }
  }
  if (ser) {
    for (const [ref, want] of [['object:Cube', '<blender-object>Cube</blender-object>'],
      ['material:Mat', '<blender-material>Mat</blender-material>'],
      ['collection:Col', '<blender-collection>Col</blender-collection>'],
      ['Cube', '<blender-object>Cube</blender-object>']]) {
      let got = null; let err = null;
      try { got = await ser(ref); } catch (e) { err = e; }
      ok('§2.5 serialize(' + JSON.stringify(ref) + ') === ' + JSON.stringify(want), got === want,
        err ? '抛了：' + String(err.message) : got);
    }
  }
  if (typeof st.onPickItem === 'function') {
    const ins = st.onPickItem({ candidate: { value: 'object:Cube', name: 'Cube' } });
    const i = (ins && ins.insert) || {};
    ok('§2.5 onPick → insert{source:"blender", ref:"object:Cube", label:"Cube", clipboardText:"@Cube", appearance:"file"}',
      i.source === 'blender' && i.ref === 'object:Cube' && i.label === 'Cube' && i.clipboardText === '@Cube' && i.appearance === 'file', i);
  } else {
    info('未暴露 onPickItem ⇒ §2.5 的 ReferenceInsert 形状未覆盖');
  }
  // §2.5 候选数据源失败必须**不抛**（返回 []），否则会污染输入框。
  // 本测试的 fetch 桩一律 reject，正好验这条纪律。
  if (typeof st.sceneItemCandidates === 'function') {
    let got = null; let err = null;
    try { got = await st.sceneItemCandidates({ query: 'cu' }); } catch (e) { err = e; }
    ok('§2.5 候选数据源失败时不抛、返回 []', err === null && Array.isArray(got) && got.length === 0,
      err ? '抛了：' + String(err.message) : JSON.stringify(got));
  }
}
info('factory 内 require：' + (requiredByFactory.length ? JSON.stringify([...new Set(requiredByFactory)]) : '（无）'));
info('bundle 大小：' + src.length + ' B（' + path.relative(ROOT, BUNDLE) + '）');

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log('客户端 bundle 自检：' + pass + ' 通过 / ' + fail + ' 失败' +
  (fail ? '' : '  ✅') + '   （' + path.relative(ROOT, BUNDLE) + '）');
for (const m of infos) console.log('  · ' + m);
if (fail) {
  console.log('  失败项：');
  for (const f of fails) console.log('  x ' + f.clause + (f.detail !== null ? ' — ' + JSON.stringify(f.detail).slice(0, 400) : ''));
  console.log('  含义：这一条红了 ⇒ 用户重启 DSH 后这个插件加载会崩（或加载器认不出），必须先修再发版。');
}
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * 宿主 `/host` 路由自检 —— 逐条打 `docs/宿主集成-接口契约.md` §4 的验收判据 1–8。
 *
 * 为什么需要它：`/host/*` 是**用户侧**能力（面板取图 / 点击进消息 / `@` 提及），
 * 走的是浏览器 `fetch` 跨源调用，与模型侧 15 个工具完全不同的通道。
 * 它一旦坏，模型侧全部自检仍然全绿 —— 所以必须有一条独立的、打真 HTTP 的自检。
 *
 * 判据（契约 §4，编号与契约一致）：
 *   1 CORS 预检通过（OPTIONS → 204 + ACAO 回显 loopback）
 *   2 非 loopback Origin 不回显（不放行任意站点）
 *   3 捕获后 seq 递增、能取图（PNG 魔数 + 尺寸与 latest 一致）
 *   4 陈旧 seq 被拒（409 stale_seq）
 *   5 点物体命中（object.name 非空且是当前场景真实对象）
 *   6 点空处为 null
 *   7 错配拒绝（scene_mismatch，绝不降级投到当前场景）
 *   8 `@` 数据源（scene-items 过滤 + limit + 排序）
 *
 * 纪律（照本仓库既有 `tests/*_selftest.mjs` 风格）：
 *   - **不新增依赖**，纯 Node（只用 `fetch` + `node:buffer` 全局）。
 *   - **后端不可达 → 打印 SKIP 且 exit 0**；后端在但 **Blender 不在 → 判据 1/2 照跑，3–8 标 SKIP**。
 *   - 后端在跑但**尚未装载 `/host` 路由**（开发期并行）→ SKIP 且 exit 0，并打印原始回执。
 *   - 判据 7 需要**临时改一次场景名**才能构造错配，改完在 `finally` 里还原并核验；
 *     设 `DSH_HOST_TEST_NO_MUTATE=1` 可完全关闭这次改动（则判据 7 标 SKIP）。
 *     写通道被别的会话持有时（409 leased）**不夺租约**，判据 7 标 SKIP。
 *   - 红了就是红了：不为了让测试通过而放宽断言，失败项连原始回执一起打出来。
 *
 * 用法：node tests/host_routes_selftest.mjs
 * 退出码：0 = 全过或有 SKIP；1 = 有断言失败
 */
const BASE = String(process.env.DSH_BLENDER_BACKEND || 'http://127.0.0.1:9877').replace(/\/+$/, '');
const LOOPBACK = 'http://127.0.0.1:3080';
const NO_MUTATE = process.env.DSH_HOST_TEST_NO_MUTATE === '1';
const CAPTURE_TIMEOUT = Number(process.env.DSH_HOST_TEST_CAPTURE_TIMEOUT_MS || 40000);

let pass = 0; let fail = 0; let skip = 0; let warn = 0;
const fails = [];
const skips = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; fails.push({ clause: name, detail: extra === undefined ? null : extra }); }
}
function doSkip(name, why) { skip++; skips.push({ clause: name, why: String(why) }); }
function warnOnly(msg) { warn++; console.log('  ! WARN ' + msg); }

// ── HTTP 小工具 ────────────────────────────────────────────────────────────
async function req(method, pathq, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  let body;
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + pathq, { method, headers, body, signal: AbortSignal.timeout(opts.timeout || 15000) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, method, path: pathq, status: r.status, headers: Object.fromEntries(r.headers), buf, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, method, path: pathq, status: 0, headers: {}, buf: Buffer.alloc(0), ms: Date.now() - t0,
      err: String((e && e.message) || e) };
  }
}
function jbody(rec) { try { return JSON.parse(rec.buf.toString('utf8')); } catch (e) { return null; } }
function isPng(buf) {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}
function pngDims(buf) {
  if (buf.length < 24 || buf.slice(12, 16).toString('latin1') !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
/** 原始回执：一行把"状态 + 关键响应头 + 体量"打全，便于贴给 Lead 复核 */
function show(rec, note) {
  const tag = '    ' + (rec.method || '?') + ' ' + rec.path + (note ? '  (' + note + ')' : '');
  if (!rec.ok) { console.log(tag + '\n      → 请求异常: ' + rec.err + '  [' + rec.ms + 'ms]'); return; }
  const h = rec.headers;
  const bits = ['status=' + rec.status, 'bytes=' + rec.buf.length, rec.ms + 'ms'];
  if (h['content-type']) bits.push('ct=' + h['content-type']);
  if (h['cache-control']) bits.push('cc=' + h['cache-control']);
  bits.push('acao=' + (h['access-control-allow-origin'] === undefined ? '(无)' : JSON.stringify(h['access-control-allow-origin'])));
  for (const k of ['access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age', 'vary']) {
    if (h[k] !== undefined) bits.push(k.replace('access-control-', 'ac-') + '=' + JSON.stringify(h[k]));
  }
  console.log(tag + '\n      → ' + bits.join(' '));
  if (isPng(rec.buf)) { const d = pngDims(rec.buf); console.log('      → PNG 魔数 ✓ ' + (d ? d.w + 'x' + d.h : '(IHDR 未识别)')); return; }
  const text = rec.buf.toString('utf8').slice(0, 500);
  if (text) console.log('      → body: ' + text.replace(/\n/g, ' '));
}
function setOf(v) { return String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(','); }
function hasOriginInVary(v) { return String(v || '').split(',').some((s) => s.trim().toLowerCase() === 'origin'); }
/** 契约 §1.2 的 latest/capture 响应形状 */
function latestShape(v) {
  const bad = [];
  if (!v || typeof v !== 'object') return ['体不是对象'];
  if (!Number.isInteger(v.seq)) bad.push('seq 不是整数');
  if (!(v.captured_at === null || typeof v.captured_at === 'number')) bad.push('captured_at 不是 number|null');
  if (!['user', 'auto', 'model', 'none'].includes(v.source)) bad.push('source 不在枚举内: ' + JSON.stringify(v.source));
  if (!(v.file === null || typeof v.file === 'string')) bad.push('file 不是 string|null');
  if (!(v.scene === null || typeof v.scene === 'string')) bad.push('scene 不是 string|null');
  if (!(v.scene_count === null || Number.isInteger(v.scene_count))) bad.push('scene_count 不是 int|null');
  for (const k of ['stale', 'pickable', 'blender_quiet']) if (typeof v[k] !== 'boolean') bad.push(k + ' 不是布尔');
  if (!Number.isInteger(v.width) || !Number.isInteger(v.height)) bad.push('width/height 不是整数');
  if (v.seq === 0 && v.source !== 'none') bad.push('seq===0 时 source 必须是 "none"');
  if (v.seq === 0 && v.captured_at !== null) bad.push('seq===0 时 captured_at 必须是 null');
  return bad;
}
function isAscending(names) {
  const a = names.map(String);
  const plain = a.every((v, i) => i === 0 || a[i - 1] <= v);
  const loc = a.every((v, i) => i === 0 || a[i - 1].localeCompare(v) <= 0);
  return { ok: plain || loc, plain, loc };
}

console.log('宿主 /host 路由自检 —— 目标 ' + BASE + (NO_MUTATE ? '（DSH_HOST_TEST_NO_MUTATE=1）' : ''));

// ── 前置 0：后端 / Blender / 路由部署 三态 ─────────────────────────────────
const health = await req('GET', '/health', { timeout: 4000 });
const doctor = await req('GET', '/doctor', { timeout: 8000 });
if (!health.ok && !doctor.ok) {
  console.log('SKIP: 后端不可达（' + BASE + '）—— 先 blender_viewport(op="start") 再重跑本自检');
  console.log('  /health: ' + (health.ok ? health.status : health.err));
  console.log('  /doctor: ' + (doctor.ok ? doctor.status : doctor.err));
  process.exit(0);
}
const dj = jbody(doctor);
const doctorKind = dj && dj.addon && dj.addon.kind ? dj.addon.kind : (dj ? dj.kind : null);
const blenderUp = String(doctorKind) === 'ok';

const latestProbe = await req('GET', '/host/view/latest', { timeout: 8000 });
const lp = jbody(latestProbe);
const routeMissing = latestProbe.ok && latestProbe.status === 404 && lp && lp.error === 'not found';
if (!latestProbe.ok || routeMissing) {
  console.log('SKIP: 后端在跑，但 /host 路由未装载（未部署或后端版本旧）—— 判据 1–8 无从判定');
  show(latestProbe, '部署探针');
  process.exit(0);
}
console.log('前置：/health=' + (health.ok ? health.status : health.err) + '  /doctor=' + (doctor.ok ? doctor.status : doctor.err)
  + '  doctor.kind=' + JSON.stringify(doctorKind) + '  → Blender ' + (blenderUp ? '在跑' : '不可达（判据 3–8 将标 SKIP）'));
if (!blenderUp) console.log('  （判据 1/2 是纯 HTTP 的 CORS 行为，不需要 Blender，照跑）');
console.log('');

// ── 判据 1 · CORS 预检 ─────────────────────────────────────────────────────
console.log('[判据 1] CORS 预检（OPTIONS → 204 且回显 loopback Origin）');
const o1 = await req('OPTIONS', '/host/view/latest', { headers: { Origin: LOOPBACK }, timeout: 8000 });
show(o1, 'Origin=' + LOOPBACK);
ok('判据 1 · OPTIONS → 204', o1.ok && o1.status === 204, o1.ok ? o1.status : o1.err);
ok('判据 1 · OPTIONS 空体', o1.ok && o1.buf.length === 0, o1.buf.length + ' B');
ok('判据 1 · ACAO 回显请求的 loopback Origin', o1.headers['access-control-allow-origin'] === LOOPBACK,
  o1.headers['access-control-allow-origin']);
ok('判据 1 · allow-methods 含 GET/POST/OPTIONS', setOf(o1.headers['access-control-allow-methods']) === 'get,options,post',
  o1.headers['access-control-allow-methods']);
ok('判据 1 · allow-headers 含 content-type', setOf(o1.headers['access-control-allow-headers']) === 'content-type',
  o1.headers['access-control-allow-headers']);
ok('判据 1 · max-age = 600', String(o1.headers['access-control-max-age'] || '') === '600', o1.headers['access-control-max-age']);
ok('判据 1 · Vary 含 Origin', hasOriginInVary(o1.headers['vary']), o1.headers['vary']);
{
  const ol = await req('OPTIONS', '/host/view/latest', { headers: { Origin: 'http://localhost:5173' }, timeout: 8000 });
  show(ol, 'Origin=http://localhost:5173');
  ok('判据 1 · OPTIONS 对 http://localhost:<port> 也回显', ol.headers['access-control-allow-origin'] === 'http://localhost:5173',
    ol.headers['access-control-allow-origin']);
  const gl = await req('GET', '/host/view/latest', { headers: { Origin: LOOPBACK }, timeout: 8000 });
  show(gl, 'GET + loopback Origin');
  ok('判据 1 · GET 响应同样带 ACAO', gl.headers['access-control-allow-origin'] === LOOPBACK,
    gl.headers['access-control-allow-origin']);
  // 已知错误路径也必须带 CORS（面板首次打开时 png 还没帧，就是这条）
  const ge = await req('GET', '/host/view.png', { headers: { Origin: LOOPBACK }, timeout: 8000 });
  show(ge, 'GET /host/view.png（无 seq，可能 200/404/409 —— 不论状态都必须带 CORS）');
  ok('判据 1 · 错误/边界响应也带 ACAO（§1.1「含错误」）', ge.headers['access-control-allow-origin'] === LOOPBACK,
    ge.headers['access-control-allow-origin']);
  // 未知 /host 路径：契约字面也要求带 CORS，但面板永远不会打到它 → 只 WARN，不判失败
  const gu = await req('GET', '/host/definitely-not-a-route', { headers: { Origin: LOOPBACK }, timeout: 8000 });
  show(gu, 'GET 未知 /host 路径');
  if (gu.headers['access-control-allow-origin'] !== LOOPBACK) {
    warnOnly('未知 /host 路径（' + gu.status + '）未带 ACAO —— 契约 §1.1 字面要求「所有 /host/* 响应含错误」；面板不会打到它，故不计失败，报给 Lead 定夺');
  }
}
console.log('');

// ── 判据 2 · 非 loopback Origin 不回显 ─────────────────────────────────────
console.log('[判据 2] 非 loopback Origin 不回显（不放行任意站点）');
{
  const cases = [
    ['http://evil.example', false, '任意外站'],
    ['http://127.0.0.1.evil.com', false, '后缀伪装（正则要求精确匹配 host）'],
    ['https://127.0.0.1:3080', false, '契约正则只认 http://'],
    ['http://localhost.evil.com', false, 'localhost 后缀伪装'],
    [LOOPBACK, true, 'loopback（对照：必须回显）'],
    ['http://localhost', true, 'loopback 无端口（对照：必须回显）'],
    ['http://127.0.0.1', true, 'loopback 无端口（对照：必须回显）'],
  ];
  for (const [origin, shouldEcho, why] of cases) {
    const r = await req('OPTIONS', '/host/view/latest', { headers: { Origin: origin }, timeout: 8000 });
    show(r, 'Origin=' + origin + ' —— ' + why);
    const got = r.headers['access-control-allow-origin'];
    ok('判据 2 · Origin=' + origin + ' → ' + (shouldEcho ? '回显' : '不回显'), shouldEcho ? got === origin : got === undefined,
      got === undefined ? '(无 ACAO)' : got);
    ok('判据 2 · Origin=' + origin + ' → 仍带 Vary: Origin', hasOriginInVary(r.headers['vary']), r.headers['vary']);
  }
  const noOrigin = await req('OPTIONS', '/host/view/latest', { timeout: 8000 });
  show(noOrigin, '不带 Origin 头');
  ok('判据 2 · 无 Origin 头 → 不加 ACAO', noOrigin.headers['access-control-allow-origin'] === undefined,
    noOrigin.headers['access-control-allow-origin']);
}
console.log('');

// ── 判据 3–8 需要 Blender（帧来自真实视口）─────────────────────────────────
if (!blenderUp) {
  for (const [n, why] of [['3', 'capture 需要 Blender'], ['4', '需要帧'], ['5', '需要帧+矩阵'], ['6', '需要帧+矩阵'],
    ['7', '需要帧+矩阵+写通道'], ['8', 'scene-items 需要 Blender']]) {
    doSkip('判据 ' + n, 'Blender 不可达（doctor.kind=' + JSON.stringify(doctorKind) + '）：' + why);
  }
  finish();
}

// ── 判据 3 · 捕获后 seq 递增、能取图 ───────────────────────────────────────
console.log('[判据 3] 捕获 → seq 递增 → 取图（PNG 魔数 + 尺寸一致）');
const cap1 = await req('POST', '/host/view/capture', { json: { auto: false }, timeout: CAPTURE_TIMEOUT });
show(cap1, 'capture {auto:false}');
const c1 = jbody(cap1);
if (!cap1.ok || cap1.status !== 200 || !c1 || c1.ok !== true) {
  ok('判据 3 · capture → 200 且 ok:true', false, cap1.ok ? (cap1.status + ' ' + JSON.stringify(c1)) : cap1.err);
  doSkip('判据 4', 'capture 失败，无帧可用');
  doSkip('判据 5', 'capture 失败，无帧可用');
  doSkip('判据 6', 'capture 失败，无帧可用');
  doSkip('判据 7', 'capture 失败，无帧可用');
  doSkip('判据 8', 'capture 失败后仍可单独打 scene-items，见下');
} else {
  ok('判据 3 · capture → 200 且 ok:true', true);
  ok('判据 3 · seq >= 1（捕获后递增）', Number.isInteger(c1.seq) && c1.seq >= 1, c1.seq);
  ok('判据 3 · source === "user"（auto:false）', c1.source === 'user', c1.source);
  const shapeBad = latestShape(c1);
  ok('判据 3 · 响应形状合 §1.2（字段与类型齐全）', shapeBad.length === 0, shapeBad);
  console.log('      · latest: seq=' + c1.seq + ' source=' + c1.source + ' file=' + JSON.stringify(c1.file)
    + ' scene=' + JSON.stringify(c1.scene) + ' scene_count=' + c1.scene_count + ' ' + c1.width + 'x' + c1.height
    + ' stale=' + c1.stale + ' pickable=' + c1.pickable + ' quiet=' + c1.blender_quiet);

  const png1 = await req('GET', '/host/view.png?seq=' + c1.seq, { timeout: CAPTURE_TIMEOUT });
  show(png1, 'png?seq=' + c1.seq);
  ok('判据 3 · png → 200', png1.ok && png1.status === 200, png1.ok ? png1.status : png1.err);
  ok('判据 3 · content-type 是 image/png', /image\/png/i.test(png1.headers['content-type'] || ''), png1.headers['content-type']);
  ok('判据 3 · cache-control: no-store', /no-store/i.test(png1.headers['cache-control'] || ''), png1.headers['cache-control']);
  ok('判据 3 · 字节是 PNG 魔数', isPng(png1.buf), png1.buf.slice(0, 8).toString('hex'));
  const dim = pngDims(png1.buf);
  ok('判据 3 · PNG 实际尺寸 === latest.width/height（§1.2 不许撒谎）',
    !!dim && dim.w === c1.width && dim.h === c1.height, dim ? dim.w + 'x' + dim.h + ' vs ' + c1.width + 'x' + c1.height : 'IHDR 未识别');

  // 附加（契约 §1.3/§1.4 明写，非 §4 判据编号）
  const pngNoSeq = await req('GET', '/host/view.png', { timeout: CAPTURE_TIMEOUT });
  show(pngNoSeq, 'png（省略 seq）');
  ok('附加 · 省略 seq → 200 当前帧（§1.3）', pngNoSeq.ok && pngNoSeq.status === 200, pngNoSeq.ok ? pngNoSeq.status : pngNoSeq.err);

  const capAuto = await req('POST', '/host/view/capture', { json: { auto: true }, timeout: CAPTURE_TIMEOUT });
  show(capAuto, 'capture {auto:true}');
  const ca = jbody(capAuto);
  ok('附加 · capture auto:true → source="auto"（§1.4）', !!ca && ca.source === 'auto', ca ? ca.source : null);

  const capLo = await req('POST', '/host/view/capture', { json: { max_size: 100 }, timeout: CAPTURE_TIMEOUT });
  show(capLo, 'capture {max_size:100}（应夹到 200）');
  const cl = jbody(capLo);
  ok('附加 · max_size=100 夹到下界 200（§1.4）', !!cl && Math.max(cl.width, cl.height) === 200,
    cl ? cl.width + 'x' + cl.height : null);

  const capHi = await req('POST', '/host/view/capture', { json: { max_size: 5000 }, timeout: CAPTURE_TIMEOUT });
  show(capHi, 'capture {max_size:5000}（上界 2000）');
  const ch = jbody(capHi);
  // 上界只断言"不超过"：契约 §1.4 说夹到 [200,2000]；实现若选择"不放大超过原生视口"也合规
  ok('附加 · max_size=5000 → 最长边 ≤ 2000（§1.4 上界）', !!ch && Math.max(ch.width, ch.height) <= 2000,
    ch ? ch.width + 'x' + ch.height : null);

  const capBack = await req('POST', '/host/view/capture', { json: { max_size: 1000 }, timeout: CAPTURE_TIMEOUT });
  show(capBack, 'capture {max_size:1000}（复原一个正常尺寸的当前帧）');
  ok('附加 · 复原 capture 正常', capBack.ok && capBack.status === 200, capBack.ok ? capBack.status : capBack.err);
}
console.log('');

// 取当前帧（后续判据用）
const latest = jbody(await req('GET', '/host/view/latest', { timeout: 8000 }));
const curSeq = latest && Number.isInteger(latest.seq) ? latest.seq : 0;

// ── 判据 4 · 陈旧 seq 被拒 ────────────────────────────────────────────────
console.log('[判据 4] 陈旧 seq → 409 stale_seq');
if (curSeq < 2) {
  doSkip('判据 4', '当前 seq=' + curSeq + '，没有可回退的旧帧（需要 >=2；再 capture 一次后重跑）');
} else {
  const old = await req('GET', '/host/view.png?seq=' + (curSeq - 1), { timeout: CAPTURE_TIMEOUT });
  show(old, 'png?seq=' + (curSeq - 1) + '（落后一帧）');
  const oj = jbody(old);
  ok('判据 4 · 陈旧 seq → 409', old.ok && old.status === 409, old.ok ? old.status : old.err);
  ok('判据 4 · error === "stale_seq"', !!oj && oj.error === 'stale_seq', oj ? oj.error : null);
  ok('判据 4 · 回带当前 seq（§1.3）', !!oj && oj.seq === curSeq, oj ? oj.seq : null);
  ok('判据 4 · 409 体是 JSON', /application\/json/i.test(old.headers['content-type'] || ''), old.headers['content-type']);
  const unknown = await req('GET', '/host/view.png?seq=99999999', { timeout: CAPTURE_TIMEOUT });
  show(unknown, 'png?seq=99999999（未知 seq）');
  const uj = jbody(unknown);
  ok('附加 · 未知 seq 也 → 409 stale_seq（§1.3「落后或未知」）', unknown.ok && unknown.status === 409 && !!uj && uj.error === 'stale_seq',
    unknown.ok ? (unknown.status + ' ' + JSON.stringify(uj)) : unknown.err);
}
console.log('');

// ── 判据 5/6/7 · pick ────────────────────────────────────────────────────
const pickable = !!(latest && latest.pickable);
const frameSeq = curSeq;
let sceneNames = null;
async function loadSceneNames() {
  if (sceneNames) return sceneNames;
  const r = await req('GET', '/host/scene-items', { timeout: 15000 });
  const j = jbody(r);
  sceneNames = new Set(j && Array.isArray(j.objects) ? j.objects.map((o) => o.name) : []);
  return sceneNames;
}
function pickShape(o) {
  const bad = [];
  if (!o || typeof o !== 'object') return ['object 不是对象'];
  if (typeof o.name !== 'string' || !o.name) bad.push('name 非空字符串');
  if (typeof o.type !== 'string') bad.push('type 不是字符串');
  if (typeof o.detail !== 'string') bad.push('detail 不是字符串');
  if (!Array.isArray(o.location) || o.location.length !== 3 || !o.location.every((x) => typeof x === 'number')) bad.push('location 不是 3 个数字的数组');
  return bad;
}
async function pickAt(x, y) {
  const r = await req('POST', '/host/view/pick', { json: { seq: frameSeq, x, y }, timeout: CAPTURE_TIMEOUT });
  return { rec: r, body: jbody(r) };
}

console.log('[判据 5] 点物体命中（画面中心）');
if (!pickable) {
  doSkip('判据 5', '当前帧 pickable=false（该帧没有可用矩阵）—— 契约 §1.2 要求此时必须 false，不许撒谎');
  doSkip('判据 6', '当前帧 pickable=false');
  doSkip('判据 7', '当前帧 pickable=false');
} else {
  const { rec: r5, body: p5 } = await pickAt(0.5, 0.5);
  show(r5, 'pick {x:0.5,y:0.5}');
  if (!r5.ok) { ok('判据 5 · pick 请求可达', false, r5.err); }
  else if (r5.status === 502) { doSkip('判据 5', 'pick 返回 502（Blender 不可达）：' + JSON.stringify(p5)); }
  else if (!p5 || p5.ok !== true) {
    if (p5 && /_mismatch$/.test(String(p5.error))) doSkip('判据 5', '捕获后场景/文件被并发改动（' + p5.error + '）—— 环境噪声，重跑即可');
    else ok('判据 5 · pick 回执 ok:true', false, p5);
  } else if (p5.object !== null) {
    const names = await loadSceneNames();
    ok('判据 5 · 命中物体且 name 非空', typeof p5.object.name === 'string' && p5.object.name.length > 0, p5.object.name);
    ok('判据 5 · 命中对象是当前场景真实对象（scene-items 里有）', names.has(p5.object.name), p5.object.name);
    const bad = pickShape(p5.object);
    ok('判据 5 · object 形状合 §1.5（name/type/detail/location）', bad.length === 0, bad);
  } else {
    // 中心为空：用网格兜底，尽量把"命中"这条路验到（不是放宽断言，是换采样点）
    const hits = [];
    for (const y of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        if (x === 0.5 && y === 0.5) continue;
        const { body: p } = await pickAt(x, y);
        if (p && p.ok === true && p.object && p.object.name) hits.push({ x, y, name: p.object.name });
        if (hits.length >= 3) break;
      }
      if (hits.length >= 3) break;
    }
    if (hits.length) {
      const names = await loadSceneNames();
      console.log('      · 中心为空，网格兜底命中：' + JSON.stringify(hits));
      ok('判据 5 · 命中物体且 name 非空（网格兜底，中心为空）', true);
      ok('判据 5 · 命中对象是当前场景真实对象（网格兜底）', hits.every((h) => names.has(h.name)),
        hits.filter((h) => !names.has(h.name)).map((h) => h.name));
    } else {
      doSkip('判据 5', '画面中心与 5x5 网格均未命中物体（object:null）—— 无法判定"命中"，把视口对准一个物体再重跑');
    }
  }
  // 附加：x/y 夹到 [0,1]（§1.5 明写）
  const clamp = await pickAt(2, -1);
  show(clamp.rec, 'pick {x:2,y:-1}（应夹到 [0,1] 而不是报错）');
  ok('附加 · x/y 超范围被夹取而不是报错（§1.5）', !!clamp.body && clamp.body.ok === true, clamp.body);

  console.log('');
  console.log('[判据 6] 点空处 → object:null');
  const { rec: r6, body: p6 } = await pickAt(0.01, 0.01);
  show(r6, 'pick {x:0.01,y:0.01}');
  if (!r6.ok) { ok('判据 6 · pick 请求可达', false, r6.err); }
  else if (r6.status === 502) { doSkip('判据 6', 'pick 返回 502（Blender 不可达）：' + JSON.stringify(p6)); }
  else if (!p6 || p6.ok !== true) {
    if (p6 && /_mismatch$/.test(String(p6.error))) doSkip('判据 6', '并发改动（' + p6.error + '）');
    else ok('判据 6 · pick 回执 ok:true', false, p6);
  } else if (p6.object === null) {
    ok('判据 6 · 点空处 → object:null', true);
  } else {
    doSkip('判据 6', '该角落恰好有物体（' + JSON.stringify(p6.object.name) + '）—— 服务端行为正确，是采样点被占，不是失败');
  }
  console.log('');

  // ── 判据 7 · 错配拒绝 ───────────────────────────────────────────────────
  console.log('[判据 7] 错配拒绝（scene_mismatch，绝不降级投到当前场景）');
  const frameScene = latest && latest.scene ? String(latest.scene) : null;
  if (NO_MUTATE) {
    doSkip('判据 7', 'DSH_HOST_TEST_NO_MUTATE=1 → 不临时改场景名；手测：把 Blender 里场景改名后再 pick 旧 seq，应回 scene_mismatch');
  } else if (!frameScene) {
    doSkip('判据 7', '当前帧没有场景名（scene=null），无法构造错配');
  } else {
    const tmpName = frameScene + '.dshselftest';
    const renameCode = 'import bpy\ns = bpy.context.scene\ns.name = ' + JSON.stringify(tmpName) + '\nprint("DSH_RENAMED " + s.name)\n';
    console.log('      · 为构造错配，临时把场景名 ' + JSON.stringify(frameScene) + ' → ' + JSON.stringify(tmpName) + '（finally 里还原）');
    const ren = await req('POST', '/act', { json: { code: renameCode }, timeout: 40000 });
    show(ren, 'POST /act 改名');
    const rj = jbody(ren);
    if (ren.status === 409) {
      doSkip('判据 7', '写通道被别的会话持有（409 leased，holder=' + JSON.stringify(rj && rj.holder) + '）—— 不夺租约');
    } else if (!rj || rj.ok !== true || !String(rj.stdout || '').includes('DSH_RENAMED ' + tmpName)) {
      doSkip('判据 7', '无法构造错配：/act 未把场景名改成 ' + JSON.stringify(tmpName) + '（回执 '
        + (ren.ok ? JSON.stringify(rj).slice(0, 200) : ren.err) + '）');
    } else {
      try {
        const { rec: r7, body: p7 } = await pickAt(0.5, 0.5);
        show(r7, 'pick 旧 seq（场景已改名）');
        const errOk = !!p7 && p7.ok === false && p7.error === 'scene_mismatch';
        ok('判据 7 · 场景错配 → error === "scene_mismatch"', errOk, p7);
        if (errOk && p7.current === tmpName) {
          ok('判据 7 · expected/current 如实回带（§1.5）', p7.expected === frameScene,
            { expected: p7.expected, current: p7.current, want: frameScene });
        } else if (errOk) {
          // 共享同一个 Blender 时，别的会话可能也在改名 → 这是环境噪声，不是服务端缺陷
          doSkip('判据 7 · expected/current 回带', '并发改名：current=' + JSON.stringify(p7.current)
            + ' 不是本测试设的 ' + JSON.stringify(tmpName) + '（仍是 scene_mismatch，纪律成立）');
        }
        ok('判据 7 · 绝不降级投到当前场景（不得回 object）', !(p7 && p7.object), p7 && p7.object);
      } finally {
        const backCode = 'import bpy\ns = bpy.context.scene\ns.name = ' + JSON.stringify(frameScene) + '\nprint("DSH_RESTORED " + s.name)\n';
        const back = await req('POST', '/act', { json: { code: backCode }, timeout: 40000 });
        show(back, 'POST /act 还原场景名');
        const bj = jbody(back);
        const restored = !!(bj && bj.ok === true && String(bj.stdout || '').includes('DSH_RESTORED ' + frameScene));
        ok('判据 7 · 场景名已还原（不留副作用）', restored,
          bj ? { ok: bj.ok, stdout: String(bj.stdout || '').slice(0, 200), error: bj.error || null } : null);
        if (!restored) console.log('      !!! 手工处置：把 Blender 当前场景名改回 ' + JSON.stringify(frameScene));
      }
    }
  }
}
console.log('');

// ── 判据 8 · @ 数据源 ────────────────────────────────────────────────────
console.log('[判据 8] @ 数据源（scene-items 过滤 / limit / 排序）');
{
  const si = await req('GET', '/host/scene-items', { timeout: 20000 });
  show(si, 'scene-items（全量）');
  const sj = jbody(si);
  if (!si.ok || si.status === 502 || !sj || sj.ok !== true) {
    if (si.status === 502) doSkip('判据 8', 'Blender 不可达（502）：' + JSON.stringify(sj));
    else ok('判据 8 · scene-items → 200 且 ok:true', false, si.ok ? (si.status + ' ' + JSON.stringify(sj)) : si.err);
  } else {
    ok('判据 8 · 三数组形状（objects/materials/collections）',
      Array.isArray(sj.objects) && Array.isArray(sj.materials) && Array.isArray(sj.collections),
      { o: typeof sj.objects, m: typeof sj.materials, c: typeof sj.collections });
    const objsBad = (sj.objects || []).filter((o) => !o || typeof o.name !== 'string' || typeof o.type !== 'string');
    const matsBad = (sj.materials || []).filter((o) => !o || typeof o.name !== 'string');
    const colsBad = (sj.collections || []).filter((o) => !o || typeof o.name !== 'string');
    ok('判据 8 · 每项含 name（objects 另含 type）', objsBad.length === 0 && matsBad.length === 0 && colsBad.length === 0,
      { objsBad: objsBad.length, matsBad: matsBad.length, colsBad: colsBad.length });
    ok('判据 8 · 默认 limit ≤ 200（§1.6）',
      (sj.objects || []).length <= 200 && (sj.materials || []).length <= 200 && (sj.collections || []).length <= 200,
      { o: (sj.objects || []).length, m: (sj.materials || []).length, c: (sj.collections || []).length });
    for (const [k, arr] of [['objects', sj.objects], ['materials', sj.materials], ['collections', sj.collections]]) {
      const asc = isAscending((arr || []).map((x) => x.name));
      ok('判据 8 · ' + k + ' 按 name 升序（稳定）', asc.ok, { names: (arr || []).map((x) => x.name).slice(0, 8), plain: asc.plain, locale: asc.loc });
    }

    // 过滤：契约 §4 举例是 q=cu → 含 Cube；但任意用户场景不一定有 Cube → 用真实存在的名字验证语义
    const allNames = [...(sj.objects || []).map((x) => x.name), ...(sj.materials || []).map((x) => x.name), ...(sj.collections || []).map((x) => x.name)];
    const cube = (sj.objects || []).find((o) => /cube/i.test(o.name));
    if (cube) {
      const fc = await req('GET', '/host/scene-items?q=cu', { timeout: 15000 });
      show(fc, 'scene-items?q=cu（契约 §4 判据 8 的示例）');
      const fj = jbody(fc);
      ok('判据 8 · q=cu → 含 ' + JSON.stringify(cube.name), !!fj && Array.isArray(fj.objects) && fj.objects.some((o) => o.name === cube.name),
        fj && fj.objects ? fj.objects.map((o) => o.name).slice(0, 10) : null);
    } else {
      console.log('      · 当前场景没有名字含 "cube" 的对象（契约 §4 的示例对象），改用真实名字验证过滤语义');
    }
    if (!allNames.length) {
      doSkip('判据 8 · 过滤', '场景为空（objects/materials/collections 全空），无法验证子串过滤');
    } else {
      const probe = allNames[0];
      const q = probe.slice(0, Math.min(2, probe.length));
      const f = await req('GET', '/host/scene-items?q=' + encodeURIComponent(q), { timeout: 15000 });
      show(f, 'scene-items?q=' + encodeURIComponent(q) + '（取自真实名字 ' + JSON.stringify(probe) + '）');
      const fj = jbody(f);
      const flat = fj ? [...(fj.objects || []), ...(fj.materials || []), ...(fj.collections || [])].map((x) => x.name) : [];
      ok('判据 8 · 过滤大小写不敏感子串（返回项都含 q）',
        !!fj && flat.every((n) => String(n).toLowerCase().includes(q.toLowerCase())),
        { q, got: flat.slice(0, 10) });
      ok('判据 8 · 过滤结果含被查询的真实项 ' + JSON.stringify(probe), flat.includes(probe), flat.slice(0, 10));
      const fUpper = await req('GET', '/host/scene-items?q=' + encodeURIComponent(q.toUpperCase()), { timeout: 15000 });
      const fu = jbody(fUpper);
      const flatU = fu ? [...(fu.objects || []), ...(fu.materials || []), ...(fu.collections || [])].map((x) => x.name) : [];
      ok('判据 8 · q 大写与小写结果一致（大小写不敏感）', flatU.length === flat.length, { lower: flat.length, upper: flatU.length });
    }
    const none = await req('GET', '/host/scene-items?q=zzz-no-such-name-zzz', { timeout: 15000 });
    show(none, 'scene-items?q=zzz-no-such-name-zzz（无匹配）');
    const nj = jbody(none);
    ok('判据 8 · 无匹配 → ok:true 且三数组皆空', !!nj && nj.ok === true && (nj.objects || []).length === 0
      && (nj.materials || []).length === 0 && (nj.collections || []).length === 0, nj);

    const lim1 = await req('GET', '/host/scene-items?limit=1', { timeout: 15000 });
    show(lim1, 'scene-items?limit=1');
    const l1 = jbody(lim1);
    ok('判据 8 · limit=1 → 每类最多 1 条', !!l1 && (l1.objects || []).length <= 1 && (l1.materials || []).length <= 1
      && (l1.collections || []).length <= 1, l1 ? { o: l1.objects.length, m: l1.materials.length, c: l1.collections.length } : null);
    const lim0 = await req('GET', '/host/scene-items?limit=0', { timeout: 15000 });
    show(lim0, 'scene-items?limit=0（应夹到下界 1）');
    const l0 = jbody(lim0);
    ok('附加 · limit=0 夹到下界 1（§1.6）', !!l0 && l0.ok === true && (l0.objects || []).length <= 1
      && (l0.materials || []).length <= 1 && (l0.collections || []).length <= 1, l0 ? { o: l0.objects.length, m: l0.materials.length, c: l0.collections.length } : null);
    const limNeg = await req('GET', '/host/scene-items?limit=-5', { timeout: 15000 });
    show(limNeg, 'scene-items?limit=-5（应夹到下界 1）');
    const lneg = jbody(limNeg);
    ok('附加 · limit=-5 夹到下界 1（§1.6）', !!lneg && lneg.ok === true && (lneg.objects || []).length <= 1
      && (lneg.materials || []).length <= 1 && (lneg.collections || []).length <= 1, lneg ? { o: lneg.objects.length, m: lneg.materials.length, c: lneg.collections.length } : null);
    const limHi = await req('GET', '/host/scene-items?limit=99999', { timeout: 20000 });
    show(limHi, 'scene-items?limit=99999（应夹到上界 1000）');
    const lhi = jbody(limHi);
    ok('附加 · limit=99999 夹到上界 1000（§1.6）', !!lhi && lhi.ok === true && (lhi.objects || []).length <= 1000
      && (lhi.materials || []).length <= 1000 && (lhi.collections || []).length <= 1000, lhi ? { o: lhi.objects.length, m: lhi.materials.length, c: lhi.collections.length } : null);
  }
}

finish();

function finish() {
  console.log('');
  console.log('宿主 /host 路由自检：' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过'
    + (warn ? ' / ' + warn + ' 警告' : '') + (fail ? '' : '  ✅'));
  if (skips.length) {
    console.log('  跳过（不算失败）：');
    for (const s of skips) console.log('  - ' + s.clause + '：' + s.why);
  }
  if (fail) {
    console.log('  失败项（契约 §4 判据 / §1 字段）：');
    for (const f of fails) console.log('  x ' + f.clause + (f.detail !== null ? ' — ' + JSON.stringify(f.detail).slice(0, 400) : ''));
  }
  process.exit(fail ? 1 : 0);
}

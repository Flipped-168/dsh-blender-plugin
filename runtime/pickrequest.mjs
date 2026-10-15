/**
 * 宿主集成 v1.2 · 点选请求（阻塞式交互）状态机
 *
 * 契约：`docs/宿主集成-接口契约.md` §7.2（冻结）。语义一句话：
 *   **全局至多一个 pending**；模型发起请求 → 用户点视口 → 点完直接返回对象名。
 *
 * 为什么单独一个模块（而不是塞进 viewstore）：viewstore 管的是"最近一帧的视口状态"（有图像字节、
 * 有相机矩阵），本模块管的是"一次交互的生命周期"（无字节、只有状态迁移）。两者寿命与淘汰策略都不同
 * （帧留 50 条、结束态请求只留 8 条），混在一起会让两边的淘汰逻辑互相牵制。
 *
 * 三条容易写错的纪律（都来自 §7.2 的字面）：
 *   ① **空处 = answered**（`object:null`）——"用户明确表示没有"，不是失败、不是取消；
 *   ② **错配/未知 seq 不结束请求**（仍 pending）——让用户刷新后再点，而不是把请求废掉；
 *   ③ `expired` 是**惰性判定**：没有任何定时器，每次读取时比一次 `now > expires_at`。
 */

/** §7.2：`prompt` 缺省值。 */
export const PICK_PROMPT_DEFAULT = '请点一下你要改的物体';
/** §7.2：`prompt` 最长 200 字符（超出截断）。 */
export const PICK_PROMPT_MAX = 200;
/** §7.2：`timeout_s` 缺省 120、夹到 [5, 600]。 */
export const PICK_TIMEOUT_DEFAULT_S = 120;
export const PICK_TIMEOUT_MIN_S = 5;
export const PICK_TIMEOUT_MAX_S = 600;
/** §7.2：结束态（answered/cancelled/expired）保留最近 8 条，其余淘汰为 `unknown`。 */
export const PICK_FINISHED_KEEP = 8;

/** §7.2：`timeout_s` 口径与 §1.4/§1.6 一致 —— 缺省/非数 → 默认值；给了数 → 一律夹进区间。 */
export function clampPickTimeoutS(v) {
  if (v === null || v === undefined || v === '') return PICK_TIMEOUT_DEFAULT_S;
  const n = Number(v);
  if (!Number.isFinite(n)) return PICK_TIMEOUT_DEFAULT_S;
  return Math.max(PICK_TIMEOUT_MIN_S, Math.min(PICK_TIMEOUT_MAX_S, Math.round(n)));
}

/**
 * §7.2：`prompt` 截断到 200 字符。
 * 用 `.slice(0,200)`（UTF-16 单元）而不是 `Array.from`（码点）—— 契约的判据是"最长 200 字符"，
 * 而测试会断言 `prompt.length <= 200`；按码点截断时，200 个星形平面字符的 `.length` 会是 400。
 * 代价是理论上可能切断代理对：末尾若剩半个高代理就再削一个单元，保证不产生非法字符串。
 */
export function clampPrompt(v) {
  const s = (v === null || v === undefined || v === '') ? PICK_PROMPT_DEFAULT : String(v);
  if (s.length <= PICK_PROMPT_MAX) return s;
  let out = s.slice(0, PICK_PROMPT_MAX);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) out = out.slice(0, -1);   // 别留半个代理对
  return out;
}

export function createPickRequestStore() {
  let counter = 0;
  let pending = null;          // {requestId, prompt, created_at, expires_at}
  const finished = [];         // 最近 PICK_FINISHED_KEEP 条，最新在**后**

  const nowS = () => Date.now() / 1000;

  /** 把当前 pending 收进结束态（唯一的 pending 出口，保证"至多一个"） */
  function settle(state, object, reason) {
    if (!pending) return null;
    const rec = {
      requestId: pending.requestId,
      state: state,
      object: object === undefined ? null : object,
      reason: reason || null,
      finished_at: nowS(),
    };
    finished.push(rec);
    while (finished.length > PICK_FINISHED_KEEP) finished.shift();
    pending = null;
    return rec;
  }

  /** §7.2：`expired` 惰性判定 —— 读取前先比一次时间，没有定时器 */
  function tick() {
    if (pending && nowS() > pending.expires_at) settle('expired', null, 'timeout');
  }

  /** 查一个 requestId 的当前态（先惰性过期）。`known=false` ⇒ 淘汰掉了/从没存在过 */
  function stateOf(requestId) {
    tick();
    const id = (requestId === null || requestId === undefined) ? '' : String(requestId);
    if (pending && pending.requestId === id) return { state: 'pending', record: pending, known: true };
    const rec = finished.find((r) => r.requestId === id);
    if (rec) return { state: rec.state, record: rec, known: true };
    return { state: 'unknown', record: null, known: false };
  }

  /** §7.2 `POST /host/pick/request`：新请求把旧的置 `cancelled`（`reason:"superseded"`） */
  function create(opts = {}) {
    tick();
    if (pending) settle('cancelled', null, 'superseded');   // 全局至多一个 pending
    const created = nowS();
    counter += 1;
    pending = {
      requestId: 'pk-' + String(counter) + '-' + String(Math.floor(created)),
      prompt: clampPrompt(opts.prompt),
      created_at: created,
      expires_at: created + clampPickTimeoutS(opts.timeout_s),
    };
    return publicPending();
  }

  function publicPending() {
    if (!pending) return null;
    return {
      requestId: pending.requestId,
      prompt: pending.prompt,
      created_at: pending.created_at,
      expires_at: pending.expires_at,
    };
  }

  /** §7.2 `GET /host/pick/request`：只回 pending 的那个（过期则先判过期再回 null） */
  function current() { tick(); return publicPending(); }

  /** 命中/空处 → `answered`。**只由 server 在 pick 成功（含 object:null）时调用。** */
  function answer(requestId, object) {
    const st = stateOf(requestId);
    if (!st.known || st.state !== 'pending') return { ok: false, state: st.state, error: 'no_such_request' };
    settle('answered', object === undefined ? null : object, null);
    return { ok: true, state: 'answered', object: object === undefined ? null : object };
  }

  /** §7.2 `POST /host/pick/cancel`：幂等 —— 已结束回 200 + 实际态；不存在回 `unknown` */
  function cancel(requestId, reason) {
    const st = stateOf(requestId);
    if (st.state === 'pending') {
      settle('cancelled', null, reason ? String(reason) : 'user');
      return { ok: true, state: 'cancelled' };
    }
    return { ok: true, state: st.state };
  }

  /**
   * §7.2 `GET /host/pick/result`。
   * `error` 的取值：契约只给了 `"error": null` 的示例、**未定义取值**。这里只在
   * **cancelled** 时填 `reason`（`user`/`superseded`/`aborted`）—— 因为 §7.2 明确点名了
   * `reason:"superseded"`，而 `result` 的字段里只有 `error` 能承载它（判据 15 要观察得到）；
   * 其余态一律 `null`（`expired`/`unknown` 由 `state` 自解释，`answered` 有 object）。
   */
  function result(requestId) {
    const st = stateOf(requestId);
    const obj = (st.record && st.record.object) ? st.record.object : null;
    const err = (st.state === 'cancelled') ? (st.record.reason || 'user') : null;
    return { ok: true, state: st.state, object: obj, error: err };
  }

  /** 诊断快照（**不进 HTTP 契约**）：给自检/排查看"到底还剩几条" */
  function snapshot() {
    tick();
    return {
      pending: publicPending(),
      finished: finished.map((r) => ({ requestId: r.requestId, state: r.state, reason: r.reason, has_object: !!r.object })),
      finished_keep_max: PICK_FINISHED_KEEP,
      counter: counter,
    };
  }

  return { create, current, stateOf, answer, cancel, result, snapshot, tick };
}

/** 进程内单例：server.mjs 的路由与自检共用同一份状态 */
export const pickRequestStore = createPickRequestStore();

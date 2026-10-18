/**
 * host_presence.mjs —— 「有没有 UI 在轮询 /host/*」的零 I/O 记录。
 *
 * 为什么需要：`blender_rt_pick` 是阻塞式交互，但模型侧无法从回执里区分
 *   「用户看到了面板但没点」与「宿主没有可应答 UI（TUI 无面板 / Web 页在后台 /
 *     面板注册失败）」—— 旧实现只能一起等到 120–600 s 超时，还把原因误写成
 *   「用户没点」。
 *
 * 口径（与 contracts/v2.2 增补一致）：
 *   · 面板专属 GET：/host/view/latest、/host/view.png、/host/pick/request。
 *   · /host/ready 只有在请求带**合法 Web Origin**（loopback / dsh-app://app）时才记：
 *     它代表 Web 页面还活着（侧栏可以收起）；无 Origin 的健康检查/curl 不算。
 *   · /host/pick/result 是**模型侧**轮询，绝不能记（否则工具自己的轮询会把自己伪装成 UI）。
 *   · TTL 10 s：面板常规 1.5–2 s 一轮；捕获/取图最长 5 s，留足两个 tick。
 *   · 快速失败宽限 2.5 s；TUI open 被宿主 5 s 限速时工具侧会重试/放宽。
 *   · 纯内存、零 Blender 往返；`now` 可注入，便于单测。
 */

/** 面板轮询超过这个年龄就算「没有 watcher」。 */
export const UI_POLL_TTL_MS = 10000;
/** 发起请求后至少等这么久再判「无人应答」，给 auto-open/首次轮询留时间。 */
export const PICK_NO_UI_GRACE_MS = 2500;

/**
 * @param {() => number} [now] 时钟（毫秒）；单测注入，生产用 Date.now。
 */
export function createHostPresence(now = () => Date.now()) {
  let lastSeenAt = null;
  let lastKind = null;

  /** 当前 watcher 快照：`seen` 表示 TTL 内有过面板轮询；`age_ms` 为 null 表示从未见过。 */
  function snapshot() {
    const age = lastSeenAt === null ? null : Math.max(0, now() - lastSeenAt);
    return {
      seen: lastSeenAt !== null && age !== null && age <= UI_POLL_TTL_MS,
      age_ms: age,
      kind: lastKind,
    };
  }

  /** 记一次 UI 轮询；`kind` 只是诊断标签（web / tui / unknown），不参与判定。 */
  function note(kind) {
    lastSeenAt = now();
    lastKind = kind ? String(kind) : null;
    return snapshot();
  }

  return { note, snapshot };
}

/**
 * 工具侧决策（生产与自检共用）：请求已发出 `startedAt` 毫秒，是否应立即判
 * 「无人应答」。宽限内恒 false；宽限后看到新的 watcher 就继续等。
 *
 * @param {{seen?: boolean} | null | undefined} watching `/host/pick/result` 的 watching 快照
 * @param {number} startedAt 发起请求的 Date.now()
 * @param {number} [now] 当前时间（单测注入）
 */
export function shouldFailFast(watching, startedAt, now = Date.now()) {
  if (!watching || watching.seen !== false) return false;
  return now - Number(startedAt) >= PICK_NO_UI_GRACE_MS;
}

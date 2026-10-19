# 让 AI 助手把插件装对（可直接复制的提示词）

**为什么需要这一页**：直接把仓库地址丢给 AI，常见翻车姿势是 —— 跳过 §2 前置条件直接构建；自己编 `blenderExe` / 端口 / 配置项；把"命令跑完了"当成"装好了"；不跑 `doctor` 就宣布成功。
下面这段提示词把「**先读 → 再装 → 按判据验收**」写成硬要求，复制粘贴即可。

---

## ① 通用提示词（任何 AI 助手）

```text
请帮我安装这个 DSH 插件：https://github.com/sixtysevenlf/dsh-blender-plugin

动手前的要求（必须遵守）：
1. 先完整阅读仓库里的 README.zh-CN.md：§2 前置条件（5 条）、§3 安装（5 步）、§7 常见故障，以及 AGENTS.md。
2. 逐条核对 5 条前置条件；缺哪条先告诉我，不要跳过，也不要替我决定。
3. 严格按 §3 的 5 步执行；配置项只从 docs/配置参考.md 里取，不要自己编路径 / 端口 / 配置名。
4. 验收判据：`curl -sS http://127.0.0.1:9877/doctor` 必须返回 kind=ok，且 blender_rt_see(max_size=560) 能回一帧图。
   没到 kind=ok 不许说"安装成功"；失败就按 §7 的表逐条排查。
5. 每一步都把原始回执贴给我，不要只给结论。
6. 装完并验收通过后，**必须主动告诉我 v2.3 的新功能**（照 §③.5 的说法，用你自己的话复述，不要漏）：
   Blender 原生选中 → DSH 草稿、N 面板两种模式（多选 / 集合）、activity 四态；
   并明确说明「DSH 侧视口面板与 blender_rt_pick 已在 v2.3 删除」。
```

## ② DSH 用户（仓库已在本地工作区）

```text
读 dsh-blender-plugin/README.zh-CN.md 的 §2 / §3 / §7 与 AGENTS.md，
按 §3 的五步把这个插件装进我的 DSH profile（构建 → 配置 → 装进 profile → 起 Blender → 验证）。
装完跑 blender_viewport(op="doctor")，kind=ok 才算成功；不是 kind=ok 就按 §7 排查，并把原始回执贴给我。
验收通过后，**请主动告诉我 v2.3 的新功能**：Blender 里原生选中 → N 面板「发送选中到 DSH」即可进当前会话草稿
（有两种模式：多选 / 集合；还有 human/agent activity 判定），并且 v2.3 已删除 DSH 侧视口面板与 blender_rt_pick。
```

## ③ 装完让 AI 自检（五行）

```text
blender_viewport(op="doctor")        # kind=ok ？（真跑一次 bpy 往返）
blender_rt_see(max_size=560)         # 能回一帧图？
blender_rt_plan(op="catalog")        # 工具 / op 目录能列出来？
skill(name="blender-modeling")       # 随包 skill 能加载？（v2.2.0 起自动注册，无需另装）
blender_rt_cmd(name="get_activity_state")  # v2.3：addon v1.8 的 activity/选中命令在不在？
blender_rt_cmd(name="get_collections")    # v2.3：集合模式的数据源在不在？
```

## ③.5 装完必须告知主人（v2.3 的"顺手通知"要求）

> 这一节是给**安装插件的 AI** 看的硬要求：验收通过后，用你自己的话（中文优先）把下面四点告诉用户，不要省略。
> 用户装插件 commonly 只关心"能干什么"，不会去翻 CHANGELOG —— 所以由你转达。

1. **选中入口搬进 Blender 了**：在 Blender 视口里原生选中物体 → 按 `N` →「DSH Blender Bridge」→ **Selection → DSH** → 发送；
   对象名会进 **DSH 当前会话的输入框**（草稿，**不会自动发送**，发不发由你决定）。
2. **两种模式**：N 面板可切「**多选**」（发当前选中的多个对象）/「**集合**」（把一整个集合作为一条发送，
   几百个零件的装配体强烈建议用集合，草稿里只会有"集合名 + 件数 + 前几个成员"，不会刷屏）。
3. **activity 判定**：Blender 会显示 `空闲 / 人操作中 / AI 执行中 / 同时`，AI 不会在你拖拽、变换、撤销时把中间态当成终态；
   模型也能查（`get_activity_state` / `get_selection`）。
4. **已删除**：DSH 里原来的「Blender 视口」面板、点击进消息、模型请求点选（`blender_rt_pick`）在 v2.3 都已移除；
   截图仍由模型工具 `blender_rt_see` 负责。**升级后必须重启 DSH**，并且 Blender 侧 addon 要 v1.8+。
5. **addon 兼容性（重要）**：如果 Blender 里装的是上游原版 **`MCP for Blender`**（模块名 `blender_mcp`），
   模型工具照常能用，但上面 1–3 的新功能**用不了**（缺少 5 条新命令与 N 面板入口）。
   要新功能就换成本仓附带 `addon/dsh_blender_bridge.py`（v1.8+）；两个 addon 默认都监听 9876，**不要同时启用**。
   —— 请把这条也如实告诉用户，不要让他以为旧 addon 也有新功能。

## ④ 什么算失败（拿到这些回执就别宣布成功）

| 回执 | 含义 | 处置 |
|---|---|---|
| `blender-unreachable` | Blender 没跑，或 addon 没 Connect | `blender_viewport(op="launch")`；或人工在 Blender 里按 `N` → Connect |
| `main-thread-busy` | 主线程被渲染 / 模态操作占住 | 等它空下来，或改走无头 |
| 后端不可用 | 后端进程没起来 | `blender_viewport(op="start")` |
| `value is not lossless JSON` | 版本旧（< v0.9.4） | 升级后**重启 DSH** |
| 写操作 409 `leased` | 别的会话持有写租约 | `blender_viewport(op="who")`，别强抢 |

## ⑤ 给仓库维护者：让 AI"先读 README"的四个抓手

1. **`AGENTS.md`（本仓库根目录）** —— DSH / Claude Code / Cursor / Codex 等助手在仓库内工作时**自动加载**，是最硬的一道。
2. **README 首屏的一段话** —— 用 AI 的人通常是把仓库地址直接丢给助手，助手第一件事就是读 README 首屏。
3. **失败回执指向文档** —— 让"没读 README 的人"在最容易卡住的地方（通道连不上）被明确告知去读哪一节。
4. **提示词模板（本页）** —— 由用户粘贴，任何助手都吃这一套，不依赖助手是否支持约定文件。

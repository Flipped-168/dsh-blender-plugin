# 宿主集成层评估：mcp-for-blender 的 Codex 插件 → 能不能进 dsh-blender-plugin / 移植到 DSH

> 评估时间：**2026-10-16** ｜ 上游 `ahujasid/mcp-for-blender`（`main`，Codex 插件 2.1.1 / addon protocol **13**）
> 本机基线：`dsh-blender-plugin` v1.0.5（15 工具，**纯 host 半边**）｜ DSH **0.2.1-alpha.2**（`/usr/lib/node_modules/@deepseek-ai/dsh`，299 个包）
> 方法：GitHub API 取上游源码逐段读 + 读本机 DSH 已装包的 **`.d.ts` / 已打包 `.js` / README** + 本仓库与本机 profile `grep` 实测
> 与前一份《[上游整合评估-mcp-for-blender与blend-ai.md](上游整合评估-mcp-for-blender与blend-ai.md)》的分工：
> **那份评"上游 Blender 侧能力"（雕刻/修网格/UV/扫掠）；本份评"宿主集成层"（把 Blender 塞进聊天客户端）。两轴不重叠，可并存。**

---

## 0. 结论速览

| # | 结论 |
|---|---|
| 1 | **能参考，值得参考** —— 但价值**不在"工具更多"**。上游只有 **9 个 MCP 工具**（README §Capabilities 自述 "as nine tools"），**比你的 15 个还少**。你印象里的"社区版工具更多"，是相对**官方 Blender Lab MCP**（自述 lightweight）而言。 |
| 2 | 上游真正的差异化是**宿主侧 4 个机制**：内联视口 App、**点击对象→进下一条消息**、缩略图选择器、`@` 提及源。 |
| 3 | **DSH 侧设施齐备，且本机已在跑第三方客户端插件** —— 实测 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里就有 `@dsh-external/dsh-coc-dice` 等 **7 个第三方 client 插件**，**你自己的 `@dsh-external/dsh-blender-plugin` 就在同一个列表里**。→ "外部包能不能贡献浏览器半边"这个单点风险 **已解除**。 |
| 4 | **一个硬前置**：点击反投影依赖 addon 命令 **`pick_viewport_object`**。实测你仓库内两份 addon（v1.6/protocol 5、v1.7/protocol 11）**都没有**这条，上游 protocol 13 才有。**不补这条，Phase 2 做不了。** |
| 5 | **两处 DSH 与 Codex 的语义差**（照抄会踩）：① DSH **没有** `ui/update-model-context` / `openai/modelContext` 等价物 → "点击入上下文"要落成**草稿附件 + 草稿文本**；② `SelectOption` / `InputTriggerCandidate` **没有缩略图字段** → 缩略图选择器要自己写组件。 |
| 6 | **一条实测出来的新约束**：你后端 `runtime/server.mjs` **没有任何 CORS 头**（grep 无命中）→ 浏览器面板直接 `fetch('127.0.0.1:9877')` 会被跨源拦。要么给后端加 CORS，要么走 DSH 的 typert `@Remote` 通道。 |
| 7 | **不要照搬 MCP Apps 协议**（`io.modelcontextprotocol/ui`）—— DSH 不是 MCP 宿主。要的是**同一体验**，用 DSH 原生槽位实现。 |

---

## 1. 上游"特殊功能"清单（按可移植性分级）

### A. 宿主集成层（本次重点）

| 功能 | 实现证据（上游文件:行） | 机制要点 | 移植性 |
|---|---|---|---|
| **A1 内联视口 App** | `openai_apps.py:207`（`VIEWPORT_URI="ui://mcp-for-blender/viewport-v2"`）、`server.py:2044`（`@mcp.resource(..., mime_type="text/html;profile=mcp-app")`）、`apps/viewport.html`（17 KB） | 最新一帧视口 PNG 作为 **MCP App（HTML）**内联在对话旁；`openai/ui.preferredDisplayMode="fullscreen"` | 体验可移植；协议不可移植 |
| **A2 点击对象 → 下一条消息上下文** ★核心 | `viewport.html:358-393`（点击→`callTool("viewport_pick")`→`attach()`）、`server.py:2121`（`viewport_pick`）、`addon.py:2178`（`pick_viewport_object`） | 点击坐标归一化 0..1 + 该帧**相机矩阵** → addon 反投影 `scene.ray_cast` → 对象名 → `ui/update-model-context` 写 `openai/modelContext` | 机制可移植；**DSH 无对应上下文 API，需改走附件+文本**（见 §4 Phase 2） |
| **A3 ViewportStore（状态与陈旧判定）** | `openai_apps.py:254-338` | `seq / png / captured_at / source(model\|user\|auto) / origin(file,scene,scene_count)`；`scene_version` 由 `SCENE_CHANGING_COMMANDS` 累加 → `stale`；**App 轮询 store 而非轮询 Blender**（面板开着不占 Blender 主线程）；`_views` 留最近 50 帧相机矩阵供点击反查 | **直接可抄**（MIT 工程件） |
| **A4 能力探测 + env 强制** | `openai_apps.py:36-102`；`.mcp.json`（`BLENDER_MCP_APPS=1`、`BLENDER_MCP_OPENAI_FORMS=1`） | **Codex 客户端不广告这两项能力，即使它支持** → 插件侧强制开 | 教训可移植 |
| **A5 app-only 工具过滤** | `openai_apps.py:105`（`meta.ui.visibility==["app"]`）、`server.py:2176` | 只给 UI 用的工具**不进模型工具表**，省 schema 税 | 直接可抄 |
| **A6 缩略图选择器** | `openai_apps.py:121-188`（`openai/elicitation/create` + `x-openai-thumbnail`）；调用点 `server.py:972/1159/1394` | 搜索结果以**缩略图网格**点选；客户端不支持则**回退纯文本列表**，并在 session 记 `_FORMS_REFUSED_ATTR` 不再重试 | 体验可移植；**DSH 无缩略图字段**，需自写组件 |
| **A7 `@` 提及源** | `server.py:1992-1997`（`meta={"openai/extensions":{"mentions/search":{}}}` + `_APP_ONLY`） | 输入框 `@` 直接引用场景对象/材质/集合 | **机制完全可移植**（DSH `inputTriggers` 现成） |
| **A8 自动重拍（静默窗口）** | `openai_apps.py:251`（`AUTO_CAPTURE_QUIET_S=0.8`）+ `SCENE_CHANGING_COMMANDS` | 场景改完后**静默 0.8 s** 才重拍 → 连续编辑只出一张 | 直接可抄 |
| **A9 文件/场景错配防护** | `addon.py:2188-2193`（`mismatch:"file"\|"scene"`）、`server.py:2136-2145` | 点击落到**不是当前打开的那个 .blend/场景**时**拒绝**并提示 Refresh，绝不误投 | 直接可抄（安全纪律，与写租约同源） |

### B. 其它工程件（非 UI）

| 功能 | 实现证据 | 一句话 |
|---|---|---|
| **B1 addon 自动装卸 + 握手版本检查** | `addon_manager.py`（`EXPECTED_ADDON_PROTOCOL_VERSION=13`、`discover_blender_addon_dirs`、`install_addon`、`update_installed_addons`、`handshake_addon`、`_backup_addon_file`） | 包里**自带 addon 副本**，能装进 Blender、握手发现"服务端比 addon 新"、**改前先备份**。补你"addon 由用户自备"的运维短板 |
| **B2 一键配置客户端** | `setup_cli.py`（`detect_clients`/`server_entry`/`_strip_jsonc`；自述：合并而非覆盖、写 `.bak`、用 uvx **绝对路径**因 GUI app 不继承终端 PATH） | `mcp-for-blender setup` 自动探测 9 种客户端 |
| **B3 `look` 多视角一次成图** | `server.py:1559-1692`（`mode=viewport\|camera\|angles\|frames\|image`，`shading=solid\|material\|rendered\|wireframe\|xray`；native/scripted **双路互备**；每次设置**改完还原**） | 与你 `rt_see` 自定义视角同源，可对照补缺 |
| **B4 safe_mode（AST 白名单）** | `safe_mode.py`（988 行；deny-by-default 节点遍历；自述威胁模型是 **prompt injection**） | 你旧评估已记；其**自述局限诚实**："只管 MCP 这条路，addon 的 socket 谁都能连" |
| **B5 trajectory 采集** | `trajectory.py`（57 KB，**只写 Supabase**） | 与"本地可审计"取向冲突，不建议 |
| **B6 7 篇专家指南** | `guides/{bpy,scene,materials,animation,rigging,retopology,level-design}.md` | 与你的 skill 体系重合，可对照补缺 |

---

## 2. 你插件的现状基线（缺口判据）

| 维度 | 现状 | 证据 |
|---|---|---|
| 工具面 | **纯模型侧 15 工具**，零 UI | `src/index.ts`（2069 行） |
| **宿主半边** | **只有 host，无 client** —— `package.json` 里 `dsh` 只有 `{bundle:{patch:"./cordis.patch.yml"}}`，`exports` 无 `"./client"`，无 `lib/client.js` | `package.json`、`lib/` 目录 |
| 宿主依赖 | `peerDependencies`: `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`、`cordis`、`schemastery` | `package.json` |
| **图片回传** | **已有**：`toAttachment()` → `ctx.get('attachments')` → `attachments.saveImage()`；`renderOne()` 塞 `{type:'image', attachment}` 进 ContentBlock[] | `src/index.ts:653-670`、`:672-679`；调用点 `:1127/:1140/:1193/:1263` |
| **人肉面板** | **曾有过、已移除**（"网页 UI + Windows 输入注入"） | `src/index.ts:16-17` 注释 |
| addon 命令面 | 两份 addon 均**无** `pick_viewport_object` / `list_scene_items`（grep 命中 0） | `blender/scripts/addons/dsh_blender_bridge.py`=v1.6/protocol **5**；`tmp/addon_v210.py`=v1.7/protocol **11** |
| **后端 CORS** | **无任何 CORS 头**（grep 无命中） | `runtime/server.mjs:195`（`http.createServer`） |

> ⚠️ **文档与文件不一致**：`AGENTS.md` §2 写"addon 已升到 v1.7/protocol 11"，但仓库里 `blender/scripts/addons/dsh_blender_bridge.py` 实际是 **v1.6/protocol 5**。真正在跑的可能是 Blender 用户目录那份。建议以 `blender_rt_cmd get_name_info`（`get_addon_info`）**现场回执**为准并回头校文档。

---

## 3. DSH 侧对应设施（**实测存在**，带路径）

> `$D = /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。证据来自 `.d.ts` / 已打包 `.js` / README。

| 你需要的能力 | DSH 对应物 | 证据 | 成熟度 |
|---|---|---|---|
| **客户端插件（浏览器半边）** | `package.json` 的 **`dsh.client`** 字段 `{platform:'web', inject?:string[], immediately?, external?}` + `exports["./client"]` + `lib/client.js`；`dsh-client-modules` README:34 "turns each declaration into a served bundle under `/plugins`" | `$D/dsh-package-manifest/lib/types/types.d.ts:76-89`（`DshClientManifest`）、`$D/dsh-client-modules/README.md:34`、`.../lib/types/client/manifest.d.ts:10-12`（`window.__ModuleLoader__.load({id,chunk?,factory})`） | **现成**，本机 7 个第三方插件在跑 |
| **槽位系统（一切内联 UI 底座）** | `ctx.slots` = `SlotRegistry`（`register` / `inject` / `provideRoot` / `renderSlot`）；组件契约 `SlotComponent<P> = (props:P)=>ReactNode`；kind `single\|list\|keyed\|chain`；**注册到未声明槽位会 throw** | `$D/dsh-client-ui-renderer/lib/types/client/registry.d.ts:46,85,111,133,158`、`$D/dsh-client-ui-slots/lib/types/index.d.ts:343,789,802,83,761-767` | **现成** |
| **面板座位（视口面板落点）** | `conversation.view`（会话视图 Tab，list/session）、`main`（中栏 keyed，配合 `ctx.layout.selectPanel(id)`）、`shell.bottom`、`shell.overlay`（全框浮层）、`conversation.input.dock` / `.overlay` / `.left` / `.right`；**右侧栏自定义 tab**：`ctx.sidebarRightTabs.register(def)` + keyed `sidebar.right.pane.tab`，`ctx.sidebarRight.openTab(kind,opts)` | `$D/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:184,214,220`、`$D/dsh-client-ui-layout/lib/types/client/index.d.ts:53,81,95`、`.../client/service.d.ts:32`、`$D/dsh-client-ui-sidebar-right/lib/types/client/tab-registry.d.ts:164`、`.../service.d.ts:168` | **现成** |
| ⚠️ `root` 槽位 | `registry.d.ts:24-30` 警告：single 槽位动态注册**优先级更低反而胜出**，会让 AppFrame 整个消失。全屏浮层用 `shell.overlay` | 同上 | 避坑 |
| **`@` 提及源** | `ctx.inputTriggers.registerSource(src)`；`InputTriggerSource{trigger:'/'\|'@', name, candidates(), header?(), onPick(), matchSpace?/matchEnter?, lexicon?, codec?}`；**`codec.serialize(ref)` 就是"@提及→模型文本"的正式通道** | `$D/dsh-client-ui-input-trigger/lib/types/client/contract.d.ts:11-17`、`.../client/service.d.ts:29`、`.../types.d.ts:139,140,122-127` | **现成** |
| ⚠️ 候选无缩略图 | `InputTriggerCandidate{name,label?,description?,icon?:'file'\|'folder'\|'session'\|ComponentType,hint?,section?,value?,drill?}` —— **没有 image/thumbnail** | `$D/dsh-client-ui-input-trigger/lib/types/types.d.ts:35` | 限制 |
| **往草稿写文本/引用** | `InputActions{captureInsertion(), insertText(text,span), setDraft(text), persistDraft(), addAttachments(ids), removeAttachment(id), pruneAttachments(ids), submit()}`；session 作用域槽位组件 props 里直接给 `inputActions` | `$D/dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:222-243`、`.../contract/slots.d.ts:332-347` | **现成** |
| **往草稿塞附件 / 直接发送** | `ctx.conversation.createDrafts(sessionId, File[]) → ComposerAttachment[]`；`ctx.conversation.sendSession(session, text, attachmentIds, mode, signal)`；`ctx.conversation.send(text)` | `$D/dsh-client-ui-conversation/lib/types/client/service.d.ts:112,123` | **现成** |
| **上传** | `ctx.fileUpload.upload(sessionId, body, name, signal, onProgress)` | `$D/dsh-client-file-upload/README.md:28` | 现成 |
| **附件持久化** | `ctx.attachments.*`（`saveImage` / `admitPromptContent` / `saveFile` / `readImageRequest` / `imageHostPath`…）；图片进模型是 `ImageBlock` + `ImageAttachmentRef`；**通用文件永不作为字节进 provider**，只给一行 handle（名字/字节数/digest 前缀/只读路径） | `$D/dsh-attachment/README.md:75,105`、`.../lib/types/types.d.ts` | **现成**（你已在用） |
| **把后端图显示在面板里** | `ctx.resources` + `useResource<P>(address)`（地址 `dsh-resource://<type>/…`，**每个槽位组件 props 里都有**；状态 `none\|loading\|live\|failed`）；provider 声明 `ResourceProtocolMap` | `$D/dsh-client-resources/README.md`（Summary / Read a resource） | **现成**（面板取图的正规通道） |
| **客户端↔宿主 RPC** | `@Remote` / `@RemoteScope(key)` 标注 host 方法 → 生成 client 声明 → 客户端 `ctx.remote.<namespace>.<method>()`；`signal:AbortSignal` 末参 = 协作取消；`@Remote({mode:'stream'})` 支持流 | `$D/dsh-typert-protocol/README.md:12,32,38,45,49` | **现成**；你**尚未**有 `@Remote` 服务 |
| **缩略图选择器（文本行版）** | `ctx.commandUi.register({name,label?,description?,icon?:ComponentType,available(),ui:{kind:'popupSelect',options(),onSelect()}})`；`SelectOption{id,label,badge?,detail?,group?,active?,confirmation?}` —— **无 image 字段** | `$D/dsh-client-ui-commands/lib/types/client/contract.d.ts:124,92,58,26` | 文本行现成；缩略图需自写 |
| **模型发起式表单（可复用范式）** | host `dsh-tool-ask-user` + `dsh-user-questions`（`'userQuestions/answer'`、`'userQuestions/attachWait'`）+ client `dsh-client-ui-user-questions`；占 `conversation.composer`（**chain** 槽位，由 `select` 路由） | `$D/dsh-client-ui-user-questions/lib/types/client/contract/slots.d.ts:268`、`$D/dsh-user-questions/lib/typert.remote-client.d.ts`、`$D/dsh-client-ui-conversation/.../slots.d.ts:190` | 现成（参考用） |
| 上下文注入的展示 | `ContextInjectionRow`（`ContextMessageNode['content'\|'source'\|'producer'\|'form']`）；`ContextRole = 'inject'\|'recall'` | `$D/dsh-client-ui-chat/lib/types/client/chat/ContextInjectionRow.d.ts`、`.../contract/context-producer.d.ts` | 现成（读） |
| 宿主侧系统提示注入 | `ctx.systemPrompt.section({name,order,text})` / `.context()` / `.variable(name,provider)` / `assemble()` / `refreshContext()` | `$D/dsh-system-prompt/lib/types/index.d.ts:247,266,290,311,301` | 现成（**host 侧**，非客户端推送） |

### 3.1 可照抄的本机模板（最有价值的一条）

`@dsh-external/dsh-coc-dice@0.2.3` 是**本机已在跑**的第三方客户端插件，就是"给外部插件加浏览器半边"的活样板：

```json
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"], "platform": "web" } },
"exports": {
  ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
  "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
  "./package.json": "./package.json"
}
```
产物：`lib/index.js`（host）+ `lib/client.js`（browser，`window.__ModuleLoader__.load({...})` 形态）。

其面板注册写法（`lib/client.js:719`）：
```js
ctx.slots.inject("conversation.view", () => ctx.slots.register({
  name: "conversation.view",
  id: "@dsh-external/dsh-coc-dice-panel",
  label: () => "克苏鲁骰子",
  component: () => ({ render() { return document.createElement("div") } })
}));
```
⚠️ **一个已知的写法陷阱**：按运行时 `ui-slots/lib/index.js:163,204`（`register(options, component)`、`const entry = {component, options:{...}}`），`component` 取**第二参数**。coc-dice 把它塞进 options → 该条目 `component === undefined`，它真实 UI 是自建 `document.body` 浮窗（"能跑但不在类型契约内"）。**你实现时按双参数正规写法**：`ctx.slots.register({name,id,label}, Component)`。

---

## 4. 移植方案（修正版）

### Phase 0 —— 前置：给 addon 补两条命令（**不做则 Phase 2 无法开始**）

| 命令 | 为什么必须 | 参考实现 |
|---|---|---|
| `pick_viewport_object(view_matrix, window_matrix, width, height, x, y, file, scene)` | 点击反投影的唯一后端 | 上游 `addon.py:2178-2245`（MIT，约 60 行）：`projection = window_matrix @ view_matrix` → `inverted()` → NDC 反投影出 origin/direction → `scene.ray_cast(evaluated_depsgraph)` 命中网格；灯光/相机/空物体无表面 → 按**屏幕距离** `_PICK_RADIUS_PX` 兜底；**先校验 `file`/`scene` 错配**再投 |
| `list_scene_items` | `@` 提及的数据源 | 上游同名 handler |

**纪律**：① 先 `blender_rt_cmd get_addon_info` 记录现场版本；② 改前 `blender_rt_txn snapshot`（addon 是用户资产，对象级 `mark/revert` 不覆盖）；③ **自己补两条纯增量命令**优于整体升 protocol 13（后者牵动协议适配层与 34 条命令面的连带回归）。

### Phase 1 —— 给插件加"客户端半边"（**Phase 2/3 的地基，必须先验通**）

1. 新增 `src/client/` + client 构建产物 `lib/client.js`；
2. `package.json` 加 `dsh.client: {platform:"web", inject:[...]}` 与 `exports["./client"]`（照 §3.1 模板）；
3. **最小空面板**：注册到 `conversation.view` 或右侧栏 tab，渲染一行字；
4. 验收：重启 DSH → GUI 里能看到该面板。
> ⚠️ client 半边改动要**重建 bundle**；`dsh-client-hmr`（`README.md:24-27`）只在 `pnpm run dev:web` 同时运行时才免刷新热更新，否则重建 + 刷新页面。

### Phase 2 —— `@` 提及源（低风险、高收益，可独立上线）

- `apply(ctx)` 里 `ctx.effect(() => ctx.inputTriggers.registerSource({ trigger:'@', name:'blender', candidates: …, onPick: …, codec: … }))`；
- `candidates()` 从后端取 `list_scene_items`（objects/materials/collections）；
- `onPick` 返回 `{insert: ReferenceInsert}`；`codec.serialize` 输出你要的模型文本（如 `<blender-object>Cube</blender-object>`）；
- **收益**：模型不再猜 `bpy.data.objects` 里的名字 —— 正是你 `docs/证据分级与读图纪律.md` 那条纪律的**机器化**。

### Phase 3 —— 视口面板 + 点击入上下文（**核心差异化**，替代你已移除的"人肉面板"）

1. **后端**：`runtime/` 加 `ViewportStore` 等价物（照抄 A3 语义：`seq`/`source`/`origin(file,scene)`/`scene_version` 与 `stale`/最近 N 帧相机矩阵/`AUTO_CAPTURE_QUIET_S`）。**关键**：面板**轮询 store**，不轮询 Blender → 面板开着不占 Blender 主线程。
2. **前端**：用右侧栏 tab 或 `conversation.view` 注册视口面板；取图走 `ctx.resources` + `useResource`（§3）或你已有的附件路径。
3. **传输层（**决策点**）**：面板要调后端 → **两条路**：
   - **a. 给后端加 CORS**（`runtime/server.mjs:195` 的 `http.createServer` 里加 `Access-Control-Allow-Origin` + 处理 `OPTIONS` 预检）—— 改动最小，面板直接 `fetch('http://127.0.0.1:9877/...')`；
   - **b. 走 typert `@Remote`**：host 侧新增带 `@Remote` 的服务方法（Node 进程内访问 9877），客户端 `ctx.remote.<ns>.<method>()` —— **更 DSH 地道、无 CORS 问题**，但要写 host 服务 + 生成 client 声明。
   > 实测事实：你后端**当前没有任何 CORS 头**，所以 (a) 是必须做的一步，否则跨源直接失败。
4. **点击 → 入上下文（**与 Codex 的语义差，重点**）**：DSH **没有** `ui/update-model-context` 等价物，落法是：
   ```js
   // 点击 → 调后端 pick → 拿对象名
   const blob = await (await fetch(BACKEND + '/viewport.png')).blob();
   const file = new File([blob], 'blender-click.png', {type:'image/png'});
   const drafts = ctx.conversation.createDrafts(sessionId, [file]);
   inputActions.addAttachments(drafts.map(d => d.id));      // 图进草稿附件栏
   inputActions.insertText(
     `Blender 视口点击：${objName}（${detail}）。用户说"这个"时指它。`,
     inputActions.captureInsertion());                       // 文本进草稿
   ```
   用户在输入框看到图 + 一句说明，**由用户决定发送**（比 Codex 的"自动挂到下一次消息"更保守，也更符合你的纪律）。
5. **必须带上的两条纪律**（上游踩过）：**A9 文件/场景错配拒绝**；**A8 静默 0.8 s 才自动重拍**。
6. **与现有机制协同**：视口刷新与 `pick` 都**不改场景** → 走**只读**路径，别撞写租约。

### Phase 4 ——（可选）缩略图选择器

你 5 个资产集成开关全 off → **优先级最低**。若要：`SelectOption` **没有** image 字段，需自写组件挂 `conversation.input.overlay` 等座位，选中后调 `inputActions`；或做"模型发起式"（参考 `dsh-tool-ask-user` + `dsh-user-questions` + `dsh-client-ui-user-questions` 三件套，占 `conversation.composer` chain 座位）。

---

## 5. 明确不建议照搬

| 项 | 理由 |
|---|---|
| **MCP Apps 协议**（`io.modelcontextprotocol/ui`、`text/html;profile=mcp-app`） | DSH 不是 MCP 宿主。实测全树 grep `mcp-app`/`apps-sdk`/`ui/resource`/`_meta` **无 MCP-Apps 等价物**（唯一命中是 Lighthouse 审计串、settings 校验键、URL 路径段、ACP README 的"no `_meta`"声明）。搬协议 = 给 DSH 造 MCP 客户端，成本高且没必要 |
| `openai/elicitation/create` 表单协议 | 同上；DSH 用 `ctx.commandUi` + 自写组件覆盖主路径 |
| 用 iframe 做视口面板 | 三重不利：① **本部署 Browser tab 默认关闭** —— `dsh-web-app/cordis.patch.yml:291-293` 有 `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`，本机是 `web` profile（生效组合 `~/.dsh/profiles/web/cordis.yml:1500-1502` 继承该表达式）→ 未挂载；② 即使启用，它**拒绝 DSH 应用自身 origin**、跨源读不到 DSH DOM/storage/API（`README.md:59,63`），且**无 postMessage 桥**；③ `documentpreview` 的 blob iframe sandbox 仅 `allow-scripts`（不含 `allow-same-origin`）。**React 座位是正路** |
| trajectory→Supabase、telemetry、premium 云端生成 | 与你旧评估一致：与"本地、可审计、写租约"冲突 |
| 把 9 个上游工具照搬 | 你 15 个工具已覆盖看/做/批处理/回退；只有 `look` 的多视角语义值得**对照** |

---

## 6. 风险与待验证项（**诚实清单**）

| 项 | 状态 | 怎么验 |
|---|---|---|
| DSH 客户端插件面存在（槽位/面板/触发器/附件/RPC） | **已实测**（读 `.d.ts`/`.js`/README） | — |
| **外部包能贡献浏览器半边** | **已解除** ✅ | `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 含 `@dsh-external/dsh-coc-dice` 等 7 个第三方 client 插件；**你的 `@dsh-external/dsh-blender-plugin` 就在同一列表** |
| DSH **无** `ui/update-model-context` / `openai/modelContext` 等价物 | **已实测**（全树 grep 无命中） | 用 §4 Phase 3.4 的"草稿附件 + 文本"落法 |
| 后端**无 CORS** → 面板不能直连 9877 | **已实测** | 二选一：加 CORS 或走 `@Remote` |
| `conversation.view` 条目 `label` 是否即 `ViewTab.label` | **未证实** ⚠️ | 投影代码未随包发布；实现时实测 |
| sidebar-browser（iframe 路线）在本部署是否可用 | **已查实：默认关闭** ✅ | `dsh-web-app/cordis.patch.yml:291-293` 门控 `disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`；本机 `dsh web` = `web` profile（`bin.js` 里 desktop profile 被 `rejectElectronProfile` 拒绝）→ 求值为 true，未挂载。`dsh-client-ui-sidebar-browser/README.md:28` 亦自述 "disabled by default in Web profiles… Enable the shipped entry through the Web profile patch"。**本方案不走 iframe，故不阻塞** |
| 能力 2/3/4 依赖的宿主插件是否已挂载 | **已查实：全部常开** ✅ | `dsh-web-app/cordis.patch.yml`：`ui-renderer:264`、`ui-resources:272`、`ui-sidebar-right:278`、`ui-conversation:321`、`ui-input-trigger:366`、`ui-commands:369`、`ui-reference:378` |
| `ctx.slots.register` 单参数形态（options.component）是否有效 | **未证实** ⚠️ | 类型与运行时都表明 `component` 是**第二参数**；按双参数正规写法实现 |
| 你本机 addon 的**实际**版本/协议 | **不确定** | `blender_rt_cmd(name="get_addon_info")` 取现场回执 |
| 上游 addon 已到 protocol 13，你落后 2 版 | 已实测（`addon_manager.py:23`） | 建议**只补两条命令**，不整体跟进 |

---

## 7. 建议实施顺序（含验收判据）

| 步 | 内容 | 验收判据（可执行） | 估时 |
|---|---|---|---|
| 1 | `get_addon_info` 现场确认版本；校 `AGENTS.md` | 回执与文档一致 | 10 min |
| 2 | addon 补 `pick_viewport_object`（含 file/scene 错配拒绝） | 对已知坐标返回**预期对象名**；错配返回 `mismatch` | 半天 |
| 3 | addon 补 `list_scene_items` | 返回 objects/materials/collections 计数与首项名字 | 2 h |
| 4 | **Phase 1：加 client 半边 + 最小空面板**（照 §3.1 模板） | 重启 DSH 后 GUI 出现该面板 —— **这是 Phase 2/3 的开关** | 半天 |
| 5 | Phase 2：`@` 提及源接 `list_scene_items` | 输入 `@` 出候选；pick 后草稿出现对象引用；发出去模型能读到对象名 | 1 天 |
| 6 | Phase 3：视口面板 + 点击入上下文（含 CORS 或 `@Remote` 决策） | 面板显示最新帧；点击某对象 → 草稿出现图 + 对象名文本；改场景后 0.8 s 内自动刷新；点空处只附整图 | 2–3 天 |
| 7 | 回归：写租约 / 只读白名单 / 15 个工具不受影响 | `npm test` 全绿 + `doctor kind=ok` | 半天 |

---

## 8. 附录：本次证据出处

**上游（读码，GitHub API 取 raw）**
- `src/dsh_blender_bridge/openai_apps.py`（338 行）：`:36-102` 能力探测/env 强制、`:105` `is_app_only`、`:121-188` 缩略图选择器、`:207` `VIEWPORT_URI`、`:215-232` 图标与 HTML、`:238-251` 场景变更命令集与 0.8 s 静默、`:254-338` `ViewportStore`
- `src/dsh_blender_bridge/apps/viewport.html`（17 298 B）：`:78` `data-clickable`、`:148-149` `canAttach/picks`、`:199-207` `openai/modelContext` 同步、`:287-295` 交互文案、`:358-393` 点击→pick→attach、`:394-417` `ui/update-model-context`
- `src/dsh_blender_bridge/server.py`（2 224 行）：`:1559` `look`、`:1992-1997` `search_mentions`、`:2044` viewport resource、`:2082-2121` `open_viewport`/`viewport_latest`/`viewport_capture`/`viewport_pick`、`:2176` `_list_tools_for_client`
- `addon.py`（270 889 B，protocol 13）：`:1508` handler dict、`:2137-2160` 捕获留存相机矩阵、`:2178-2245` `pick_viewport_object`
- `addon_manager.py:23`（`EXPECTED_ADDON_PROTOCOL_VERSION=13`）、`setup_cli.py`、`safe_mode.py`、`trajectory.py`、`guides/*.md`

**本机 DSH（读已装包 `.d.ts` / `.js` / README，`$D=.../node_modules/@deepseek-ai`）**
- 客户端插件：`dsh-package-manifest/lib/types/types.d.ts:76-89`、`dsh-client-modules/README.md:34`、`.../lib/types/client/manifest.d.ts:10-12`
- 槽位：`dsh-client-ui-renderer/lib/types/client/registry.d.ts:46,85,111,133,158`、`dsh-client-ui-slots/lib/types/index.d.ts:83,343,761-767,789,802`、`.../lib/index.js:163,204`
- 座位：`dsh-client-ui-conversation/.../contract/slots.d.ts:184,190,214,220,332-347`、`dsh-client-ui-layout/lib/types/client/index.d.ts:53,81,95`、`.../client/service.d.ts:32`、`dsh-client-ui-sidebar-right/.../tab-registry.d.ts:164`、`.../service.d.ts:168`
- 输入与附件：`dsh-client-ui-conversation/.../contract/input.d.ts:17-26,135,147,222-243`、`.../client/service.d.ts:112,123`、`dsh-client-file-upload/README.md:28`、`dsh-attachment/README.md:75,105`
- 提及：`dsh-client-ui-input-trigger/.../client/contract.d.ts:11-17`、`.../client/service.d.ts:29`、`.../types.d.ts:35,122-127,139,140`
- 资源与 RPC：`dsh-client-resources/README.md`、`dsh-typert-protocol/README.md:12,32,38,45,49`
- 选择器与表单：`dsh-client-ui-commands/.../contract.d.ts:26,58,92,124`、`dsh-client-ui-user-questions/.../slots.d.ts:268`、`dsh-user-questions/lib/typert.remote-client.d.ts`
- 其它：`dsh-system-prompt/lib/types/index.d.ts:247,266,290,301,311`、`dsh-client-ui-chat/.../ContextInjectionRow.d.ts`

**本机 profile / 本仓库（grep 实测）**
- `~/.dsh/profiles/web/package.json`：`dsh.profile.bundles` 含 7 个第三方 client 插件（含 `@dsh-external/dsh-coc-dice` 与 `@dsh-external/dsh-blender-plugin`）
- `~/.dsh/profiles/web/node_modules/@dsh-external/dsh-coc-dice/package.json`：`dsh.client` + `exports["./client"]` 模板
- `$D/dsh-web-app/cordis.patch.yml:264,272,278,291-293,321,366,369,378`：常开宿主插件列表 + `ui-sidebar-browser` 的 desktop 门控
- `~/.dsh/profiles/web/cordis.yml:1500-1502`：生效组合继承同一门控表达式
- `src/index.ts:653-679`（`toAttachment`/`renderOne`）、`:1127/:1140/:1193/:1263`（调用点）、`:16-17`（人肉面板已移除）
- `package.json`（无 `dsh.client`、无 `"./client"`）
- `blender/scripts/addons/dsh_blender_bridge.py`（v1.6/p5）、`tmp/addon_v210.py`（v1.7/p11）：`pick_viewport_object`/`list_scene_items` 命中 **0**
- `runtime/server.mjs:195`（`http.createServer`，**无 CORS 头**）

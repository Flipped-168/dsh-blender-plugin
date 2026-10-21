# DSH × Blender 直连实时插件

> 🤖 **想让 AI 帮你装？** 别让它猜 —— 把仓库地址和 [`docs/AI-安装提示词.md`](docs/AI-安装提示词.md) 一起发给它
>（可直接粘贴的提示词 + 验收判据 + 装完必须转达的新功能）。唯一验收判据：`doctor` 回 `kind=ok`。

> **GUI Blender 可选。** 模型既能直连 GUI 做"看一眼 → 改一步 → 再确认"，
> 也能在**持久无头会话**里连续建模、出图、验收 —— 无头是**交互式**的
>（`exec` / `see` / `watch` / `reset` 同一条热路径），不是一次性批处理。
> 15 个模型工具，不用装 MCP、不用 CLI 适配层；
> 而**你**在 Blender 里原生选中物体，按一个按钮就把它们送进 DSH 当前会话的输入框。

> 🏷 **v2.6.0** · 15 个模型工具 · **33 family / 217 个 plan op** · addon **v1.10**（protocol 11）· 包体 **1.6 MB / 163 文件**（解包 4.8 MB）

---

## 支持本项目 · 爱发电

如果它帮你省了时间，可以支持一下开发：<https://afdian.com/a/sixtyseven67>。

---

## v2.6 亮点（P0–P2，六条）

- **① 交互式无头（P0）—— 新的默认建模路径。** 持久 worker 支持 `preload` 启动前导、`see`（临时相机 + Workbench 离屏）、
  `reset`、`warmup`；`rt_do` / `rt_see` 可显式 `session`（GUI 不在时 `auto` 自动降级），
  `rt_watch` 可无头，`rt_plan(session="auto")` 按 family 自动起 worker 并同步 dispatch。
  实测：`start` 2.24 s（含 1.1 s 首帧初始化），之后 `exec` 0–2 ms、`see` 往返 53–85 ms（320×180）；
  worker 空闲 15 min 自动回收（`DSH_WORKER_TTL_MS`，0=关闭）。
- **② 参考图量具（P0）** `img_digest / img_probe / img_measure / img_calib`：原生分辨率量测（轮廓 / 主轴 / Hough 直线 /
  孔与圆 / 对称 / 可读性），一次给可确认数字表 + 原生裁剪图册 + 标注总图；给 `known_len` 才出 mm，
  没标定就**只给比例、绝不编 mm**。真机 61/61 断言。
- **③ 装配（P0–P2）** `asm_scan`（clash / hidden_ok / contact / gap / float / contained / unresolved 全对全分类）→
  `asm_manifest`（md5 / 接口帧 / allow 校验）→ `asm_merge`（id 序 append + 法线 + snapshot + 自动 gate，dry-run 默认）→
  `asm_repair`（safe / manual / aggressive；safe 只做平移吸附、硬禁布尔）→ `asm_gate`（verdict-first，`export_allowed` 仅 pass）→
  `asm_export`（GLB / FBX / OBJ + manifest + append-only merge_ledger）。
- **④ 白模与参考包（P0 / P2）** `blockout_base / batch / export`（声明式 parts、mm / anchor、Workbench 3 视图、GLB；
  20 件几何 9 ms、3 视 512 首帧后 25 ms/张）+ `blockout_turntable`（Blender 内置 FFMPEG 出 MP4）+
  `blockout_refsheet`（4 张正交/透视 PNG + 2×2 拼图 + refsheet.json）。
- **⑤ 视觉验收与缺陷评估（P1–P2）** `visualreport_report`（同机位 QC，verdict-first，qc→imgtools→numpy 三级降级；
  同图 pass、平移/缺角 fail + 缺陷 crop 与 mm 定位；72–96 ms）· `shapesolve_solve`（正交解析投影 + numpy 光栅化，
  不渲染；三视反演误差 0.98% / 1.55% / 0.35%，solve 793 ms）· `eval_run`（装配 D1/D3/D4/D5/D7/D8 + reference 12 例 +
  calib core；缺模块 skipped / degraded，**不假通过**）。
- **⑥ 强制门（P1）** `gate_preflight`（开工体检）→ `gate_checkpoint`（回退点）→ `gate_deliver`（先过门再导出）；
  `deliver_export(require_gate=true)` 真机验证：pass 才写盘，bad gate 直接 blocked。

> v2.6.0 自身还包含：台账磁盘对账（后端重启后可回收已完成作业）、Blender 5.2 合成器迁移、多灯卫生、
> 进度/心跳通道、`audit_mesh` 第五态、写作用域两维（集合 + 对象前缀）。完整实测记录见 [CHANGELOG.md](CHANGELOG.md)。

## 1. 30 秒速览

| 能干什么 | 工具 | 典型耗时 / 说明 |
|---|---|---|
| 看 GUI 视口 / 自定义角度（不建相机、不动你的视口） | `blender_rt_see` | 55–160 ms；自定义角度约 100 ms |
| 无头会话里看一眼 | `blender_rt_see {session}` · `rt_worker op=see` | 53–85 ms（320×180） |
| 改一步、看一眼（GUI / 无头交互） | `blender_rt_do` · `{session}` | ≈105 ms；exec 0–2 ms + see |
| 动没动、对不对 | `blender_rt_watch`（GUI / `session`） | ≤6 帧 + 逐帧 hash；无头 3 帧 ≈58 ms |
| 内环搜索（上千次迭代不进模型回合） | `blender_rt_loop`（`target:"session"` 走无头同步阻塞） | 160 tick/s（GUI）· 20 次 56 ms（session） |
| 透传 / 列出 addon 命令 | `blender_rt_cmd` / `blender_rt_commands` | 39 条（24 常驻 + 15 集成门控） |
| 渲染性能诊断 + 预设 | `blender_rt_perf` | analyze ≈10–20 s |
| 对象精简（安全合并、几何零损失） | `blender_rt_opt` | ≈1.4 ms/对象 |
| 重活丢给无头进程（多视角 / 附图） | `blender_rt_headless` | 冷启动 0.9–1.2 s；`shots` + `attach_images` |
| 契约层 + 规划器（33 family / 217 op） | `blender_rt_plan` | catalog 本地直出；`session:"auto"` 无头路由 |
| 热无头会话（复用同一个 `blender -b`） | `blender_rt_worker` | start 2.24 s 只付一次；空闲 TTL 15 min |
| 事务 / 回滚 | `blender_rt_txn` | 快照 96.7 MB / 824 ms（300 对象） |
| 配方库（存 / 套 / 导出参数组合） | `blender_rt_preset` | 存过的值真的生效 |
| 长任务作业层（超时不丢结果） | `blender_rt_job` | wait 默认 120 s；进度 / 心跳可观测 |
| 通道体检 / 写租约 / 一键拉起 Blender | `blender_viewport` | health 70–100 ms |

### 随包 skill（v2.2.0+，无需另装）

本包在 [`skills/blender-modeling/`](skills/blender-modeling/) 内置建模 skill，插件加载时注册为 `bundled` provider。
装好插件、重启 DSH 后，会话技能目录里就会出现；模型做建模 / 装配时会自行加载。
内容包括：选形决策树、编号配方、六条必踩的坑、数值门清单、多 Agent 分工协议、参考图还原 SOP、多视标定。

- **优先级**：rank 600。你自己放在 `~/.dsh/skills/blender-modeling` 的副本（user rank 400）仍然优先，老用户不会被强制覆盖。
- **非 DSH 宿主**（Claude Code / Codex / Cursor…）：同一目录就是普通 `skills/<name>/SKILL.md`，软链或拷到宿主技能根目录即可。

详细教程：[`docs/操作教程.md`](docs/操作教程.md) · 配置参考：[`docs/配置参考.md`](docs/配置参考.md) ·
部署 SOP：[`docs/部署SOP.md`](docs/部署SOP.md) · headless 路线：[`docs/headless优先-路线决定.md`](docs/headless优先-路线决定.md) ·
接口契约 v2.3：[`docs/宿主集成-接口契约-v2.3增补.md`](docs/宿主集成-接口契约-v2.3增补.md) ·
v2.6.0 更新说明：[`docs/v2.6.0-更新说明.md`](docs/v2.6.0-更新说明.md)。

---

## 2. 前置条件（Requirements，5 条）

1. **Blender 4.x / 5.x** —— **GUI 首选**。GUI 用于 addon 直连（`rt_cmd`、部分 `rt_see` / `rt_do`、原生选中）；
   无头工具（`rt_headless` / `rt_job` / `rt_worker` / `rt_do{session}` / `rt_see{session}` / `rt_watch{session}`）
   直接起 `blender -b`，**无头备用路线**：不需要 GUI，也不需要 addon Connect。后端需要能找到 Blender 可执行文件（配置 `blenderExe` 或放进 PATH）。
2. **Blender addon —— 只支持本仓附带的 [`addon/dsh_blender_bridge.py`](addon/dsh_blender_bridge.py)**
   （**`DSH Blender Bridge` v1.10**，模块名 `dsh_blender_bridge`）。它监听 `127.0.0.1:9876`，提供 39 条命令
   （24 常驻 + 15 集成门控），含场景查询、视口截图、`execute_code`、选中/活动状态与 5 个可选集成
   （PolyHaven / Hyper3D / Sketchfab / Poly Pizza / Hunyuan3D）。**只有 GUI 直连才需要安装并 Connect。**
   上游 `MCP for Blender` / harveyxiacn `blender_mcp_addon` 自 v2.3 起不再支持；
   如果装的是旧 addon，请停用它并改成本仓 addon（见 [MIGRATIONS.md](MIGRATIONS.md)）。
3. **Node.js ≥ 20**（跑后端与插件宿主）。
4. **DSH（DeepSeek Harness）** —— 本包以 DSH 插件形态提供工具（`inject: ['tools']`，按 `dsh.bundle` 声明装配）。
   WSL 里跑 DSH、Blender 在 Windows：需要 WSL 互操作（默认开）；Windows / 原生 Linux / macOS 同机部署都支持并自动探测。
5. **只有重建时才需要 DSH 源码 checkout**（`DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh`）；
   本仓已提交 `lib/`，克隆下来即可用。

---

## 3. 安装（Install，5 步）

> **不想构建、也不想走 npm？** 直接下 [Releases](https://github.com/sixtysevenlf/dsh-blender-plugin/releases) 里的
> `dsh-external-dsh-blender-plugin-2.6.0.tgz`（**1.6 MB / 163 文件**，解包 4.8 MB）：解包后放进
> `<profile>/node_modules/@dsh-external/dsh-blender-plugin`，或 `npm i ./那个tgz`。skill 就在包里（`skills/blender-modeling/`）。
> 完整第三方清单见 [`docs/给第三方的安装清单.md`](docs/给第三方的安装清单.md)。

```bash
# ① 构建（可选）—— lib/ 已提交，通常可跳过；只有改了 src/ 才需要重建
cd dsh-blender-plugin
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh          # 产出 lib/

# ② 配置（不设也能靠自动探测跑；要改就复制样例）
cp dsh-blender.config.example.json dsh-blender.config.json        # 见 docs/配置参考.md

# ③ 装到 DSH（本包已声明 dsh.bundle → 走官方 bundle 装配）
#    a) 软链进 <profile>/node_modules/@dsh-external/dsh-blender-plugin
#    b) profile package.json：dependencies 加 "link:<本目录绝对路径>"，
#       dsh.profile.bundles 加 "@dsh-external/dsh-blender-plugin"
#    c) 预演：dsh --profile <profile> --dump-config → 重启 DSH

# ④ 接 Blender —— 两条路，按需要选：
#    GUI 直连（要原生选中 / 吃 GUI 场景时）：blender_viewport(op="launch") 一键拉起 + 自动 Connect（幂等）
#    纯无头（不需要 GUI / addon）：跳过 addon，确认 blenderExe 可被后端探测，直接用 rt_worker / rt_headless
#    人工 GUI 三步：Edit ▸ Preferences ▸ Add-ons ▸ Install... → 选 addon/dsh_blender_bridge.py
#                → 勾选启用「DSH Blender Bridge」→ 3D 视图按 N → Connect（端口 9876）

# ⑤ 验证 —— GUI 路线唯一验收判据：doctor 回 kind=ok（没到 = 没装好，按 §8 排查）
curl -sS http://127.0.0.1:9877/health      # 后端活着 + 加载版本自证（provenance）
curl -sS http://127.0.0.1:9877/doctor      # ⭐ 真跑一次 bpy 往返 + 打印生效配置
curl -sS http://127.0.0.1:9877/who         # 租约 + 通道指标 + config
```

插件会自动拉起后端（`node runtime/server.mjs`，默认 `127.0.0.1:9877`），并有 **15 秒看护**：进程掉了自动重生。
`blender_viewport op=stop` 可暂停看护。

> **纯无头路线（不装 addon）**：没有 addon 时 `doctor` 的 bpy 往返不可达，这不代表后端没装好 —— 用
> `blender_rt_worker(op="start", name="smoke")` + `blender_rt_worker(op="see", name="smoke")` 回一帧图自证；
> **GUI 路线仍以 `doctor` → `kind=ok` 为唯一验收判据**。

> **随包 skill（v2.2.0+）**：DSH 重启后，`blender-modeling` 会自动从 `skills/blender-modeling/` 注册，无需另下 / 软链。

---

## 4. 第一次使用

### 4.1 GUI 直连（要"看 GUI 里那个场景"时）

```text
blender_viewport(op="doctor")                                # 体检：通道健康 + 生效配置
blender_rt_see(max_size=560)                                 # 看一帧：模型眼里的视口
blender_rt_see(from="9,-9,6", look_at="0,0,1")               # 换个角度：不打扰你正在看的视口
```

### 4.2 交互式无头（不打开 GUI）

```text
blender_rt_worker {op:"start", name:"build", preload:"imgtools,assembly,blockout", engine:"workbench"}
blender_rt_do     {session:"build", code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_see    {session:"build", from:"7,-7,5", look_at:"0,0,1"}
blender_rt_plan   {op:"img_digest", args:{path:"D:/ref/front.png", known_len:{mm:100, p1_px:[100,80], p2_px:[420,80]}}, session:"auto"}
blender_rt_watch  {session:"build", seconds:2, fps:4}
```

同一个 `name` 复用同一个 `blender -b`（持久内核 `K` 跨调用保留）；`rt_plan` 的 `session:"auto"`
会按 family 自动挑模块 `preload`。GUI 不在时 `rt_do` / `rt_see` 也会 `auto` 降级到这条路（可 `auto:false` 关掉）。

### 4.3 宿主集成：`@` 提及 + Blender 原生选中

除模型工具外，本包还给 DSH Web 客户端贡献一个**用户侧**半边（走独立 `/host/*` 路由，**不进** op 目录、
**不加**模型工具 ⇒ **15 个工具 / 217 个 op** 的能力面零变化）：

- **`@` 提及**：输入框敲 `@` 出对象 / 材质 / 集合候选（引用带前缀 `object:<name>` / `material:<name>` /
  `collection:<name>`），选中后由 `codec` 拆掉前缀、序列化成 `<blender-object>Cube</blender-object>`，模型不再猜对象名。
- **Blender 原生选中 → 草稿**（v2.3+；子元素选中需 addon v1.10+）：在 Blender 里选中 → `N` → **Selection → DSH** → 发送；
  选中进**当前会话草稿**，**不自动发送**。两种模式：**多选**（当前选中对象）/ **集合**（整组发送，大装配体推荐）。
  编辑模式点/线/面、姿态骨骼、曲线/晶格控制点也会随发送带过去（`selection.sub`）。
- **activity 状态**：Blender 统一判定 `idle / human / agent / both`；N 面板实时显示，模型可查
  `blender_rt_cmd get_activity_state` / `get_selection`（查询**自身不算** agent），
  另有 `get_collections` / `send_collection_to_dsh` 供集合工作流。
- **历史说明**：v2.3 起删除 DSH 侧视口面板（Web 侧栏 + TUI 侧栏）、点击进消息、`blender_rt_pick`；
  后端 `/host/view/*`、`/host/pick*`、`/host/ready` 路由**同步删除**；现存宿主路由只有
  `/host/selection`（+ `/latest`、`/consume`）、`/host/scene-items`、`/host/jobs`（+ `/log`）。

> ⚠ **改完 / 升级完必须重启 DSH**：客户端半边（`lib/client.js`）是 DSH 启动时加载的模块；只改了后端才用
> `blender_viewport(op="restart")`。客户端半边从 HTTP loopback GUI 或官方桌面端 `dsh-app://app` 跨源调
> `9877`；后端仅对 **HTTP loopback** 与**精确的 `dsh-app://app`** 回显 CORS Origin。**这不是身份验证，也不是服务端 403。**

### 4.4 一次真实会话（5 个调用）

```text
blender_rt_worker {op:"start", name:"build", preload:"imgtools,assembly", engine:"workbench"}
blender_rt_do     {session:"build", code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_see    {session:"build", from:"7,-7,5", look_at:"0,0,1"}
blender_rt_plan   {op:"audit_scene", session:"auto"}
blender_rt_txn    {op:"snapshot", label:"before-edit"}
```

---

## 5. 工具参考（Tool reference，15 个工具）

后端总会由插件自动拉起；**GUI 通道类**（`rt_cmd` / `rt_commands`、不传 `session` 的 `rt_see` / `rt_do` / `rt_watch`）需要 addon 已 Connect；
**无头备用类**（`rt_headless` / `rt_job` / `rt_worker` / `rt_plan{session}` / 传了 `session` 的 `rt_do` / `rt_see` / `rt_watch`）不需要 GUI；默认仍先走 GUI。
参数名就是 schema 里的名字，WSL / Windows / macOS 完全一致。

| 工具 | 作用 |
|---|---|
| `blender_rt_see` | 取一帧 3D 视口（约 55–160 ms）。`full=true` + `area=N` 走整窗口 / 第 N 个区域截图；`from` / `look_at`（+ `lens`、`ortho`、`view_size`、`shading`、`overlays`、`view_mode`）走**自定义视角**：自建矩阵离屏绘制，不建相机、不改 `scene.camera`、不动用户视口。传 `session` 走无头 worker（Workbench 离屏，53–85 ms）；`auto` 控制 GUI 不可用时是否降级；同画面默认不重复附图，`force=true` 强制重发。 |
| `blender_rt_do` | 在 Blender 主线程执行 Python，持久内核 `K` 跨调用保留状态；`see=true` 顺带回一帧。显式 `session` 直接走无头交互（exec 0–2 ms + Workbench see，同一轮可连做几十步）；`auto`（默认 true）在 GUI 不可达时自动降级；`preload` 给无头会话预载模块。 |
| `blender_rt_watch` | 在一段时间窗内连续采样视口（≤6 帧 + 逐帧 hash），回答"动没动 / 对不对"。`session` 走无头 worker 的 `_watch`（逐帧 Workbench 离屏 + hash；实测 3 帧动画 distinct=3 / 58 ms）。 |
| `blender_rt_loop` | Blender 主线程内环搜索：`setup/step/measure` + 罚项 / 退火 / 候选表 / 可复现导出。`target:"session"` 走 worker 的 `dsh_loop_sync` 同步阻塞循环（不依赖 timers；20 次 56 ms）。 |
| `blender_rt_cmd` | 透传 addon 任意命令（39 条：24 常驻 + 15 集成门控），含 `get_world_state_snapshot` / `drain_human_activity` / 遥测同意 / 5 个资产集成。 |
| `blender_rt_commands` | 列出当前可用 addon 命令 + 5 个集成的真实开关状态（含缺 API key 的提示）。 |
| `blender_rt_perf` | 渲染性能：`analyze` 差分实测；`apply` 预设（persistent_data / OptiX 降噪 / auto_tile off / 采样上限）；`revert` / `status`。 |
| `blender_rt_opt` | 对象精简：analyze 合并候选；同集合 / 同材质安全合并，**几何零损失**（≈1.4 ms/对象）。 |
| `blender_rt_headless` | 独立 `blender -b` 进程（不占 GUI 通道）：`file/outdir/args/env/timeout_ms/factory_startup/bootstrap/preload`；`shots=[{name,from,look_at,lens,res,samples}]` 一次出多视角；`attach_images`（`true` 最多 3 张 / `"sheet"` 只拼图）；结果用 `print("HEADLESS {json}")` 回传。 |
| `blender_rt_plan` | 契约层 + 规划器：**33 family / 217 op**（`op="catalog"` 本地直出"何时用 / 别用 / 最小骨架"）；组件 / 连接 / 包络、只读校验、`destructive_guard`、证据账本、假设三态（`supported / refuted / unresolved`）、规划器 → bpy 编译。回执带单行 verdict/top_defects/next 信封；`attach_images` ≤2 张；`session:"auto"` 走无头 worker 同步 dispatch。 |
| `blender_rt_worker` | 热无头会话（复用同一个 `blender -b` + 持久 `K`）：`start/exec/see/reset/status/stop/restart/list`；`preload` / `warmup` / `engine` / `gpu` / `purge_prefix`；`see` 在无 GUI 时给 `rt_see` 兜底；空闲 TTL 15 min（`DSH_WORKER_TTL_MS`，0=关）。 |
| `blender_rt_txn` | 事务：文件级 `snapshot/restore`（拓扑安全）+ 对象级 `mark/revert`（只含变换 / 材质 / 可见性）。 |
| `blender_rt_preset` | 参数配方库：`save/list/get/apply/delete/export/import`（点路径 data；targets `MAT:` / `OBJ:` / `SCENE`）。 |
| `blender_rt_job` | 长任务作业层：`start/status/collect/wait/kill/list`；工具超时不丢结果；回执带 `stage / progress / progressHistory / heartbeat / idleMs`；`wait` 默认 120 s（上限 600 s）。 |
| `blender_viewport` | 通道运维：`status/start/stop/restart/doctor/who/lease/release/launch`；写租约支持两维作用域（`scope="collection:COL_Lights,prefix:LGT-"`）。 |

### 5.1 边界与不覆盖（Limits，重要）

- **不覆盖**（`catalog` 默认页与无头交接块都明确写了）：**生物 / 有机造型、电影级布光 / 体积 / 合成、角色动画绑定**。
  在这些方向上找不到工具是正常的；`sculpt_*` 可以雕形体，但不等于角色管线。
- **未安装依赖，不要当成已支持**：`landmark` / 人脸（无 cv2 / MediaPipe；`face_ratios` 需要你自己给 landmark 坐标）、
  **OCR**、**DXF**、**Open3D / manifold3d / glTF-Validator**。`gltf_validate` / `ext_mesh_check` 等 ext 族依赖这些第三方组件，
  没装时会如实返回 skipped / degraded / 缺依赖错误 —— **不假通过**；需要时按回执提示安装，或改用 Blender 原生导出。
- **量测纪律**：`img_*` 没有 `known_len` 就只给像素比例，**mm 全为 null**；可读性 <8 px 的特征会进 `unreadable`，不要写进 spec。
- **主观项**：观感 / 风格仍需人或强模型判断；数值门用 `gate_*` / `audit_*` / `visualreport_*`，别用眼睛估尺寸。
- **相机 / 场景安全**：`rt_see` 自定义视角不建相机、不动你的视口；写操作过租约，第二个会话会拿到 `409 leased`。

---

## 6. 实战配方（Recipes）

常用链路（细节在 [`docs/操作教程.md`](docs/操作教程.md) 与随包 skill）：

- **交互式无头（主路径）**：`rt_worker(op="start", preload=…)` → `rt_do(session, see)` → `rt_see(session)` → `rt_watch(session)`；
  规划/验收用 `rt_plan(session="auto")`，内环用 `rt_loop(target="session")`。长任务改用 `rt_headless(as_job=true)` 或 `rt_job(op="start")`。
- **参考图 → 白模 → 装配 → 交付**：`img_digest(known_len=…)` 量参考图 → `blockout_base / batch` 出白模 →
  `asm_manifest → asm_scan → asm_merge(dry_run:true) → asm_merge(dry_run:false) → asm_gate → asm_export` →
  `visualreport_report` 同机位复核。
- **装配修复**：`fix_interference`（只读规划）→ `asm_repair(policy:"safe")`（平移吸附，硬禁布尔）→ `asm_scan` 复检。
- **产形 → 体检 → 修**：`sculpt_scan → sculpt_setup(VOXEL) → sculpt_apply` · `audit_mesh → fix_repair → audit_mesh`。
- **贴图交付**：`uv_smart_project → uv_stats → deliver_export(require_gate:true) → deliver_verify` · `material_build → material_apply → material_bake`。
- **门流程**：`gate_preflight`（开工体检）→ `gate_checkpoint`（回退点）→ 建模/修复 → `gate_run` 或 `gate_deliver`；
  读顶层**三态 `verdict`**（`degraded` ≠ 通过）。
- **干涉 / 间隙**：`audit_interference` / `clear_check` / `audit_connectivity`；车辆走
  `vehicle_package → vehicle_base → clear_check → qc_render_views(ortho)`。
- **参考图轮廓反演 / 缺陷评估**：`shapesolve_solve`（正交投影 + 光栅化，不渲染）· `eval_run`（捕获率 / 基线，缺模块不假通过）。
- **长任务**：`render_state → render_wait`（渲染中写命令约 71 ms 回 `BUSY_RENDER`）· 超过 1 分钟用
  `blender_rt_job(op="start")` 或 `rt_headless(as_job=true)`，用 `op="wait"` 收结果。
- **回滚**：对象级 `mark/revert`；拓扑改动必须 `snapshot/restore`。

---

## 7. 配置（Configuration）

配置来源（优先级从高到低）：插件配置 → `DSH_BLENDER_*` 环境变量 → `$DSH_BLENDER_CONFIG` 文件 →
包根 `dsh-blender.config.json` → `~/.dsh/dsh-blender.config.json` → 自动探测默认值。

常用项：`port`（后端 9877）、`addonHost` / `addonPort`（9876）、`workerPort`（9879）、`blenderExe`、
`workDir`、`holder`、`leaseTtlMs`（写租约 TTL，默认 600000 ms）；无头相关：`DSH_WORKER_TTL_MS`
（worker 空闲 TTL，默认 15 min，0=关）、`DSH_HEADLESS_WAIT_MS`（headless 同步等待窗口，默认 100 s）。
旧的 `addonProtocol` 配置在 v2.3 起**已删除**。完整表见 [`docs/配置参考.md`](docs/配置参考.md)。

---

## 8. 常见故障（Troubleshooting）

| 回执 / 现象 | 含义 | 处置 |
|---|---|---|
| `blender-unreachable` | GUI 通道没连通（Blender 没跑 / addon 没 Connect） | GUI 类工具用 `blender_viewport(op="launch")`，或人工按 `N` → Connect；纯无头类工具不需要 addon，直接传 `session` 或走 `rt_headless` |
| `main-thread-busy` | GUI 主线程被渲染 / 模态操作占住 | 等它空下来，或改走无头（`session` / `rt_headless`） |
| 后端不可用（9877 连不上） | 后端进程没起来 | `blender_viewport(op="start")` |
| 工具数不是 15 / catalog 不是 33-217 | 插件版本旧，或升级后没重启 DSH | 安装 v2.6.0 → **重启 DSH** → 复核 |
| `value is not lossless JSON` | 插件 / 后端版本不一致（旧版） | 升级到同一版本后**重启 DSH** |
| 写操作 409 `leased` | 别的会话持有写租约 | `blender_viewport(op="who")` 查持有者与作用域，别强抢 |
| GUI 不在时 `rt_do` / `rt_see` 自动走无头 | 正常行为（`auto` 默认 true） | 要强制 GUI：先 Connect，再传 `auto:false` |
| worker 忽然没了 | 空闲超过 TTL 被回收（默认 15 min） | 重新 `op="start"`；长任务用 `rt_job` / `rt_headless(as_job:true)` |
| `plan session="auto"` 第一次慢约 2 s | 首次冷启动 + preload（之后复用） | 正常；固定 `name` 可复用同一会话 |
| N 面板没有「Selection → DSH」 | 装的是旧 `MCP for Blender`（v2.3 不支持） | 停用旧 addon，装本仓 v1.10，再重启 DSH |
| 已发送但草稿没字 | 升级后没重启 DSH / 草稿被锁 | 重启 DSH；看 `/host/selection/latest.last_consume` 的 `ok/reason` |
| 旧「Blender 视口」tab 还在 | DSH 没重启（v2.3 已删面板） | 重启 DSH |
| 资产集成不可用 | 集成开关没开 / 缺 API key | `blender_rt_commands` 看每个集成的真实状态；在 Blender 面板里配置 |
| ext 族报缺依赖 / skipped | 未安装 Open3D / manifold3d / glTF-Validator | 按回执安装对应依赖，或跳过该项（不会假通过） |

只改后端：`blender_viewport(op="restart")`。改插件 / 客户端：**必须重启 DSH**。

---

## 9. 目录结构（Repository layout）

```text
addon/dsh_blender_bridge.py   # Blender addon（v1.10；MIT，保留原版权声明）
runtime/                      # 后端：engine/server/runner/perf/view/recover + Python 能力模块
                              #   新增 assembly / blockout / evalharness / shapesolve / visualreport
src/index.ts                  # DSH host：15 个工具 + 后端看护（15 s）+ 租约 + 回执消毒
src/client/index.js           # Web 客户端半边：@ 提及 + 原生选中桥（v2.3 已无面板）
lib/                          # 构建产物（host 半边 + client bundle，已提交）
skills/blender-modeling/      # 随包建模 skill（自动注册）
tests/                        # 纯 Node 自检 + 真机能力自检（assembly / blockout / imgtools / …）
docs/                         # 教程 / 配置 / headless 路线 / 宿主契约 / 安装清单
```

---

## 10. 自检（Self-tests）

```bash
npm test                                  # 离线全套（能力锁 / schema / runtime 护栏 / 恢复 / 选中存储 / client bundle / skill provider）
node tests/client_bundle_selftest.mjs     # bundle 形状 + @ codec + 选中文本 / 插入路径
node tests/selection_store_selftest.mjs   # 选中存储：消毒 / seq / consume / last_consume
node tests/host_routes_selftest.mjs       # 真 HTTP 路由（需要后端在跑）
npm run test:routes                       # 路由契约（静态）
```

**真机能力自检**（需要 Blender；走无头通道，例）：

```text
blender_rt_headless(preload="imgtools", engine="none", script_file="tests/img_digest_selftest.py")
blender_rt_headless(preload="assembly,audit,contract,clearance,gate", engine="none",
                    script_file="tests/assembly_selftest.py")
blender_rt_headless(preload="blockout,qc,qc_render", engine="none",
                    script_file="tests/blockout_selftest.py")
```

发版门：`npm test` 全绿 + `npm pack --dry-run` ≈ **1.6 MB / 163 文件** + `blender_viewport(op="doctor")` → `kind=ok`。

---

## 11. 安全、许可与致谢（Security, license, credits）

- **写操作收敛**：所有改动走带**写租约**的路由；第二个会话拿到 `409 leased`，不会悄悄交错写入；
  租约可用 `scope` 声明集合 / 对象前缀两个维度。
- **CORS**：`/host/*` 只对 loopback Origin（与精确的 `dsh-app://app`）回显 `Access-Control-Allow-Origin`；
  这是浏览器跨源规则，**不是身份验证**。三个端口都只监听本机，不要对外暴露。
- 一切都在本地运行；不打包任何模型 / 贴图资源。
- **许可**：插件 MIT。addon 是 [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) 的 MIT 衍生版 ——
  原版权声明保留在文件里，**请勿删除**。
- 致谢：上游作者与所有 issue 反馈者、Blender 社区，以及在 WSL / Windows / macOS 上帮忙实测通道的人。

---

历史版本与逐版实测记录见 [`CHANGELOG.md`](CHANGELOG.md)；从旧版本升级见 [`MIGRATIONS.md`](MIGRATIONS.md)。

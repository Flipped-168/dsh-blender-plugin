# DSH × Blender 直连实时插件

> 🤖 **想让 AI 帮你装？** 别让它猜 —— 把仓库地址和 [`docs/AI-安装提示词.md`](docs/AI-安装提示词.md) 一起发给它
>（可直接粘贴的提示词 + 验收判据 + v2.3 要求的"装完必须告诉主人"）。唯一验收判据：`doctor` 回 `kind=ok`。

> **一条 TCP 直连通道，把 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）接到正在运行的 GUI Blender。**
> 15 个模型工具，不用装 MCP、不用 CLI 适配层：AI 能看、能改、能批处理、能验收、能回滚；
> 而**你**在 Blender 里原生选中物体，按一个按钮就把它们送进 DSH 当前会话的输入框。
>
> 🏷 **v2.3.0** · 15 个模型工具 · 28 family / 186 个 plan op · addon **v1.8**（protocol 11）· 包体 **1.4 MB / 159 文件**
>
> **v2.3 变了什么**：选中入口搬进 Blender（多选 / 集合两种模式 + human/agent 判定）；
> DSH 侧视口面板、点击进消息、`blender_rt_pick` **已删除**。详见下方「v2.3 亮点」。

---

## 支持本项目 · 爱发电

如果它帮你省了时间，可以支持一下开发：<https://afdian.com/a/sixtyseven67>。

---

## v2.3 亮点（What's new in v2.3）

- **选中入口搬进 Blender**：在视口里原生选中 → `N` →「DSH Blender Bridge」→ **Selection → DSH** → 发送；
  选中进 **DSH 当前会话草稿**，**不自动发送**。
- **两种模式**：**多选**（当前选中对象）/ **集合**（整组发送）。
  对象 / 集合成员列表**默认折叠**；展开后是带滚动条的 UIList，高度用「高度（行）」滑杆调（3–30 行，默认 8）——不固定、不铺长列。
- **子元素选中**（v2.4）：编辑模式里选**顶点 / 边 / 面**、姿态模式选**骨骼**、编辑模式选**曲线/晶格控制点**，
  发送时 payload 会带上 `selection.sub`（索引数组 + 选择模式 + 截断标记）；草稿文本会写明"已选哪些元素"，
  模型可用 `bmesh` / `pose.bones[...]` 精确修改。完整数组用 `blender_rt_cmd get_selection` 查。
  切到集合模式会自动推断最相关集合，⟳ 可重新推断。
  几百个零件的装配体直接发集合，草稿文本只给"集合名 + 件数 + 前几个成员"。
- **activity 判定**：Blender 统一判定 `idle / human / agent / both`（模态操作、最近人类编辑/撤销/选区变化、
  agent 命令窗口），面板实时显示，模型可查 `get_activity_state` / `get_selection`（查询自身不计入 agent）。
- **删除**：DSH 侧视口面板（Web 右侧栏 + TUI 侧栏）、点击进消息、模型请求点选 → 模型工具 **16 → 15**。
- **安装型 AI 必须转达**：`docs/AI-安装提示词.md` §③.5 已把"装完主动告诉用户这些新功能"写成硬要求。
- 另含：大名单收敛（草稿最多列 24 个名字 + 总数）、集合 payload 消毒、`last_consume` 诊断字段。

> 历史：v2.2 随包 skill + TUI 面板（面板 v2.3 删除）；v2.1 作业层 / 配方库 / 多选点选；v2.0 addon 改名
> `DSH Blender Bridge`；v1.0 冻结模型工具面。带实测数据的逐版记录见 [`CHANGELOG.md`](CHANGELOG.md)。

---

## 1. 30 秒速览

| 能干什么 | 工具 | 典型耗时 |
|---|---|---|
| 看视口 | `blender_rt_see` | 50–100 ms |
| 换任意角度看（不建相机、不动你的视口） | `blender_rt_see {from, look_at, …}` | 85–280 ms |
| 改一步、看一眼 | `blender_rt_do {see:true}` | ≈105 ms |
| 动没动、对不对 | `blender_rt_watch` | 每次 ≤6 帧 |
| 内环搜索（上千次迭代不进模型回合） | `blender_rt_loop` | 160 tick/s |
| 透传 / 列出 addon 命令 | `blender_rt_cmd` / `blender_rt_commands` | 25–55 ms |
| 渲染性能诊断 + 预设 | `blender_rt_perf` | analyze ≈10–20 s |
| 对象精简（安全合并、几何零损失） | `blender_rt_opt` | ≈1.4 ms/对象 |
| 重活丢给无头进程 | `blender_rt_headless` | 冷启动 0.9–1.2 s |
| 契约层 + 规划器（28 family / 186 op） | `blender_rt_plan` | AABB 24 ms · BVH 0.17 ms/对（307 对象） |
| 热无头会话（复用同一个 `blender -b`，`K` 跨调用保留） | `blender_rt_worker` | 冷启动只付一次 |
| 事务 / 回滚 | `blender_rt_txn` | 快照 96.7 MB / 824 ms（300 对象） |
| 配方库（存 / 套 / 导出参数组合） | `blender_rt_preset` | 存过的值真的生效 |
| 长任务作业层（超时不丢结果） | `blender_rt_job` | `op=wait` 等结构化结果 |
| 通道体检 / 写租约 / 一键拉起 Blender | `blender_viewport` | health 70–100 ms |

### 随包 skill（v2.2.0+，无需另装）

本包在 [`skills/blender-modeling/`](skills/blender-modeling/) 内置建模 skill，插件加载时注册为 `bundled` provider。
装好插件、重启 DSH 后，会话技能目录里就会出现；模型做建模 / 装配时会自行加载。
内容包括：选形决策树、24 条编号配方、六条必踩的坑、数值门清单、多 Agent 分工协议。

- **优先级**：rank 600。你自己放在 `~/.dsh/skills/blender-modeling` 的副本（user rank 400）仍然优先，老用户不会被强制覆盖。
- **非 DSH 宿主**（Claude Code / Codex / Cursor…）：同一目录就是普通 `skills/<name>/SKILL.md`，软链或拷到宿主技能根目录即可。

详细教程：[`docs/操作教程.md`](docs/操作教程.md) · 配置参考：[`docs/配置参考.md`](docs/配置参考.md) ·
部署 SOP：[`docs/部署SOP.md`](docs/部署SOP.md) · 接口契约 v2.3：[`docs/宿主集成-接口契约-v2.3增补.md`](docs/宿主集成-接口契约-v2.3增补.md)。

---

## 2. 前置条件（Requirements，5 条，缺一不可）

1. **Blender 4.x / 5.x 以 GUI 模式运行** —— 这条通道需要活的 GUI 会话（`-b` 只给无头工具用）。
2. **Blender 里的 addon —— 只支持本仓附带的 [`addon/dsh_blender_bridge.py`](addon/dsh_blender_bridge.py)**
   （**`DSH Blender Bridge` v1.8**，模块名 `dsh_blender_bridge`）。它监听 `127.0.0.1:9876`，至少提供 `ping`、`get_scene_info`、
   `get_world_state_snapshot`、`get_object_info(name)`、`get_viewport_screenshot(...)`、`execute_code(code)`，
   外加 5 个可选集成（PolyHaven / Hyper3D / Sketchfab / Poly Pizza / Hunyuan3D）。
   **上游 `MCP for Blender` / harveyxiacn `blender_mcp_addon` 自 v2.3 起不再支持**（旧的双名回退与 category-action 适配已删除）；
   如果装的是旧 addon，请停用它并改成本仓 addon（见 [MIGRATIONS.md](MIGRATIONS.md)）。
3. **Node.js ≥ 20**（跑后端与插件宿主）。
4. **DSH（DeepSeek Harness）** —— 本包以 DSH 插件形态提供工具（`inject: ['tools']`，按 `dsh.bundle` 声明装配）。
   WSL 里跑 DSH、Blender 在 Windows：需要 WSL 互操作（默认开）；Windows / 原生 Linux / macOS 同机部署都支持并自动探测。
5. **只有重建时才需要 DSH 源码 checkout**（`DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh`）；
   本仓已提交 `lib/`，克隆下来即可用。

---

## 3. 安装（Install，5 步）

> **不想构建、也不想走 npm？** 直接下 [Releases](https://github.com/sixtysevenlf/dsh-blender-plugin/releases) 里的
> `dsh-external-dsh-blender-plugin-2.3.0.tgz`（1.3 MB / 142 文件）：解包后放进
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

# ④ 装 addon + 启动 Blender + Connect —— 推荐一键：
#    blender_viewport(op="launch")  ← 拉起 GUI Blender + 自动扫到并启用 addon
#      （dsh_blender_bridge 与 blender_mcp 两种名字都能扫到）+ 轮询 9876，幂等；实测约 11 秒连上
#    人工（三条，缺一不可）：
#      a) 装 addon：Edit ▸ Preferences ▸ Add-ons ▸ Install... → 选 addon/dsh_blender_bridge.py
#         （或改用上游原版 MCP for Blender —— 两条都能连，但 v2.3 新功能只有改名版有，见 §2）
#      b) 启用它（勾选）；v2.0.0 改名后旧的「MCP for Blender」条目是**死引用**，需重新启用「DSH Blender Bridge」（见 MIGRATIONS.md）
#      c) 3D 视图按 N → 找到「DSH Blender Bridge」面板 → Connect（端口 9876）

# ⑤ 验证 —— 唯一验收判据：doctor 回 kind=ok（没到 = 没装好，按 §8 排查）
curl -sS http://127.0.0.1:9877/health      # 后端活着 + 加载版本自证（provenance）
curl -sS http://127.0.0.1:9877/doctor      # ⭐ 真跑一次 bpy 往返 + 打印生效配置
curl -sS http://127.0.0.1:9877/who         # 租约 + 通道指标 + config
```

插件会自动拉起后端（`node runtime/server.mjs`，默认 `127.0.0.1:9877`），并有 **15 秒看护**：进程掉了自动重生。
`blender_viewport op=stop` 可暂停看护。

> **随包 skill（v2.2.0+）**：DSH 重启后，`blender-modeling` 会自动从 `skills/blender-modeling/` 注册，无需另下 / 软链。

---

## 4. 第一次使用

```text
blender_viewport(op="doctor")                                # 体检：通道健康 + 生效配置
blender_rt_see(max_size=560)                                 # 看一帧：模型眼里的视口
blender_rt_see(from="9,-9,6", look_at="0,0,1")               # 换个角度：不打扰你正在看的视口
```

### 4.1 宿主集成：`@` 提及 + Blender 原生选中

除模型工具外，本包还给 DSH Web 客户端贡献一个**用户侧**半边（走独立 `/host/*` 路由，**不进** op 目录、
**不加**模型工具 ⇒ **15 个工具 / 186 个 op** 的能力面零变化）：

- **`@` 提及**：输入框敲 `@` 出对象 / 材质 / 集合候选（引用带前缀 `object:<name>` / `material:<name>` /
  `collection:<name>`），选中后由 `codec` 拆掉前缀、序列化成 `<blender-object>Cube</blender-object>`，模型不再猜对象名。
- **Blender 原生选中 → 草稿**（v2.3，需 addon v1.8+）：在 Blender 里选中 → `N` → **Selection → DSH** → 发送；
  选中进**当前会话草稿**，**不自动发送**。两种模式：**多选**（当前选中对象）/ **集合**（整组发送，大装配体推荐）。
  - **列表可伸缩**：默认折叠，展开后带滚动条；高度用「高度（行）」滑杆调整，不固定。
  - 后端地址收进折叠的「后端 / 高级」。
- **activity 状态**：Blender 统一判定 `idle / human / agent / both`；N 面板实时显示，模型可查
  `blender_rt_cmd get_activity_state` / `get_selection`（查询**自身不算** agent），另有
  `get_collections` / `send_collection_to_dsh` 供集合工作流。
- **v2.3 已删除**：DSH 侧视口面板（Web 右侧栏 + TUI 侧栏）、点击进消息、第 16 个工具 `blender_rt_pick`。
  编辑/姿态模式的子元素选择（点/线/面/骨骼/曲线点）也会随发送带过去（`selection.sub`）。
  请改用原生选中；模型侧截图仍用 `blender_rt_see`。后端 `/host/view/*`、`/host/pick*`、`/host/ready`
  路由为兼容保留，但本仓**已无 UI 消费者**。

> ⚠ **改完 / 升级完必须重启 DSH**：客户端半边（`lib/client.js`）是 DSH 启动时加载的模块；只改了后端才用
> `blender_viewport(op="restart")`。客户端半边从 HTTP loopback GUI 或官方桌面端 `dsh-app://app` 跨源调
> `9877`；后端仅对 **HTTP loopback** 与**精确的 `dsh-app://app`** 回显 CORS Origin。**这不是身份验证，也不是服务端 403。**

### 4.2 一次真实会话（5 个调用）

```text
blender_rt_cmd {name:"get_scene_info"}
blender_rt_do   {code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_plan {op:"audit_scene"}
blender_rt_headless {script:"print('HEADLESS {\"ok\":true}')", engine:"none"}
blender_rt_txn  {op:"snapshot", label:"before-edit"}
```

---

## 5. 工具参考（Tool reference，15 个工具）

所有工具都要求后端在跑（插件会帮你起）且 addon 已连上。参数名就是 schema 里的名字，WSL / Windows / macOS 完全一致。

| 工具 | 作用 |
|---|---|
| `blender_rt_see` | 取一帧 3D 视口（约 50–160 ms）。`full=true` + `area=N` 走整窗口 / 第 N 个区域截图；`from` / `look_at`（+ `lens`、`ortho`、`view_size`、`shading`、`overlays`、`view_mode`）走**自定义视角**：自建矩阵离屏绘制，不建相机、不改 `scene.camera`、不动用户视口；同一视角默认不重复出图，`force=true` 强制重发。 |
| `blender_rt_do` | 在 Blender 主线程执行 Python，持久内核 `K` 跨调用保留状态；`see=true` 顺带回一帧。 |
| `blender_rt_watch` | 在一段时间窗内连续采样视口（≤6 帧 + 逐帧 hash），回答"动没动 / 对不对"。 |
| `blender_rt_loop` | Blender 主线程内环搜索：`setup/step/measure` + 罚项 / 退火 / 候选表 / 可复现导出。 |
| `blender_rt_cmd` | 透传 addon 任意命令（39 条：24 常驻 + 15 集成门控）。 |
| `blender_rt_commands` | 列出当前可用 addon 命令 + 5 个集成的真实开关状态。 |
| `blender_rt_perf` | 渲染性能：`analyze` 差分实测；`apply` 预设（persistent_data / OptiX 降噪 / auto_tile off / 采样上限）；`revert` / `status`。 |
| `blender_rt_opt` | 对象精简：analyze 合并候选；同集合 / 同材质安全合并，**几何零损失**（≈1.4 ms/对象）。 |
| `blender_rt_headless` | 独立 `blender -b` 进程（不占 GUI 通道）：`file/outdir/args/timeout_ms/factory_startup/bootstrap/preload`；结果用 `print("HEADLESS {json}")` 回传。 |
| `blender_rt_plan` | 契约层 + 规划器：组件 / 连接 / 包络、只读校验、`destructive_guard`、证据账本、假设三态判定（`supported / refuted / unresolved`）、规划器 → bpy 编译；`op="catalog"` 本地直出 28 family / 186 op（何时用 / 别用 / 最小骨架）。 |
| `blender_rt_worker` | 热无头会话（复用同一个 `blender -b` + 持久 `K`）：`start/exec/status/stop/restart`。 |
| `blender_rt_txn` | 事务：文件级 `snapshot/restore`（拓扑安全）+ 对象级 `mark/revert`（只含变换 / 材质 / 可见性）。 |
| `blender_rt_preset` | 参数配方库：`save/list/get/apply/delete/export/import`（点路径 data；targets `MAT:` / `OBJ:` / `SCENE`）。 |
| `blender_rt_job` | 长任务作业层：`start/status/collect/wait/kill/list`；工具超时不丢结果。 |
| `blender_viewport` | 通道运维：`status/start/stop/restart/doctor/who/lease/release/launch`。 |

---

## 6. 实战配方（Recipes）

常用链路（细节在 [`docs/操作教程.md`](docs/操作教程.md) 与随包 skill）：

- **产形 → 体检 → 修**：`sculpt_scan → sculpt_setup(VOXEL) → sculpt_apply` · `audit_mesh → fix_repair → audit_mesh`。
- **贴图交付**：`uv_smart_project → uv_stats → deliver_export → deliver_verify` · `material_build → material_apply → material_bake`。
- **装配验收**：`gate_plan(preset="assembly") → gate_run(spec_path=…)`，读顶层**三态 `verdict`**（`degraded` ≠ 通过）。
- **干涉 / 间隙**：`audit_interference` / `audit_clearance` / `audit_connectivity`；车辆走 `vehicle_package → vehicle_base → clear_check → qc_render_views(ortho)`。
- **长任务**：`render_state → render_wait`（渲染中写命令约 71 ms 回 `BUSY_RENDER`）· 超过 1 分钟用 `blender_rt_job(op="start")`。
- **回滚**：对象级 `mark/revert`；拓扑改动必须 `snapshot/restore`。

---

## 7. 配置（Configuration）

配置来源（优先级从高到低）：插件配置 → `DSH_BLENDER_*` 环境变量 → `$DSH_BLENDER_CONFIG` 文件 →
包根 `dsh-blender.config.json` → `~/.dsh/dsh-blender.config.json` → 自动探测默认值。

常用项：`port`（后端 9877）、`addonHost` / `addonPort`（9876）、`addonProtocol`（`auto|flat|category-action`）、
`blenderExe`、`workDir`、`holder`、`workerPort`（9879）。完整表见 [`docs/配置参考.md`](docs/配置参考.md)。

---

## 8. 常见故障（Troubleshooting）

| 回执 / 现象 | 含义 | 处置 |
|---|---|---|
| `blender-unreachable` | Blender 没跑，或 addon 没 Connect | `blender_viewport(op="launch")`；或人工按 `N` → Connect |
| `main-thread-busy` | 主线程被渲染 / 模态操作占住 | 等它空下来，或改走无头 |
| 后端不可用（9877 连不上） | 后端进程没起来 | `blender_viewport(op="start")` |
| `value is not lossless JSON` | 插件版本旧（< v0.9.4） | 升级后**重启 DSH** |
| 写操作 409 `leased` | 别的会话持有写租约 | `blender_viewport(op="who")`，别强抢 |
| N 面板没有「Selection → DSH」 | 装的是旧 `MCP for Blender`（v2.3 不支持） | 停用旧 addon，装本仓 v1.8，再重启 DSH |
| 已发送但草稿没字 | 升级后没重启 DSH / 草稿被锁 | 重启 DSH；看 `/host/selection/latest.last_consume` 的 `ok/reason` |
| 旧「Blender 视口」tab 还在 | DSH 没重启（v2.3 已删面板） | 重启 DSH |

只改后端：`blender_viewport(op="restart")`。改插件 / 客户端：**必须重启 DSH**。

---

## 9. 目录结构（Repository layout）

```text
addon/dsh_blender_bridge.py   # Blender addon（上游改名版；MIT，保留原版权声明）
runtime/                      # 后端：engine/server/runner/perf/view/选中存储 + Python 能力模块
src/index.ts                  # DSH host：15 个工具 + 后端看护（15 s）+ 租约 + 回执消毒
src/client/index.js           # Web 客户端半边：@ 提及 + 原生选中桥（v2.3 已无面板）
lib/                          # 构建产物（host 半边 + client bundle，已提交）
skills/blender-modeling/      # 随包建模 skill（自动注册）
tests/                        # 纯 Node 自检（零新增依赖）
docs/                         # 教程 / 配置 / 宿主集成契约 / 安装清单
```

---

## 10. 自检（Self-tests）

```bash
npm test                                  # 离线全套（能力锁 / schema / runtime 护栏 / 选中存储 / client bundle / skill provider）
node tests/client_bundle_selftest.mjs     # bundle 形状 + @ codec + 选中文本 / 插入路径
node tests/selection_store_selftest.mjs   # 选中存储：消毒 / seq / consume / last_consume
node tests/host_routes_selftest.mjs       # 真 HTTP 路由（判据 1–8、S1–S3；需要后端在跑）
npm run test:routes                       # 路由契约（静态）
```

发版门：`npm test` 全绿 + `npm pack --dry-run` ≈ **1.3 MB / 142 文件** + `blender_viewport(op="doctor")` → `kind=ok`。

---

## 11. 安全、许可与致谢（Security, license, credits）

- **写操作收敛**：所有改动走带**写租约**的 `/act` 类路由；第二个会话拿到 `409 leased`，不会悄悄交错写入。
- **CORS**：`/host/*` 只对 loopback Origin 回显 `Access-Control-Allow-Origin`；这是浏览器跨源规则，不是身份验证。
  三个端口都只监听本机，**不要**对外暴露。
- 一切都在本地运行；不打包任何模型 / 贴图资源。
- **许可**：插件 MIT。addon 是 [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) 的 MIT 衍生版 ——
  原版权声明保留在文件里，**请勿删除**。
- 致谢：上游作者与所有 issue 反馈者、Blender 社区，以及在 WSL / Windows / macOS 上帮忙实测通道的人。

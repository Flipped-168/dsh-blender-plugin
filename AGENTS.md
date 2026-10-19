# AGENTS.md —— 给 AI 助手的仓库说明

> 这个文件会被 DSH / Claude Code / Cursor / Codex 等助手**自动加载**。动手前先读完（约 1 分钟）。
> 人类读者请直接看 [README.zh-CN.md](README.zh-CN.md)（[English](README.md)）。

## 0. 硬规则：先读 README，再动手

凡是**安装 / 部署 / 配置 / 排查**类任务，先完整读 `README.zh-CN.md`（或 `README.md`）的这三节：

| 读哪节 | 为什么 |
|---|---|
| **§2 前置条件（5 条）** | 缺一条都装不起来。注意：Blender 侧 addon **只支持本包附带的 `addon/dsh_blender_bridge.py`（v1.10+）**；旧 `MCP for Blender` 自 v2.3 起不支持，必须停用旧 addon 再启用本包 addon（见 [MIGRATIONS.md](MIGRATIONS.md)） |
| **§3 安装（5 步）** | 构建 → 配置 → 装进 profile → 起 Blender → 验证 |
| **§8 常见故障**（英文 README 为 §9） | 报错先查表，别自己发明修法 |

**不要凭直觉编**：路径、端口（addon `9876` / 后端 `9877`）、配置项名，一律从 `docs/配置参考.md` 取。
工具名 / op 名不确定时先 `blender_rt_plan(op="catalog")`（本地直出，不占往返）；写错会回 `did_you_mean`，照它给的骨架改。

## 1. 「装好了」的判据（不是「命令跑完了」）

三条全绿才算装好；缺一条就是没装好，按 §8 排查（英文 README 为 §9）：

1. `curl -sS http://127.0.0.1:9877/doctor` → `kind=ok`
2. `blender_viewport(op="doctor")` → `kind=ok`
3. `blender_rt_see(max_size=560)` → 回一帧图（而不是一段报错文本）

**没到 `kind=ok` 不要对用户说「安装成功」。** 典型失败与含义：

| 回执 | 含义 | 处置 |
|---|---|---|
| `blender-unreachable` | Blender 没跑，或 addon 没 Connect | `blender_viewport(op="launch")`；或人工在 Blender 里按 `N` → Connect |
| `main-thread-busy` | 主线程被渲染 / 模态操作占住 | 等它空下来，或改走无头 |
| 后端不可用 | 后端进程没起来 | `blender_viewport(op="start")` |
| `value is not lossless JSON` | 版本旧（< v0.9.4） | 升级后**重启 DSH** |
| 写操作 409 `leased` | 别的会话持有写租约 | `blender_viewport(op="who")`，别强抢 |

## 2. 装完 / 改完之后的规矩

- **插件升级后必须重启 DSH**（插件是 DSH 启动时加载的模块）；只改了后端才用 `blender_viewport(op="restart")`。
- 长任务（> 1 min、长渲染、批量几何）走 `blender_rt_job(op="start"/"wait")` 或 `blender_rt_headless(as_job=true)`；
  **别用同步 headless 硬等** —— 客户端超时 ≠ 任务失败，按 `runId` 回收结果。
- 拓扑类改动要回滚，用 `blender_rt_txn` 的文件级 `snapshot/restore`；对象级 `mark/revert` **不含**拓扑 / UV 改动。

## 3. 改这个仓库本身

- 构建：`DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh`（`src/` → `lib/`）。
- 离线自检：`npm test`；真机 HTTP 验收：`node tests/host_routes_selftest.mjs`（需要后端在跑）。
- 改 `runtime/*.py` 前先看 `tests/README.md`；每个能力族都有对应的 `*_selftest`。
- 文档事实源在包内：`README.zh-CN.md` · `docs/操作教程.md` · `docs/配置参考.md` · `CHANGELOG.md`。
- **发版流程**（v1.0.0 起）：① 版本号**三处同步**（`package.json` / `src/index.ts` 的 `PLUGIN_VERSION` / 重建后的 `lib/`）；
  ② `npm test` 全绿；③ 提交 → `git tag -a vX.Y.Z` → 推 `main` 与 tag → `gh release create`。
- **发布 npm**：`npm pack` → `npm publish <tgz> --access public`（包名 `@dsh-external/dsh-blender-plugin`，需维护者 npm 登录）。
  打包面靠 `runtime/.npmignore` + `package.json` 的 `files` 否定模式把 `runtime/ext/venv`（1.2 G）挡在包外 ——
  **改 `files` 后必须 `npm pack --dry-run` 核对**（健康值：v2.5.0 起约 **1.3 MB / 142 文件**（删掉面板/点选/旧 addon 支持后变小），含随包 skill + 选中桥；v2.2 为 1.5 MB/161、v2.1 为 1.3 MB/144；
  曾经漏成 458 MB / 12638 文件）。
- **随包 skill 的真源**：`skills/blender-modeling/`（SKILL.md + references + MIT LICENSE/NOTICE）。插件加载时注册 bundled provider
  （`ctx.inject(['skills'], …)`，rank 600；用户 `~/.dsh/skills` 的 400 副本仍优先）。**改 skill 直接改这里**，独立仓库
  `dsh-skill-blender-modeling` 仅作非 DSH 宿主的镜像；改完跑 `node tests/skill_bundle_selftest.mjs`（61 断言，含带 signal 的真 SkillRegistry 集成）。
- **v2.3 选中桥 + 删面板**：DSH 侧视口面板 / `blender_rt_pick` / TUI 侧栏面板**已删除**（入口改到 Blender 原生选中）。addon 侧 `ActivityTracker` + 5 条命令（`get_activity_state` / `get_selection` / `send_selection_to_dsh` /
  `get_collections` / `send_collection_to_dsh`，addon v1.10；集合发送用于大装配体）；
  v2.4 起编辑模式点/线/面、姿态骨骼、曲线/晶格控制点也进入 `selection.sub`（见契约 §S1.3）。
  后端 `/host/selection{,/latest,/consume}`；Web 客户端 `conversation.input.dock` 无头桥。契约唯一真源 `docs/宿主集成-接口契约-v2.3增补.md`；
  回归 `node tests/selection_store_selftest.mjs` + `node tests/client_bundle_selftest.mjs`（改后两者都必须在 `npm test` 里绿）。
  两个 N 面板模式：**多选 / 集合**（`get_collections` / `send_collection_to_dsh`；大装配体用集合）。
  **装完/升级完必须主动告诉用户这些新功能**（话术见 `docs/AI-安装提示词.md` §③.5）——用户装插件后不会去翻 CHANGELOG。

## 4. 给用户的一段提示词

[docs/AI-安装提示词.md](docs/AI-安装提示词.md) 是可直接粘贴给任意 AI 助手的安装提示词（含验收判据与失败对照表）。

# 迁移与路径变更记录

> 若你的环境基线文档里出现"旧路径"，对照本表。**旧路径均已删除**，只在原址留指路 README。

## v2.0.0 改名迁移（去上游痕迹，2026-10-16）

> 本插件与它依赖的 Blender 侧 addon **一起改名**。**旧名仍被兼容读取**，但用户侧有一件必须做的事（见下）。
> 改名方案与逐字命名映射（唯一真源）：[`docs/改名方案-去上游痕迹.md`](docs/改名方案-去上游痕迹.md)。

### 改了什么

| 项 | 旧 | 新 |
|---|---|---|
| Blender addon 文件名 / 模块名 | `blender_mcp.py` / `blender_mcp` | **`dsh_blender_bridge.py`** / **`dsh_blender_bridge`** |
| addon 显示名（UI / 面板 / 日志） | `MCP for Blender` | **`DSH Blender Bridge`** |
| addon 标识前缀（属性 / prefs / handler / timer，34 个） | `blendermcp_` | **`dshbb_`** |
| 注册类 | `bpy.types.blendermcp_server` | **`bpy.types.dshbb_server`** |
| 5 个集成开关 | `blendermcp_use_polyhaven` 等 | **`dshbb_use_polyhaven`** 等 |
| 协议判别 id（`addonProtocol`） | `ahujasid` | **`flat`**（`ahujasid` 为**已弃用别名**，仍被接受） |
| 协议显示标签 | `ahujasid / MCP for Blender（…）` | **`直连 addon · 扁平协议（无分帧）`** |

### 用户要做的三件事

1. **在 Blender 偏好设置里重新启用 addon**：模块名从 `blender_mcp` 变成 `dsh_blender_bridge` ⇒ Blender 旧的"已启用插件"记录是**死引用**（可顺手移除）。到 `Edit ▸ Preferences ▸ Add-ons` 里重新启用 **`DSH Blender Bridge`**，然后 3D 视图按 `N` →「DSH Blender Bridge」→ **Connect**。
2. **旧配置不用改**：`addonProtocol: "ahujasid"` 仍被接受（`resolveProtocol` 归一化为 `flat`，不报错）。addon 侧标识按兼容契约做**双名探测**（先读 `dshbb_*`，取不到再回退 `blendermcp_*`；`bpy.types` 同理），所以**改名前后都能连**。
3. **以后升级上游 addon 会打回原形**：上游仍用 `blendermcp_*` 与 `MCP for Blender`。届时 addon 显示名会变回 `MCP for Blender`、标识回到 `blendermcp_*` —— **插件的双名回退仍能让通道继续工作**（不需要改配置）；想保持新名字就按 [`docs/改名方案-去上游痕迹.md`](docs/改名方案-去上游痕迹.md) §1.1 自行做机械替换。

> **归属与许可保留**：改名只动**显示名与标识**，不动 addon 源码里的版权声明与 MIT 许可证文本。上游归属/对比叙述保留在 [`docs/上游整合评估-mcp-for-blender与blend-ai.md`](docs/上游整合评估-mcp-for-blender与blend-ai.md)、[`docs/宿主集成层评估-Codex插件与DSH移植.md`](docs/宿主集成层评估-Codex插件与DSH移植.md) 与 [`CHANGELOG.md`](CHANGELOG.md) 的来源条目里。

## 历史：路径 / 通道变更（2026-09）

| 时间 | 变更 | 旧 | 新 |
|---|---|---|---|
| 2026-09-13 | 插件独立成包并改名 | `plugins/dsh-blender-viewport/`（包名 `@dsh-external/dsh-blender-viewport`） | **`dsh-blender-plugin/`**（包名 **`@dsh-external/dsh-blender-plugin`**）；运行时从 `blender/viewport/` 迁到 **`dsh-blender-plugin/runtime/`** |
| 2026-09-13 | MCP / CLI 通道废弃 | `blender/cli-tools/blender-mcp`、`D:\DSH\blender\venv`、`~/blender-mcp`、`blender/viewport/ui.html`、`tools/win_input_daemon.ps1` | 全部删除；模型侧只剩直连通道的 9 个工具 |
| 2026-09-13 | 后端进程 | 由旧插件 `plugins/dsh-blender-viewport` 拉起 | 由 `dsh-blender-plugin` 拉起（`runtime/server.mjs --port 9877`），带 15 s 看护 |
| 2026-09-13 (v0.4.0) | 取帧参数：自定义视角 | 旧版"换角度 = 改用户视口 / 建相机对象"（或 CLI 的 `rotate_view_generate_image`） | `blender_rt_see {from, look_at, lens, ortho, ortho_scale, view_size, shading, overlays, view_mode}`；零场景改动（`runtime/view.py`） |
| 2026-09-13 (v0.4.0) | 长任务通道 | 在 GUI 会话里硬跑 `render.render()`（会撞 CUDA context，且占满主线程） | `blender_rt_headless {script, file, outdir, args, timeout_ms, factory_startup, bootstrap, preload}` 独立进程 |
| 2026-09-13 (v0.4.0) | 并发保护 | 无（多个会话/agent 直接互相踩） | 写通道租约：`/lease` `/release` `/who` + `blender_viewport {op:"who|lease|release"}`；只读 op 豁免 |
| 2026-09-13 (v0.4.0) | 健康检查 | `/health` 只能说"后端活着" | `/doctor` + `{op:"doctor"}`：真跑 bpy 往返，三级判定 + `fix` |

## 环境基线文档该读哪份

- 总说明：`dsh-blender-plugin/README.md`
- 机制/踩坑：`dsh-blender-plugin/docs/操作教程.md`
- 建模方案（内环）：`dsh-blender-plugin/docs/操作教程.md`
- 工作区约定：作者工作区的 `AGENTS.md` §2（等价内容见本包 `README.md` + `docs/操作教程.md`）

## 注意（曾经踩过）

- **Blender 里 addon 的 socket 没起来时**，后端照常运行（`/health` ok），但所有 rt 工具会报错 —— 先看 `blender_viewport {op:"doctor"}` 的三级判定。
- **GUI 会话里不要连续 `render.render()`**（见 README「已知限制」）；长渲染用 `blender_rt_headless`。
- **旧文档里若写租约是"顾问式/不阻塞"或参数叫 `resolution`**：那是最初的设计稿口径。实际实现是：写路由会返回 **409 并挡下**（`force:true` 可抢），自定义视角分辨率参数叫 **`view_size`**（"宽x高"）。见 CHANGELOG v0.4.0。

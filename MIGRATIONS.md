# MIGRATIONS —— 从旧版本迁到 v2.3

> v2.3 是**收缩版**：删除了 DSH 侧视口面板 / 点选 / TUI 面板，**不再兼容**上游 `MCP for Blender`
> 与 harveyxiacn `blender_mcp_addon`。下面是从各旧状态迁到 v2.3 的唯一路径。

## 1. Blender 侧 addon：必须换成 `DSH Blender Bridge` v1.8+

v2.3 的原生选中 / 集合 / activity 依赖本仓 addon 的 5 条命令与 N 面板入口，旧 addon 没有。
两个 addon 都默认监听 `127.0.0.1:9876`，**不能同时启用**。

1. `Edit ▸ Preferences ▸ Add-ons` → 停用旧条目（`MCP for Blender` / `blender_mcp` / `blender_mcp_addon`）。
2. `Install...` → 选本仓 [`addon/dsh_blender_bridge.py`](addon/dsh_blender_bridge.py) → 勾选启用 **DSH Blender Bridge**。
3. 3D 视图按 `N` →「DSH Blender Bridge」→ **Connect**（端口 9876）；或直接 `blender_viewport(op="launch")`。
4. `blender_rt_cmd get_addon_info` → `addon_version` 应为 `[1,8]`，capabilities 含
   `get_activity_state` / `get_selection` / `get_collections` / `send_*_to_dsh`。

> 旧名 `blender_mcp` 的"已启用"记录是死引用，可以移除；插件**不再做双名回退**。

## 2. DSH 侧：升级插件后必须重启 DSH

- 客户端半边（`@` 提及 + 原生选中桥）是启动时装载的；不重启会继续跑旧 bundle（里面还有已删除的面板）。
- 旧「Blender 视口」tab、点击进消息、`blender_rt_pick` 在 v2.3 全部消失，这是**预期行为**。
- 选中入口改为：Blender 原生选中 → `N` →「Selection → DSH」→ 发送（多选 / 集合两种模式）。

## 3. 配置文件清理（可选）

- `addonProtocol` 配置项与 `DSH_BLENDER_ADDON_PROTOCOL` 环境变量**已删除**（只剩本仓扁平协议）。
  旧配置里留着也不影响启动，但建议删掉，避免误以为还能切协议。
- 其他 `DSH_BLENDER_*` 配置项不变，见 [`docs/配置参考.md`](docs/配置参考.md)。

## 4. 旧的接口契约文档

`docs/宿主集成-接口契约.md`、`宿主集成-接口契约-v2.1增补.md`、`v2.2增补.md` 与 TUI 适配文档已删除；
当前唯一真源是 [`docs/宿主集成-接口契约-v2.3增补.md`](docs/宿主集成-接口契约-v2.3增补.md)。

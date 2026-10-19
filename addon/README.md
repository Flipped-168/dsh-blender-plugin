# `dsh_blender_bridge.py` —— Blender 侧 addon（本仓附带）

配套 [`@dsh-external/dsh-blender-plugin`](../README.zh-CN.md) 的 Blender 内 addon。
**本目录是"改名版"**；你也可以改用**上游原版**（见下面"两条路"）—— 插件对 addon 标识做了**双名回退**，两条都能连。

## 这个文件是什么

| 项 | 值 |
|---|---|
| 文件名 / 模块名 | `dsh_blender_bridge.py` / `dsh_blender_bridge` |
| 显示名（Blender 插件列表里） | **DSH Blender Bridge** |
| 版本 / 协议 | addon **v1.8 / protocol 11**（2026-10-19 活进程实测：Blender 5.2.2 LTS） |
| 标识前缀 | `dshbb_`（注册类 `bpy.types.dshbb_server`、5 个集成开关 `dshbb_use_*`） |
| TCP 端口 | 默认 `127.0.0.1:9876` |
| 命令面 | 39 条（24 常驻 + 15 集成门控；v1.8 新增 `get_activity_state` / `get_selection` / `send_selection_to_dsh` / `get_collections` / `send_collection_to_dsh`） |

## 来源与许可（MIT）

本文件是 [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) 的**衍生改名版**（MIT）。
改名只动了**显示名与标识前缀**，**版权与许可文本原样保留**：

```
# Code created by Siddharth Ahuja: www.github.com/ahujasid © 2025
    "author": "Siddharth Ahuja",
```

上游 MIT 许可要求保留上述版权声明 —— **请勿删除**。

## 装法（两条路，任选）

### A. 用本仓附带版（开箱即用）

1. Blender → `Edit ▸ Preferences ▸ Add-ons ▸ Install...` → 选本目录的 `dsh_blender_bridge.py`
2. 勾选启用 **DSH Blender Bridge**
3. 3D 视图按 `N` → 找到「**DSH Blender Bridge**」面板 → 点 **Connect**（端口 9876）

### B. 用上游原版

按上游仓库说明装 `MCP for Blender`（模块名 `blender_mcp`）即可 —— 插件会自动识别（双名回退），
只是 Blender 里显示的名字是上游那个。

> 也可以让插件**一键拉起**：`blender_viewport(op="launch")` —— 它会拉起 GUI Blender 并**自动扫到并启用**
> addon（`dsh_blender_bridge` 与 `blender_mcp` 两种名字都能扫到），实测约 11 秒连上。

## 环境变量（v2.0.0 起改名，旧名仍兼容）

新名优先、旧名回退：`DSHBB_HYPER3D_API_KEY` → 回退 `BLENDERMCP_HYPER3D_API_KEY`，其余同理
（`SKETCHFAB` / `POLYPIZZA` / `HUNYUAN3D_*` / `PREMIUM_*`）。**你已设的旧变量不会失效。**

## 升级上游会怎样

上游新版的标识仍是 `blendermcp_*`。直接替换本文件会让显示名变回 `MCP for Blender` —— 但**通道照常工作**
（插件双名回退兜住）。想要新功能又要新名字，就在新版上重做一次改名：
`blendermcp_` → `dshbb_`、`MCP for Blender` → `DSH Blender Bridge`、`blender_mcp` → `dsh_blender_bridge`。

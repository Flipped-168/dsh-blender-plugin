# DSH × Blender — direct real-time channel

> 🤖 **Installing with an AI agent?** Don't let it guess — send it the repo URL plus
> [`docs/AI-安装提示词.md`](docs/AI-安装提示词.md) (paste-ready prompt + acceptance criteria + the v2.3
> "tell your owner" requirement). The only acceptance criterion is `doctor` → `kind=ok`.

> **One TCP channel between [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) and a live GUI Blender.**
> 15 model tools, no MCP assembly, no CLI adapter: the model can look, edit, batch-process, verify and roll back —
> while **you** pick objects in Blender natively and send them into the DSH draft with one button.
>
> 🏷 **v2.5.0** · 15 model tools · 28 families / 186 plan ops · addon **v1.10** (protocol 11) · package **1.3 MB / 142 files**
>
> **What changed in v2.3:** selection moved into Blender (multi-select / collection modes + human/agent activity);
> the DSH-side viewport panel, click-to-message and `blender_rt_pick` were **removed**. See §5.

---

## Support · Afdian (爱发电)

If this saves you time, you can support development: <https://afdian.com/a/sixtyseven67>.

---

## 1. What you get (30-second tour)

| Capability | Tool | Typical latency |
|---|---|---|
| Peek at the viewport | `blender_rt_see` | 50–100 ms |
| Render from any angle (no camera object, user viewport untouched) | `blender_rt_see {from, look_at, …}` | 85–280 ms |
| Change one thing and verify it | `blender_rt_do {see:true}` | ≈105 ms |
| Did it move? Is it right? | `blender_rt_watch` | ≤6 frames/call |
| Inner-loop search (thousands of iterations, zero model turns) | `blender_rt_loop` | 160 ticks/s |
| Pass through any addon command / list them | `blender_rt_cmd` / `blender_rt_commands` | 25–55 ms |
| Render performance profiling + preset | `blender_rt_perf` | analyze ≈10–20 s |
| Object decimation (safe join, zero geometry loss) | `blender_rt_opt` | ≈1.4 ms/object |
| Headless process for heavy renders / batch geometry | `blender_rt_headless` | cold start 0.9–1.2 s |
| Contract layer + planner (28 families / 186 ops) | `blender_rt_plan` | AABB sweep 24 ms · BVH 0.17 ms/pair (307 objects) |
| Hot headless session (reuse one `blender -b`, `K` persists) | `blender_rt_worker` | pays the 1.1–1.5 s cold start once |
| Transactions / rollback | `blender_rt_txn` | snapshot 96.7 MB / 824 ms (300 objects) |
| Preset library (save / apply / export parameter sets) | `blender_rt_preset` | stored values really take effect |
| Job layer for work longer than one wait window | `blender_rt_job` | `op=wait` returns the structured result |
| Channel health / write lease / one-call Blender launch | `blender_viewport` | health 70–100 ms |

### Bundled modeling skill (v2.2.0+, no extra install)

The package ships `blender-modeling` under [`skills/blender-modeling/`](skills/blender-modeling/) and registers it with DSH's skill registry as a `bundled` provider when the plugin loads. After installing the plugin and restarting DSH, the skill appears in the session skill catalog; the model loads it on its own for modeling / assembly work. It contains the shape decision tree, 24 numbered recipes, the six pitfalls, the numeric-gate checklist, and the multi-agent coordination protocol.

- **Precedence**: rank 600. A copy you installed yourself under `~/.dsh/skills/blender-modeling` (user rank 400) still wins, so existing users are never force-updated.
- **Non-DSH hosts** (Claude Code / Codex / Cursor…): the same directory is a plain `skills/<name>/SKILL.md` bundle — link or copy it to your host's skill root.

Detailed walkthrough (Chinese): [`docs/操作教程.md`](docs/操作教程.md) · configuration reference: [`docs/配置参考.md`](docs/配置参考.md) · deployment SOP: [`docs/部署SOP.md`](docs/部署SOP.md) · contract v2.3: [`docs/宿主集成-接口契约-v2.3增补.md`](docs/宿主集成-接口契约-v2.3增补.md).

---

## 2. Requirements

1. **Blender 4.x / 5.x running in GUI mode** — this channel needs a live GUI session (`-b` is only used by the headless tools).
2. **Blender addon — only the bundled [`addon/dsh_blender_bridge.py`](addon/dsh_blender_bridge.py) is supported** (**`DSH Blender Bridge` v1.10**, module `dsh_blender_bridge`). It listens on `127.0.0.1:9876` and provides `ping`, `get_scene_info`, `get_world_state_snapshot`, `get_object_info(name)`, `get_viewport_screenshot(...)`, `execute_code(code)` plus the 5 optional asset integrations (PolyHaven / Hyper3D / Sketchfab / Poly Pizza / Hunyuan3D). Upstream `MCP for Blender` / harveyxiacn `blender_mcp_addon` are **not supported** since v2.3 (the old dual-name and category-action adapters were deleted) — if you have one installed, disable it and install the bundled addon (see [MIGRATIONS.md](MIGRATIONS.md)).
3. **Node.js ≥ 20** (runs the backend).
4. **DSH (DeepSeek Harness)** — this package is a DSH plugin (`inject: ['tools']`, declares `dsh.bundle` via `cordis.patch.yml`). WSL host + Windows Blender needs WSL interop (on by default); same-OS setups (Windows / native Linux / macOS) are supported and auto-detected.
5. **A DSH source checkout only if you rebuild** (`DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh`); the repo commits `lib/`, so a plain clone is ready to install.

---

## 3. Install (5 steps)

> **No build, no npm?** Grab `dsh-external-dsh-blender-plugin-2.5.0.tgz` (1.3 MB / 142 files) from [Releases](https://github.com/sixtysevenlf/dsh-blender-plugin/releases): unpack it into `<profile>/node_modules/@dsh-external/dsh-blender-plugin`, or `npm i ./that.tgz`. The skill is inside the tarball (`skills/blender-modeling/`).
> Full third-party checklist: [`docs/给第三方的安装清单.md`](docs/给第三方的安装清单.md).

```bash
# 1) Build (optional — lib/ is committed; only needed after changing src/)
cd dsh-blender-plugin
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh     # produces lib/

# 2) (optional) configure — auto-detection usually just works
cp dsh-blender.config.example.json dsh-blender.config.json

# 3) Install into DSH as a profile bundle (this package declares dsh.bundle):
#    a) symlink into <profile>/node_modules/@dsh-external/dsh-blender-plugin
#    b) in the profile package.json add "link:<abs path>" to dependencies and
#       "@dsh-external/dsh-blender-plugin" to dsh.profile.bundles
#    c) dry-run: dsh --profile <profile> --dump-config   then restart DSH

# 4) Start Blender and connect the addon — two routes:
#    agent / unattended: blender_viewport(op="launch")   # boot script + spawn + polls 9876, idempotent
#    manual: start Blender → press N → "DSH Blender Bridge" → Connect (127.0.0.1:9876)
#    (v2.3: the old "MCP for Blender" addon is no longer supported — disable it and install the bundled one; see MIGRATIONS.md)

# 5) Verify — the ONLY acceptance criterion: doctor returns kind=ok (otherwise it is NOT installed; walk §9)
curl -sS http://127.0.0.1:9877/health    # backend alive + provenance (is this process the disk copy?)
curl -sS http://127.0.0.1:9877/doctor    # FULL round-trip through bpy; "kind":"ok" is the goal
curl -sS http://127.0.0.1:9877/who       # write lease + channel metrics + effective config
```

The plugin auto-starts the backend (`node runtime/server.mjs`, default `127.0.0.1:9877`) and runs a **15-second watchdog** that respawns it if it dies. `blender_viewport op=stop` pauses the watchdog.

> **Bundled skill (v2.2.0+)**: once DSH restarts, `blender-modeling` is registered from `skills/blender-modeling/` automatically — no extra clone / download / symlink.

---

## 4. First contact

```text
blender_viewport(op="doctor")                          # health + effective config
blender_rt_see(max_size=560)                           # what the model sees right now
blender_rt_see(from="9,-9,6", look_at="0,0,1")         # a different angle, user viewport untouched
```

### 4.1 Host integration: `@` mentions + native selection

The package contributes a **user-side** half for DSH's Web client (its own `/host/*` routes — no op-catalog entry, no model tools, so the **15-tool / 186-op** surface is unchanged):

- **`@` mentions** — type `@` to pick scene objects / materials / collections (refs are prefixed: `object:<name>` / `material:<name>` / `collection:<name>`); the `codec` strips the prefix and serializes to `<blender-object>Cube</blender-object>`, so the model stops guessing object names.
- **Native selection → draft** (v2.3+; sub-element selection v2.4, addon v1.10+): select in Blender → press `N` → **Selection → DSH** → send. The selection lands in the **current session draft** and is **not auto-sent**. Two modes: **多选 / Multi** (current selected objects) and **集合 / Collection** (one collection as a whole — best for large assemblies).
- **Collapsible, scrollable, resizable lists**: the object / collection-member list is collapsed by default; once expanded it is a scrollable UI list whose height is set by the **高度（行）** slider (3–30 rows). The backend URL lives under a collapsed **后端 / 高级** section.
- **Sub-element selection** (v2.4): selection in Edit Mode (vertices / edges / faces), Pose Mode (bones), or curve/lattice edit mode is sent as `selection.sub` (indices + select mode + truncation flag). The draft text names the selected elements; the model can edit them through `bmesh` / `pose.bones[...]`. Full arrays are available via `blender_rt_cmd get_selection`.
- **Activity state** (v2.3): Blender reports `idle / human / agent / both`; the N panel shows it live and the model can query `blender_rt_cmd get_activity_state` / `get_selection` (the query itself is excluded from `agent`). Also `get_collections` / `send_collection_to_dsh` for the collection workflow.
- **Removed in v2.3**: the DSH-side viewport panel (Web sidebar + TUI side panel), click-to-message, and the 16th tool `blender_rt_pick`. Use native selection instead; the model still has `blender_rt_see` for screenshots. The backend `/host/view/*`, `/host/pick*` and `/host/ready` routes remain for compatibility but have **no UI consumer** in this repo.

> ⚠ **Restart DSH after any change/upgrade**: the client half (`lib/client.js`) is loaded at DSH startup; only a backend-only change can use `blender_viewport(op="restart")`.
> The client half calls `9877` cross-origin from `http://127.0.0.1:3080`; the backend only echoes CORS for **loopback** origins. This is not authentication, and it is not a server-side 403.

### 4.2 A real session (5 calls)

```text
blender_rt_cmd {name:"get_scene_info"}
blender_rt_do   {code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_plan {op:"audit_scene"}
blender_rt_headless {script:"print('HEADLESS {\"ok\":true}')", engine:"none"}
blender_rt_txn  {op:"snapshot", label:"before-edit"}
```

---

## 5. What's new

**v2.5.0 — activity on top, AI pause button, env/model API panels**

- **Activity on top** of the N panel; while the AI is operating (`agent` / `both`) it shows an alert row. A **暂停 AI 操作 / 继续 AI 操作** button pauses the AI: write commands from DSH return `AI_PAUSED`, only read-only queries pass; resume only from the Blender panel.
- **环境与角色模型API调用** parent panel with two subpanels, all collapsed by default: **环境生成** (Poly Haven / Sketchfab / Poly Pizza) and **模型生成** (Hyper3D / Hunyuan3D / Tripo); decorative icons removed.

**v2.4.0 — sub-element selection + resizable panel lists**

- **Sub-element selection** (addon v1.9): Edit Mode vertices / edges / faces, Pose/Edit bones, and curve/lattice control points are now part of the selection payload (`selection.sub`). The draft text names the exact elements, so the model can edit them with `bmesh` / `pose.bones[...]`; full arrays via `blender_rt_cmd get_selection`.
- **Resizable N-panel lists**: object / member lists are collapsible Blender UIList (scroll bar) with an adjustable height (`高度（行）` slider + `−/+` buttons); backend URL lives under a collapsed `后端 / 高级`.
- **Everything from v2.3**: Blender addon v1.9 `ActivityTracker` (`idle / human / agent / both`) + 5 commands (`get_activity_state`, `get_selection`, `send_selection_to_dsh`, `get_collections`, `send_collection_to_dsh`).
- N panel `Selection → DSH` with **Multi** (object list) / **Collection** (member list, count, child collections, auto-infer) modes; sends into the current DSH draft, never auto-sends.
- Backend `/host/selection{,/latest,/consume}` (pure memory, zero Blender round-trips) + `last_consume` diagnostics.
- **Removed**: Web/TUI viewport panel, click-to-message, `blender_rt_pick` → **15 model tools**; capability lock updated. Also removed: upstream `MCP for Blender` / category-action addon support, dual-name fallbacks, and the `addonProtocol` config.
- Docs: contract supplement, install AI now **must tell its owner** about the new features (`docs/AI-安装提示词.md` §③.5).
- Also in 2.3: large-list collapse (first 24 names + total; collection summaries), @ mentions kept.

**Recent history**: v2.3 moved selection into Blender and removed the DSH viewport panel / pick / TUI panel (16 → 15 tools); v2.2 bundled the `blender-modeling` skill and added the TUI side panel (removed in v2.3); v2.1 added jobs/presets/multi-pick; v2.0 renamed the addon to `DSH Blender Bridge`; v1.0 froze the model-facing tool surface. Full measured log: [`CHANGELOG.md`](CHANGELOG.md).

---

## 6. Tool reference (15 tools)

All tools require the backend to be running (the plugin starts it for you) and the addon to be connected. Parameter names are the schema's own names, identical on WSL, Windows and macOS.

| Tool | What it does |
|---|---|
| `blender_rt_see` | Viewport frame (~50–160 ms). `full=true` + `area=N` for a window/area screenshot; `from` / `look_at` (+ `lens`, `ortho`, `view_size`, `shading`, `overlays`, `view_mode`) renders a custom angle off-screen without creating a camera or moving the user viewport. Same-view dedupe unless `force=true`. |
| `blender_rt_do` | Execute Python in Blender's main thread with a **persistent kernel `K`** across calls; `see=true` returns a frame. |
| `blender_rt_watch` | Sample the viewport over a time window (≤6 frames + per-frame hash) to answer "did it move / is it right". |
| `blender_rt_loop` | Inner-loop search inside Blender's main thread: `setup/step/measure` with penalties, annealing, candidate board and reproducible export. |
| `blender_rt_cmd` | Pass through any addon command (39 names: 24 always-on + 15 gated). |
| `blender_rt_commands` | List currently available addon commands + the 5 integrations' real on/off state. |
| `blender_rt_perf` | Render performance: `analyze` differential timings; `apply` presets (persistent_data / OptiX denoise / auto_tile off / sample caps); `revert` / `status`. |
| `blender_rt_opt` | Object decimation: analyze safe join groups; join with **zero geometry loss** (~1.4 ms/object). |
| `blender_rt_headless` | Separate `blender -b` process (does not occupy the GUI channel). `file/outdir/args/timeout_ms/factory_startup/bootstrap/preload`; results via `print("HEADLESS {json}")`. |
| `blender_rt_plan` | Contract layer + planner: component/connection/envelope, read-only audits, `destructive_guard`, evidence ledger, three-state hypothesis verdicts (`supported / refuted / unresolved`), planner → bpy compile. `op="catalog"` is answered locally with 28 families / 186 ops (when to use / when not / minimal skeleton). |
| `blender_rt_worker` | Hot headless session (reuses one `blender -b` + persistent `K`): `start/exec/status/stop/restart`. |
| `blender_rt_txn` | Transactions: file-level `snapshot/restore` (topology-safe) + object-level `mark/revert` (transforms/materials/visibility only). |
| `blender_rt_preset` | Parameter preset library: `save/list/get/apply/delete/export/import` (dot-path data; targets `MAT:` / `OBJ:` / `SCENE`). |
| `blender_rt_job` | Long-work job layer: `start/status/collect/wait/kill/list`; a tool timeout never loses the result. |
| `blender_viewport` | Channel ops: `status/start/stop/restart/doctor/who/lease/release/launch`. |

---

## 7. Recipes

Common chains (details in [`docs/操作教程.md`](docs/操作教程.md) and the bundled skill):

- **Model → audit → fix**: `sculpt_scan → sculpt_setup(VOXEL) → sculpt_apply` · `audit_mesh → fix_repair → audit_mesh`.
- **Deliver with textures**: `uv_smart_project → uv_stats → deliver_export → deliver_verify` · `material_build → material_apply → material_bake`.
- **Assembly acceptance**: `gate_plan(preset="assembly") → gate_run(spec_path=…)`, read the top-level **three-state `verdict`** (`degraded` is *not* a pass).
- **Interference / clearance**: `audit_interference` / `audit_clearance` / `audit_connectivity`; vehicles get `vehicle_package → vehicle_base → clear_check → qc_render_views(ortho)`.
- **Long jobs**: `render_state → render_wait` (`BUSY_RENDER` comes back in ~71 ms while rendering) · `blender_rt_job(op="start")` for >1 min.
- **Rollback**: object-level `mark/revert`; topology changes require `snapshot/restore`.

---

## 8. Configuration

Config sources (highest first): plugin config → `DSH_BLENDER_*` env → `$DSH_BLENDER_CONFIG` file → package root `dsh-blender.config.json` → `~/.dsh/dsh-blender.config.json` → auto-detected defaults.

Key knobs: `port` (backend, 9877), `addonHost`/`addonPort` (9876), `blenderExe`, `workDir`, `holder`, `workerPort` (9879). Full table: [`docs/配置参考.md`](docs/配置参考.md).

---

## 9. Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `blender-unreachable` | Blender not running / addon not connected | `blender_viewport(op="launch")`; or press `N` → Connect |
| `main-thread-busy` | Main thread blocked by render/modal | Wait, or use the headless path |
| Backend unreachable (`9877`) | Backend process not running | `blender_viewport(op="start")` |
| `value is not lossless JSON` | Old plugin (< v0.9.4) | Upgrade, **restart DSH** |
| `409 leased` on writes | Another session holds the write lease | `blender_viewport(op="who")`; don't steal |
| N panel has no “Selection → DSH” | You are running the old `MCP for Blender` addon (unsupported since v2.3) | Disable it, install the bundled addon v1.10, restart DSH |
| Selection sent but no text in draft | DSH not restarted after upgrade / draft locked | Restart DSH; check `/host/selection/latest.last_consume` |
| Old “Blender 视口” tab still shows | DSH not restarted (v2.3 removed the panel) | Restart DSH |

Backend-only changes: `blender_viewport(op="restart")`. Plugin/client changes: **restart DSH**.

---

## 10. Repository layout

```text
addon/dsh_blender_bridge.py   # Blender addon (renamed upstream build; MIT, original copyright kept)
runtime/                      # backend: engine/server/runner/perf/view/select store + Python capability modules
src/index.ts                  # DSH host: the 15 tools, backend watchdog (15 s), lease heartbeat
src/client/index.js           # Web client half: @ mentions + native-selection bridge (no panel in v2.3)
lib/                          # built host half + client bundle (committed)
skills/blender-modeling/      # bundled modeling skill (auto-registered)
tests/                        # pure-Node self-tests (no new deps)
docs/                         # tutorial, config, host-integration contracts, checklists
```

---

## 11. Self-tests

```bash
npm test                                  # offline suite (capability lock, schemas, runtime guards, selection store, client bundle, skill provider)
node tests/client_bundle_selftest.mjs     # bundle shape + @ codec + selection text/insertion
node tests/selection_store_selftest.mjs   # selection store: sanitize / seq / consume / last_consume
node tests/host_routes_selftest.mjs       # live /host routes incl. selection S1–S3 + deleted-route 404 guards
npm run test:routes                       # static route contract
```

Release gate: `npm test` green + `npm pack --dry-run` ≈ **1.3 MB / 142 files** + `blender_viewport(op:"doctor")` → `kind=ok`.

---

## 12. Security, license, credits

- **Write confinement**: all mutations go through `/act`-style routes guarded by a **write lease**; a second session gets `409 leased` instead of silently interleaving.
- **CORS**: `/host/*` only echoes `Access-Control-Allow-Origin` for loopback origins; it is a browser-cross-origin rule, not authentication. Do not expose the ports beyond localhost.
- Everything runs locally. No models / textures are bundled.
- **License**: plugin MIT. The addon is an MIT derivative of [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) — the original copyright notice is kept in the file; do not remove it.
- Thanks: all upstream authors and issue reporters; the Blender community; and everyone who tested the WSL/Windows/macOS channel.

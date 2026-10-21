# DSH × Blender — direct real-time channel

**English** · [简体中文](README.zh-CN.md)

> **中文简介**：DSH × Blender 直连插件 v2.6.0，15 个模型工具、33 family / 217 op。默认先开 GUI Blender + Connect；无头是备用路径（也能 `rt_see`，不是默认）。支持参考图量具、装配扫描/修复/门/导出、白模与 Seedance 参考包。完整中文说明见 [README.zh-CN.md](README.zh-CN.md)。

> 🤖 **Installing with an AI agent?** Don't let it guess — send it the repo URL plus
> [`docs/AI-安装提示词.md`](docs/AI-安装提示词.md) (paste-ready prompt + acceptance criteria + the v2.6
> "tell your owner" checklist). The only acceptance criterion is `doctor` → `kind=ok`.

> **GUI Blender is the default.** Start Blender + Connect first; the model drives a live GUI session ("look → change → verify").
> **Headless is the fallback** (no GUI / batch / long jobs), but it is still **interactive**: `exec` / `see` / `watch` / `reset`
> share one hot path, so the model can keep working and seeing frames without a window.
> 15 model tools, no MCP assembly, no CLI adapter; and **you** can select objects natively in Blender and push them
> into the current DSH draft with one button.

> 🏷 **v2.6.0** · 15 model tools · **33 families / 217 plan ops** · addon **v1.10** (protocol 11) · package **1.6 MB / 163 files** (4.8 MB unpacked)

---

## Support · Afdian (爱发电)

If this saves you time, you can support development: <https://afdian.com/a/sixtyseven67>.

---

## 1. What you get (30-second tour)

| Capability | Tool | Typical latency / notes |
|---|---|---|
| Peek at the GUI viewport / render from any angle (no camera object, user viewport untouched) | `blender_rt_see` | 55–160 ms; custom angle ≈100 ms |
| Look inside a headless session | `blender_rt_see {session}` · `rt_worker op=see` | 53–85 ms (320×180) |
| Change one thing and verify it (GUI / headless) | `blender_rt_do` · `{session}` | ≈105 ms; exec 0–2 ms + see |
| Did it move? Is it right? | `blender_rt_watch` (GUI / `session`) | ≤6 frames + per-frame hash; headless 3 frames ≈58 ms |
| Inner-loop search (thousands of iterations, zero model turns) | `blender_rt_loop` (`target:"session"` = headless blocking loop) | 160 ticks/s (GUI) · 20 iterations 56 ms (session) |
| Pass through addon commands / list them | `blender_rt_cmd` / `blender_rt_commands` | 39 names (24 always-on + 15 gated) |
| Render performance profiling + presets | `blender_rt_perf` | analyze ≈10–20 s |
| Object decimation (safe join, zero geometry loss) | `blender_rt_opt` | ≈1.4 ms/object |
| Heavy work in a headless process (multi-view / images) | `blender_rt_headless` | cold start 0.9–1.2 s; `shots` + `attach_images` |
| Contract layer + planner (33 families / 217 ops) | `blender_rt_plan` | catalog answered locally; `session:"auto"` headless routing |
| Hot headless session (reuse one `blender -b`) | `blender_rt_worker` | 2.24 s start paid once; idle TTL 15 min |
| Transactions / rollback | `blender_rt_txn` | snapshot 96.7 MB / 824 ms (300 objects) |
| Preset library (save / apply / export parameter sets) | `blender_rt_preset` | stored values really take effect |
| Job layer for work longer than one wait window | `blender_rt_job` | wait 120 s default; progress/heartbeat visible |
| Channel health / write lease / one-call Blender launch | `blender_viewport` | health 70–100 ms |

### Bundled modeling skill (v2.2.0+, no extra install)

The package ships `blender-modeling` under [`skills/blender-modeling/`](skills/blender-modeling/) and registers it with DSH's
skill registry as a `bundled` provider when the plugin loads. After installing the plugin and restarting DSH, the skill
appears in the session skill catalog and the model loads it on its own for modeling / assembly work. It contains the
shape decision tree, numbered recipes, the six pitfalls, the numeric-gate checklist, the multi-agent protocol, the
reference-image reconstruction SOP and multi-view calibration.

- **Precedence**: rank 600. A copy you installed yourself under `~/.dsh/skills/blender-modeling` (user rank 400) still wins, so existing users are never force-updated.
- **Non-DSH hosts** (Claude Code / Codex / Cursor…): the same directory is a plain `skills/<name>/SKILL.md` bundle — link or copy it to your host's skill root.

Walkthrough (Chinese): [`docs/操作教程.md`](docs/操作教程.md) · configuration: [`docs/配置参考.md`](docs/配置参考.md) ·
deployment SOP: [`docs/部署SOP.md`](docs/部署SOP.md) · historical headless route (superseded by GUI-first): [`docs/headless优先-路线决定.md`](docs/headless优先-路线决定.md) ·
host contract v2.3: [`docs/宿主集成-接口契约-v2.3增补.md`](docs/宿主集成-接口契约-v2.3增补.md) ·
what changed in v2.6.0: [`docs/v2.6.0-更新说明.md`](docs/v2.6.0-更新说明.md).

---

## 2. Requirements

1. **Blender 4.x / 5.x — GUI first.** The GUI is needed for the addon channel (`rt_cmd`, GUI-mode `rt_see` / `rt_do`,
   native selection). Headless tools (`rt_headless` / `rt_job` / `rt_worker` / `rt_do{session}` / `rt_see{session}` /
   `rt_watch{session}`) spawn `blender -b` directly and need **neither a GUI nor a connected addon**. The backend only has to
   find the Blender executable (set `blenderExe` or put it on `PATH`).
2. **Blender addon — only the bundled [`addon/dsh_blender_bridge.py`](addon/dsh_blender_bridge.py) is supported**
   (**`DSH Blender Bridge` v1.10**, module `dsh_blender_bridge`). It listens on `127.0.0.1:9876` and exposes 39 commands
   (24 always-on + 15 gated), including scene queries, viewport screenshots, `execute_code`, selection/activity state and
   the 5 optional integrations (PolyHaven / Hyper3D / Sketchfab / Poly Pizza / Hunyuan3D).
   **Install and Connect it only for the GUI channel.** Upstream `MCP for Blender` / harveyxiacn `blender_mcp_addon` are
   **not supported** since v2.3 — disable the old addon and install the bundled one (see [MIGRATIONS.md](MIGRATIONS.md)).
3. **Node.js ≥ 20** (runs the backend).
4. **DSH (DeepSeek Harness)** — this package is a DSH plugin (`inject: ['tools']`, declares `dsh.bundle`). WSL host + Windows
   Blender needs WSL interop (on by default); same-OS setups (Windows / native Linux / macOS) are supported and auto-detected.
5. **A DSH source checkout only if you rebuild** (`DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh`); the repo commits
   `lib/`, so a plain clone is ready to install.

---

## 3. Install (5 steps)

> **No build, no npm?** Grab `dsh-external-dsh-blender-plugin-2.6.0.tgz` (**1.6 MB / 163 files**, 4.8 MB unpacked) from
> [Releases](https://github.com/sixtysevenlf/dsh-blender-plugin/releases): unpack it into
> `<profile>/node_modules/@dsh-external/dsh-blender-plugin`, or `npm i ./that.tgz`. The skill is inside the tarball
> (`skills/blender-modeling/`). Full third-party checklist: [`docs/给第三方的安装清单.md`](docs/给第三方的安装清单.md).

```bash
# 1) Build (optional) — lib/ is committed; only needed after changing src/
cd dsh-blender-plugin
DSH_CHECKOUT=/path/to/dsh-harness bash scripts/build.sh     # produces lib/

# 2) (optional) configure — auto-detection usually just works
cp dsh-blender.config.example.json dsh-blender.config.json

# 3) Install into DSH as a profile bundle (this package declares dsh.bundle):
#    a) symlink into <profile>/node_modules/@dsh-external/dsh-blender-plugin
#    b) in the profile package.json add "link:<abs path>" to dependencies and
#       "@dsh-external/dsh-blender-plugin" to dsh.profile.bundles
#    c) dry-run: dsh --profile <profile> --dump-config   then restart DSH

# 4) Connect Blender — pick one:
#    GUI channel (native selection / live scene): blender_viewport(op="launch") boots, enables and connects (idempotent)
#    Headless only (no GUI / no addon): skip the addon; make sure blenderExe is discoverable, then use rt_worker / rt_headless
#    Manual GUI: Edit > Preferences > Add-ons > Install... -> addon/dsh_blender_bridge.py
#                -> enable "DSH Blender Bridge" -> press N in the 3D view -> Connect (port 9876)

# 5) Verify — the ONLY acceptance criterion (GUI route): doctor returns kind=ok (otherwise it is NOT installed; walk §9)
curl -sS http://127.0.0.1:9877/health    # backend alive + provenance (is this process the disk copy?)
curl -sS http://127.0.0.1:9877/doctor    # FULL round-trip through bpy; "kind":"ok" is the goal
curl -sS http://127.0.0.1:9877/who       # write lease + channel metrics + effective config
```

The plugin auto-starts the backend (`node runtime/server.mjs`, default `127.0.0.1:9877`) and runs a **15-second watchdog** that
respawns it if it dies. `blender_viewport op=stop` pauses the watchdog.

> **Headless-only install (no addon)**: doctor's bpy round-trip is unreachable without an addon — that does not mean the backend
> failed. Verify with `blender_rt_worker(op="start", name="smoke")` + `blender_rt_worker(op="see", name="smoke")` returning a frame.
> **For the GUI route, doctor → `kind=ok` remains the only acceptance criterion.**

> **Bundled skill (v2.2.0+)**: once DSH restarts, `blender-modeling` is registered from `skills/blender-modeling/` automatically.

---

## 4. First contact

### 4.1 GUI channel (when you need the live scene)

```text
blender_viewport(op="doctor")                          # health + effective config
blender_rt_see(max_size=560)                           # what the model sees right now
blender_rt_see(from="9,-9,6", look_at="0,0,1")         # a different angle, user viewport untouched
```

### 4.2 Interactive headless (no GUI window)

```text
blender_rt_worker {op:"start", name:"build", preload:"imgtools,assembly,blockout", engine:"workbench"}
blender_rt_do     {session:"build", code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_see    {session:"build", from:"7,-7,5", look_at:"0,0,1"}
blender_rt_plan   {op:"img_digest", args:{path:"D:/ref/front.png", known_len:{mm:100, p1_px:[100,80], p2_px:[420,80]}}, session:"auto"}
blender_rt_watch  {session:"build", seconds:2, fps:4}
```

The same `name` reuses the same `blender -b` process (persistent kernel `K` survives across calls); `rt_plan` with
`session:"auto"` picks the right modules for the family and `preload`s them. When no GUI is reachable, `rt_do` / `rt_see` also
fall back to this path automatically (`auto` defaults to true; pass `auto:false` to disable).

### 4.3 Host integration: `@` mentions + native selection

Besides model tools, the package contributes a **user-side** half for the DSH Web client (its own `/host/*` routes —
no op-catalog entry, no model tools, so the **15-tool / 217-op** surface is unchanged):

- **`@` mentions** — type `@` to pick scene objects / materials / collections (refs are prefixed `object:<name>` /
  `material:<name>` / `collection:<name>`); the `codec` strips the prefix and serializes to
  `<blender-object>Cube</blender-object>`, so the model stops guessing object names.
- **Native selection → draft** (v2.3+; sub-element selection needs addon v1.10+): select in Blender → press `N` → **Selection → DSH** →
  send. The selection lands in the **current session draft** and is **not auto-sent**. Two modes: **Multi** (selected objects) and
  **Collection** (one collection as a whole — best for large assemblies). Edit-mode vertices / edges / faces, pose bones and
  curve/lattice control points travel too (`selection.sub`).
- **Activity state**: Blender reports `idle / human / agent / both`; the N panel shows it live and the model can query
  `blender_rt_cmd get_activity_state` / `get_selection` (the query itself is excluded from `agent`), plus
  `get_collections` / `send_collection_to_dsh` for the collection workflow.
- **History note**: v2.3 removed the DSH-side viewport panel (Web sidebar + TUI side panel), click-to-message and
  `blender_rt_pick`. The backend `/host/view/*`, `/host/pick*` and `/host/ready` routes were **removed** with them; the
  only host routes left are `/host/selection` (+ `/latest`, `/consume`), `/host/scene-items` and `/host/jobs` (+ `/log`).

> ⚠ **Restart DSH after any change/upgrade**: the client half (`lib/client.js`) is loaded at DSH startup; only a backend-only
> change can use `blender_viewport(op="restart")`. The client half calls `9877` cross-origin from an HTTP loopback GUI or the
> official `dsh-app://app` desktop shell; the backend only echoes CORS for **HTTP loopback** and the **exact** `dsh-app://app`
> origin. This is not authentication, and it is not a server-side 403.

### 4.4 A real session (5 calls)

```text
blender_rt_worker {op:"start", name:"build", preload:"imgtools,assembly", engine:"workbench"}
blender_rt_do     {session:"build", code:"import bpy; bpy.ops.mesh.primitive_cube_add(size=2)", see:true}
blender_rt_see    {session:"build", from:"7,-7,5", look_at:"0,0,1"}
blender_rt_plan   {op:"audit_scene", session:"auto"}
blender_rt_txn    {op:"snapshot", label:"before-edit"}
```

---

## 5. What's new in v2.6 (P0–P2, six items)

- **① Interactive headless (P0) — fallback path when GUI is unavailable (not the default).** The persistent worker supports `preload`,
  `see` (temporary camera + Workbench off-screen), `reset` and `warmup`; `rt_do` / `rt_see` accept an explicit
  `session` (with `auto` fallback when no GUI is available), `rt_watch` works headless, and `rt_plan(session="auto")` boots a worker per
  family and dispatches synchronously. Measured: `start` 2.24 s (including 1.1 s first-frame init), then `exec` 0–2 ms and
  `see` round-trips of 53–85 ms (320×180); idle workers are reclaimed after 15 min (`DSH_WORKER_TTL_MS`, 0 disables).
- **② Reference-image gauge (P0)** `img_digest / img_probe / img_measure / img_calib`: native-resolution measurement (silhouette /
  principal axis / Hough lines / holes and circles / symmetry / readability), one confirmed-number table + native-resolution crop
  atlas + annotated overview. mm are emitted **only** when `known_len` is supplied; without calibration it reports ratios and
  **never invents mm**. 61/61 assertions on the real machine.
- **③ Assembly (P0–P2)** `asm_scan` (all-pairs classification: clash / hidden_ok / contact / gap / float / contained / unresolved) →
  `asm_manifest` (md5 / interface frames / allow validation) → `asm_merge` (id-order append + normals + snapshot + auto gate,
  dry-run by default) → `asm_repair` (safe / manual / aggressive; safe only translates/snaps and hard-blocks booleans) →
  `asm_gate` (verdict-first, `export_allowed` only on pass) → `asm_export` (GLB / FBX / OBJ + manifest + append-only merge_ledger).
- **④ Blockout and reference packs (P0 / P2)** `blockout_base / batch / export` (declarative parts, mm / anchor, Workbench 3 views,
  GLB; 9 ms for 20 parts of geometry, 25 ms/frame after the first of 3 × 512 views) + `blockout_turntable` (MP4 via Blender's
  built-in FFMPEG) + `blockout_refsheet` (4 orthographic/perspective PNGs + 2×2 contact sheet + refsheet.json).
- **⑤ Visual acceptance and defect evaluation (P1–P2)** `visualreport_report` (same-camera QC, verdict-first, qc→imgtools→numpy
  three-level fallback; identical image passes, shift/missing-corner fails with defect crops and mm location; 72–96 ms) ·
  `shapesolve_solve` (orthographic analytic projection + numpy rasterization, no rendering; three-view inversion errors
  0.98% / 1.55% / 0.35%, solve 793 ms) · `eval_run` (assembly D1/D3/D4/D5/D7/D8 + 12 reference cases + calib core; missing
  modules are skipped/degraded and **never fake a pass**).
- **⑥ Forced gates (P1)** `gate_preflight` (startup audit) → `gate_checkpoint` (rollback point) → `gate_deliver` (gate before export);
  `deliver_export(require_gate=true)` verified on the real machine: pass writes to disk, a bad gate is blocked.

> v2.6.0 itself also ships: disk-ledger reconciliation (finished jobs are recoverable after a backend restart), the Blender 5.2
> compositor migration, multi-light hygiene, the progress/heartbeat channel, the fifth `audit_mesh` state, and two-dimensional
> write scopes (collection + object prefix). Full measured history: [CHANGELOG.md](CHANGELOG.md).

---

## 6. Tool reference (15 tools)

The backend is always started by the plugin. **GUI-channel tools** (`rt_cmd` / `rt_commands` and `rt_see` / `rt_do` / `rt_watch`
without `session`) need a connected addon; **headless tools** (`rt_headless` / `rt_job` / `rt_worker` / `rt_plan{session}` and
`rt_do` / `rt_see` / `rt_watch` with `session`) do not. Parameter names are the schema's own names, identical on WSL, Windows and macOS.

| Tool | What it does |
|---|---|
| `blender_rt_see` | Viewport frame (~55–160 ms). `full=true` + `area=N` for a window/area screenshot; `from` / `look_at` (+ `lens`, `ortho`, `view_size`, `shading`, `overlays`, `view_mode`) renders a custom angle off-screen without creating a camera or moving the user viewport. With `session` it uses the headless worker (Workbench off-screen, 53–85 ms); `auto` controls downgrade behavior; same-view dedupe unless `force=true`. |
| `blender_rt_do` | Execute Python in Blender's main thread with a **persistent kernel `K`** across calls; `see=true` returns a frame. An explicit `session` goes straight to interactive headless (exec 0–2 ms + Workbench see, dozens of steps per turn); `auto` (default true) falls back when no GUI is reachable; `preload` seeds the headless session. |
| `blender_rt_watch` | Sample the viewport over a time window (≤6 frames + per-frame hash) to answer "did it move / is it right". `session` uses the worker's `_watch` (Workbench off-screen per frame + hashes; measured 3-frame animation distinct=3 / 58 ms). |
| `blender_rt_loop` | Inner-loop search inside Blender's main thread: `setup/step/measure` with penalties, annealing, candidate board and reproducible export. `target:"session"` uses the worker's `dsh_loop_sync` blocking loop (no timers; 20 iterations 56 ms). |
| `blender_rt_cmd` | Pass through any addon command (39 names: 24 always-on + 15 gated), including `get_world_state_snapshot` / `drain_human_activity` / telemetry consent / the 5 asset integrations. |
| `blender_rt_commands` | List currently available addon commands + the real on/off state of the 5 integrations (including missing API keys). |
| `blender_rt_perf` | Render performance: `analyze` differential timings; `apply` presets (persistent_data / OptiX denoise / auto_tile off / sample caps); `revert` / `status`. |
| `blender_rt_opt` | Object decimation: analyze safe join groups; join within collection/material with **zero geometry loss** (~1.4 ms/object). |
| `blender_rt_headless` | Separate `blender -b` process (does not occupy the GUI channel): `file/outdir/args/env/timeout_ms/factory_startup/bootstrap/preload`; `shots=[{name,from,look_at,lens,res,samples}]` for multi-view output in one run; `attach_images` (`true` = up to 3 images, `"sheet"` = contact sheet only); results via `print("HEADLESS {json}")`. |
| `blender_rt_plan` | Contract layer + planner: **33 families / 217 ops** (`op="catalog"` is answered locally with "when / when not / minimal skeleton"); components / connections / envelopes, read-only audits, `destructive_guard`, evidence ledger, three-state hypotheses (`supported / refuted / unresolved`), planner → bpy compile. Replies carry a one-line verdict/top_defects/next envelope; `attach_images` ≤2; `session:"auto"` dispatches through a headless worker. |
| `blender_rt_worker` | Hot headless session (reuses one `blender -b` + persistent `K`): `start/exec/see/reset/status/stop/restart/list`; `preload` / `warmup` / `engine` / `gpu` / `purge_prefix`; `see` backs `rt_see` when no GUI exists; idle TTL 15 min (`DSH_WORKER_TTL_MS`, 0 disables). |
| `blender_rt_txn` | Transactions: file-level `snapshot/restore` (topology-safe) + object-level `mark/revert` (transforms / materials / visibility only). |
| `blender_rt_preset` | Parameter preset library: `save/list/get/apply/delete/export/import` (dot-path data; targets `MAT:` / `OBJ:` / `SCENE`). |
| `blender_rt_job` | Long-work job layer: `start/status/collect/wait/kill/list`; a tool timeout never loses the result; replies include `stage / progress / progressHistory / heartbeat / idleMs`; `wait` defaults to 120 s (max 600 s). |
| `blender_viewport` | Channel ops: `status/start/stop/restart/doctor/who/lease/release/launch`; the write lease supports two scope dimensions (`scope="collection:COL_Lights,prefix:LGT-"`). |

### 6.1 Limits — what is NOT covered

- **Not covered** (the `catalog` front page and the headless handoff block say so explicitly): **creature / organic modeling,
  cinematic lighting / volumetrics / compositing, and character rigging & animation**. Not finding tools there is expected;
  `sculpt_*` can shape a body, but that is not a character pipeline.
- **Dependencies that are NOT installed — do not claim support**: landmark / face (no cv2 or MediaPipe; `face_ratios` requires
  landmark coordinates you supply), **OCR**, **DXF**, and **Open3D / manifold3d / glTF-Validator**. The ext family
  (`gltf_validate` / `ext_mesh_check`) depends on those; when missing it reports skipped / degraded / a missing-dependency
  error — **it never fakes a pass**. Install per the reply, or use Blender's native export.
- **Measurement discipline**: without `known_len`, `img_*` reports pixel ratios only and **all mm stay null**; features below
  8 px readability land in `unreadable` — do not write them into a spec.
- **Subjective judgement** (look / style) still needs a human or a strong model; use `gate_*` / `audit_*` / `visualreport_*`
  for numeric gates, and never estimate dimensions by eye.
- **Camera / scene safety**: custom-angle `rt_see` creates no camera and leaves your viewport alone; writes go through the lease,
  so a second session gets `409 leased`.

---

## 7. Recipes

Common chains (details in [`docs/操作教程.md`](docs/操作教程.md) and the bundled skill):

- **Interactive headless (main path)**: `rt_worker(op="start", preload=…)` → `rt_do(session, see)` → `rt_see(session)` →
  `rt_watch(session)`; use `rt_plan(session="auto")` for planning/acceptance and `rt_loop(target="session")` for the inner loop.
  Long work moves to `rt_headless(as_job=true)` or `rt_job(op="start")`.
- **Reference image → blockout → assembly → delivery**: `img_digest(known_len=…)` → `blockout_base / batch` →
  `asm_manifest → asm_scan → asm_merge(dry_run:true) → asm_merge(dry_run:false) → asm_gate → asm_export` →
  `visualreport_report` for same-camera verification.
- **Assembly repair**: `fix_interference` (read-only planning) → `asm_repair(policy:"safe")` (translate/snap, booleans blocked) →
  `asm_scan` again.
- **Model → audit → fix**: `sculpt_scan → sculpt_setup(VOXEL) → sculpt_apply` · `audit_mesh → fix_repair → audit_mesh`.
- **Deliver with textures**: `uv_smart_project → uv_stats → deliver_export(require_gate:true) → deliver_verify` ·
  `material_build → material_apply → material_bake`.
- **Gate flow**: `gate_preflight` (startup audit) → `gate_checkpoint` (rollback point) → build/repair → `gate_run` or
  `gate_deliver`; read the top-level **three-state `verdict`** (`degraded` is *not* a pass).
- **Interference / clearance**: `audit_interference` / `clear_check` / `audit_connectivity`; vehicles go
  `vehicle_package → vehicle_base → clear_check → qc_render_views(ortho)`.
- **Silhouette inversion / defect evaluation**: `shapesolve_solve` (orthographic projection + rasterization, no render) ·
  `eval_run` (capture rate / baseline; missing modules never fake a pass).
- **Long jobs**: `render_state → render_wait` (writes return `BUSY_RENDER` in ~71 ms while rendering) · anything over a minute
  goes to `blender_rt_job(op="start")` or `rt_headless(as_job=true)`, collected with `op="wait"`.
- **Rollback**: object-level `mark/revert`; topology changes require `snapshot/restore`.

---

## 8. Configuration

Config sources (highest first): plugin config → `DSH_BLENDER_*` env → `$DSH_BLENDER_CONFIG` file → package root
`dsh-blender.config.json` → `~/.dsh/dsh-blender.config.json` → auto-detected defaults.

Key knobs: `port` (backend, 9877), `addonHost` / `addonPort` (9876), `workerPort` (9879), `blenderExe`, `workDir`, `holder`,
`leaseTtlMs` (write-lease TTL, default 600000 ms). Headless-related: `DSH_WORKER_TTL_MS` (worker idle TTL, default 15 min,
0 disables), `DSH_HEADLESS_WAIT_MS` (headless sync wait window, default 100 s). The old `addonProtocol` setting was **removed** in v2.3.
Full table: [`docs/配置参考.md`](docs/配置参考.md).

---

## 9. Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| `blender-unreachable` | GUI channel not connected (Blender not running / addon not connected) | For GUI tools: `blender_viewport(op="launch")`, or press `N` → Connect. Pure headless tools need no addon: pass `session` or use `rt_headless` |
| `main-thread-busy` | GUI main thread blocked by render/modal | Wait, or switch to the headless path (`session` / `rt_headless`) |
| Backend unreachable (9877) | Backend process not running | `blender_viewport(op="start")` |
| Tool count is not 15 / catalog is not 33-217 | Old plugin version, or DSH not restarted after upgrade | Install v2.6.0 → **restart DSH** → re-check |
| `value is not lossless JSON` | Plugin/backend version mismatch (old build) | Upgrade both to the same version, **restart DSH** |
| `409 leased` on writes | Another session holds the write lease | `blender_viewport(op="who")` to see holder and scope; don't steal |
| `rt_do` / `rt_see` silently go headless when no GUI | Expected behavior (`auto` defaults to true) | For a hard GUI requirement: Connect first, then pass `auto:false` |
| A worker disappeared | Idle TTL reclaimed it (15 min by default) | `op="start"` again; long work belongs in `rt_job` / `rt_headless(as_job:true)` |
| `plan session="auto"` is slow (~2 s) the first time | First cold start + preload (reused afterwards) | Normal; keep a stable `name` to reuse the session |
| N panel has no "Selection → DSH" | Old `MCP for Blender` addon (unsupported since v2.3) | Disable it, install the bundled addon v1.10, restart DSH |
| Selection sent but no text in draft | DSH not restarted after upgrade / draft locked | Restart DSH; inspect `/host/selection/latest.last_consume` (`ok/reason`) |
| Old "Blender 视口" tab still shows | DSH not restarted (v2.3 removed the panel) | Restart DSH |
| An asset integration is unavailable | Integration toggle off / API key missing | `blender_rt_commands` shows the real state; configure it in the Blender panel |
| ext family reports missing deps / skipped | Open3D / manifold3d / glTF-Validator not installed | Install per the reply, or skip the item (no fake pass) |

Backend-only changes: `blender_viewport(op="restart")`. Plugin/client changes: **restart DSH**.

---

## 10. Repository layout

```text
addon/dsh_blender_bridge.py   # Blender addon (v1.10; MIT, original copyright notice kept)
runtime/                      # backend: engine/server/runner/perf/view/recover + Python capability modules
                              #   new: assembly / blockout / evalharness / shapesolve / visualreport
src/index.ts                  # DSH host: the 15 tools, backend watchdog (15 s), lease, receipt sanitizing
src/client/index.js           # Web client half: @ mentions + native-selection bridge (no panel since v2.3)
lib/                          # built host half + client bundle (committed)
skills/blender-modeling/      # bundled modeling skill (auto-registered)
tests/                        # pure-Node self-tests + real-machine capability tests (assembly / blockout / imgtools / …)
docs/                         # tutorial, config, headless rationale, host contracts, install checklists
```

---

## 11. Self-tests

```bash
npm test                                  # offline suite (capability lock, schemas, runtime guards, recovery, selection store, client bundle, skill provider)
node tests/client_bundle_selftest.mjs     # bundle shape + @ codec + selection text/insertion
node tests/selection_store_selftest.mjs   # selection store: sanitize / seq / consume / last_consume
node tests/host_routes_selftest.mjs       # live /host routes (backend must be running)
npm run test:routes                       # static route contract
```

**Real-machine capability tests** (Blender required; headless channel, examples):

```text
blender_rt_headless(preload="imgtools", engine="none", script_file="tests/img_digest_selftest.py")
blender_rt_headless(preload="assembly,audit,contract,clearance,gate", engine="none",
                    script_file="tests/assembly_selftest.py")
blender_rt_headless(preload="blockout,qc,qc_render", engine="none",
                    script_file="tests/blockout_selftest.py")
```

Release gate: `npm test` green + `npm pack --dry-run` ≈ **1.6 MB / 163 files** + `blender_viewport(op="doctor")` → `kind=ok`.

---

## 12. Security, license, credits

- **Write confinement**: all mutations go through routes guarded by a **write lease**; a second session gets `409 leased` instead
  of silently interleaving. The lease can declare two scope dimensions (collection / object prefix).
- **CORS**: `/host/*` only echoes `Access-Control-Allow-Origin` for loopback origins (and the exact `dsh-app://app` origin); it is a
  browser-cross-origin rule, **not authentication**. Do not expose the ports beyond localhost.
- Everything runs locally. No models / textures are bundled.
- **License**: plugin MIT. The addon is an MIT derivative of [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) — the
  original copyright notice is kept in the file; do not remove it.
- Thanks: all upstream authors and issue reporters; the Blender community; and everyone who tested the WSL/Windows/macOS channel.

---

Version history and measured per-release notes: [`CHANGELOG.md`](CHANGELOG.md); upgrading from older versions: [`MIGRATIONS.md`](MIGRATIONS.md).

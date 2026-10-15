/**
 * dsh-blender-plugin —— 客户端半边（浏览器 bundle）。
 *
 * 手写、零打包器、零新增依赖（契约 §0 / §2.2）。本文件**就是** bundle 源：
 * `scripts/build-client.mjs` 原样拷成 `lib/client.js`，由 `package.json` 的
 * `dsh.client` + `exports["./client"]` 暴露给 DSH 宿主。
 *
 * 包装格式逐字照本机已在跑的第三方样板
 * `@dsh-external/dsh-coc-dice/lib/client.js`：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })
 * 加载器语义（`dsh-client-modules/lib/types/client/manifest.d.ts:9-16`）：执行 bundle 只
 * **登记** factory；所有副作用在 materialization 时才跑。
 *
 * 三块功能（契约 §2）：
 *   ① 视口面板 —— 注册到 `conversation.view`（list/session 槽位），轮询
 *      `GET /host/view/latest`（常规 1500ms / stale 600ms），seq 变则换图。
 *   ② 点击 → 进下一条消息 —— 归一化坐标 → `POST /host/view/pick` → 标记；
 *      底部「加入消息」把当前帧塞成草稿附件 + 一句说明（**不自动发送**）。
 *   ③ `@` 提及源 —— `GET /host/scene-items?q=` 按 对象/材质/集合 分组。
 *
 * 纪律：
 *   - 不得 `import`/`export` 语法、不得顶层 `await`、不得引用 Node 内置模块；
 *     可 `require("react")`（baseline 提供，core client-ui 包同样用法）。
 *   - 所有 fetch 失败**静默降级**并在面板显示一行状态；`@` 候选失败返回 `[]` **不抛**。
 *   - 点击**不自动发送**，只填草稿。
 *   - 后端地址默认 http://127.0.0.1:9877，可被 ctx 配置 / localStorage 覆盖。
 */
window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-blender-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		//#region 配置
		/** 后端默认地址（契约 §2.4 / AGENTS.md §2：后端 127.0.0.1:9877）。 */
		var DEFAULT_BACKEND = "http://127.0.0.1:9877";
		/** localStorage 覆盖键（最高优先级的用户侧覆盖）。 */
		var LS_BACKEND_KEY = "dsh-blender-plugin:backend";
		/** 常规轮询间隔（契约 §2.3）。 */
		var POLL_IDLE_MS = 1500;
		/** 帧已陈旧时的轮询间隔（契约 §2.3）。 */
		var POLL_STALE_MS = 600;
		/** 自动重拍的最小间隔：两次自动重拍之间至少 1200ms（task-4 要求 2）。 */
		var AUTO_CAPTURE_MIN_INTERVAL_MS = 1200;
		/** 自动重拍"连续无进展"上限；达到即停手，不再自动重拍（task-4 要求 2）。 */
		var AUTO_CAPTURE_MAX_STUCK = 3;
		/** 截图最长边；与手动刷新同一口径（契约 §1.4 夹到 [200,2000]）。 */
		var AUTO_CAPTURE_MAX_SIZE = 1000;
		/** 门控轮询间隔：`GET /host/ready`（契约 §7.3.1，便宜可常开）。 */
		var READY_POLL_MS = 2000;
		/** 面板内轮询间隔：`GET /host/pick/request`（契约 §7.4）。 */
		var PICK_POLL_MS = 2000;
		/** 右侧栏 tab 类型定义 id（= 包名；也是 body 注册的 key，契约 §7.3.2）。 */
		var TAB_ID = "@dsh-external/dsh-blender-plugin";
		/** 右侧栏 tab 的 kind（`openTab` 用它寻址，契约 §7.3.2）。 */
		var TAB_KIND = "blender-viewport";
		/** 「已应答」横幅停留时长（契约 §7.4：2 s 后消失）。 */
		var PICK_DONE_MS = 2000;
		/** 降级座位（conversation.view）的注册 id。 */
		var FALLBACK_VIEW_ID = TAB_ID + "-viewport";

		/** apply() 期间由 ctx 配置解析出的地址；backend() 在它之上叠 localStorage。 */
		var configuredBackend = DEFAULT_BACKEND;
		/** 幂等守卫：cordis 同一 fiber 只 apply 一次；卸载时复位（见 apply 里的 effect）。 */
		var started = false;

		/** 去掉尾部斜杠（不用正则字面量，避免粗筛误伤）。 */
		function stripTrailingSlashes(value) {
			var out = String(value === null || value === undefined ? "" : value);
			while (out.length > 0 && out.charAt(out.length - 1) === "/") out = out.slice(0, -1);
			return out;
		}

		/**
		 * 当前生效的后端地址。每次调用都重读 localStorage，所以用户在控制台里
		 * `localStorage.setItem("dsh-blender-plugin:backend", "http://…")` 后立刻生效。
		 */
		function backend() {
			try {
				var v = window.localStorage.getItem(LS_BACKEND_KEY);
				if (v) return stripTrailingSlashes(v);
			} catch (e) { /* 隐私模式 / 无 localStorage → 退回配置值 */ }
			return configuredBackend;
		}

		/** 优先级：window.__DSH_BLENDER_BACKEND__ > ctx.config.{backend,host,blenderBackend} > 默认。 */
		function resolveConfiguredBackend(ctx) {
			try {
				var g = window.__DSH_BLENDER_BACKEND__;
				if (typeof g === "string" && g) return stripTrailingSlashes(g);
			} catch (e) { /* ignore */ }
			try {
				var c = ctx && ctx.config;
				if (c) {
					if (typeof c.backend === "string" && c.backend) return stripTrailingSlashes(c.backend);
					if (typeof c.host === "string" && c.host) return stripTrailingSlashes(c.host);
					if (typeof c.blenderBackend === "string" && c.blenderBackend) return stripTrailingSlashes(c.blenderBackend);
				}
			} catch (e) { /* ignore */ }
			return DEFAULT_BACKEND;
		}
		//#endregion

		//#region 通用小工具
		/** 任何值 → 可读错误文本（绝不抛）。 */
		function errText(e) {
			if (e === null || e === undefined) return "未知错误";
			if (typeof e === "string") return e;
			if (e.message) return String(e.message);
			return String(e);
		}

		/** 夹到 [0,1]（契约 §1.5：坐标超出范围夹住）。 */
		function clamp01(n) {
			if (!(typeof n === "number") || n !== n) return 0;
			if (n < 0) return 0;
			if (n > 1) return 1;
			return n;
		}

		/** 取路径最后一段（面板里显示 .blend 文件名）。 */
		function shortPath(p) {
			var s = String(p === null || p === undefined ? "" : p);
			var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
			return i >= 0 ? s.slice(i + 1) : s;
		}

		/** Unix 秒 → 本地 HH:MM:SS。 */
		function timeLabel(unixSec) {
			try {
				var d = new Date(unixSec * 1000);
				function two(n) { return n < 10 ? "0" + n : String(n); }
				return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
			} catch (e) {
				return "";
			}
		}

		/** source 字段 → 中文（契约 §1.2）。 */
		function sourceLabel(src) {
			if (src === "user") return "用户";
			if (src === "auto") return "自动";
			if (src === "model") return "模型";
			return "无";
		}

		/**
		 * 从 ctx 上安全取一个服务：`ctx.get(name)` 是 cordis 的安全访问器
		 * （`dsh-client-ui-conversation/lib/client.js:22945` 同款用法）；
		 * 服务未挂载时返回 undefined 而不是抛。
		 */
		function serviceOf(ctx, name) {
			try {
				if (ctx && typeof ctx.get === "function") return ctx.get(name);
				if (ctx) return ctx[name];
			} catch (e) { /* ignore */ }
			return undefined;
		}
		//#endregion

		//#region HTTP（全部永不抛，失败折叠成 {ok:false}）
		/**
		 * 永不抛的 JSON 取回。失败一律折叠成 `{ ok:false, status, body:null, error }`，
		 * 由调用方静默降级 —— 契约要求面板「fetch 失败必须静默降级」。
		 * @returns {Promise<{ok:boolean,status:number,body:any,error:(string|null)}>}
		 */
		async function fetchJSON(url, init) {
			var res;
			try {
				res = await window.fetch(url, init);
			} catch (e) {
				return { ok: false, status: 0, body: null, error: errText(e) };
			}
			var status = res && typeof res.status === "number" ? res.status : 0;
			var httpOk = !!(res && res.ok);
			var body = null;
			try {
				body = await res.json();
			} catch (e) {
				body = null;
			}
			return { ok: httpOk, status: status, body: body, error: null };
		}

		/** POST 一个小 JSON 体（自动带 content-type）。 */
		function postJSON(url, payload) {
			return fetchJSON(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
		}

		/**
		 * `GET /host/ready` → 响应体或 null（契约 §7.1）。
		 * **门控的唯一依据**；取不到/未就绪一律当作"不可用"（静默降级）。
		 */
		async function fetchReady() {
			var r = await fetchJSON(backend() + "/host/ready");
			if (r.ok && r.body && r.body.ok === true) return r.body;
			return null;
		}

		/** `GET /host/pick/request` → pending 请求或 null（契约 §7.2）。失败一律当 null。 */
		async function fetchPickRequest() {
			var r = await fetchJSON(backend() + "/host/pick/request");
			if (r.ok && r.body && r.body.ok === true) return r.body.request || null;
			return null;
		}

		/** 面板上那行"后端不可达"状态文案。 */
		function offlineText(r) {
			if (r && r.status > 0) return "后端返回 HTTP " + r.status + " —— 静默降级，仍在重试";
			return "后端不可达（" + backend() + "）—— 静默降级，仍在重试";
		}

		/** `POST /host/view/capture` 失败文案。 */
		function captureFailText(r) {
			if (r && r.body && r.body.error) return "刷新失败：" + r.body.error;
			if (r && r.status > 0) return "刷新失败：HTTP " + r.status;
			return "刷新失败：后端不可达";
		}

		/** `POST /host/view/pick` 的业务错误文案（契约 §1.5）。 */
		function pickErrorText(b) {
			var e = b && b.error;
			if (e === "unknown_seq") return "该帧已过期（unknown_seq）—— 点「刷新」后重试";
			if (e === "file_mismatch") return "截图与 Blender 当前打开的 .blend 不一致（file_mismatch）：截图属于 " + shortPath(b.expected) + "，当前是 " + shortPath(b.current) + " —— 已拒绝，未误投";
			if (e === "scene_mismatch") return "截图与 Blender 当前场景不一致（scene_mismatch）：截图属于 " + String(b.expected) + "，当前是 " + String(b.current) + " —— 已拒绝，未误投";
			return "点选被拒：" + (e ? String(e) : "未知原因");
		}
		//#endregion

		//#region 文案（契约 §2.4，逐字）
		/**
		 * 点击 → 进下一条消息的文本规则（契约 §2.4 第 4 步）。
		 * 有选中对象 → 带对象名与 detail；无选中 → 只说明附了截图。
		 */
		function messageText(sel) {
			if (sel && sel.name) {
				var detail = sel.detail ? String(sel.detail) : (sel.type ? String(sel.type) : "对象");
				return "Blender 视口点击：" + sel.name + "（" + detail + "）。用户说\"这个/这些\"时指它们；对象名在 bpy.data.objects 里可直接用。";
			}
			return "附上当前 Blender 视口截图。";
		}
		//#endregion

		//#region 视口状态规范化
		/** 面板初始状态（seq===0 表示还没有任何帧，契约 §1.2）。 */
		var INITIAL_VIEW = {
			seq: 0,
			stale: false,
			pickable: false,
			blenderQuiet: false,
			width: 0,
			height: 0,
			file: null,
			scene: null,
			source: "none",
			capturedAt: null
		};

		/** `GET /host/view/latest` 响应 → 面板状态（字段名照契约 §1.2，一个不改）。 */
		function normalizeView(b) {
			var src = b && typeof b.source === "string" ? b.source : "none";
			return {
				seq: b && typeof b.seq === "number" ? b.seq : 0,
				stale: !!(b && b.stale === true),
				pickable: !!(b && b.pickable === true),
				blenderQuiet: !!(b && b.blender_quiet === true),
				width: b && typeof b.width === "number" ? b.width : 0,
				height: b && typeof b.height === "number" ? b.height : 0,
				file: b && typeof b.file === "string" ? b.file : null,
				scene: b && typeof b.scene === "string" ? b.scene : null,
				source: src,
				capturedAt: b && typeof b.captured_at === "number" ? b.captured_at : null
			};
		}
		//#endregion

		//#region 自动重拍（上游 A8：场景改完 + Blender 静默 → 自行重拍）
		/**
		 * 面板是否"看不见"（标签页被切走 / 窗口最小化）。
		 * 看不见时**停止**自动重拍，省 Blender 主线程（task-4 要求 5）。
		 * `typeof document` 对未声明标识符是安全的（无 document 的环境不抛）。
		 */
		function isDocumentHidden() {
			try {
				if (typeof document === "undefined" || !document) return false;
				return document.visibilityState === "hidden";
			} catch (e) {
				return false;
			}
		}

		/**
		 * 自动重拍决策（**纯函数**，与 React / 网络解耦 ⇒ 可离线单测）。
		 *
		 * 上游语义（`openai_apps.py` 的 `AUTO_CAPTURE_QUIET_S`）：场景变更命令完成后、
		 * Blender 静默 0.8s 才重拍，连续编辑只出一张。本插件复用后端**已有的**两个字段
		 * 判定 —— `stale`（该帧之后场景被改过）与 `blender_quiet`（无在飞命令且距上次
		 * 命令 ≥0.8s）—— **不改契约任何字段**。
		 *
		 * @param s {{seq:number,stale:boolean,blenderQuiet:boolean,hidden:boolean,inflight:number,
		 *           picking:boolean,now:number,lastAt:number,lastSeq:number,stuck:number,
		 *           minIntervalMs:number,maxStuck:number}}
		 * @returns {{action:'capture'|'noProgress'|'stop'|'skip', reason:string}}
		 */
		function autoCaptureDecision(s) {
			// 不打断用户 / 不并发：看不见、有在飞请求、正在 pick → 本轮一律跳过
			if (s.hidden === true) return { action: "skip", reason: "hidden" };
			if (s.inflight > 0) return { action: "skip", reason: "inflight" };
			if (s.picking === true) return { action: "skip", reason: "picking" };
			if (!(s.seq > 0)) return { action: "skip", reason: "no_frame" };
			// 只有"场景改过"才需要重拍（新鲜帧由调用方清零无进展计数）
			if (s.stale !== true) return { action: "skip", reason: "fresh" };
			if (s.stuck >= s.maxStuck) return { action: "stop", reason: "stuck" };
			// Blender 还在忙（有在飞命令 / 距上次命令 <0.8s）→ 等它静下来再拍
			if (s.blenderQuiet !== true) return { action: "skip", reason: "busy" };
			// 这一帧已经重拍过、seq 没动 ⇒ 无进展。**不发新请求**，只让调用方计数；
			// 于是"同一 seq 不重复触发"与"连续 3 次无进展停手"两条同时成立（不无限打后端）。
			if (s.seq === s.lastSeq) return { action: "noProgress", reason: "same_seq" };
			if (s.now - s.lastAt < s.minIntervalMs) return { action: "skip", reason: "throttled" };
			return { action: "capture", reason: "stale_and_quiet" };
		}
		//#endregion

		//#region 点击 → 草稿（契约 §2.4；**不自动发送**）
		/**
		 * 读会话输入框当前草稿文本（备用通道用：绝不覆盖用户已写的内容）。
		 * `SessionInput.state: SnapshotStore<InputState>`，`InputState.draft: string`
		 * （`dsh-client-ui-conversation/lib/types/client/contract/input.d.ts:254-260`）。
		 * @returns {{readable:boolean, draft:string}}
		 */
		function readDraftInfo(sessionInput) {
			try {
				var st = sessionInput && sessionInput.state;
				if (st && typeof st.getSnapshot === "function") {
					var snap = st.getSnapshot();
					if (snap && typeof snap.draft === "string") return { readable: true, draft: snap.draft };
				}
			} catch (e) { /* ignore */ }
			return { readable: false, draft: "" };
		}

		/** 可用则 notify，不可用静默（契约 §2.4 第 5 步）。 */
		function notifyInfo(deps, text) {
			try {
				var f = deps && deps.fallbackInput;
				if (f && typeof f.notify === "function") { f.notify("info", text); return; }
			} catch (e) { /* 静默 */ }
		}

		/**
		 * 契约 §2.4 的五步：取图 → File → createDrafts → addAttachments → insertText。
		 * 全程不抛；失败返回 `{ok:false, reason}`，由面板显示成一行状态。
		 *
		 * @param deps {{conversation:any, sessionId:any, inputActions:any, fallbackInput:any, seq:number}}
		 * @param sel  选中的对象（`POST /host/view/pick` 的 `object`），或 null
		 * @returns {Promise<{ok:boolean, how?:string, reason?:string, warning?:string}>}
		 */
		async function addFrameToDraft(deps, sel) {
			var conversation = deps && deps.conversation;
			var sessionId = deps && deps.sessionId;
			var actions = deps && deps.inputActions;
			var fallback = deps && deps.fallbackInput;
			var seq = deps && deps.seq;

			if (!(seq > 0)) return { ok: false, reason: "还没有视口帧 —— 点「刷新」让后端截一张" };
			if (!sessionId) return { ok: false, reason: "未取得 sessionId（该座位没有会话身份）—— 只能预览，不能加入消息" };
			if (!actions && !fallback) return { ok: false, reason: "未取得 inputActions —— 无法写入草稿" };
			if (!conversation || typeof conversation.createDrafts !== "function") {
				return { ok: false, reason: "会话草稿接口不可用（ctx.conversation.createDrafts 缺失）" };
			}
			if (typeof File !== "function") return { ok: false, reason: "当前环境没有 File 构造器" };

			// ① 取当前帧 → blob → File
			var file;
			try {
				var res = await window.fetch(backend() + "/host/view.png?seq=" + seq);
				if (!res || !res.ok) return { ok: false, reason: "取图失败（HTTP " + (res && res.status ? res.status : 0) + "）" };
				var blob = await res.blob();
				file = new File([blob], "blender-viewport.png", { type: "image/png" });
			} catch (e) {
				return { ok: false, reason: "取图失败：" + errText(e) };
			}

			// ② createDrafts(sessionId, [file]) → ComposerAttachment[]
			var drafts;
			try {
				drafts = conversation.createDrafts(sessionId, [file]);
			} catch (e) {
				return { ok: false, reason: "创建草稿失败：" + errText(e) };
			}
			if (!drafts || !drafts.length) return { ok: false, reason: "创建草稿失败（createDrafts 返回空）" };
			var ids = [];
			for (var i = 0; i < drafts.length; i++) {
				if (drafts[i] && drafts[i].id !== undefined && drafts[i].id !== null) ids.push(drafts[i].id);
			}
			if (!ids.length) return { ok: false, reason: "创建草稿失败（草稿没有 id）" };

			var text = messageText(sel);

			// ③ 附件入草稿
			if (actions) {
				var added;
				try {
					added = actions.addAttachments(ids);
				} catch (e) {
					return { ok: false, reason: "加入附件失败：" + errText(e) };
				}
				if (added === false) return { ok: false, reason: "输入框当前不接受附件（可能在提交中）" };
			} else {
				try {
					fallback.addAttachments(ids);
				} catch (e) {
					return { ok: false, reason: "加入附件失败（备用通道）：" + errText(e) };
				}
			}

			// ④ 文本入草稿（**不自动发送**，用户自己决定）
			if (actions) {
				var wrote = false;
				for (var attempt = 0; attempt < 2 && !wrote; attempt++) {
					try {
						wrote = actions.insertText(text, actions.captureInsertion()) === true;
					} catch (e) {
						wrote = false;
					}
				}
				if (!wrote) {
					return { ok: true, how: "actions", warning: "截图已进草稿附件，但文本插入被拒（草稿正在变或已锁定）—— 请手动补一句说明" };
				}
			} else {
				// 备用通道 SessionInput 只有 setDraft（整体替换）→ 只在"读得到且为空"时才写，绝不覆盖用户内容
				var info = readDraftInfo(fallback);
				if (!info.readable) {
					return { ok: true, how: "fallback", warning: "截图已进草稿附件；备用通道读不到当前草稿，未写文本 —— 请手动补一句说明" };
				}
				if (info.draft.length > 0) {
					return { ok: true, how: "fallback", warning: "截图已进草稿附件；备用通道不覆盖已有草稿文本 —— 请手动补一句说明" };
				}
				try {
					fallback.setDraft(text);
				} catch (e) {
					return { ok: true, how: "fallback", warning: "截图已进草稿附件，但文本写入失败：" + errText(e) };
				}
			}

			// ⑤ 通知（可用则用，不可用静默）
			notifyInfo(deps, "已加入消息");
			return { ok: true, how: "actions" };
		}
		//#endregion

		//#region @ 提及源（契约 §2.5）
		/** ref 前缀 → 允许的种类（`object:<name>` / `material:<name>` / `collection:<name>`）。 */
		var REF_KINDS = { object: true, material: true, collection: true };

		/**
		 * 拆 ref：`object:Cube` → `{kind:"object", name:"Cube"}`；裸 `Cube` → `{kind:"object", name:"Cube"}`。
		 * 裸值按 object 处理 ⇒ 契约 §2.5 里那两行 codec 写法（`'@'+ref`、`'<blender-object>'+ref+'</blender-object>'`）
		 * 对裸 ref **逐字成立**，对带前缀的 ref 则给出更准确的模型文本。
		 */
		function splitRef(ref) {
			var s = String(ref === null || ref === undefined ? "" : ref);
			var i = s.indexOf(":");
			if (i > 0) {
				var kind = s.slice(0, i);
				if (REF_KINDS[kind] === true) return { kind: kind, name: s.slice(i + 1) };
			}
			return { kind: "object", name: s };
		}

		/**
		 * `@` 候选数据源：`GET /host/scene-items?q=<query>`。
		 * 按 对象 / 材质 / 集合 用 `section` 分组（候选**没有**缩略图字段，契约 §2.5）。
		 * **失败必须返回 `[]` 且不抛** —— 抛了会污染输入框。
		 */
		async function sceneItemCandidates(req) {
			try {
				var q = req && typeof req.query === "string" ? req.query : "";
				var r = await fetchJSON(backend() + "/host/scene-items?q=" + encodeURIComponent(q));
				if (!r.ok || !r.body || r.body.ok !== true) return [];
				var out = [];
				// [响应字段, section 名, ref 前缀, icon]
				var groups = [
					["objects", "对象", "object", "file"],
					["materials", "材质", "material", "file"],
					["collections", "集合", "collection", "folder"]
				];
				for (var g = 0; g < groups.length; g++) {
					var list = r.body[groups[g][0]];
					if (!list || typeof list.length !== "number") continue;
					for (var i = 0; i < list.length; i++) {
						var it = list[i];
						if (!it || !it.name) continue;
						var name = String(it.name);
						out.push({
							name: name,
							label: name,
							description: groups[g][0] === "objects" ? String(it.type || "OBJECT") : groups[g][1],
							icon: groups[g][3],
							section: groups[g][1],
							value: groups[g][2] + ":" + name
						});
					}
				}
				return out;
			} catch (e) {
				return [];
			}
		}

		/** 选中一个候选 → ReferenceInsert（契约 §2.5）。 */
		function onPickItem(pick) {
			var c = pick && pick.candidate ? pick.candidate : {};
			var ref = typeof c.value === "string" && c.value ? c.value : String(c.name || "");
			var parts = splitRef(ref);
			return {
				insert: {
					source: "blender",
					ref: ref,
					label: parts.name,
					appearance: "file",
					clipboardText: "@" + parts.name
				}
			};
		}

		/** ref ↔ 文本/剪贴板投影（契约 §2.5；`serialize` 是"@提及 → 模型文本"的正式通道）。 */
		var blenderCodec = {
			clipboardText: function (ref) {
				return "@" + splitRef(ref).name;
			},
			serialize: function (ref) {
				var parts = splitRef(ref);
				return Promise.resolve("<blender-" + parts.kind + ">" + parts.name + "</blender-" + parts.kind + ">");
			}
		};
		//#endregion

		//#region 点选请求（契约 §7.4：阻塞式交互的客户端半边）
		/**
		 * 把 `POST /host/pick/answer` 的回执映射成横幅文案与后续动作（**纯函数**，可离线单测）。
		 *
		 * 契约 §7.2 的状态机：
		 *   - `ok:true, state:"answered"`（命中或空处）→ 请求结束，横幅转「已应答」
		 *   - `ok:false, state:"pending"` + `scene_mismatch`/`unknown_seq` → **仍 pending**，
		 *     横幅提示「刷新后再点」，继续等用户
		 *   - `ok:false, error:"no_such_request"` → 请求已结束，横幅收起
		 *
		 * @returns {{kind:'answered'|'retry'|'gone', text:string, name:(string|null)}}
		 */
		function answerOutcome(body) {
			if (!body || body.ok !== true) {
				var e = body && body.error ? String(body.error) : "unknown";
				if (e === "no_such_request") {
					return { kind: "gone", text: "该点选请求已结束（no_such_request）", name: null };
				}
				return { kind: "retry", text: "刷新后再点（" + e + "）", name: null };
			}
			if (body.state !== "answered") {
				return { kind: "retry", text: "刷新后再点（" + String(body.state || "pending") + "）", name: null };
			}
			var obj = body.object;
			if (obj && obj.name) {
				return { kind: "answered", text: "已应答：" + obj.name + "（已返回给模型）", name: String(obj.name) };
			}
			return { kind: "answered", text: "已应答：空处（已返回给模型）", name: null };
		}
		//#endregion

		//#region 面板（两个座位共用主体）
		/** 面板内联样式（不引外部 CSS，避免污染全局）。 */
		var UI = {
			root: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px", minWidth: 0, fontSize: "12.5px", lineHeight: 1.5, color: "var(--dsw-alias-label-primary, #1d2129)" },
			head: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
			title: { fontWeight: 600, whiteSpace: "nowrap" },
			dot: { width: "8px", height: "8px", borderRadius: "50%", flex: "none", background: "#aeaeb2" },
			spacer: { flex: "1 1 auto", minWidth: "4px" },
			btn: { font: "inherit", fontSize: "11.5px", padding: "3px 10px", borderRadius: "999px", cursor: "pointer", whiteSpace: "nowrap", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))", background: "transparent", color: "inherit" },
			stage: { position: "relative", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))", borderRadius: "8px", overflow: "hidden", background: "rgba(128,128,128,.06)" },
			img: { display: "block", width: "100%", height: "auto", cursor: "crosshair" },
			imgInert: { display: "block", width: "100%", height: "auto", cursor: "default" },
			marker: { position: "absolute", width: "16px", height: "16px", marginLeft: "-8px", marginTop: "-8px", borderRadius: "50%", border: "2px solid #ff9f0a", boxShadow: "0 0 0 2px rgba(255,159,10,.28)", pointerEvents: "none" },
			empty: { padding: "22px 12px", textAlign: "center", color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))" },
			meta: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))", wordBreak: "break-word" },
			chip: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 8px", borderRadius: "999px", fontSize: "11.5px", background: "rgba(255,159,10,.14)", border: "1px solid rgba(255,159,10,.4)" },
			chipIdle: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 8px", borderRadius: "999px", fontSize: "11.5px", background: "transparent", border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))", color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))" },
			note: { fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))", wordBreak: "break-word" },
			noteError: { fontSize: "11.5px", color: "#e03131", wordBreak: "break-word" },
			banner: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "6px 8px", borderRadius: "8px", background: "rgba(255,159,10,.14)", border: "1px solid rgba(255,159,10,.45)" },
			bannerOk: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "6px 8px", borderRadius: "8px", background: "rgba(52,199,89,.12)", border: "1px solid rgba(52,199,89,.45)" },
			bannerText: { fontSize: "11.5px", fontWeight: 600, flex: "1 1 auto", minWidth: 0, wordBreak: "break-word" },
			bannerMsg: { fontSize: "11px", flexBasis: "100%", color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.9))", wordBreak: "break-word" },
			foot: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }
		};

		/** 极简 createElement 包装（不引 jsx-runtime，避免多一个 require）。 */
		function h(tag, props) {
			var args = [tag, props];
			for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);
			return React.createElement.apply(React, args);
		}

		/**
		 * 造面板**主体**组件（两个座位共用同一份实现）。
		 * - 右侧栏座位：`sidebar.right.pane.tab`（`key = TAB_ID`），props 里带框架注入的 `useTabInfo`
		 * - 降级座位：`conversation.view`（契约 §2.3 / §7.3.5）
		 * 组件闭包里握着 root `ctx`（取 `ctx.conversation` 用）。每次 boot 只造一次 ⇒ 身份稳定。
		 */
		function makePanelBody(ctx) {
			function BlenderViewportPanel(props) {
				var p = props || {};
				// sessionId 双通道：① 座位标准 props（ui-session BUILTIN_SOURCE 提供）
				//                 ② 本插件 register 的 inject(sessionId) 业务面（框架解析）
				var sessionId = p.sessionId !== undefined && p.sessionId !== null ? p.sessionId : p.blenderSessionId;
				// inputActions 双通道：① 座位标准 props（ui-conversation 的 uiSession.provide 提供）
				//                    ② 备用 SessionInput（ctx.sessions.scope(sessionId) → actx.get("conversation").input.for(actx)）
				var inputActions = p.inputActions || null;
				var fallbackInput = p.blenderInput || null;
				// 座位信息：右侧栏座位由 BlenderViewportPane 注入 __tabInfo / __seat
				var seat = p.__seat === "sidebar" ? "sidebar" : "fallback";
				var tabInfo = p.__tabInfo || null;
				// 面板不可见时不轮询（契约 §7.4）：右侧栏读 tab.visible；降级座位无从得知 ⇒ 视为可见
				var tabVisible = seat === "sidebar" && tabInfo && tabInfo.tab ? tabInfo.tab.visible !== false : true;

				var viewState = React.useState(INITIAL_VIEW);
				var view = viewState[0];
				var setView = viewState[1];
				var selState = React.useState(null);
				var sel = selState[0];
				var setSel = selState[1];
				var markState = React.useState(null);
				var mark = markState[0];
				var setMark = markState[1];
				var noteState = React.useState(null);
				var note = noteState[0];
				var setNote = noteState[1];
				var busyState = React.useState(false);
				var busy = busyState[0];
				var setBusy = busyState[1];
				// 自动重拍的可视状态（"停手"要在面板上显示成一行状态，task-4 要求 2）
				var autoStateLive = React.useState({ stopped: false, stuck: 0 });
				var autoState = autoStateLive[0];
				var setAutoState = autoStateLive[1];
				// 在飞请求计数（用 ref：轮询 effect 只跑一次，读 state 会读到过期闭包）
				var inflightRef = React.useRef(0);
				// pick 专用标记（task-4 要求 3：pick 进行中不自动重拍）
				var pickingRef = React.useRef(false);
				// 自动重拍账本：{ lastAt: 上次发起时刻, lastSeq: 已为哪一帧拍过, stuck: 连续无进展次数 }
				var autoRef = React.useRef({ lastAt: 0, lastSeq: -1, stuck: 0 });
				// §7.4 点选请求：pending 请求 + 横幅文案（无 pending 时走 §2.4 原路径）
				var pickReqLive = React.useState(null);
				var pickReq = pickReqLive[0];
				var setPickReq = pickReqLive[1];
				var pickMsgLive = React.useState(null);
				var pickMsg = pickMsgLive[0];
				var setPickMsg = pickMsgLive[1];
				var pickDoneTimer = React.useRef(0);

				/** 进入一次在飞请求（自动重拍 / 手动刷新 / pick / 加入消息 共用同一计数）。 */
				function beginFlight() {
					inflightRef.current += 1;
					setBusy(true);
				}
				/** 退出一次在飞请求；归零才把按钮从"…"恢复。 */
				function endFlight() {
					inflightRef.current = Math.max(0, inflightRef.current - 1);
					if (inflightRef.current === 0) setBusy(false);
				}
				/** 有进展（帧新鲜了 / 用户手动刷新）→ 无进展计数清零、解除停手。 */
				function autoProgress() {
					autoRef.current.stuck = 0;
					setAutoState(function (prev) {
						return prev.stopped || prev.stuck !== 0 ? { stopped: false, stuck: 0 } : prev;
					});
				}
				/** 记一次"无进展"；达上限即停手（之后不再自动重拍，等用户手动刷新）。 */
				function autoStuck() {
					var a = autoRef.current;
					a.stuck += 1;
					if (a.stuck >= AUTO_CAPTURE_MAX_STUCK) {
						setAutoState(function (prev) {
							return prev.stopped ? prev : { stopped: true, stuck: a.stuck };
						});
					}
				}

				// ── 轮询 GET /host/view/latest（常规 1500ms / stale 600ms）──
				// 轮询本身只读 store，**绝不**碰 Blender（契约 §3 末条）；
				// 只有判定"场景改过 + Blender 静默"时才发 POST /host/view/capture（上游 A8）。
				React.useEffect(function () {
					var alive = true;
					var timer = 0;
					function later(ms) {
						if (!alive) return;
						timer = window.setTimeout(tick, ms);
					}
					/**
					 * 按上游 A8 语义决定是否自动重拍；需要就发一次 POST。
					 * @returns {Promise<boolean>} 本轮是否真的重拍了（好让 tick 提前再轮询）
					 */
					async function autoCaptureIfDue(next) {
						var a = autoRef.current;
						var decision = autoCaptureDecision({
							seq: next.seq,
							stale: next.stale,
							blenderQuiet: next.blenderQuiet,
							hidden: isDocumentHidden(),
							inflight: inflightRef.current,
							picking: pickingRef.current,
							now: Date.now(),
							lastAt: a.lastAt,
							lastSeq: a.lastSeq,
							stuck: a.stuck,
							minIntervalMs: AUTO_CAPTURE_MIN_INTERVAL_MS,
							maxStuck: AUTO_CAPTURE_MAX_STUCK
						});
						if (decision.action === "skip") return false;
						if (decision.action === "stop") {
							setAutoState(function (prev) {
								return prev.stopped ? prev : { stopped: true, stuck: a.stuck };
							});
							return false;
						}
						if (decision.action === "noProgress") {
							autoStuck();
							return false;
						}
						// action === "capture"：先记账"已为这一帧拍过"，再发请求（auto:true ⇒ source="auto"）
						a.lastAt = Date.now();
						a.lastSeq = next.seq;
						beginFlight();
						var r = await postJSON(backend() + "/host/view/capture", { max_size: AUTO_CAPTURE_MAX_SIZE, auto: true });
						endFlight();
						if (!alive) return true;
						if (r.ok && r.body && r.body.ok === true) {
							var after = normalizeView(r.body);
							setView(after);
							if (after.stale === true) autoStuck();
							else autoProgress();
						} else {
							autoStuck();   // 502 / 网络失败也算无进展，避免无限重试
						}
						return true;
					}
					async function tick() {
						var r = await fetchJSON(backend() + "/host/view/latest");
						if (!alive) return;
						if (!(r.ok && r.body && r.body.ok === true)) {
							setNote({ level: "warn", text: offlineText(r) });
							later(POLL_IDLE_MS);
							return;
						}
						var next = normalizeView(r.body);
						setView(next);
						setNote(null);
						if (next.stale !== true) autoProgress();
						var captured = await autoCaptureIfDue(next);
						if (!alive) return;
						// 刚重拍过 → 尽快再看一眼，把新帧显示出来
						if (captured) later(POLL_STALE_MS);
						else later(next.stale ? POLL_STALE_MS : POLL_IDLE_MS);
					}
					tick();
					return function () {
						alive = false;
						if (timer) window.clearTimeout(timer);
					};
				}, []);

				// ── §7.4 轮询 GET /host/pick/request（面板不可见时不轮询，省资源）──
				React.useEffect(function () {
					if (!tabVisible) return undefined;
					var alive = true;
					var timer = 0;
					async function poll() {
						var req = await fetchPickRequest();
						if (!alive) return;
						setPickReq(req);
						timer = window.setTimeout(poll, PICK_POLL_MS);
					}
					poll();
					return function () {
						alive = false;
						if (timer) window.clearTimeout(timer);
					};
				}, [tabVisible]);

				// 卸载时清掉「已应答」横幅的自动隐藏定时器
				React.useEffect(function () {
					return function () {
						if (pickDoneTimer.current) { window.clearTimeout(pickDoneTimer.current); pickDoneTimer.current = 0; }
					};
				}, []);

				/** 显示横幅文案；autoHideMs>0 时到点自动消失（契约 §7.4：已应答 2 s 后消失）。 */
				function showPickMsg(text, autoHideMs) {
					setPickMsg({ text: text });
					if (pickDoneTimer.current) { window.clearTimeout(pickDoneTimer.current); pickDoneTimer.current = 0; }
					if (autoHideMs > 0) {
						pickDoneTimer.current = window.setTimeout(function () {
							pickDoneTimer.current = 0;
							setPickMsg(null);
						}, autoHideMs);
					}
				}

				/** 「取消」→ POST /host/pick/cancel（契约 §7.4）。 */
				async function onCancelPick() {
					var req = pickReq;
					if (!req || !req.requestId) return;
					if (inflightRef.current > 0) return;
					beginFlight();
					var cr;
					try {
						// 行首不能是 await（bundle 纯度粗筛会当成顶层 await）→ 赋值形式
						cr = await postJSON(backend() + "/host/pick/cancel", { requestId: req.requestId, reason: "user" });
					} finally {
						endFlight();
					}
					if (cr === undefined) { /* 静默：取消是尽力而为 */ }
					setPickReq(null);
					setPickMsg(null);
				}

				/** 手动刷新：让后端重拍一张（auto:false ⇒ source="user"）。与自动重拍互斥。 */
				async function onCapture() {
					if (inflightRef.current > 0) return;
					beginFlight();
					var r = await postJSON(backend() + "/host/view/capture", { max_size: AUTO_CAPTURE_MAX_SIZE, auto: false });
					endFlight();
					if (r.ok && r.body && r.body.ok === true) {
						setView(normalizeView(r.body));
						setNote(null);
						// 用户显式要求 → 重新武装自动重拍（清节流与无进展账本）
						autoRef.current.lastAt = 0;
						autoRef.current.lastSeq = -1;
						autoProgress();
					} else {
						setNote({ level: "warn", text: captureFailText(r) });
					}
				}

				/** 点击图像：算 0..1 归一化坐标（左上角原点、y 向下）→ POST /host/view/pick。 */
				function onImageClick(ev) {
					var el = ev && ev.currentTarget;
					if (!el || typeof el.getBoundingClientRect !== "function") return;
					var rect = el.getBoundingClientRect();
					if (!rect || !rect.width || !rect.height) return;
					doPick(clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height));
				}

				async function doPick(x, y) {
					if (inflightRef.current > 0 || !(view.seq > 0)) return;
					// pickable===false：图像仍可点，但只"附整图"并提示（契约 §2.3）
					if (!view.pickable) {
						setSel(null);
						setMark(null);
						setNote({ level: "warn", text: "当前帧不可按物体点选（没有相机矩阵）—— 点「刷新」后可点选" });
						return;
					}
					// pickingRef 让自动重拍在 pick 在飞期间闭嘴（task-4 要求 3）
					pickingRef.current = true;
					// §7.4：有 pending 点选请求 → 这一次点击走 answer（阻塞式交互），
					// 不再走 §2.4 的"加入消息"路径
					if (pickReq && pickReq.requestId) {
						beginFlight();
						var ar;
						try {
							ar = await postJSON(backend() + "/host/pick/answer", { requestId: pickReq.requestId, seq: view.seq, x: x, y: y });
						} finally {
							pickingRef.current = false;
							endFlight();
						}
						var ab = ar && ar.body ? ar.body : null;
						var outcome = answerOutcome(ab);
						if (outcome.kind === "answered") {
							var aobj = ab && ab.object ? ab.object : null;
							setPickReq(null);
							setSel(aobj);
							setMark(aobj ? { x: x, y: y } : null);
							setNote(null);
							showPickMsg(outcome.text, PICK_DONE_MS);
						} else if (outcome.kind === "gone") {
							setPickReq(null);
							showPickMsg(outcome.text, PICK_DONE_MS);
						} else {
							// 仍 pending（错配 / seq 未知）→ 保持等待，提示刷新后重试
							showPickMsg(outcome.text, 0);
						}
						return;
					}
					beginFlight();
					var r;
					try {
						r = await postJSON(backend() + "/host/view/pick", { seq: view.seq, x: x, y: y });
					} finally {
						pickingRef.current = false;
						endFlight();
					}
					if (!r.ok || !r.body) {
						setNote({ level: "warn", text: "点选失败：" + (r.error || ("HTTP " + r.status)) });
						return;
					}
					if (r.body.ok !== true) {
						setNote({ level: "warn", text: pickErrorText(r.body) });
						return;
					}
					if (!r.body.object) {           // 点在空处 → 清空已选（只附整图）
						setSel(null);
						setMark(null);
						setNote(null);
						return;
					}
					if (sel && sel.name === r.body.object.name) {   // 已选中的对象再点一次 → 取消
						setSel(null);
						setMark(null);
						setNote(null);
						return;
					}
					setSel(r.body.object);
					setMark({ x: x, y: y });
					setNote(null);
				}

				/** 「加入消息」：填草稿，**不发送**。 */
				async function onAdd() {
					if (inflightRef.current > 0) return;
					beginFlight();
					var res = await addFrameToDraft({
						conversation: serviceOf(ctx, "conversation"),
						sessionId: sessionId,
						inputActions: inputActions,
						fallbackInput: fallbackInput,
						seq: view.seq
					}, sel);
					endFlight();
					if (!res.ok) {
						setNote({ level: "error", text: res.reason });
						return;
					}
					if (res.warning) {
						setNote({ level: "warn", text: res.warning });
						return;
					}
					setNote({ level: "info", text: "已加入消息（未发送）—— 请自行确认后发送" });
				}

				// ── 渲染 ──
				var pickPending = !!(pickReq && pickReq.requestId);
				var canAdd = view.seq > 0 && !!sessionId && !!(inputActions || fallbackInput) && !busy && !pickPending;
				var addHint = "";
				if (pickPending) addHint = "模型正在请求你点选 —— 先点画面（或「取消」）再加消息";
				else if (!(view.seq > 0)) addHint = "还没有视口帧";
				else if (!sessionId) addHint = "未取得 sessionId（该座位没有会话身份）—— 只能预览";
				else if (!inputActions && !fallbackInput) addHint = "未取得 inputActions —— 只能预览";
				// 降级可见化：拿不到 sessionId / inputActions 时把原因显示成一行状态
				// （契约要求「所有 fetch 失败静默降级并**在面板显示一行状态**」，同一纪律）
				var degradeHint = "";
				if (!sessionId) degradeHint = "未取得 sessionId（该座位没有会话身份）—— 只能预览，不能加入消息";
				else if (!inputActions && !fallbackInput) degradeHint = "未取得 inputActions —— 只能预览，不能加入消息";

				var dotColor = view.seq > 0 ? (view.stale ? "#ff9f0a" : "#34c759") : "#aeaeb2";
				var imgSrc = view.seq > 0 ? backend() + "/host/view.png?seq=" + view.seq : null;

				var stageKids = [];
				if (imgSrc) {
					stageKids.push(h("img", {
						key: "img",
						src: imgSrc,
						alt: "Blender 视口",
						style: view.pickable ? UI.img : UI.imgInert,
						onClick: onImageClick,
						onError: function () {
							setNote({ level: "warn", text: "取图失败（/host/view.png）—— 面板仍在轮询" });
						}
					}));
					if (mark) {
						stageKids.push(h("span", {
							key: "mark",
							style: Object.assign({}, UI.marker, { left: (mark.x * 100) + "%", top: (mark.y * 100) + "%" })
						}));
					}
				} else {
					stageKids.push(h("div", { key: "empty", style: UI.empty },
						h("div", null, "还没有视口帧"),
						h("div", { style: { fontSize: "11px", marginTop: "4px" } }, "点「刷新」让后端截一张")
					));
				}

				var metaBits = [];
				if (view.seq > 0) {
					metaBits.push("seq " + view.seq);
					if (view.width && view.height) metaBits.push(view.width + "×" + view.height);
					if (view.source !== "none") metaBits.push("来源 " + sourceLabel(view.source));
					if (view.scene) metaBits.push("场景 " + view.scene);
					if (view.file) metaBits.push(shortPath(view.file));
					if (view.capturedAt) metaBits.push(timeLabel(view.capturedAt));
					if (view.stale) metaBits.push(view.blenderQuiet && !autoState.stopped ? "已陈旧（待自动重拍）" : "已陈旧");
					if (!view.pickable) metaBits.push("不可点选");
				}

				var kids = [];
				// §7.4：顶部显著横幅（有 pending 请求 → 请求点选 + 取消；否则显示应答/重试结果）
				if (pickPending) {
					kids.push(h("div", { key: "pickreq", style: UI.banner },
						h("div", { key: "t", style: UI.bannerText },
							h("b", { key: "b" }, "模型请求你点选"),
							"：" + String(pickReq.prompt || "请点一下你要改的物体")),
						h("button", {
							key: "cancel",
							type: "button",
							style: UI.btn,
							onClick: onCancelPick,
							title: "取消这次点选请求（模型会收到「已取消」）"
						}, "取消"),
						pickMsg ? h("div", { key: "m", style: UI.bannerMsg }, pickMsg.text) : null
					));
				} else if (pickMsg) {
					kids.push(h("div", { key: "pickmsg", style: UI.bannerOk },
						h("div", { key: "t", style: UI.bannerText }, pickMsg.text)));
				}
				kids.push(h("div", { key: "head", style: UI.head },
					h("span", { key: "dot", style: Object.assign({}, UI.dot, { background: dotColor }) }),
					h("span", { key: "title", style: UI.title }, "Blender 视口"),
					h("span", { key: "spacer", style: UI.spacer }),
					h("button", {
						key: "capture",
						type: "button",
						style: UI.btn,
						disabled: busy,
						onClick: onCapture,
						title: "让后端重新截一张（POST /host/view/capture）"
					}, busy ? "…" : "刷新")
				));
				kids.push(h("div", { key: "stage", style: UI.stage }, stageKids));

				if (metaBits.length) kids.push(h("div", { key: "meta", style: UI.meta }, metaBits.join(" · ")));

				var footKids = [
					h("span", { key: "chip", style: sel ? UI.chip : UI.chipIdle },
						sel ? ("已选：" + sel.name + (sel.detail ? "（" + sel.detail + "）" : "")) : "未选中对象"),
					h("button", {
						key: "add",
						type: "button",
						style: UI.btn,
						disabled: !canAdd,
						onClick: onAdd,
						title: canAdd ? "把当前截图（含选中对象名）加入输入框草稿；不会自动发送" : addHint
					}, "加入消息")
				];
				kids.push(h("div", { key: "foot", style: UI.foot }, footKids));

				// 不可点选时的固定提示（契约 §2.3）
				if (view.seq > 0 && !view.pickable) {
					kids.push(h("div", { key: "hint", style: UI.note }, "刷新后可按物体点选（当前帧没有相机矩阵，点击只会附整图）"));
				}
				if (degradeHint) {
					kids.push(h("div", { key: "degrade", style: UI.note }, "⚠ " + degradeHint));
				}
				// 自动重拍停手说明（task-4 要求 2：连续无进展达上限后不许再打后端，且要说清）
				if (autoState.stopped) {
					kids.push(h("div", { key: "autostop", style: UI.note },
						"⚠ 自动重拍已停手（连续 " + AUTO_CAPTURE_MAX_STUCK + " 次无进展）—— 场景可能仍在变，请手点「刷新」"));
				}
				if (note && note.text) {
					kids.push(h("div", { key: "note", style: note.level === "error" ? UI.noteError : UI.note }, note.text));
				}
				// §7.3.5 降级说明：右侧栏不可用 → 已退回对话页签
				if (seat === "fallback") {
					kids.push(h("div", { key: "seatnote", style: UI.note }, "右侧栏不可用，已退回对话页签。"));
				}

				return h("div", { style: UI.root }, kids);
			}
			return BlenderViewportPanel;
		}

		/**
		 * 右侧栏座位的包装：把框架注入的 `useTabInfo` 读出来，透传给共用主体。
		 *
		 * `useTabInfo` 由槽位 `sidebar.right.pane.tab` 的 inject face（`hooks.tabInfo`）
		 * 合成 —— 契约 §7.3.6；类型见
		 * `dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts:196-202`
		 * （`UseSidebarRightTabInfo = () => SidebarRightTabInfo`）。
		 */
		function makeSidebarPane(PanelBody) {
			function BlenderViewportPane(props) {
				var useTabInfo = props && props.useTabInfo;
				var tabInfo = null;
				if (typeof useTabInfo === "function") {
					try { tabInfo = useTabInfo(); } catch (e) { tabInfo = null; }
				}
				var merged = {};
				for (var k in props) {
					if (Object.prototype.hasOwnProperty.call(props, k)) merged[k] = props[k];
				}
				merged.__seat = "sidebar";
				merged.__tabInfo = tabInfo;
				return React.createElement(PanelBody, merged);
			}
			return BlenderViewportPane;
		}
		//#endregion

		//#region 右侧栏门控（契约 §7.3："启用才出现"）
		/**
		 * 取 `sidebarRightTabs` / `sidebarRight` 两个服务。
		 * 旧宿主没有它们 ⇒ `ok:false` ⇒ 走 §7.3.5 的 conversation.view 降级。
		 * 服务名出处：`dsh-client-ui-sidebar-right/lib/client.js:9114-9115`
		 * （`ctx.reflect.provide("sidebarRightTabs", tabs)` / `("sidebarRight", controller)`）。
		 */
		function sidebarRightServices(ctx) {
			var tabs = null;
			var right = null;
			try { tabs = ctx && typeof ctx.get === "function" ? ctx.get("sidebarRightTabs") : null; } catch (e) { tabs = null; }
			try { right = ctx && typeof ctx.get === "function" ? ctx.get("sidebarRight") : null; } catch (e) { right = null; }
			var ok = !!(tabs && typeof tabs.register === "function" && right && typeof right.openTab === "function");
			return { tabs: tabs, right: right, ok: ok };
		}

		/**
		 * 就绪门控状态机（`ready` 由调用方喂进来 ⇒ **可离线单测**，不必起定时器）。
		 *
		 * - `ready===true` 且未注册 → 两阶段注册（类型 + 主体）；
		 *   两个服务缺失 → 降级注册到 `conversation.view`（§7.3.5）
		 * - `false→true` 边沿 → `openTab(TAB_KIND)`，**每个会话只自动开一次**（§7.3.3）
		 * - `true→false` → `dispose()` 注销 + 关掉已开的本 kind 标签页（§7.3.4）
		 *
		 * @param ctx  cordis 客户端 ctx
		 * @param opts {{ paneBody: Function, fallbackRegister: (() => Function)|null }}
		 * @returns {{ applyReady:Function, dispose:Function, state:Function }}
		 */
		function createPaneGate(ctx, opts) {
			var registered = null;      // { mode, dispose } | null
			var mode = "idle";          // idle | sidebar | fallback
			var lastReady = null;
			var openedSessions = {};    // sessionId（或 "__no_session__"）→ 已自动开过

			function disposeAll(list) {
				for (var i = list.length - 1; i >= 0; i--) {
					try { list[i](); } catch (e) { /* 注销失败不阻断 */ }
				}
			}

			/** 当前在屏会话 id；读不到给 null（`openTab` 在没有会话时会 throw，先探再调）。 */
			function mountedSessionId() {
				try {
					var right = ctx && typeof ctx.get === "function" ? ctx.get("sidebarRight") : null;
					if (right && right.mounted && typeof right.mounted.getSnapshot === "function") {
						var sid = right.mounted.getSnapshot();
						return sid === undefined ? null : sid;
					}
				} catch (e) { /* ignore */ }
				return null;
			}

			/** 两阶段注册（契约 §7.3.2）；任一阶段失败都返回 null（调用方转降级）。 */
			function registerSidebar() {
				if (!sidebarRightServices(ctx).ok) return null;
				var disposers = [];
				try {
					// ① 类型：静态声明，无运行时钩子；返回 disposer。
					//    下面三处用**契约 §7.3.2 的冻结字面量**逐字写（id / kind / key / openTab 的 kind）——
					//    tests/client_bundle_selftest.mjs 对它们做静态断言；TAB_ID/TAB_KIND 必须与之保持一致。
					disposers.push(ctx.sidebarRightTabs.register({
						id: "@dsh-external/dsh-blender-plugin",
						kind: "blender-viewport",
						title: function () { return "Blender 视口"; },
						guide: [{ id: "viewport", title: "Blender 视口", description: "看 Blender 当前画面，点物体写进消息" }]
					}));
				} catch (e) {
					return null;
				}
				try {
					// ② 主体：等槽位声明（sidebar-right 在运行时声明 sidebar.right.pane.tab）
					//    槽位是 keyed ⇒ 必须给 key（= 类型定义的 id，契约 §7.3.2 冻结字面量）
					disposers.push(ctx.slots.inject("sidebar.right.pane.tab", function () {
						return ctx.slots.register({ name: "sidebar.right.pane.tab", key: "@dsh-external/dsh-blender-plugin" }, opts.paneBody);
					}));
				} catch (e) {
					disposeAll(disposers);
					return null;
				}
				return { mode: "sidebar", dispose: function () { disposeAll(disposers); } };
			}

			/** 自动开一次；同一会话只开一次（用户手动关掉后不反复弹，§7.3.3）。 */
			function openOnce() {
				var sid = mountedSessionId();
				var key = sid === null ? "__no_session__" : String(sid);
				if (openedSessions[key] === true) return false;
				openedSessions[key] = true;
				// 契约 §7.3.3 的冻结字面量（静态断言要求逐字出现；TAB_KIND 必须与之保持一致）
				try { ctx.sidebarRight.openTab("blender-viewport"); return true; } catch (e) { return false; }
			}

			/** 关掉本 kind 已开的标签页（否则注销类型后它们会显示"nothing can view this"）。 */
			function closeOurTabs() {
				var sid = mountedSessionId();
				if (sid === null) return;
				try {
					var right = ctx.sidebarRight;
					if (!right || typeof right.tabsIn !== "function" || typeof right.close !== "function") return;
					var list = right.tabsIn(sid) || [];
					for (var i = 0; i < list.length; i++) {
						var t = list[i];
						if (t && t.kind === TAB_KIND && t.id) {
							try { right.close(t.id); } catch (e) { /* ignore */ }
						}
					}
				} catch (e) { /* ignore */ }
			}

			function applyReady(ready) {
				var isReady = ready === true;
				var edge = lastReady !== isReady;
				lastReady = isReady;
				if (isReady) {
					if (!registered) {
						var r = registerSidebar();
						if (r) {
							registered = r;
							mode = "sidebar";
						} else if (typeof opts.fallbackRegister === "function") {
							registered = { mode: "fallback", dispose: opts.fallbackRegister() };
							mode = "fallback";
						}
					}
					if (edge) openOnce();
				} else {
					if (registered) { registered.dispose(); registered = null; }
					if (mode === "sidebar") closeOurTabs();
					mode = "idle";
				}
			}

			return {
				applyReady: applyReady,
				dispose: function () {
					if (registered) { registered.dispose(); registered = null; }
					mode = "idle";
				},
				state: function () {
					return { mode: mode, registered: !!registered, lastReady: lastReady, openedSessions: openedSessions };
				}
			};
		}
		//#endregion

		//#region 插件入口
		/**
		 * 备用通道：由框架解析出的 `sessionId` 反查会话作用域 ctx，
		 * 再取该会话的 `SessionInput`（有 `setDraft`/`addAttachments`/`notify`）。
		 *
		 * 出处（本机运行时）：`dsh-client-ui-conversation/lib/client.js:20515-20522`
		 * 的 QueueDock 同款写法 —— `const actx = ctx.sessions.scope(sessionId)` →
		 * `actx.get("conversation")` → `conversation.input.for(actx)`。
		 * `ctx.sessions.scope(id)` 签名见
		 * `dsh-api-session-controller/lib/types/client/sessions/service.d.ts:212`。
		 */
		function sessionFallback(ctx, sessionId) {
			var out = { blenderSessionId: sessionId, blenderInput: null };
			try {
				var sessions = serviceOf(ctx, "sessions");
				var actx = sessions && typeof sessions.scope === "function" ? sessions.scope(sessionId) : undefined;
				if (actx && typeof actx.get === "function") {
					var conversation = actx.get("conversation");
					if (conversation && conversation.input && typeof conversation.input.for === "function") {
						out.blenderInput = conversation.input.for(actx);
					}
				}
			} catch (e) {
				out.blenderInput = null;
			}
			return out;
		}

		/**
		 * cordis 插件入口。只 inject `slots`（面板必需，且是本机 coc-dice 验证过的写法）；
		 * `inputTriggers` 用 `ctx.inject([...])` **懒等**，避免"输入触发器没挂载 ⇒ 面板也一起消失"。
		 */
		function apply(ctx) {
			if (started) return;
			started = true;
			configuredBackend = resolveConfiguredBackend(ctx);

			var PanelBody = makePanelBody(ctx);
			var PaneBody = makeSidebarPane(PanelBody);

			// ① 就绪门控（§7.3）：轮询 GET /host/ready；ready===true 才注册右侧栏座位。
			//    旧宿主（无 sidebarRightTabs/sidebarRight）→ 降级到 conversation.view（§7.3.5）。
			ctx.effect(function () {
				var gate = createPaneGate(ctx, {
					paneBody: PaneBody,
					fallbackRegister: function () {
						// §2.3 降级座位：双参数正规写法 register(options, component)
						return ctx.slots.inject("conversation.view", function () {
							return ctx.slots.register({
								name: "conversation.view",
								id: FALLBACK_VIEW_ID,
								order: 40,
								label: function () { return "Blender 视口"; },
								inject: function (sessionId) { return sessionFallback(ctx, sessionId); }
							}, PanelBody);
						});
					}
				});
				var alive = true;
				var timer = 0;
				async function tick() {
					var body = await fetchReady();
					if (!alive) return;
					gate.applyReady(!!(body && body.ready === true));
					timer = window.setTimeout(tick, READY_POLL_MS);
				}
				tick();
				return function () {
					alive = false;
					if (timer) window.clearTimeout(timer);
					gate.dispose();
				};
			}, "@dsh-external/dsh-blender-plugin: /host/ready gate");

			// ② @ 提及源（契约 §2.5）。inputTriggers 服务名见
			//    dsh-client-ui-input-trigger/lib/client.js:1526
			ctx.inject(["inputTriggers"], function (scope) {
				var triggers = typeof scope.get === "function" ? scope.get("inputTriggers") : undefined;
				if (!triggers || typeof triggers.registerSource !== "function") return;
				scope.effect(function () {
					return triggers.registerSource({
						trigger: "@",
						name: "blender",
						candidates: function (session, req) { return sceneItemCandidates(req); },
						onPick: onPickItem,
						codec: blenderCodec
					});
				}, "@dsh-external/dsh-blender-plugin: @ blender scene items");
			});

			// ③ 卸载时复位守卫（便于热重载 / 重新 apply）
			ctx.effect(function () {
				return function () { started = false; };
			}, "@dsh-external/dsh-blender-plugin: reset apply guard");
		}

		var inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		// 仅供离线自检/探针断言纯函数（DSH 只读 apply/inject，未知导出无副作用）
		exports.__selftest = {
			DEFAULT_BACKEND: DEFAULT_BACKEND,
			LS_BACKEND_KEY: LS_BACKEND_KEY,
			POLL_IDLE_MS: POLL_IDLE_MS,
			POLL_STALE_MS: POLL_STALE_MS,
			AUTO_CAPTURE_MIN_INTERVAL_MS: AUTO_CAPTURE_MIN_INTERVAL_MS,
			AUTO_CAPTURE_MAX_STUCK: AUTO_CAPTURE_MAX_STUCK,
			AUTO_CAPTURE_MAX_SIZE: AUTO_CAPTURE_MAX_SIZE,
			autoCaptureDecision: autoCaptureDecision,
			isDocumentHidden: isDocumentHidden,
			messageText: messageText,
			splitRef: splitRef,
			onPickItem: onPickItem,
			blenderCodec: blenderCodec,
			normalizeView: normalizeView,
			sceneItemCandidates: sceneItemCandidates,
			pickErrorText: pickErrorText,
			addFrameToDraft: addFrameToDraft,
			stripTrailingSlashes: stripTrailingSlashes,
			clamp01: clamp01,
			makeViewportPanel: makePanelBody,
			// v1.2（§7.3 / §7.4）
			READY_POLL_MS: READY_POLL_MS,
			PICK_POLL_MS: PICK_POLL_MS,
			PICK_DONE_MS: PICK_DONE_MS,
			TAB_ID: TAB_ID,
			TAB_KIND: TAB_KIND,
			FALLBACK_VIEW_ID: FALLBACK_VIEW_ID,
			answerOutcome: answerOutcome,
			createPaneGate: createPaneGate,
			sidebarRightServices: sidebarRightServices,
			makePanelBody: makePanelBody,
			makeSidebarPane: makeSidebarPane
		};
		return module.exports;
	}
});

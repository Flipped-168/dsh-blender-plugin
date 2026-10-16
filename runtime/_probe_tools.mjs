import { AddonClient, GATE_FLAGS } from './engine.mjs';
const a = new AddonClient();
const out = {};
const tryCall = async (name, params = {}, timeout = 20000) => {
  const t0 = Date.now();
  try {
    const r = await a.send(name, params, timeout);
    out[name] = { ok: true, ms: Date.now() - t0, r: JSON.stringify(r).slice(0, 150) };
  } catch (e) {
    out[name] = { ok: false, ms: Date.now() - t0, err: String(e && e.message || e).slice(0, 110) };
  }
};
await tryCall('ping');
await tryCall('get_addon_info');
await tryCall('get_scene_info', {});
await tryCall('get_world_state_snapshot', {});
await tryCall('get_object_info', { name: 'Cube' });
await tryCall('get_telemetry_consent');
await tryCall('get_polyhaven_status');
await tryCall('get_hyper3d_status');
await tryCall('get_sketchfab_status');
await tryCall('get_polypizza_status');
await tryCall('get_hunyuan3d_status');
await tryCall('get_polyhaven_categories', { asset_type: 'hdris' }, 25000);
// 5 个集成开关：**双名探测**（先新名 dshbb_use_*，取不到回退旧名 blendermcp_use_*）——
// 与 engine.mjs 的 FLAGS_CODE 同口径；回执键用新名。
const LEGACY_GATE_FLAGS = GATE_FLAGS.map((n) => n.replace(/^dshbb_/, 'blendermcp_'));
const code = [
  'import bpy, json',
  's = bpy.context.scene',
  'names = ' + JSON.stringify(GATE_FLAGS),
  'legacy = ' + JSON.stringify(LEGACY_GATE_FLAGS),
  'out = {}',
  'for i, n in enumerate(names):',
  '    v = getattr(s, n, None)',
  '    if v is None:',
  '        v = getattr(s, legacy[i], None)   # 旧 addon 回退（改名前的版本）',
  '    out[n] = v',
  'print(json.dumps(out))',
].join('\n');
await tryCall('execute_code', { code });
console.log(JSON.stringify(out, null, 1));
a.close();

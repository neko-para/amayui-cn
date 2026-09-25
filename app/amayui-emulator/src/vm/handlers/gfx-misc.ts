/**
 * 图形子系统的「其余」：灯光 / Live2D 槽 / movie 槽 / 网格槽表 / 渲染状态 / 帧刷新配置。
 *
 * 这些在 emulator 里没有对应的可视模型（无 3D 灯光、无 Live2D、无影片），
 * 但仍按引擎语义**读写 emulator 侧的槽表与渲染配置**，所以不算 no-op 插桩。
 */
import type { OpHandler, StepCtx } from '../step.js';
import { readIntOperand } from '../operand.js';
import { operandsFor, type PlannedOperands } from '../operandPlan.js';
import { cfgInt } from '../../engineConfig.js';
import { CFG } from '../../configRegistry.js';
import type { OpTable } from './shared.js';

/**
 * 取本族的**操作数计划视图**（`tickets/T-0082` 批次：图形杂项族（gfx-misc），6 条）；缺计划 = 编程错误。
 */
function planFor(c: StepCtx): PlannedOperands {
  const p = operandsFor(c);
  if (!p) throw new Error(`0x${c.instr.opcode.toString(16)}：图形杂项族（gfx-misc）走操作数计划层，但没有声明计划`);
  return p;
}

// ---------------------------------------------------------------------------
// 本族用到的引擎字段（`_this[K]`，一律 dword 下标）
// ---------------------------------------------------------------------------

/**
 * **`_this[675972] = 168993`**：引擎的「**有影片在放**」标志（raw 31668 的写点）。
 *
 * 读者是**主循环第 20660 行**那一整块影片泵：`if (_this[675972]) { …1000 槽逐槽
 * sub_488550/推进/到期析构… }`（raw 20660-20738），末尾把每一位活着的槽重新聚合成该标志
 * （raw 20687-20694），并在 `effect_flags` 上维护 `0x2000`（raw 20810 清 / 20941 置）。
 * emulator **没有影片泵**（无影片解码器）⇒ 本票只把「引擎写过的这一格」如实落到字段面，
 * 泵本身的缺失写在 `tickets/T-0164/changes-c164.md`。
 */
const ENGINE_FIELD_MOVIE_PLAYING = 168993;

/**
 * `sub_4054D0(_this, a2)`（raw 11107-11118）：**把 op3 解码成「模式 0..3」**。
 *
 * 先按位（0x10000→0 / 0x20000→1 / 0x40000→2 / 0x80000→3，**按从低到高第一个命中的位**），
 * 四位都不置时取配置 `set:DependMovieSound` 的**原值**（⇒ 该配置是 0..3 的枚举，不是开关）。
 */
function decodeMovieMode(c: StepCtx, op3: number): number {
  if ((op3 & 0x10000) !== 0) return 0;
  if ((op3 & 0x20000) !== 0) return 1;
  if ((op3 & 0x40000) !== 0) return 2;
  if ((op3 & 0x80000) !== 0) return 3;
  return c.e.config ? cfgInt(c.e.config, CFG.setDependMovie, 0) : 0;
}

/**
 * `sub_405460(_this, 模式)`（raw 11081-11104）：**模式 → 「该音源配置可用」的 BOOL**。
 *
 * | 模式 | 体 | 判据 |
 * |---|---|---|
 * | 1 | raw 11090 | `GetConfig(sound:Music) >= 0`（★是 `>= 0`，**不是** `!= 0`） |
 * | 2 | raw 11092/11103 | `GetConfig(sound:SE) != 0` |
 * | 3 | raw 11095/11103 | `GetConfig(sound:Voice) != 0` |
 * | 4 | raw 11098/11103 | `GetConfig(sound:Movie) != 0` |
 * | 0/其它 | raw 11100 | 恒 **0**（`result = 0` 初始化后直接 `return result`） |
 *
 * ⇒ 这个 BOOL 进 `CMovieToTexture+1144`（raw 31658）并决定 `sub_4879E0` 挂哪个音轨
 * （raw 31659-31662）。emulator 没有影片音轨 ⇒ 它只作为宿主缝的**第 3 实参**可见。
 */
function movieAudioGate(c: StepCtx, mode: number): number {
  const cfg = c.e.config;
  const get = (key: string): number => (cfg ? cfgInt(cfg, key, 0) : 0);
  switch (mode) {
    case 1:
      return get(CFG.soundMusic) >= 0 ? 1 : 0;
    case 2:
      return get(CFG.soundSE) !== 0 ? 1 : 0;
    case 3:
      return get(CFG.soundVoice) !== 0 ? 1 : 0;
    case 4:
      return get(CFG.soundMovie) !== 0 ? 1 : 0;
    default:
      return 0;
  }
}


/**
 * **`0x32F`（sub_4272B0, raw 34117 → `sub_49A150` raw 116741-116748）：D3D 灯光开关**。
 *
 * `sub_49A150` 全文只有两行：
 * ```c
 * _this[a2 + 13677] = 0;                                  // ★enabled 位（Scene[54708+idx]，连续 word 下标）
 * (**(_DWORD **)(_this[465] + 1040) + 212)(…, a2, 0);     //  设备 vtable+212 = LightEnable(idx, FALSE)
 * ```
 * 两张表分工（★`T-0164` 读体订正旧注释的"数组形状"）：
 *  - **enabled 位** = `Scene[13677+idx]`（word 下标，`54708 = 13677*4`）—— 重放循环 raw 122110-122122
 *    读的**就是这一张**（`v10 = v1 + 13677`，逐 `++v10`）；
 *  - **灯光记录** = `sub_49A080` 填的 0x68 字节 `D3DLIGHT9`，在重放里是 `v9 = v1 + 13687` 且
 *    每轮 `v9 += 26`（26 dword = 104 = 0x68）⇒ 与 enabled 位**不是同一张表**。
 *
 * 消费者 = **设备重建重放**（raw 122112-122118）——emulator 没有 D3D 设备/灯光模型。
 * ⇒ 本票**不**把这两格写进 `engineValues`：那只会造出"写了但没人读"的假象，把它洗成"已实现"
 * （同族先例 `0x248` 的 `-248` 是**有据**的专用全局槽，不是这一形状）。宿主缝保留。
 */
const op_light_enable: OpHandler = (c) => {
  const plan = planFor(c);
  const idx = (plan.int(1) ?? 0);
  c.native.setLight?.(idx, false);
};

/**
 * `0x23D`（sub_41A300, raw 25320-25347）：**销毁 movie/纹理槽 42..999**（958 次循环）。
 *
 * 体逐字（raw 25327-25346）：
 * ```c
 * v1 = 42;  v2 = _this + 80708;  v3 = _this + 94714;   // ← 94714 = 378688/4
 * do {
 *   if ( *v3 ) { sub_488FB0(*v3); (**v3)(*v3, 1); *v3 = 0; }   // ① 影片对象析构 + 表项置 0
 *   result = sub_49E980(v2, v1++);                             // ② Scene 侧卸槽（槽→imgid = −1
 * } while ( v1 < 1000 );                                       //    + CTexture 表面析构，raw 119586）
 * ```
 * ★**起点是 42、上界是 `< 1000`**：槽 0..41（含 ADV 窗用的那批）与槽 1000 都不在区间内。
 * ★与 `0x259`（只清记录表、不 delete）**不是同一件事**：这一条真的析构对象并解绑槽→imgid
 * ⇒ 引用这些槽的图元此后取不到纹理（`tickets/T-0102` 的 H3 正是"清错了这条"造成的白块）。
 *
 * ★`T-0164`：宿主缝 `releaseMovieSlots` 此前**两个宿主都没实现**（只落进 DropRecorder 的
 * 「意图被丢弃」）⇒ 958 个槽的绑定与对象全部留存。现已在 `HeadlessScene`/`PixiBackend` 落地。
 */
const op_release_movie_slots: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.releaseMovieSlots?.();
};

/**
 * `0x32B`（sub_41A4A0, raw 25411）：**清 D3DX 网格层级槽表**（Scene+50708 区，1000 槽）。
 * 引擎经 `sub_4A0750 → sub_479A50` + delete 逐项释放（与 0x23D、0x259 都不同族）。
 */
const op_clear_mesh_slots: OpHandler = (c) => {
  const plan = planFor(c);
  c.native.clearMeshSlots?.();
};

/** `0x248`（sub_4252E0, raw 32705）：`dword_55052C = op1`（渲染配置全局）。 */
const op_set_render_cfg_248: OpHandler = (c) => {
  const plan = planFor(c);
  const v = (plan.int(1) ?? 0);
  c.e.engineValues.set(-248, v); // 负键：专用全局槽（非 _this 字段），避免与引擎字段号冲突
};

/**
 * **`0x259`（sub_41A3A0, raw 25357）：复位「每槽记录的标志两位」**（主/影两张镜像表，1000 槽全覆盖）。
 *
 * 引擎体逐位（raw 25357-25374）：
 * ```c
 * result = _this + 86176;              // Engine+344704 = 影表记录的 [+8]
 * v2 = 1000;
 * do {
 *   *(result - 5000) = 0;   // Engine+324704 = Scene+0x750 = tex_slot_flag_a（0x258 的 bit0 位）
 *   *result = 0;            // Engine+344704 = 影表同一格
 *   *(result - 4999) = 0;   // Engine+324708 = Scene+0x754 = tex_slot_flag_b（0x258 的 bit1 位）
 *   result[1] = 0;          // Engine+344708 = 影表同一格
 *   result += 5;            // 步长 5 dword = 20 B/槽
 *   --v2;
 * } while ( v2 );
 * ```
 * `Scene+20*slot` 的 dword 468/469 正是 `0x258`（`sub_425D20` raw 33156-33185）按 op2 的
 * bit0/bit1 写的那两格（`fields.json` 的 `Scene/0x750`/`Scene/0x754`）。
 * ⇒ **`0x259` 是 `0x258` 的整表复位器**：它**不碰** imgid（`Scene/0x748`，`0x1F9` 写）
 * 、也不碰槽对象（`Scene+4*slot+42456`）。旧注"清**前两个** dword / 清 imgid"是**错的**
 * （`tickets/T-0102` 订正：那条口径让 emulator 抹掉了槽 17 的绑定 ⇒ ADV 窗口回落 1×1 白占位块）。
 * 真正销毁 42..999 槽对象的是 `0x23D`。
 */
const op_clear_slot_records: OpHandler = (c) => {
  const plan = planFor(c);
  c.e.texSlotFlags.clear(); // 引擎清的就是「按槽设置的标志两位」（0x258 写入、此处整表归零）
  c.native.clearSlotRecords?.();
};

/**
 * **`0x340`（sub_427B60 → `sub_49A2D0`, raw 34457）：渲染状态下发**。
 *
 * 体（raw 116869-116876）：
 * ```c
 * v2 = _this[465];
 * _this[13948] = a2;                              // ★状态槽 —— 设备重建时被重放
 * (**(_DWORD **)(v2 + 1040) + 228)(…, 22, a2);    //   设备 vtable+228：状态 #22
 * ```
 * ★消费者 = **设备重建重放**（raw 122124 的 `(vtable+228)(v3, 22, v1[13948])`）—— 那一段是
 * D3D 设备重建函数，emulator **没有 D3D 设备**（2D 重写）⇒ `Scene[13948]` 这一格在重写侧
 * **写下去不会有活消费者**。而它又是 `Scene` 的字段（`sub_49A2D0` 收的是 `_this + 80708`），
 * 与 `engineValues`（`Engine._this[K]` 的字段面）**不是同一张表**。
 * ⇒ `T-0164` **不**发明一个写了没人读的槽（那正是"把缺口洗成已实现"），只保留唯一能到达
 * 设备侧的宿主缝；「状态槽 + 重放」这条能力缺口如实登记（见 `tickets/T-0164/changes-c164.md`）。
 */
const op_set_render_state: OpHandler = (c) => {
  const plan = planFor(c);
  const v = (plan.int(1) ?? 0);
  c.native.setRenderState?.(22, v);
};

/**
 * **`0x20F` play-movie**（`sub_4237B0` raw 31605-31670，arity 槽 = 7 ⇒ argc 3）：
 * `op1` = 影片资源 id、`op2` = 影片槽、`op3` = **音量/模式选择子**（位解码，见下）。
 *
 * 体逐字：
 * ```c
 * v2 = op2;
 * if ( !_this[4*v2 + 378688] ) {                 // ① 惰性建槽对象（CMovieToTexture，0x480 字节）
 *   obj = sub_489040(operator new(0x480));
 *   _this[4*v2 + 378688] = obj;
 *   if ( !sub_488DC0(obj, hwnd, 视频表, sub_454FA0(op1)) )
 *     _CxxThrowException(asc_51F560);            //    ★装载失败 ⇒ 抛（"ムービーの初期化に失敗…"）
 * }
 * if ( !_this[4*v2 + 365288] )
 *   _CxxThrowException(asc_520248);              // ② ★该槽没有 CTexture ⇒ 抛（"テクスチャが…"）
 * sub_489230(obj, …);                            // ③ 起播
 * v9 = op3; v10 = sub_4054D0(_this, v9);         // ④ ★op3 先按位解码成模式 0..3
 * *(_DWORD *)(obj + 1144) = sub_405460(_this, v10);   // ⑤ 模式 → 音源 BOOL
 * sub_4885A0(obj, Engine[5008] * sub_408350(op3) / 10000);   // ⑥ 音量
 * sub_4883A0(obj, op3);                          // ⑦
 * _this[699204] |= 0x2000u;                      // ⑧ ★影片位
 * _this[675972] = 1;                             // ⑨ ★"有影片在放"（主循环 20660 的门）
 * ```
 * ★`T-0164` 修的三处缺口：⑧⑨ 两格**此前一格都不写**（⇒ 帧循环的电影门恒 0、
 * `0x1BA` 系的 `applyDependentMovie` 外层门恒不成立）；④⑤ 的 `op3` 此前原值直传宿主
 * （引擎给它的是 **BOOL**，不是选择子原值）；② 的"槽纹理为空"错误路径此前不存在。
 */
const op_play_movie: OpHandler = (c) => {
  const p = operandsFor(c);
  if (!p) return;
  const id = p.int(1) ?? 0;
  const slot = p.int(2) ?? 0;
  const op3 = p.int(3) ?? 0;
  // ★raw 31645-31650：该槽没有 CTexture 对象 ⇒ `_CxxThrowException(asc_520248)`，
  //   直接离开本条指令（⇒ 下面的置位一个都不发生 —— 守卫 `t0164-misc-batch.test.ts` 钉了这一点）。
  //   ★宿主**可能不建模这张表**（`hasSlotTexture` 返回 `undefined`）⇒ 那时**不**抛：与修前同行为，
  //     缺口由闸门 A 的"意图被丢弃"留痕，而不是让一条真实语料指令硬停。
  const hasTex = c.native.hasSlotTexture?.(slot);
  if (hasTex === false) {
    throw new Error(
      'ムービーの初期化に失敗しました．\r\nテクスチャが確保されていません．（0x20F：该槽没有 0x1F8 create-texture 建出来的 CTexture 对象，引擎在 raw 31645-31650 抛 asc_520248）',
    );
  }
  const mode = decodeMovieMode(c, op3); // ★raw 31655：`sub_4054D0(_this, op3)`
  const gate = movieAudioGate(c, mode); // ★raw 31656：`sub_405460(_this, 模式)` ⇒ BOOL
  c.native.playMovie?.(id, slot, gate);
  c.e.effectFlags |= 0x2000; // ★raw 31667：`_this[699204] |= 0x2000u`（`|=` 不是赋值）
  c.e.engineValues.set(ENGINE_FIELD_MOVIE_PLAYING, 1); // ★raw 31668：`_this[675972] = 1`
};

/** 图形子系统的槽表/渲染配置（真实现）。 */
export const GFX_MISC_OPS: OpTable = [
  [0x23d, op_release_movie_slots], // 销毁 movie/纹理槽 42..999
  [0x32b, op_clear_mesh_slots], // 清 D3DX 网格层级槽表
  [0x259, op_clear_slot_records], // 清两张 1000×2 记录表（不 delete）
  [0x248, op_set_render_cfg_248], // dword_55052C = op1（渲染配置全局）
  [0x32f, op_light_enable], // D3D 灯光开关（LightEnable）
  [0x340, op_set_render_state], // 渲染状态下发（设备 vtable+228）
  // ★`0x342`/`0x352` **已移出本表**（2026-09）：它们属 Live2D 族（`handlers/live2d.ts` 的 `LIVE2D_OPS`）。
  //   留在这里时虽然被后注册的 `LIVE2D_OPS` 覆盖（`handlers/index.ts` 的顺序），但两个只调**没人实现**的
  //   宿主缝的"影子 handler"会让**闸门 A** 报假缺口（实测：控制窗显示 `destroyL2DSlot`/`l2dSlotSet` 未实现）。
];

/** 图形子系统的 native 转发。 */
export const GFX_MISC_NATIVE_OPS: OpTable = [
  [0x20f, op_play_movie], // → native.playMovie
];


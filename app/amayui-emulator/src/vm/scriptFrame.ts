/**
 * **把一个解析好的脚本装入某个帧**（`tickets/T-0089` 从 `handlers/control.ts` 搬出来的**叶子模块**）。
 *
 * 为什么单独成文件（而不是留在 handlers 里）：`handlers/save-slot.ts` 需要它，而 save-slot 又被
 * `handlers/index.ts` **顶层展开**（`...SAVE_SLOT_OPS`）⇒ 若 save-slot 从 `../ops.js`（桶文件 → index）
 * 取它，就形成 `save-slot → ops → index → save-slot` 的环，**先** import save-slot 的模块图会踩 TDZ
 * （`Cannot access 'SAVE_SLOT_OPS' before initialization`，见 `test/save-slot-tdz.test.ts` 的修前证据）。
 * 本模块只依赖 `script/bin.js` 与 `vm/engine.js` 的**类型** —— 没有任何回边（更不 import handlers/）。
 */
import type { Frame } from './engine.js';
import type { ScriptBinary } from '../script/bin.js';

/**
 * 把解析好的脚本装入一个帧（建立 labelMap + **重建局部池** + 写**脚本身份 token**）。
 *
 * ★★**一次载入 = 一次新调用**：引擎 `sub_40ED40`（loadScriptFrame）读脚本后**建局部池
 * 并把 `local_int` 填 `enc_zero`** ⇒ 启动、`call-script`(0x3)、`load-frame`(0x6)、
 * `exit-script` 后重载根脚本，每一次都看不见上一次的局部量。
 *
 * 漏掉这一步的症状（2026 实测）：**帧槽会被复用** —— 最典型是脚本自己 `exit` 之后又被调用方
 * `call-script` 调回来（`CONFIG1` 的"切左侧分类"就是这么实现的：置 `7dd=1` → 退出脚本 →
 * CONFIG.BIN 重新调用）。此时上一次调用的局部量会泄漏进新一次调用：
 * ```
 * 上一页滚到底 ⇒ local5620(滚动起点)=6
 * 新一页 12 项 ⇒ local5624(最大起点)=3
 * 拇指顶 3f6 = 106 + (428 − 拇指高)·5620/5624 → 320   ← 轨道只有 106..534 ⇒ 拇指溢出轨道
 * ```
 * 全局池（`Engine.globals.*`）**不在此列**：那是跨脚本状态（"上次选的分类" `12721e` 就在里面，
 * 所以切完分类高亮才记得住）。
 *
 * ★**`scriptId`**：引擎同一处还写 `frames[cur][95796] = a4`（raw 18636）＝**打开该脚本用的统一文件 id**，
 * 它就是 `sub_4083B0` / `0xCD` 的脚本身份守卫要比对的那个 token（见 `Engine.guardScriptIdentity`）。
 * 没传（测试里手搓的帧）时为 -1 ⇒ 守卫跳过（引擎里 -1 也是"未注册"的初值）。
 *
 * 注意 `call-frame`(0x8) 跑的是**已预装**的固定帧、不再走本函数 ⇒ 固定帧被反复调用时局部量照旧保留
 * （与引擎一致：`sub_41C900` 不重建池）。
 */
export function loadScriptIntoFrame(
  frame: Frame,
  script: ScriptBinary,
  name?: string,
  scriptId = -1,
): void {
  frame.script = script;
  frame.name = name ?? script.signature;
  frame.ip = 0;
  frame.retStack = [];
  frame.labelMap.clear();
  for (let i = 0; i < script.instructions.length; i++) {
    frame.labelMap.set(script.instructions[i]!.index, i);
  }
  frame.locals.clear(); // ★ 重建局部池（见上方说明）
  frame.strTable = [];
  frame.arrayContainer.clear();
  frame.frameArg = 0;
  frame.scriptId = scriptId; // ★脚本身份 token（引擎 frames[cur][95796]，raw 18636）
}

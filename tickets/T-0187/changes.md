# T-0187 · 过程文档（changes.md）

## 2026-09-26

第二轮（复核订正）：新增 recheck.md —— ① 的「无条件武装」推翻（外门 bit27 raw 28540 + 内门 bit30 raw 28549 + 粘滞 Engine[489984]）、sub_4051A0 实为 5 个调用点、Engine[107706] 只写不读；「真机悬停不影响 ▼」的冲突消解（SN0000 悬停 label 把路由表换成屏幕外 ENTER/LEAVE=ffffffff 的条目）；② 订正 adcd/14acda 角色与 池外 推导链，新增机制候选（72B 记录回写 Font+1360，raw 76940-76962）；emulator 结构偏离登记待改（武装应在 (ADV_ACTIVE)===0 支内）。落库：capabilities/scripts/opcodes 三处 + 生成物重建，4 个守卫全绿。

## 2026-09-26

第三轮（真机采样定案）：用户用新采样面（inspector CLI 定位 this + 只读 250ms 采样器）做了两轮真机采样。① 收口 —— 悬停会派发脚本但不清 bit30、不重启节拍、不重置格号（tickNow/tickBase 只在切场武装点回落；cellK 相位 60s 连续）；模拟器悬停段调 finishCharReveal() 是偏差。② 侧证 —— 真机池容量 Engine+382952 = 0x708ADC = 7,375,836 ≫ 存档前缀 1,015,792 ⇒ 装载 memset 清零前缀之外 ⇒ 两条入口必然一致（推翻 T-0071 注释前提）；Font+1360 在 SC0000 阿瓦罗台词 = 0000E1FF(=swap FFE100) 黄，SN0000 旁白期保持白 ⇒ 与「正文色来自记录」一致。原始日志归档 evidence/cellk-samples.zip，digest 落 recheck.md 5.10。

## 2026-09-26

第四轮（落地 ② 的修法）：handlers/save-slot.ts 的 restoreEngineSlot 改为 e.globals.int.clear() 后写回文件非零值（= 引擎 memset 整池清零 + memcpy 前缀；float/string 原本就是 clear()）；旧注释按实测订正但保留原串（T-0071 的锚点）；test/slot-load-resume.test.ts 的「池外保留」断言改为「池外也必须为 0」。typecheck 干净；slot-load-resume 5/5、save-slot 10/10、engine-slot 9/9、slot-load-transfer 3/3、slot-load-screen 3/3、save-slot-chain 1/1 全绿；dist/renderer/renderer.js 与 dist/web/renderer.js 用 esbuild CLI 重建。capabilities 的 save-slot-chain note 补一段（池容量 vs 文件前缀 + 实测 7,375,836）；T-0071 evidence[1].note 订正 + changes.md 记录。

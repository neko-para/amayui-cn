# T-0097 ①②③ 证据与改动（IMPLEMENTATION 子代理留档）

> 作者：T-0097 ①②③ 的子代理；`④`（`analysis/fields.json` 的 Engine/0x408 scope）**未碰**。
> 本目录只是中间产物；要归档请由主 agent 拷进 `tickets/T-0097/evidence/`。

## ① `0x2EE` = `sub_426650`（raw 33590-33603）——体除字段外还写 `SetConfig`

```
33590: //----- (00426650) --------------------------------------------------------
33591: int __thiscall sub_426650(_DWORD *_this)
33592: {
33597:   _this[30 * _this[95776] + 95805] = 3;                                        // arity 槽 ⇒ argc 1
33598:   v2 = sub_41BF50(_this, 1);                                                   // op1
33599:   v3 = _this[174405];                                                          // 配置对象（_this+697620）
33600:   _this[80106] = v2;                                                           // ★Font+235128 = 消息淡入 ms
33601:   v4 = sub_41BF50(_this, 1);                                                   // ★同一个操作数再读一次
33602:   return (*(int (__thiscall **)(_DWORD *, char *, int))(v3 + 12))(_this + 174405, aMessageMessage_0, v4);
33603: }
```
- 两次读取的实参都是 `1`（同一操作数），清单：
  - `.text:0042666D  push 1  ; pExceptionObject`（`engine/天结_unpacked.exe_utf8.lst` 61030）
  - `.text:0042667C  push 1  ; pExceptionObject`（同上 61034）
  - `.text:0042668F  push offset aMessageMessage_0 ; "message:MessageFade"`（同上 61040）
- `char aMessageMessage_0[20] = "message:MessageFade"; // weak`（raw **4380**）
- opcode 归属：`.text:00417028  mov dword ptr [esi+0A5C54h], offset sub_426650`，同表邻位
  `.text:00416FF6 [0A5C40h] = sub_426620`(=0x2E9)、`.text:0041701E [0A5C50h] = sub_431230`(=0x2ED)、
  `.text:00416FE2 [0A5C38h] = sub_426540`(=0x2E7) ⇒ **0x2EE**。
- **读侧**：`0x2ED` = `sub_431230`（raw 40401-40409）`op1 = GetConfig("message:MessageFade")`。
  emulator 未注册 0x2ED（`docs-new/03-engine/opcode-table.md:491` 记「仅映射」）⇒ 本次只补写侧。

改动：`app/amayui-emulator/src/vm/handlers/engine-fields.ts`
- `ENGINE_FIELD_STORE` 删掉 `[0x2ee, { map: { 1: ENGINE_FIELD.messageFade } }, // 消息淡入]`（原第 116 行）；
- 新增 `op_set_message_fade`（读一次 op1 → `engineValues.set(80106, v)` + `setConfigValue(c.e, CFG.messageMessageFade, v)`）；
- 注册表 `[0x2ee, op_set_message_fade]`（原 `[0x2ee, op_engine_field_store]`）。

## ② `0x141`（raw 30999-31017）与位指令族（`0x135` raw 39401-39421）

```
30999: //----- (004228C0) --------------------------------------------------------
31000: void __thiscall sub_4228C0(int _this)
31005:   *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 3;
31006:   if ( (unsigned int)sub_41BF50((_DWORD *)_this, 1) > 0x10 )      // ★unsigned
31008:     sub_408050((char *)(_this + 8), 1024, aGetmeswina);
31009:     sub_4034D0((void **)_this, (const char *)(_this + 8));        // 打印（返回 void，不抛）
31013:     v2 = *(_DWORD *)(_this + 697620);
31014:     v3 = sub_41BF50((_DWORD *)_this, 1);
31015:     (*(void (__thiscall **)(int, char *, int))(v2 + 12))(_this + 697620, aMessageMeswina, v3);
31017: }
```
```
39401: //----- (0042F8B0) --------------------------------------------------------
39402: void __thiscall sub_42F8B0(int _this)                    // = 0x135
39404:   unsigned int v2; // eax                                 // ★unsigned
39408:   *(_DWORD *)(_this + 120 * *(_DWORD *)(_this + 383104) + 383220) = 5;   // argc 2
39409:   v2 = sub_41BF50((_DWORD *)_this, 2);                    // 位号 = op2
39410:   v3 = v2;
39411:   if ( v2 > 0x1F )                                        // ★unsigned 比较
39413:     sub_408050((char *)(_this + 8), 1024, aSetbit);
39414:     sub_4034D0((void **)_this, (const char *)(_this + 8)); // 打印后**继续**，不写 op1
39418:     v4 = sub_41BF50((_DWORD *)_this, 1);
39419:     sub_42B4B0(_this, 1, (1 << v3) | v4);
```
- `char aSetbit[] = "SetBitの引数が不正です．\r\n"; // idb`（raw 4445）；同族 `aRembit`（raw 4446）。
- 同形邻居（一并按同一判据统一）：
  - `0x136` = `sub_42F920` raw 39423-39443（`aRembit`；raw 39441 `~(1 << v3) & v4`）
  - `0x13F` = `sub_42FB40` raw 39548-39568（`aGetbit`；位号是 **op3**，raw 39566 `((1 << v3) & v4) != 0`）
- **反面对照（真的抛异常的族）**：`0x107` `sub_421C10` raw 30421-30441、`0xFE` `sub_421CA0` raw 30443-30459、
  `0x10B` `sub_4220B0` raw 30616-30634 都是 `_CxxThrowException(pExceptionObject, &_TI1_AVCommand_ShowMessage_Exception__)`。

改动：`app/amayui-emulator/src/vm/handlers/arithmetic.ts`
- 新增 `bitIndexGate(c, operand, mnemonic)`：`(v >>> 0) > 0x1f` ⇒ `c.log(...)` + `null`（不写 op1、**不抛**）；
- `op_bit_set`/`op_bit_reset`/`op_check_bit` 三条共用它（删掉三条 `throw new Error('bit-set: bit … > 31')` 之类）。
- `engine-fields.ts` 的 `op_set_meswin_alpha` 改 `(v >>> 0) > 0x10` + `c.log` + return。

## ③ 未写过的 int 槽 = `enc_zero` ⇒ 读 0（判据三处 raw 体）

```
18773:     if ( *(_DWORD *)(v15 + 383132) + 1 > 0 )                        // loadScriptFrame_40ED40：local_int
18775:       do
18777:         *(_DWORD *)(*(_DWORD *)(v15 + 383156) + 4 * v14++) = *(_DWORD *)(a1 + 388240);
18780:       while ( v14 < *(_DWORD *)(v15 + 383132) + 1 );
...
22328:       for ( i = 0; i < *(_DWORD *)(_this + 382952) + v53 + 1; ++i )   // Engine 构造/preload：pool_int
22329:         *(_DWORD *)(*(_DWORD *)(v52 - 16) + 4 * i) = *(_DWORD *)(_this + 388240);
...
35218:       for ( j = 0; j < *(_DWORD *)(_this + 382952) + 1; ++j )         // 全量 teardown（0x9）：pool_int
35219:         *(_DWORD *)(*(_DWORD *)(v8 - 8) + 4 * j) = *(_DWORD *)(_this + 388240);
...
42524:   do                                                               // 0x2C9 sub_4344A0：扩容新元素
42527:     v13 = *((_DWORD *)_this + 97059);
42528:     v16 = (char *)__ROL4__(v13 ^ __ROR4__(0, 7), 21);              // = ENC(0)
42531:     *(_DWORD *)(*v6 + 4 * v7++) = v16;
...
24240:   return v2 && v2() || !_this[97059] || __ROL4__(_this[97060], 11) != _this[97059];   // 密钥自检
```
- `analysis/fields.json:57`：`{"offset":"0x5EC90","type":"uint32_t","name":"enc_zero","scope":"Engine","meaning":"ENC(0) 常量槽 (this[97060])","evidence":"members.cpp 388240；loadScriptFrame 填 local_int 用","status":"confirmed"}`
- 帧字段锚点：`local_int` 基址 = `frames[cur]+383156`（= `_this[30*cur + 95789]`，`sub_41BF50` case 9）；全局 int 池 = `_this[95744]`（构造处 `v4-8 = 382984-8 = 382976`）。
- `handlers/save-slot.ts:186,197`：装 int 池时**只装非零项**（注释「只装非零项（读侧缺省即 0）」）⇒ 修前每个"存档里是 0 的全局量"都读成 `dec(key,0)` 垃圾。

**取舍：改全局（`readIntOperand`/`readRef`），删掉本地 `hasRefValue` 读绕法**（`0x12E`）。
单一实现 = `src/vm/ref.ts` 的 `decIntSlot(key, raw)`（`raw === undefined ? 0 : i32(dec(key, raw))`）。

## 改动清单（只动 app/amayui-emulator 下的 src/test）

| 文件 | 改动 |
|---|---|
| `src/vm/ref.ts` | 新增 `decIntSlot`（判据长注释）；`readRef` 的 int 分支改走它；`hasRefValue` 文档改成"只剩写侧用" |
| `src/vm/operand.ts` | int 四路（global/local/global-array/local-array）改走 `decIntSlot`；import 去掉 `dec`/`i32` |
| `src/vm/handlers/input.ts` | `0x12E` 的 `rd` 改直接 `readRef`；去掉 `hasRefValue` import；注释改成指向全局口径 |
| `src/vm/handlers/region-hittest.ts` | 并行 agent 新建的文件里 `readSlot` 也照抄了本地绕法 ⇒ 同批收口成 `readRef`（**行为逐位等价**，已申报） |
| `src/vm/handlers/engine-fields.ts` | ① `op_set_message_fade`；② `0x141` unsigned + 错误串（日志）分支 |
| `src/vm/handlers/arithmetic.ts` | ② `bitIndexGate` 三条位指令共用（unsigned + 错误串不抛） |
| `test/op-1cb-2c8-2c9.test.ts` | 改写了那条**断言旧错法**的测试（标题与断言原文见报告 §4） |
| `test/op-2ee-message-fade.test.ts` | 新增（① 守卫：字段 + 注册表 + 写后读回 + 落盘通知） |
| `test/op-141-135-bitops-unsigned.test.ts` | 新增（② 守卫：unsigned 越界门 + 错误串不抛，含 0x136/0x13F） |
| `test/operand-missing-slot-zero.test.ts` | 新增（③ 守卫：四条读路径缺槽 0 + 口径唯一棘轮 + 0x12E 端到端） |

## 测试命令与结果

```powershell
cd app/amayui-emulator
npx tsc -p tsconfig.json --noEmit            # 干净
node --env-file=test/options.test.env --import tsx --test test/op-1d0-1d1-text-metrics.test.ts test/config-read.test.ts `
  test/engine-field-ids.test.ts test/control-error-banner.test.ts test/skip-unknown.test.ts test/engine-field-store.test.ts `
  test/op-12e-hover-hittest.test.ts test/op-1cb-2c8-2c9.test.ts test/opcode-operands.test.ts `
  test/op-2ee-message-fade.test.ts test/op-141-135-bitops-unsigned.test.ts test/operand-missing-slot-zero.test.ts
# ⇒ tests 65 / pass 65 / fail 0

node --env-file=test/options.test.env --import tsx --test "test/*.test.ts"     # 全量
# ⇒ tests 855 / pass 853 / fail 1 / skipped 1
#   唯一红 = test/opcode-gaps.test.ts（md 过期：注册数 359 vs 现算 361）—— 见报告"非我引入"。
```

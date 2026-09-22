# T-0102 判据 4/5 收口：**通道约定判死 + 根因修复**（角色名"青 vs 橘"= 少翻一次 COLORREF）

> 轮 18（2026-09-22）。上一轮（轮 17）把链条核定到"只剩通道约定一处"，本轮用**引擎的两处原始代码**
> 把它判死，并修掉 emulator 的取用侧。

## 1. 判决（两条引擎证据，缺一不可）

**① 字段是 COLORREF**：`0x76` 的 handler（`sub_41F390` raw **28663-28671**）只有 5 行：

```c
_this[30 * _this[95776] + 95805] = 3;                                  // 操作数记数槽 = 3（1 个操作数）
v2 = sub_41BF50(_this, 1);                                             // 读第 1 个操作数（**脚本原值**，无前置转换）
_this[21664] = BYTE2(v2) + ((BYTE1(v2) + ((unsigned __int8)v2 << 8)) << 8);   // 字节序翻转一次
sub_459F40((int)(_this + 21324));                                      // 重建字体对象
```

**② 该字段被当 COLORREF 用**：raw **79241** 把它**原样**交给文字绘制器，后者直接喂 GDI：

```c
sub_455ED0(_this, v60 + 20, x, v24, &String, *(_DWORD *)(_this + 1360), *(_DWORD *)(_this + 1364), 0, 1, v48);
   └─ raw 68093 / 68127： SetTextColor(*(HDC *)(_this + 1104), color);   // GDI: COLORREF = 0x00BBGGRR
```

⇒ **`Font+1360` = COLORREF，屏幕上的颜色 = 该字段的 COLORREF 读法 = `bgrToRgb(字段)` = 脚本原值。**
`0x76` 的那次翻转就是"脚本 RGB → GDI COLORREF"的格式转换，**不是**作者笔误、也不是"多翻了一次"。

## 2. 与用户两条实测口径的对照（这就是判决）

阿瓦罗（`src/CVINIT.txt:37-43`：名字「アヴァロ|阿瓦罗」+ `14a8f5 = ffe100` + `14b0c5 = 4`）：

| 环节 | 值 | 说明 |
|---|---|---|
| 脚本原值（CVINIT 的 RGB 作者值） | `0xffe100` | R=255 G=225 B=0 ⇒ **橘黄** |
| `0x76` 之后：`Font+1360` | `0x00e1ff` | COLORREF：RR=0xFF GG=0xE1 BB=0x00 |
| 真机屏幕（`SetTextColor(0x00e1ff)`） | `#FFE100` | **橘** = 用户"预期应该是橘色" ✔ |
| 修前 emulator（把字段当 `0xRRGGBB`） | `#00E1FF` | **青** = 用户"变成青色了" ✔（症状复现） |

同法第二格：设置界面残留的角色色（脚本 `0xff90b6`）→ `Font+1360 = 0xb690ff` →
真机 `#FF90B6`（粉）vs 修前 emulator `#B690FF`（**紫**）= 用户第三条实测「ADV 文字颜色又开始继承…
最后一行的颜色（紫色）」✔。

⇒ **两条症状是同一个根因**：emulator 的取用侧把 COLORREF 字段当成 `0xRRGGBB` 交给了渲染器（R/B 互换）。

## 3. 修复

- `app/amayui-emulator/src/vm/handlers/msgwin.ts` 的 `globalTextStyle()`（文本样式的**唯一**来源，
  消息窗与 `draw-string`(0x204) 都走它）：
  `fill: hex6(bgrToRgb(v(21664, …)))`、`outline: hex6(bgrToRgb(v(21665, …)))`；注释补上两处 raw 证据。
- **字段语义不变**（`engineValues[21664]` 仍逐位等于引擎的 `Font+1360`，保持"字段即事实"）；
  翻转发生在**取用侧**，这也让"写字段"的那两处（`msgwin.ts` 的 `setGlobal…`、`engine-fields.ts` 的
  `0x76/0x77` transform）保持原样。
- 两个诊断探针（`config1Chain` / `gameStartChain`）改成报告**渲染用色**（`bgrToRgb(字段)`），
  与 `globalTextStyle` 同口径 —— 否则"证据说青、实现画橘"。

## 4. 期望值变更（都是**同一类**：把 R/B 互换的旧期望改回脚本原值）

| 文件 | 旧期望 | 新期望 | 判据核 |
|---|---|---|---|
| `test/text-style-snapshot.test.ts`（4 例：入队钉住 / 不回溯 / 新页新样式 / 直绘立即消费） | `rgbOf(0x563412)` = `#123456` | `#563412` | 语义不变（只比"颜色随谁走"） |
| `test/config1-chain.test.ts`（T-0102 判据 3 的 2 例，3 处断言） | `#b690ff`（紫） | `#ff90b6`（脚本原色） | 判据 3 的结论（门开/门关 × 重派生）不变 |

## 5. 守卫与验证

- `test/adv-name-color-chain.test.ts`（3 例）：
  ① `14b0c4` 逐值 == `src/CVINIT.txt` 正文（独立 oracle）；
  ② `14acda == 14b0c4[14acdc[msg]]`、`f807b == adcd[14acda]`、**渲染色 == 脚本原色**（阿瓦罗与菲亚两条）；
  ③ **判据 4 修复的定点守卫**：`engineValues[21664] = 0x00E1FF`（= 阿瓦罗的字段值）⇒
     `globalTextStyle().main.fill === '#ffe100'`；`0xB690FF` ⇒ `'#ff90b6'`；白色两个读法相同 ⇒ `'#ffffff'`。
- **突变证明**（两条，都还原并复核）：
  - 把 `globalTextStyle` 的两次 `bgrToRgb` 去掉 ⇒ 判据 4 定点守卫 **1 fail**，报错文案正是
    「阿瓦罗的名字颜色必须是 `#FFE100`（橘），不是 `#00E1FF`（青）」；
  - 把 `src/CVINIT.txt` 的 `14b0c5` 改成 7（上一轮）⇒ oracle 用例 1 fail。
- `npm run verify` 全绿：**1031 测试（1030 通过 / 1 skipped / 0 fail）** + typecheck ×3 + `check:dead-writes` 0。

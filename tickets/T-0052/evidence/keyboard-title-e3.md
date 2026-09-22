# T-0052 · E3 证据：真实 TITLE 菜单**只用键盘**走通（判据 ③）

产出：`app/amayui-emulator/test/keyboard-scenario-menu.test.ts` 的第 1 条用例
（跑一次 ~20 s：两组各一条完整 boot 链）。

## 1. 链路（真实脚本，不碰鼠标）

```
宿主 keydown → InputManager.pressKey(vk)        # VK → 虚拟位（DEFAULT_VK_TO_BIT，vm/input.ts）
             → keysHeld/keyEdge 两把刷子         # 位 0..6 = ↑/→/↓/←/Enter/Space/BackSpace
             → TITLE 每帧 i100 扫掩码            # src/TITLE.txt:134
             → joyJump[bit] → joy-callback <bit> # src/TITLE.txt:40-52 注册
             → 菜单动作（label_00000eec → menu-dispatch (local-int 3f7) → label_000010b8）
```

`ScenarioSpec` 的新事件种类 `keydown`/`keyup`（`src/frame/scenario.ts`；`vk` = Windows 虚拟键码）
就是判据 ③ 原先缺的那条能力；Electron 侧的回放天然带键盘（轨迹的输入快照里已有 `keyEdge`/`keysHeld`）。

## 2. 实测出的确定性落点（守卫钉住的就是这两行）

| 键盘序列 | 结果 | 意义 |
|---|---|---|
| `↓`（VK40 ⇒ 位2 ⇒ `joy-callback 2`）→ `Enter`（VK13 ⇒ 位4 ⇒ `label_00000eec` → `menu-dispatch`） | **TITLE → GAMESTART.BIN** | 移动 + 确认都在真实菜单上生效 |
| `Enter`（不先移动） | **仍在 TITLE.BIN** | 对照组：证明上一条不是"Enter 是全局热键"，而是移动键把选中项挪到了有效项 |

`TITLE` 期间的 `local 3f7`（菜单选中项）在用例 ① 里被 `↓` 改动过（守卫断言其取值集合 > 1 个）。

## 3. 节拍（踩过的坑，写进用例注释）

**按下只保持 ~4 帧再松开，松开后留 ~1 s**（`settleMs: 64` / `1000`）。
长按（把 `settleMs` 设成 1000 再松）会让 `0x100` 每帧重复扫到同一位 ⇒ 选中项**连续移动**，
落点不再确定（实测：`↓` 长按 + `↑` + `Enter` 会落到 QUIT 而不是 Game Start）。

## 4. 辨别力（机械证明）

把 `InputManager.pressKey` 的 `keyEdge |= 1 << bit` 注释掉（只留按住态）⇒ 本用例 **1 fail**，
点名「★键盘 ↓+Enter 必须离开 TITLE（实得序列 … → TITLE.BIN）」；还原后 2/2 绿
（同批 `keyboard-mask` / `input` / `scenario` / `scenario-replay` 共 26 条也全绿）。

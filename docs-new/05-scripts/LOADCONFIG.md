# 脚本台账 · `LOADCONFIG`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `LOADCONFIG.BIN`（真源 `src/LOADCONFIG.txt`） |
| 状态 | ✅ 已分析 |
| 是什么 | **把 SAVE.DAT 里的用户设置读回全局**：29 个 `load-int (global …)` / `load-string (global-string …)` + 1000 条数组（3b4e / a9e5 / adcd）逐项 load-int。 |
| 怎么进/出 | SYSTEM4 的「已初始化」分支 `call-script 5258`（SYSTEM4.txt:73）。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `5-11` | `load-int (global-int a9ce)` | 系统页开关：a9ce / a9cd / a9d5 / a9d0 / a9cb / a9cc |
| `12-15` | `load-int (global-int b1b6)` | 游戏页开关：b1b6 / a9e4 / 139b / a9d6 |
| `16-20` | `load-string (global-string bbd)` | 字体面名：bbd / bbe / bbf / bbb / bbc（与 INITCONFIG0 的 save-string 一一对应） |
| `21-43` | `load-int (global-int a9de)` | ADV/声音/操作页开关：a9de / a9dd / a9db / a9df / a9e0 / a9e1 / a9e2 / a9dc / a9d4 / a9da / a9d9 / a9e3 / a9d2 |
| `44-52` | `load-int (local-ptr 0)` | ★1000 条数组的批量恢复：`lookup-array (local-ptr 0) (global-int 3b4e) (local-int 0)` → `load-int (local-ptr 0)`；a9e5 与 adcd（角色配色表）同样处理 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 3b4e / a9e5 / adcd` | 三个 0x3e8 长的数组（解锁标志 / 角色相关 / 逐角色配色），逐条 load-int |
| `global a9ce…a9e4 等` | 各页开关（与 INITCONFIG* 的 save-int 对应） |

## 不变量（拿它做回归断言）

- 本脚本只 `load-*`（读表写回全局），绝不 save-*：因此"启动时设置被重置"必然是走了 INITCONFIG 分支而不是这里

## 坑（踩过一次，别再踩）

- ★数组用**指针形式** load-int（`lookup-array (local-ptr 0) …` → `load-int (local-ptr 0)`）：`load-int` 的索引来自操作数解析器，指针/直接槽都能用
- 它跑在 `CHECKCONFIG` **之前**（SYSTEM4.txt:73 → 84）：字体名先恢复、再校验是否装得上

## 相关

- 引擎常态能力：`save-data-tables-persistence`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x42DF40`（见 `analysis/functions.json`）
- 函数结论：`0x433A70`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 守卫测试：`app/amayui-emulator/test/save-data.test.ts`

## 证据与备注

- 证据：src/LOADCONFIG.txt（全文 41 行）；E3 真语料断言（有存档 ⇒ 走本脚本且 global a9ce 恢复为存档值）见 test/save-data.test.ts
- 备注：数组的语义（3b4e 解锁位 / adcd 配色）未逐个读；本条目只登记"装载机制"这一层。

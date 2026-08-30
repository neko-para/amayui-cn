# `jcc` 指令语义（src）

> 级别：**已确认**（反汇编器 `age-shared.h` 权威来源 + 全工程统计）。

---

## 1. `jcc` = 两目标条件跳转（关键，已确认）

`jcc`（opcode 0xA0）是**带真/假两个目标的条件跳转**：

```
jcc <cond> <A> <B>:
    if (cond != 0)          # 真（非零）
        if A == 0xFFFFFFFF:  fall-through（不跳，落到下一句）
        else:                goto A
    else                    # 假（cond == 0）
        if B == 0xFFFFFFFF:  fall-through
        else:                goto B
```

- **`0xFFFFFFFF` 是「该分支不跳 / 落到下句」的占位符**，不是跳转目标。
- 三种写法：
  - `jcc cond label ffffffff`＝`if(cond) goto label`（真才跳）；
  - `jcc cond ffffffff label`＝`if(!cond) goto label`（假才跳，**最常用**）；
  - `jcc cond lab1 lab2`＝真/假各跳一处（if-else）。
- 条件=某布尔/标志（**非零为真，0 为假**）；比较结果（`eq/lt/…`）用 **0xFFFFFFFF(真)/0(假)**；查表返回 -1 表示「空/未找到」。

**统计**：全工程 287,931 条 jcc —— `假跳(ffffffff,label)` **285,335**、`真跳(label,ffffffff)` **2,546**、**两分支(label,label)** **50**、同标签 0。

**权威来源**：`age-shared.h` 的 `is_label_argument`：对 0xA0，索引 >0 的操作数在 `raw_data != 0xFFFFFFFF` 时才判为 `label_XXXX`。故 jcc 操作数 2/3 各是「label 或 0xFFFFFFFF(=不跳)」。

> ⚠️ **不要**把它误读成「`jcc a b label = if(a!=b) jump label`（单目标比较）」——那只对 99.1% 的单分支成立，遇到那 50 条双分支（`label,label`）就错。若再遇 50 条双分支，需用「两目标」模型。

（反汇编器对 jcc 的这一步处理正是理解整份反汇编的关键，之前多轮都栽在这一点上。）

---

## 2. Todo（src 域）

- [ ] 50 条两分支 `jcc(cond,lab1,lab2)` 的完整清单（可选，便于逐条核对「两目标」模型）。

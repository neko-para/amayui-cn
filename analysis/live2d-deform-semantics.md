# Live2D（Cubism 2.0.06 for DirectX）变形与顶点生成 + 每帧求值语义

> 目的：补上 T-0054 M1 的缺口（`CONTEXT.md` §4.2/§4.4 提到的那份「已完成但未取回」的后台调研）。
> 落点：`analysis/live2d-deform-semantics.md`（本文件）。

## 0. 来源纪律

| 标记 | 含义 |
|---|---|
| **O** | 反编译 oracle：`engine/天结_unpacked.exe_utf8.c`，标注为 `raw <行号>`；`.lst` 用于 vtable/thunk 落真身，标注为 `lst:<行>` 或 `.data:<地址>` |
| **O/RTTI** | oracle 里的 C++ RTTI 名字（`.lst` 的 `??_7<Class>@live2d@@6B@`），比函数名可靠 |
| **[推测]** | 读体之外的推断；无 [推测] 标记的均为读体确证 |
| **[表外]** | 需要语料字节实证、oracle 里无法回答的（本文件末尾单列） |

三条硬事实（本节其余全部结论都建立在它们之上）：

1. **本作内嵌的就是 Cubism 2.x**：`aLive2dVersionS = "Live2D version %s for %s"` raw 143532、`a2006 = "2.0.06"` raw 5307、`aDirectx_0 = "DirectX"` raw 5308。
2. **`.moc` 版本上限是 10**：`sub_4BD560` raw 143882 `if ( v5 <= 10 )`，否则 raw 143912 `"Illegal data version ( available : %d___loaded____%d )"`。⇒ **本作只接受 v≤10；语料全为 v10（CONTEXT 实测 335/335）。**
3. **全 `.c` 只有两个版本分支**：raw 156907 与 raw 158838，都是 `a2[1] >= 10`。`a2` 是 `BReader*`，`a2[1]` 即 `BReader+4`，就是 `sub_4BD560` raw 143881 写进去的版本号。**不存在 `>= 11` 分支，也不存在 `>= 8` 的对象级分支**（`>= 8` 只出现在 `sub_4BD560` 读文件尾 `0x88888888` 那一处，raw 143889）。

---

## 1. `PivotManager::calcPivotValue`（组合数 / 下标映射 / 关键帧间插值）

### 1.1 类与对象图（O/RTTI 确证）

| 类 | vftable | 构造者 | 析构者 | 字段读取者 |
|---|---|---|---|---|
| `live2d::PivotManager` | `.data:0052EF44`（lst） | `sub_4CA990` raw 155002 | `sub_4CAED0` raw 155366 → `sub_4CA9D0` raw 155022 | 无（不是流对象；由父对象内部 objRead 建） |
| `live2d::ParamPivots` | `.data:0052F124` | `sub_4CDD30` raw 157804 | `sub_4CDDD0` raw 157829 | `sub_4CDE00` raw 157838 |

`PivotManager` 布局（O）：

| 字节 | 类型 | 名 | 依据 |
|---|---|---|---|
| +0 | vptr | `live2d__PivotManager___vftable_` | raw 155005 |
| +4 | `LDVector<ParamPivots*>*` | **`pivots`** —— 参数关键帧列表 | raw 155017 `_this[1] = result;`（result = `sub_4C7220(a2,pe,-1,0)`，即读一个**对象数组**（type 15））；raw 155062 `v5 = *(_DWORD *)(_this[1] + 8) - 1;` 取元素数 |

`ParamPivots` 布局（O，全部来自 `sub_4CDD30` raw 157804-157815 与 `sub_4CDE00` raw 157838-157848）：

| 字节 | 类型 | 名 | 写点 | 读点 |
|---|---|---|---|---|
| +0 | vptr | — | raw 157812 | — |
| +4 | `int` | **`pivotCount`**（关键值个数 K） | raw 157845 `_this[1] = sub_4C0F50(a2+2)`（= 一个 i32） | raw 155158 `v10 = *(_DWORD *)(v6 + 4);`（`v6` = `pivots[i]`） |
| +8 | `BaseDataID*` | **`id`**（参数 ID） | raw 157842 `_this[2] = sub_4C7220(...)` | raw 155144 `*(const char **)(*(_DWORD *)(v6 + 8) + 8)`（异常消息里打 ID 字符串）；`sub_4CAA80` raw 155069 `*(_DWORD *)(v6 + 20)` |
| +12 | `LDVector<float>*` | **`pivotValues`**（关键值数组） | raw 157847 `_this[3] = sub_4C7220(...)` | raw 155159 `v11 = *(float **)(v6 + 12);`，raw 155163 `v13 = *v11;`，raw 155206 `v23 = v11[v22];` |
| +16 | `int` | **`pivotIndex`**（落在第几段） | raw 155234 `*(_DWORD *)(v6 + 24) = v12;` | — |
| +20 | `int` | **`setValue`**（该参数当前取值，读流时=0 raw 157811） | raw 155232 `*(float *)(v6 + 28) = v19;` 是 +28 | — |
| +24 | `int` | **`paramIndex`** | raw 157813 `*(_DWORD *)(_this + 16) = -2;` | raw 155069 `*(_DWORD *)(v6 + 20) != v8`（v8 = `*((_DWORD *)a2 + 3)` = 参数下标） |
| +28 | `float` | **`pivotWeight`**（段内插值权重 w） | raw 155232 | raw 155319 `0.0 == *(float *)(v11 + 28)`、raw 155347 `pExceptionObject[v23++] = *(float *)(v11 + 28);` |

> 注：oracle 里 `+16/+20` 与 `+24/+28` 在反编译输出中混用了 `*(_DWORD *)(v6+16)` 与 `*(float *)(v6+28)` 两种写法（Hex-Rays 的 int/float 联合），实际就是上表四格。

### 1.2 `calcPivotValue` = read 体确证的两个函数

任务里说的 `calcPivotValue`（vftable 在 raw 5425-5426）在 `_utf8.c` 里**没有单独的函数体**——它是 `PivotManager` 的**两个非虚成员**，被 `BDAffine`/`BDBoxGrid`/`DDTexture` 的求值路径直接调用：

| 名字 | 地址 / raw | 作用 |
|---|---|---|
| `PivotManager::isParamChanged`（本报告命名） | `sub_4CAA80` raw 155053 | 只要 `pivots` 里**任一**参数是"可见且未锁定"（`*(_BYTE *)(v7 + *(*(a2+40)+4)) == 1`，raw 155074）就返回 1 |
| **`calcPivotValue`（真正做插值定位的那个）** | **`sub_4CAB10` raw 155083-155242** | 返回 **`v35` = "在关键帧之间、需要插值的参数个数"**；副作用：给每个 `ParamPivots` 写 `pivotIndex`(+24) 与 `pivotWeight`(+28)，并**对固定参数（weight==0）直接改索引表** |
| **`buildPivotTable`（把组合索引表展开）** | **`sub_4CAD50` raw 155267-155362** | 把 `a2`（一个 `unsigned __int16[PIVOT_TABLE_SIZE+1]`）填成"组合索引 → 关键点元组下标"的查表；`v5 = 1 << a4`，`a4 = calcPivotValue 的返回值`；末尾写 `-1` 终结符 raw 155359 |
| `getPivotValueFloat` | `sub_4CB570` raw 155701 | 按 `v4 = calcPivotValue(...)` 的**元数**（1/2/3/4/默认）对一组 float 关键值做**线性/双线性/三线性/N 线性**插值 |
| `getPivotValueInt` | `sub_4CAF40` raw 155403 | 同上，int 版 |

### 1.3 组合数怎么算、下标怎么映射

**结论（O，确定）：组合索引空间 = `1 << m`，其中 `m` = `calcPivotValue` 的返回值 = "当前落在关键帧之间（`0 < weight < 1`）的参数个数"。索引表由 `sub_4CAD50` 展开，**不是** `∏ pivotCount`。**

`sub_4CAD50` 伪代码（raw 155267-155361，逐行对应）：

```
sub_4CAD50(pm, table /*u16[]*/, weightBuf /*float[]*/, m):
    v5 = 1 << m                      # raw 155289  -> 组合数
    if v5 + 1 > 65:                  # raw 155290  PIVOT_TABLE_SIZE
        printf("Over_the_interpolation_buffer_size____%d\n", v5)
        printf("please enlarge Live2D.h / PIVOT_TABLE_SIZE \n")     # raw 155292-155294
    清零 table[0 .. v5)              # raw 155304-155310

    a4 = 1                           # raw 155298  -> 当前参数在组合索引里占的"位权"
    v24 = 1                          # raw 155299
    v23 = 0                          # 已收集的插值参数个数
    for i in 0 .. count(pm.pivots):                       # raw 155316-155354
        p = pm.pivots[i]
        if p.pivotWeight == 0.0:                          # raw 155319
            # 固定参数：整张表加同一个常量
            c = a4 * p.pivotIndex                         # raw 155321
            if c < 0: throw                                 # raw 155322-155325
            for j in 0 .. v5: table[j] += c                 # raw 155327-155328
        else:
            # 插值参数：用 Gray 反射码在"第 k 段的两端"之间切
            lo = a4 * p.pivotIndex                          # raw 155332
            hi = a4 * (p.pivotIndex + 1)                    # raw 155334
            for j in 0 .. v5:                               # raw 155335-155344
                table[j] += (j / v24) % 2 ? hi : lo         # raw 155340-155342
            weightBuf[v23++] = p.pivotWeight                 # raw 155347  (第 k 个插值参数的权重)
            v24 *= 2                                        # raw 155348
        a4 *= p.pivotCount                                   # raw 155351  ←★位权按 pivotCount 累进
    table[v5] = -1                                           # raw 155359   终结符
    weightBuf[v23] = -1.0                                    # raw 155360
    return v23
```

**哪个参数最快变化（关键问题）**：`a4` 从 1 开始、每过一个参数 `a4 *= pivotCount`（raw 155298 / raw 155351），而 `table[j]` 里 `j / v24 % 2`（v24 从 1 起每遇一个插值参数 `*= 2`，raw 155299/155348）。
⇒ **`pm.pivots[]` 的槽 0 是"最快变化位"**（它的段标志来自 `j` 的 bit0），与 `params[0]` 最快变化的通行说法一致。[推测：`pm.pivots[]` 的顺序 = 模型 `ParamDefSet` 的顺序，因为 `PivotManager` 用一次 `objRead`（type 15 数组）建立，数组元素顺序就是流里的顺序。]

**参数值落在关键帧之间时怎么处理（`sub_4CAB10` raw 155160-155229，逐行）**：

```
ε = flt_52F184 = 9.9999997e-05          # raw 5442
K  = p.pivotCount                        # raw 155158
V  = p.pivotValues[]                     # raw 155159
x  = 该参数的当前值                       # raw 155157 (从 ParamDefSet 的 float 值池取)
if K < 1: idx = -1; w = 0                              # LABEL_19, raw 155161-155162
elif K == 1:                                           # raw 155166-155187
    if V[0] - ε < x < V[0] + ε:  # 视为命中唯一关键帧
        idx = 0; w = 0
    else:
        idx = 0; w = 0; *changed = 1     # raw 155186
else:
    if V[0] - ε > x:                     # raw 155190  x 低于首关键帧
        idx = 0; w = 0; *changed = 1     # raw 155192-155193
    elif V[0] + ε > x:                   # raw 155198  首关键帧附近
        idx = 0; w = 0
    else:
        k = 1
        while V[k] + ε <= x:             # raw 155206-155218
            k += 1
            if k >= K: idx = K-1; w = 0; *changed = 1; break   # raw 155213-155214
        else:
            if V[k] - ε < x:             # raw 155219-155225
                idx = k; w = 0           # 贴在上关键帧上
            else:
                m += 1                   # raw 155226  ★这个参数要插值
                idx = k - 1              # raw 155227
                w = (x - V[k-1]) / (V[k] - V[k-1])              # raw 155228  ←★线性、按分区间
p.pivotIndex  = idx                      # raw 155234
p.pivotWeight = w                        # raw 155232
return m                                 # raw 155236 / 155241
```

⇒ **插值是"分区间线性"**，段内权重 `w = (x - V[k-1])/(V[k] - V[k-1])`（raw 155228），**不是最近邻**；端点用 `±1e-4` 容差（raw 155164/155198/155207/155219）吸附，超出首/末关键帧时**不夹紧到端点值，而是"钳位到端点关键帧 + 置 `changed` 标志"**（raw 155186/155214/155193，`*a3 = 1`）。任务问的"越界夹紧"：**有，但是"钳到端点关键帧"语义，并且会额外报告"该参数被钳过"**。

**返回值**：`sub_4CAB10` 返回的是**"需要插值的参数个数 `m`"**，**不是组合索引、也不是权重本身**。组合索引由调用方从 `table` 里取；权重数组另存（`weightBuf`）。任务问的"返回组合索引还是插值权重"⇒ **两者都不是**，是维度计数。

### 1.4 每次求值的真入口（把上面串起来）

| 函数 | raw | 作用 |
|---|---|---|
| `sub_4C9D40` | 154380-154391 | **通用求值入口**：`tbl = calcPivotValue(pm, model, &changed, valuePool); idx = tbl[0]; ctx+4 = idx; if (!changed) ctx+8 = getPivotValueFloat(pm, model, &changed, opacityPool)` |
| `sub_4C85A0` | 152994-153032 | DrawData 的 UV 求值（vtable +12）：`sub_4C9D40` → `*(ctx+52) = idx` → `sub_4CBA60(..., stride 5)` |

`sub_4C9D40` 全文（raw 154380-154391）：

```c
*(_BYTE *)(a3 + 12) = 0;
v4 = sub_4CAF40(a2, *(_DWORD **)(_this + 4), a3+12, *(_DWORD *)(_this + 20));  // int 属性
*(_DWORD *)(a3 + 4) = v4;                    // ←★ 组合索引，无夹紧
if (*(_BYTE *)(a3 + 12) == 0)
    *(float *)(a3 + 8) = sub_4CB570(a2, *(pm*), a3+12, *(_DWORD *)(_this + 24)); // float 属性
```

⇒ **组合索引 = `sub_4CAF40/4CB570` 的内部 `v4 = calcPivotValue(...)`；调用方只拿到 `table[0]` 那一个值**（`sub_4CAF40`/`sub_4CB570` 在 `v4 <= 0` 时 `return valuePool[table[0]]`，raw 155492 / 155785）。**没有任何对 `table[0]` 的越界夹紧**——唯一的夹紧是 `sub_4CAD50` 里 `1<<m + 1 > 65` 的**缓冲区大小告警**（raw 155290，只 printf，不截断）。

`sub_4CB570` 的插值元数分派（raw 155786-157660）与 `pivotWeight` 的用法：

| `m` | 形式 | 依据 |
|---|---|---|
| ≤0 | 直取 `pool[table[0]]` | raw 155784-155785 |
| 1 | 单线性：`a + (b-a)*w0` | raw 155788-155792 |
| 2 | 双线性：`(A + (B-A)*w0)*(1-w1) + (C + (D-C)*w0)*w1` | raw 155793-155798 |
| 3 | 三线性（8 点） | raw 155799-155813 |
| 4 | 四线性（16 点） | raw 155814-155819 起 |
| >4 | 通用：`q = 2^m` 个 Bernstein 式乘积，点位由 `table[]` 给出 | raw 156321-156441（`flt_526954 = 2.0` raw 4686，`sub_4CAF00` = 整数幂） |

> `sub_4CAF00` raw 155375 = **整数幂** `a1^a2`（快速平方），`flt_526954 = 2.0`（raw 4686）⇒ 默认分支里 `v84 = (int)pow(2, m) = 2^m`（raw 155562）就是点数。

---

## 2. `BDAffine`（`sub_4CCB10` raw 156973-156980）

### 2.1 第三个/第四个对象分别是什么

`sub_4CCB10` 全文（raw 156973-156980）：

```c
int *__thiscall sub_4CCB10(_DWORD *_this, int *a2, char *pExceptionObject)
{
  sub_4CF010(_this, a2, pExceptionObject);   // → _this[1]=objRead, _this[2]=objRead   (raw 158798-158807)
  _this[5] = sub_4C7220(a2, pExceptionObject, -1, 0);   // ← 第 3 个对象
  _this[6] = sub_4C7220(a2, pExceptionObject, -1, 0);   // ← 第 4 个对象
  return sub_4CF0C0(_this, a2, (int)pExceptionObject);  // 仅当 a2[1]>=10 再读 _this[4]
}
```

`BDAffine` 槽位 + 从 `.lst` 的 RTTI 确证的 vtable（`.data:0052F0AC`）：

| 字节 | 成员 | 依据 | 语义 |
|---|---|---|---|
| +0 | vptr | raw 156943 | `live2d__BDAffine___vftable_` |
| +4 | `_this[1]` | `sub_4CF010` raw 158803 | **`id`**（`BaseDataID*`，objRead → tag 51） |
| +8 | `_this[2]` | `sub_4CF010` raw 158804 | **`targetId`**（父变形器，`BaseDataID*`，objRead → tag 51） |
| +16 | `_this[4]` | `sub_4CF0C0` raw 158842 → `_this[4] = sub_4C1660(a2+2, a3)` | **`pivotOpacities`**（`LDVector<float>*`，**内联 float 数组**），**仅 `version >= 10` 读**（raw 158838） |
| +20 | `_this[5]` | `sub_4CCB10` raw 156977 | **★第 3 个对象 = `pivotManager`**（objRead → tag 66） |
| +24 | `_this[6]` | `sub_4CCB10` raw 156978 | **★第 4 个对象 = `affines`（`AffineEnt` 数组，objRead → tag 15）** |

旁证（析构 + 用点，全部一致）：

* `sub_4CCEF0` raw 157165-157185（析构）：先 `_this[5]` 调 vptr[0]（PivotManager 的析构），再把 `_this[6]` **当对象数组**逐个 `(**(v5))(v5,1)`（`*(_DWORD *)(_this[6] + 4)` 取 base、`*(_DWORD *)(_this[6] + 8)` 取 count —— 正是 `LDVector` 的记忆布局），最后 `sub_4CF000`。⇒ +20 = PivotManager、+24 = AffineEnt 数组，**确证**。
* `sub_4CCFB0` raw 157357-157359：`v6 = _DWORD *)v4[5]; v125 = sub_4CAB10(v6, v3, &a2+3);` ⇒ +20 就是喂给 `calcPivotValue` 的 PivotManager。
* `sub_4CCFB0` raw 157373/157384/…/157591：`v9 = *(_DWORD *)(v4[6] + 4); v10 = *(float **)(v9 + 4 * *v7);` ⇒ +24 是按**关键点元组下标**索引的 `AffineEnt*` 数组，元素被当 `float*` 用（`v10[1]`=x、`v10[2]`=y …），与 `sub_4CC960` 的行序完全吻合。
* `sub_4CCEF0` 只析构 `_this[5]` 与 `_this[6]`，**没有析构 `_this[4]`** ⇒ +16 的 `LDVector<float>` 由 `sub_4CF0C0` 的调用方（`sub_4BC360`/分配器一族）回收 [推测：或泄漏；不影响语义]。

### 2.2 为什么 4085 个 `BDAffine` 的 `affines` 长度为 0，而语料有 18490 个 `AffineEnt(69)`

**明确结论（O，确定）：这不是"解析器读错了对象序"。`BDAffine.affines` 是"按需建关键帧数组、构造期为空"的字段；moc.ts 的字段读序（`id → targetId → pivotManager → affines → [v≥10] pivotOpacities`）在**只要它真的读了第四个对象**这一前提下是对的。真正的原因是：**

1. **`affines` 是 `objRead`（tag 15 对象数组）**（raw 156978），**不是** `LDVector<AffineEnt*>` 这种内联数组。它读的是"**一个对象**"，那个对象必须自己带元素个数。
2. **`sub_4CCB60`（vtable +8，= 建 context 的槽）根本不读流**：它只 `sub_4BC380(28)` + `sub_4CC8C0` **凭空造 1 个（必要时 2 个）`AffineEnt`**（raw 157006-157011 存 `ctx[8]`；raw 157012-157019 在 `_this[2] && _this[2] != sub_4C3A10()` 时再造一个存 `ctx[9]`），这 2 个 `AffineEnt` **不来自文件**。
3. **语料里那 18490 个 `AffineEnt(69)` 是"tag 15 对象数组"的元素，被递归读进 `BDAffine+24`**（`sub_4C7220` 的 `case 15` raw 152187-152211）：`v19 = sub_4C1000(_this + 2)` 读元素数 → `sub_4C6E90` 建 `LDVector<void*>` → 对每个元素 `*v24 = sub_4C7220(pExceptionObject, -1, 0)`（raw 152207），而那个 `readObject` 遇到 tag 69 就走 `default:` raw 152294-152307 → `sub_4CA280(pe, 69)` → `sub_4CC8C0`（建对象、进 refno）→ raw 152303 调它的 **vtable +4 = `sub_4CC960`**（raw 156890）填 5 个 float（`a2[1] >= 10` 时再读 2 个 bool 到 +24/+25）。
   ⇒ **`moc.ts` 把 tag 69 登记成"独立对象"在 refno/计数口径上是对的**，但这些对象是**某个数组的成员**，它们的所有者就是 `BDAffine` 的第 4 个字段。
4. 因此 **`BDAffine.affines.length == 0`（4085/4085）无法用 oracle 解释成"正常值"**：`sub_4CCFB0` 的求值在 `*v7`（关键点元组下标）上直接索引 `affines` 的数据缓冲（raw 157373-157381 `v9 = *(_DWORD *)(v4[6] + 4); v10 = *(float **)(v9 + 4 * *v7);`），若数组为空则该索引读越界；而全语料 18490 个 `AffineEnt`（`≈ 4.53 个/BDAffine`，正是"每个 BDAffine 一个 pivot 插值表"的形状）又确实存在。⇒ **二者矛盾，只能是解析器侧把槽位/计数映射错了。**
   最可能的三处（按可能性排序，均需用能逐字节解析的现成工具核对）：
   * **(a) 第 3/第 4 个 `objRead` 读反了**：若把 `affines`（数组）读给了 `pivotManager` 槽、把 `pivotManager`（单对象）读给了 `affines` 槽，则 `affines` 的长度会变成 `PivotManager` 的字段数一类的小数/0；
   * **(b) 解析器的 `affines` 实际是 `BDAffine+16` 的 `pivotOpacities`**：该字段**仅 `version >= 10` 才存在**（raw 158838），若把 `pivotOpacities` 当成了 `affines`，则对任何"看起来 v<10"的解析都会得到 `null`/0；
   * **(c) 数组元素数被当成"字节长度"或反之**：`case 15` 的元素数是**元素个数**（`sub_4C1000`），而 `int[]`/`float[]`（`sub_4C14E0`/`sub_4C1660`，`sub_4C1270`）的长度是**字节数**（raw 147168 `v4 > 2 * *(_DWORD *)(_this + 16)` 与 raw 147182 `Sizea = 4 * v4` 可证）。把两者混用会让长度看起来像 0 或巨大。

> **明确结论（修正后）**：
> * `BDAffine` 的**字段读序本身是对的**（`id → targetId → pivotManager → affines → [v≥10] pivotOpacities`，§2.1 的 vtable/析构/用点三重旁证）。任务假设的"解析器读错了对象序"在**字段层面不成立**。
> * 但 **`affines` 恒为 0 一定是解析器侧的映射错误**（正确读法下它应当是一批 `AffineEnt` 元素，`≈4.53 个/BDAffine`）。**不能**把它解释成"运行时才填充"——`sub_4CCB60` 只造 1~2 个**默认值** `AffineEnt`（raw 157006-157019），且 oracle 里**没有任何**把流里的 `AffineEnt` 搬进 `affines` 的代码（全 `.c` 对 `sub_4CC8C0` 的引用只有 raw 154713 工厂与 raw 157008/157016 这两处）。

### 2.3 求值入口：从参数值到变形矩阵

**入口 = `sub_4CCFB0`（vtable +12），raw 157190-157677。** 结构：

```
sub_4CCFB0(bdaffine, model, ctx):
  pm = bdaffine[5]                       # raw 157357
  if !isParamChanged(pm, model): goto END                      # raw 157354 (sub_4CAA80)
  m  = calcPivotValue(pm, model, &changed)                     # raw 157359 (sub_4CAB10)
  ctx[12] = changed                                            # raw 157361
  ctx[5]  = getPivotValueFloat(model, pm, &changed, bdaffine[4])  # raw 157362 (sub_4CF050 -> sub_4CB570)
  buildPivotTable(pm, tuple, weights, m)                       # raw 157365 (sub_4CAD50)
  src = ctx[8] /* = ctx+32 */                                  # raw 157366
  switch (m):
    case 0: copyAffine(ctx+32, affines[tuple[0]])              # raw 157669 (sub_4CC8F0)
    case 1: 1 次线性混合 6 个分量                                # raw 157372-157382
    case 2: 双线性（4 点）                                       # raw 157383-157402
    case 3: 三线性（8 点）                                       # raw 157403-157439
    case 4: 四线性（16 点）                                      # raw 157440-157518
    default: 通用 2^m 点 Bernstein 乘积                          # raw 157519-157664
  dst[24] = src[24]; dst[25] = src[25]   # reflect 位直传           # raw 157673-157674
```

每个 `AffineEnt` 的字段（`sub_4CC960` raw 156890-156916 是**流读取器**，`sub_4CC8C0` raw 156843 是构造器）：

| 字节 | 类型 | 名 | 依据 |
|---|---|---|---|
| +4 | float | **`originX`** | raw 156894 |
| +8 | float | **`originY`** | raw 156897 |
| +12 | float | **`scaleX`** | raw 156900 |
| +16 | float | **`scaleY`** | raw 156903 |
| +20 | float | **`angle`**（**度**） | raw 156906 |
| +24 | bool | **`reflectX`**（v≥10） | raw 156911 |
| +25 | bool | **`reflectY`**（v≥10） | raw 156914 |

**实际把矩阵作用到点上的函数 = `sub_4CCC60`（BDAffine vtable +20），raw 157026-157076。** 全文语义（逐行）：

```c
sub_4CCC60(a1 /*BDAffine*/, a2 /*model*/, a3 /*ctx*/, a4 /*dst pts*/, a5, a6 /*first*/, a7 /*stride*/):
  af = ctx[9] ? ctx[9] : ctx[8]                 # raw 157045-157047  ← 优先用"父目标"那份
  rad = af.angle * flt_52F1B0                   # raw 157048   flt_52F1B0 = 0.017453292 = π/180
  s = sin(rad); c = cos(rad)                    # raw 157049-157050
  sy = ctx[16 /*float @+16*/]                    # raw 157051
  sx = (2*(af.reflectX==0) - 1) * sy            # raw 157053    reflectX!=0 → 取负
  A  = sx * c ;  B = s * sx                     # raw 157054-157055
  sy2 = sy * (2*(af.reflectY==0) - 1)           # raw 157056
  C  = -(sy2 * s) ; D = c * sy2                 # raw 157057-157058
  ox = af.originX ; oy = af.originY             # raw 157059-157060
  for (i = first; i < rows*cols; i += stride):  # raw 157061-157073
      px = src[i]; py = src2[i]
      dst[2i]   = py*C + px*A + ox               # raw 157069
      dst[2i+1] = py*D + px*B + oy               # raw 157070
```

⇒ **运算顺序与坐标系（O，确定）**：

| 项 | 结论 | 依据 |
|---|---|---|
| 角度单位 | **度**（`× π/180`） | raw 157048 + `flt_52F1B0 = 0.017453292` raw 5444 |
| 反射 | 不是独立矩阵，而是**并入 scale 的符号**：`sx' = ±scaleX`、`sy' = ±scaleY` | raw 157053 / raw 157056 |
| 顺序 | **先按 (scaleX', scaleY') 缩放，再绕原点旋转 `angle`，再平移 (originX, originY)**，即 `p' = R(angle) · S · p + T`；`R = [[c, -s],[s, c]]`，`S = diag(sx', sy')` | 展开后 raw 157069 = `py*(sx'*(-s)) + px*(sx'*c) + ox` = `(x·sx')·c + (y·sy')·(-s) + ox` |
| 另一种等价读法 | 先旋转再缩放：`p' = S' · R(angle) · p + T`，两个轴**各自**带符号 | 同上（`S'` 与 `R` 可交换对角/旋转的次序，因 `S` 是对角阵，数学上 `R·S = S·R`；回读 `sub_4CCC60` 的常量分组是 `R·S`） |
| 坐标系 | **画布坐标，原点在左上**，y 轴向下；画布由 `ModelImpl.canvasWidth/canvasHeight` 定（`sub_4C6080` raw 151211/151214），投影是 `D3DXMatrixOrthoLH(w, -h, -1.0, 1.0)`（`sub_4B0360` raw 134354，`flt_52CAC4 = -1.0` raw 5183），并在 raw 134376 用 `D3DXMatrixTranslation(-w/2 + …, h/2 - …, 0)` 把原点移到画布中心 | raw 134354 / 134376；`dbl_51D7F8 = 0.5`（raw 134309/134375 的 `- v21` 用法）[推测：`dbl_51D7F8 = 0.5`，由 `v24 = v22*0.5 - v23`、`v26 = -0.5*v25` 的形态推断] |
| `sy`（`ctx+16`）来源 | 上一帧/上一级写下的 scale 累计值；raw 157773-157774 `*(float *)(v4+16) = af[12] * af[16]` 即 `scaleX` 相乘 | raw 157713/157773 |
| 目标链 | `ctx+32` = 本对象自己的 `AffineEnt`，`ctx+36` = 父目标那份；raw 157045 `result = *(a2+36); if (!result) result = *(a2+32);` ⇒ **有目标时优先用目标那份参数，但点仍写进自己那份** | raw 157045-157047 |

`BDAffineContext` 是**另一个类**（vtable `.data:0052F0CC`，只有 +0 析构 `sub_4CCEC0`）：布局 `+0 vptr, +4 owner BDAffine*, +8 自己的 AffineEnt*, +9?…`（raw 156997-157019：`ctx[8]` = own AffineEnt、`ctx[9]` = 可选 extra）。C++ 里**没有 `BDAffineContext::update` 虚函数**——求值由 `sub_4CCFB0`（**BDAffine** 的虚槽 +12）与 `sub_4CCC60`（**BDAffine** 的虚槽 +20）完成。**`moc.ts` 如果按"BDAffineContext 有自己的 update"来建模会走错。**

---

## 3. `BDBoxGrid`（`sub_4CEDF0` raw 158689-158702）

### 3.1 字段读序与网格底层数组的快变方向

`sub_4CEDF0` 全文（raw 158689-158702）+ `sub_4CF010`（raw 158798）+ `sub_4CF0C0`（raw 158832）：

```c
int *__thiscall sub_4CEDF0(_DWORD *_this, int *a2, char *pExceptionObject)
{
  sub_4CF010(_this, a2, pExceptionObject);       // _this[1]=id, _this[2]=targetId
  if (a2[17]) a2[17] = 0;
  _this[6] = sub_4C0F50((int)(a2 + 2));          // ←★ columnCount  (obj+24)
  if (a2[17]) a2[17] = 0;
  _this[5] = sub_4C0F50((int)(a2 + 2));          // ←★ rowCount     (obj+20)
  _this[7] = sub_4C7220(a2, pExceptionObject, -1, 0);   // pivotManager (obj+28)
  _this[8] = sub_4C7220(a2, pExceptionObject, -1, 0);   // pivotPoints  (obj+32)
  return sub_4CF0C0(_this, a2, (int)pExceptionObject);  // [v>=10] pivotOpacities -> _this[4] (obj+16)
}
```

**读序（O，确定）：`id → targetId → columnCount → rowCount → pivotManager → pivotPoints → [v≥10] pivotOpacities`。`moc.ts` 记的"columnCount 先读、rowCount 后读"正确。**

网格底层数组的快变方向（O，确定）：`sub_4CDFD0` raw 157931 / `sub_4CEE70` raw 158751 都是

```c
sub_4CBA60(model, pivotManager, &changed,
           (col+1) * (row+1) /* = a4 = 点数 */, pivotPointsArray, dst, 0 /*a7*/, 2 /*a8*/)
```

即**一维长度 = `(rowCount+1)*(columnCount+1)`**。`sub_4CBA60` raw 156127/156128 `v11 = v138 = 2 * a4`（点数的 2 倍 = float 数），写指针 `v20 = &a6[4*a7]`，每点 `v20 += a8`（=2）。⇒ **数组里第 `n` 个点 = 第 `⌊n/(col+1)⌋` 行、第 `n%(col+1)` 列**，即**列（u 方向）最快变化**，行（v 方向）慢变。**与 `moc.ts` 现有实现一致（独立确证）。**

### 3.2 贝塞尔曲面求值：是 Bernstein 还是别的

**结论（O，确定）：`sub_4CBA60` raw 155982-156469 是"按 Bernstein 基做张量积曲面求值"，但只对 `m ≤ 4` 的 1/2/3/4 线性写成了展开式；`m ≥ 5` 走通用 Bernstein 乘积。**

参数：`u = *(float *)(a1 + 212)`（= `ctx->u`）、`v[i] = *(float *)(a1 + 216 + 4i)`（第 i 个插值参数的权重），`a4 = 点数`，`a5 = pivotPointsArray`，`a6 = dst`，`a7 = dst 起始偏移`，`a8 = dst 步长`。索引 `v9[j] = *(u16*)(a1 + 80 + 2j)` 就是 `buildPivotTable` 产出的**关键点元组下标**。

| `m` | 形式 | 依据 |
|---|---|---|
| 0 | 直接 copy 控制点（`a8==2 && a7==0` 时 `memcpy(a6, src, 8*a4)`） | raw 156444-156466 |
| 1 | **线性（1 次 Bernstein）**：`P = P0*(1-u) + P1*u` | raw 156133-156153 |
| 2 | **双线性（两个 1 次 Bernstein 的张量积）**：权重 `(1-v0)(1-u) / (1-v0)u / v0(1-u) / v0*uuu`（实际写序见 raw 156154-156186：`v27=(1-v1)(1-u), v29=(1-v1)u, v30=(1-u)v1, v32=u*v1`） | raw 156154-156186 |
| 3 | **双二次（两个 2 次 Bernstein 的张量积）**：8 项，权重形如 `(1-v1)(1-v0)(1-u)`、`(1-v1)(1+v0-2u?)`… 展开见 raw 156188-156247 | raw 156188-156247 |
| 4 | **双三次（两个 3 次 Bernstein 的张量积）**：16 项 | raw 156248-156320 |
| **>4（default）** | **通用张量积 Bernstein**：`q = 2^m` 个基函数 `B_q(u) = ∏_{k} (bit_k(q) ? v_k : 1-v_k)`，再对 `q` 求和（`v77 = 权重[q]`，`v74 = 控制点值[q]`） | raw 156321-156441 |

**没有"双三次固定"**：每个轴上的次数由 `calcPivotValue` 返回的**该轴的插值参数个数**决定（1→线性、2→二次、3→三次…），是"**每个轴各自 Bernstein 次数的张量积**"。

任务问"给定 `(u,v)` 与控制点数组怎么求点"：**不是双三次固定、也不是 de Casteljau**，而是**先由 `pivotTable` 把 `2^m` 个控制点下标选出来，再用 `u` 与 `v` 的 Bernstein 乘积做加权和**。`m ≤ 4` 是展开式，`m > 4` 是循环。

### 3.3 求值入口与 `pivotPoints` 长度的关系

| 函数 | 地址 / raw | 角色 |
|---|---|---|
| `sub_4CEDF0` | raw 158689 | **字段读取器**（不是求值） |
| `sub_4CDEF0` | raw 157883-157912 | **建 context**（vtable +8）。`v5 = 8 * (_this[5] + 1) * (_this[6] + 1)`（raw 157905）= **`8 × (rowCount+1) × (columnCount+1)`** 字节；`ctx[8] = alloc(v5)`（raw 157906）、`ctx[9] = (有 target) ? alloc(v5) : 0`（raw 157907-157910） |
| **`sub_4CDFD0`** | **raw 157915-157938** | **求值入口**：`if (isParamChanged(ctx[7], model)) { sub_4CBA60(model, ctx[7], &changed, (col+1)*(row+1), ctx[8], data, 0, 2); data[12] = changed; sub_4CF050(...) }` |
| `sub_4CEE70` | raw 158704-158755 | 另一条求值/继承路径（`(col+1)*(row+1)` 点，`stride 5`，把父 context 的点写进自己的 buffer） |
| **`sub_4CE040`** | **raw 157941 起** | **BDAffine/BDBoxGrid 通用的"曲面求值 + 写点"内核**（`sub_4CEF60` raw 158758-158766 是它的 vtable +20 thunk：`sub_4CE040(a4,a5,a6,a7,a8, dst, col, row)`） |

**`ctx+32`（= `ctx[8]`）与 `ctx+36`（`ctx[9]`）**：raw 158762-158764 `v8 = *(float **)(a3 + 36); if (!v8) v8 = *(float **)(a3 + 32);` ⇒ 与 `BDAffine` 同构：**有父目标时用父的那份点缓冲**。

### 3.4 「顶点组数 / ∏pivots = 1/2/3/4/5/9」这个比值是什么

**oracle 能给出的部分（O，确定）**：

1. **网格自己的点数由 (col,row) 唯一决定**：`(col+1)*(row+1)`（raw 157905 / 157931 / 158751），**与 pivot 数无关**。
2. **控制点元组数由 `calcPivotValue` 唯一决定**：表大小 `2^m`，`m` = 落在关键帧之间的参数个数（§1.3）。
3. ★**索引空间（值域）是 `∏ K_i`，其中 `K_i` = 该 `PivotManager` 里第 i 个 `ParamPivots` 的 `pivotCount`（+4）**：`sub_4CAD50` raw 155351 `a4 *= *(_DWORD *)(v11 + 4)` 就是在**累乘 knot 数**，而表里的值是 `a4*segIndex` 或 `a4*(segIndex+1)`（raw 155321 / 155332 / 155334）⇒ **表元素的最大值 = `∏K_i - 1`**。
   ⇒ 所以 `pivotPoints` / `pivotDrawOrders` / `pivotOpacities` 在**语义上**必须至少有 `∏K_i` 个元素（读侧 raw 155492 / 155785 / 156135-156138 **无越界检查**）。
   **但注意两个不同的量**：查表**大小** = `2^m`（`m` ≤ `PivotManager` 的参数数），查表**值域** = `∏K_i`。**只有 `K_i = 2` 对全部插值参数成立时二者才相等。**
4. **`pivotPoints.length` 在文件里是一个被直接读进来的长度**：`sub_4CEDF0` raw 158700 的 `sub_4C7220` 读的是一个**指向 float 子数组的指针向量**（`sub_4C7870` raw 152325 的 `size==1` 分支：外层 varint 行数 → 每行再读一个 float 数组），元素数就是文件写的。**运行时没有任何地方拿 `∏K_i` 或 `2^m` 去校验它**（全 `.c` 无此类比较）。

**关于 `1/2/3/4/5/9` 这组比值**：

* 用第 3 条即得：`pivotPoints.length / ∏K_i` **应当恒 ≥ 1 且通常 = 1**；比值为 1 是正常，**>1 表示文件给的元素比索引空间还多**（合法，只是冗余），**<1 才是异常**（会越界读）。
* 但任务给的比值集合 `{1,2,3,4,5,9}` 对乘法**不封闭**（缺 6、8），所以它**不可能**是"沿某个参数子集重算 ∏K"的结果。⇒ **最自洽的解释是：`moc.ts` 的 `∏pivotCounts` 与 oracle 的 `∏K_i` 分母不同口径**（例如它把每个 pivot 都按 `K=2` 计、或把 `pivotCount` 与 `pivotValues.length` 混用、或把不同对象的 pivotManager 串了）。**[推测]** —— `moc.ts` 在 `app/` 下（本次禁读），无法证实。
* **不要**用这组比值去反推任何运行期维度：oracle 里只有 `2^m`（表大小）与 `∏K_i`（表值域）两个量，二者与 `pivotPoints.length` 之间**没有任何换算代码**。

---

## 4. `DrawData` 的每帧求值

### 4.1 类名与槽位（O/RTTI 确证）

`live2d::DrawData` 在本作 SDK 里**实际叫 `live2d::DDTexture`**（RTTI `.lst`：`??_7DDTexture@live2d@@6B@` at `.data:0052EDF8`）。基类是 `live2d::IDrawData`（vtable `.data:0052EEB8`）。

| 槽 | 偏移 | 实现 | 语义 |
|---|---|---|---|
| +0 | 0x00 | `sub_4C8970` raw 153241 | 析构 |
| +4 | 0x04 | **`sub_4C8A60` raw 153284** | **字段读取器**（文件对象 tag 70） |
| +8 | 0x08 | **`sub_4C8320` raw 152835** | **建 context + 上传顶点/索引缓冲** |
| +12 | 0x0C | `sub_4C85A0` raw 152994 | UV 求值（写 `ctx+52` = 组合索引） |
| **+16** | **0x10** | **`sub_4C8BC0` raw 153345** | **★"求值/继承"入口**（`getTransformedPoints` 的等价物） |
| +20 | 0x14 | `sub_4C87B0` raw 153116 | **★真正走 D3D（`DrawParam_D3D`）** |
| +24 | 0x18 | `sub_4CDEE0` raw 157877 | `return 2`（类型标识，raw 143941 判 `==2`） |
| +28 | 0x1C | `sub_4C8770` raw 153095 | 释放 tex/IB |
| +32 | 0x20 | `sub_4C88B0` raw 153177 | 写 alpha |

**类层次（O/RTTI，`.lst` 486178-486185）**：`DDTexture : IDrawData : ISerializableV2 : LDObject`。**本二进制里没有 `live2d::DrawData` 这个类，也没有 `DDTTexture`**；`DrawData` 只作为 `DrawDataID` / `IDrawData` / `LDVector<IDrawData*>` 的前缀出现。⇒ `moc.ts` 的 "DrawData" 就是 RTTI 的 `DDTexture`。

### 4.2 字段读序（`sub_4C8A60` raw 153284-153342，O 确证）

| 顺序 | 字段 | 类型 | 字节 | 依据 |
|---|---|---|---|---|
| 1 | `id` | objRead (50) | +12 | `sub_4C9E20` raw 154444 |
| 2 | `targetId` | objRead (51) | +16 | raw 154445 |
| 3 | **`pivotManager`** | objRead (66) | +4 | raw 154446 |
| 4 | `averageDrawOrder` | i32 | +8 | raw 154450 |
| 5 | **`pivotDrawOrders`** | **内联 int 数组** (`sub_4C14E0`) | +20 | raw 154453 |
| 6 | **`pivotOpacities`** | **内联 float 数组** (`sub_4C1660`) | +24 | raw 154456 |
| 7 | *(v≥11: `clipId`)* | — | — | **oracle 无此分支**（§0.3） |
| 8 | `textureNo` | i32 | +32 | raw 153293 |
| 9 | `pointCount` | i32 | +36 | raw 153296 |
| 10 | `polygonCount` | i32 | +40 | raw 153299 |
| 11 | `indexArray` | objRead (25/16) | +52 | raw 153303（**注意 `a4=1`**，见下） |
| 12 | `pivotPoints` | objRead (15 → 每元素 27) | +56 | raw 153306 |
| 13 | `uvs` | objRead (27) | +60 | raw 153310 |
| 14 | *(v≥8)* `optionFlag` | i32 | +44 | raw 153322 |
| 15 | *(v≥8 且 `optionFlag & 1`)* `colorGroupNo` | i32 | +48 | raw 153330 |

**`a4`（`sub_4C7220` 的第 4 参）是什么（O，确定）**：在 `sub_4C7220` 的 `case 25`（raw 152266）里有 `if ((a4 & 1) == 0) goto LABEL_44;`——即 **`a4 & 1` 决定 tag 25/27 读到的是"int 向量"还是"float 数组"**。
* `sub_4C9E20` raw 154453 传 `a4 = 1` ⇒ **`pivotDrawOrders` 是 int 数组**（raw 152269 `sub_4C6FD0`）。
* raw 154456 传 `a4 = 0` ⇒ **`pivotOpacities` 是 float 数组**（raw 152276 `sub_4C6FB0`）。
* 全 `.c` 里 `a4 = 1` 的调用点**只有 raw 153303 这一处**（`grep sub_4C7220\(` 的全部 29 个调用点已逐点核对）。⇒ **`pivotDrawOrders` 是唯一的"FlagObjectArray"**。

> 这条很关键：**`pivotDrawOrders` 与 `pivotOpacities` 是两个独立的内联数组（类型不同、读取器不同），长度都由文件里各自的 varint 决定**；oracle 不要求两者长度相等，也不要求它们等于任何函数算出的值。

### 4.3 `pivotPoints` + `pivotManager` + `targetId` → 最终顶点（传递链）

**入口 `sub_4C8BC0` raw 153345-153424（DrawData 槽 +16）**：

```c
char sub_4C8BC0(_DWORD *_this /*DrawData*/, _DWORD *a2 /*model*/, int a3 /*ctx*/):
  if (*(_BYTE *)(a3 + 12)) return 0;                 # raw 153360  已本帧算过
  nullsub_2(a2, a3);                                 # raw 153362
  if (_this[4] /* targetId */) {                     # raw 153363
      target = _this[4];
      if (target != DST_BASE) {                      # raw 153368 (sub_4C3A10() = "DST_BASE" 单例, raw 149107)
          if (*(a3 + 36) == -2) *(a3 + 36) = sub_4C4470(model, target);   # raw 153370-153374 解析 targetId -> 下标
          if (*(a3 + 36) >= 0) {
              v8  = sub_4C8940(model, *(a3+36));      # raw 153378  target 的 context
              v9  = model->baseData[ *(a3+36) ];      # raw 153379
              if (!v8 || *(v9 + 12)) *(a3 + 20) = 0;  # raw 153380-153383 目标不可用 -> 不可见
              else {
                  (*(v8->vptr + 20))(v8, model, v9, *(a3+40), *(a3+44), _this[9], 0, 5);  # raw 153386-153394
                  *(a3 + 20) = 1;
              }
              *(float *)(a3 + 24) = *(float *)(v9 + 24);   # raw 153397-153399 继承 target 的 opacity
          } else sub_4BFE00("Target BaseData[%s] is not available.", ...);  # raw 153403
      }
  }
  # 交换"自身点缓冲"与"父点缓冲"（双缓冲 flip）
  if (!_this[4] || _this[4] == DST_BASE) { *(a3+48) = *(a3+40); if (byte) *(a3+40) = v12; }  # raw 153411-153415
  else                                   { *(a3+48) = *(a3+44); if (byte) *(a3+44) = v12; }  # raw 153417-153421
```

⇒ **`targetId` 指向 `BDAffine` / `BDBoxGrid` / 空 时的传递链（O，确定）**：

| `targetId` | 行为 | 依据 |
|---|---|---|
| 空 / `DST_BASE` | 点 = 文件里的 `pivotPoints`，**不做任何变形**（`a3+40`/`a3+44` 直接翻转） | raw 153411-153415 |
| → `BDAffine` | `sub_4C4470` 把 `targetId` 解析成 baseData 下标 → 取该 BDAffine 的 context → 调它的**槽 +20 = `sub_4CCC60`**，把 `(row, col) = (0,0)`、`stride 5` 的点变换写进**本 DrawData 的父缓冲**；并且**继承目标的 opacity**（raw 153399） | raw 153370-153399 |
| → `BDBoxGrid` | 同上，但调它的**槽 +20 = `sub_4CEF60` → `sub_4CE040(col, row)`**，按 `(col+1)(row+1)` 点求值 | raw 153386（同一处虚调用）+ raw 158758-158766 |

`ctx+36` 是**缓存的 target 下标**（初值 -2，raw 152884 `*(_DWORD *)(v5 + 36) = -2;`），`ctx+40`/`+44` 是**两套点缓冲**（自身 / 父），`ctx+48` 是"最终用哪一套"。

### 4.4 顶点元组与缓冲布局（O，确定）

`sub_4C8320` raw 152897-152915 给每个 DrawData 的 context 分配**工作缓冲**，每顶点 **5 个 float（20 字节）**：

```
v38 = 5 * _this[9]                          # raw 152897   _this[9] = +36 = pointCount
*(ctx+40) = alloc(4 * 4 * v38)              # raw 152905   自身点缓冲
*(ctx+44) = (hasTarget) ? alloc(...) : 0    # raw 152907-152910  父点缓冲
*(ctx+48) = (byte_55E2F4) ? alloc(...) : 0  # raw 152911-152915  颜色/alpha 缓冲
```

初始化（raw 152917-152979）逐顶点写：`[0]=0`（x 占位）、`[1]=uvFromPivotPoints`、`[2]=1-v_file`、`[3]=0`（alpha）、`[4]=…`。⇒ 5-float 元组的语义是 **`{x, y, alpha, u, v}`**，其中：

| 元组偏移 | 语义 | 写入点 |
|---|---|---|
| +0 | **x** | `sub_4CBA60` raw 156142-156151（`*v20 = …`）|
| +4 | **y** | 同上（`v20[1] = …`）|
| +8 | **alpha** | 初始 0.0 raw 152933-152934；`sub_4C88B0` raw 153207 `*(float *)(*(a3+48) + 20*i + 8) = a4` |
| +12 | **u** | 初始 = pivotPoints 的 u（raw 152935）|
| +16 | **1 − v_file** | 初始 `1.0 - v`（raw 152936）|

**上传到 D3D 时只取前 3 个 float**：`sub_4C1EA0` raw 148018-148051 把每个元组的前 12 字节拷进**位置流**，UV 走另一条流（raw 147830 / raw 148056-148062 的 `stride 12` / `stride 8`）。⇒ **位置流 = `{x, y, alpha}`（12 字节/顶点），UV 流 = 8 字节/顶点。**

### 4.5 `pivotDrawOrders` / `pivotOpacities` 长度与 `∏pivots` 的关系

**结论（O，确定）：三者的长度都由文件各自的 varint 决定，oracle 里没有任何一处把它们与 `∏K_i` 比较、也没有任何一处从 `∏K_i` 计算它们的长度。** 唯一的索引是 `sub_4C9D40` 写下的**组合索引**（`ctx+4` / `ctx+52`），它的**值域**是 `∏K_i`（`sub_4CAD50` raw 155351 累乘 knot 数、raw 155321/155332/155334 产生下标），**查表大小**是 `2^m`（raw 155289），唯一的"检查"是缓冲区上限 `PIVOT_TABLE_SIZE = 65`（raw 155290，只 printf 不截断）。

⇒ "实测三者长度一致、但都 ≠ ∏pivots" **与 oracle 相容**：它们是**同一批"关键点元组"的三条平行数组**，长度 = 文件写下的元组数；而 `∏K_i` 是**索引值域**。**两者只有在"每个插值参数的 `K_i` 都等于 2"时才应当相等** —— 语料里显然不是。**`moc.ts` 不该用 `∏pivots` 做任何长度断言**（见 §9）。

> ⚠️ 另一条必须记住：读侧**没有任何越界检查**（`sub_4CAF40` raw 155492、`sub_4CB570` raw 155785、`sub_4CBA60` raw 156135-156138）。若文件给的元组数 < `∏K_i`，引擎会**静默读越界**（这是"能跑但出画错"的一类静默失败）。

### 4.6 `textureNo` / `optionFlag` / `indexArray` 的用法

**索引数组语义（`indexArray` ↔ `pointCount` ↔ `polygonCount`）——O，确定：**

* `indexArray`（objRead → tag 25/16）是**内联 int 数组**，`pointCount`(+36) 与 `polygonCount`(+40) 是独立的 i32。
* **绘制时用的是"3 个索引/多边形"的 16 位索引**：`sub_4C8620` raw 153076-153077
  ```c
  v9 = 6 * *(_DWORD *)(_this + 40);        // = 2 字节 × (3 × polygonCount)
  sub_4C1C30(v10, v9, a4 + 15);            // CreateIndexBuffer(6*polygonCount)
  ...
  memcpy(a4, *(const void **)(_this + 52), v9);   // raw 153087  从 indexArray 拷 6*polygonCount 字节
  ```
  ⇒ **`indexArray` 的字节数 = `2 × 3 × polygonCount`**，即 **三角形列表（`D3DPT_TRIANGLELIST`）**，`polygonCount` = 三角形数。
  另有 `sub_4C1EA0` raw 148068 的提交参数 `PrimitiveCount = a5 / 3`、`PrimitiveType = 4`（= `D3DPT_TRIANGLELIST`），**确证三角列表、不是 strip**。
  如果文件里的 `indexArray` 元素数不是 `3*polygonCount`，`memcpy` 会**读越界**（oracle 无长度校验）；[推测] 语料里应当恒等于 `3*polygonCount`。
* `pointCount` 用于**顶点缓冲容量**：`sub_4C1C10(dev, 8 * _this[9], ...)`（raw 153050，`_this[9]` = +36 = `pointCount`）⇒ **每顶点 8 个 float（32 字节）**；`sub_4C8620` 的 VB 创建同样是 `CreateVertexBuffer(len, 8, ...)`（raw 153050 / raw 147990 的 FVF 常量 `8`）。

**`textureNo` 的用法（O，确定）**：

* 字段本体在 +32（raw 153293）。
* 它**不直接**在 DrawData 的绘制里用；`sub_4C85A0` raw 153010/153013/153017 **只用它做"纹理是否已绑定"的门控**：
  ```c
  *(_BYTE *)(a3 + 52) = 0;
  ...
  ++*(_BYTE *)(a3 + 52);
  if (*(_BYTE *)(v6 + 52) >= 2u) { *(a3 + 52) = 2; return; }   # 同一帧最多重试 2 次
  ```
* **真正绑纹理的是 `sub_4BD070(model, texNo, tex)` → `sub_4C2F90(ctx, texNo, tex)`**（raw 143631-143634 → raw 148602-148626）：把 `IDirect3DTexture9*` 存进 `DDTextureContext` 的**句柄数组[texNo]**（raw 148618），同时为同一 `texNo` 建一个 32 字节 `TextureInfo`（raw 148619-148624）。引擎侧只喂 `texNo = 0..9`（raw 92573 `_this[a6 + 9]`，引擎对象里的纹理句柄数组正好 10 项）。
* **绘制时的纹理槽**：`sub_4C1EA0` raw 148063-148068 `SetTexture(0, ctx+148 的顶点缓冲, 0, 12)`；raw 148069-148076 `SetTexture(1, <当前 texNo 对应的纹理>, 0, 8)`。⇒ **位置流（12 B/顶点）与 UV 流（8 B/顶点）分别绑到两条流上，各带一个采样器滤波常量。**
  > ⚠️ D3D9 设备 vtable 槽号存在**实测冲突**：`+400` 的两处调用形态（`(dev, index, obj, 0, value)`）与 `SetTexture(Stage, pTexture)` 的 2 参签名不符，反而更像 `SetStreamSource(StreamNumber, pStreamData, OffsetInBytes, Stride)`；而 `+260` 在别处被当"3 参 setter"用。**两者的确切 D3D 方法名未定**（见 §8-6）。**不影响功能结论**：`stride 12` 与 `stride 8` 分别对应位置流与 UV 流，这一点由 §4.4 的元组布局 + raw 153050/153077 的缓冲尺寸独立支持。
* `sub_4A1D50`（raw 122026，任务问的"渲染态恢复"）**不选纹理**（O，确定）：它只做 `+176 = SetTransform`（raw 122046-122048）、`+204 = SetLight` / `+212 = LightEnable`（raw 122116-122117）、`+228 = SetRenderState`（raw 122107/122108/122124）。全 `.c` 里 `sub_4A1D50` 没有任何纹理绑定调用。

**`optionFlag` 的用法（O，确定）**：

* 字段在 +44，**仅 `version >= 8` 读**（raw 153314-153339）。
* 位语义（raw 153326-153338）：
  * `optionFlag & 1` ⇒ 再读一个 i32 到 +48 = `colorGroupNo`（raw 153326-153330）
  * `(optionFlag & 0x1E) != 0` ⇒ `ctx+64 = (optionFlag >> 1) & 0xF` = **`colorCompositionType`（0..15）**（raw 153333-153334）
  * `optionFlag & 0x20` ⇒ `*(_BYTE *)(ctx + 68) = 0`（**关掉"影响颜色"标志**）（raw 153337-153338）
* 消费点（O，确定；唯一）：`sub_4C87B0`（DDTexture 槽 +20）raw 153115-153172：
  * raw 153126-153127 `if (*(int*)(_this+32) < 0) *(int*)(_this+32) = 1;`（`textureNo` 缺省兜底为 1）
  * raw 153130 `*((_BYTE *)drawParam + 24) = *(_BYTE *)(_this + 68);`（**剔除标志 → `DrawParam+24`**）
  * raw 153141 → `sub_4C8620` 建/填 VB+IB → raw 153142-153155 → `sub_4C1EA0` 提交
* **`colorCompositionType`（ctx+64 = `(optionFlag>>1)&0xF`）是混合模式选择器**（O，确定）：`sub_4C1EA0` raw 147934-148075 按它选 blend，**四种分支**：

| `colorCompositionType` | 处理 | 依据 |
|---|---|---|
| `1` | `SetRenderState(19=SrcBlend)=5(SRCALPHA)`、`(20=DestBlend)=2(ONE)` | raw 147934-147948（`v37==1` ⇒ `v38==0` 分支） |
| `2` | 有 colorGroup 时 `(19)=9(DESTCOLOR)`、`(20)=6(INVSRCALPHA)`；否则 `(19)=1(ZERO)`、`(20)=3(SRCCOLOR)` | raw 147936/147949-147948 |
| 其它（`v37==0`） | `(19)=5(SRCALPHA)`、`(20)=6(INVSRCALPHA)`（普通 alpha 混合） | raw 147964-147971 |

* **剔除**：`sub_4C1EA0` raw 147824-147828 `SetRenderState(22 /*D3DRS_CULLMODE*/, *(BYTE*)(a1+24) ? 3 : 1)` ⇒ **`DrawParam+24`（= `optionFlag & 0x20` 关掉的 +68）非 0 → 3（CCW）、为 0 → 1（NONE）**。⇒ **`optionFlag & 0x20` 的语义 = "关闭背面剔除"**（把 +68 清 0 ⇒ CULLMODE = NONE）。
* `optionFlag & 1` 多读的那个 i32（+48）在 DDTexture 路径里**没有其它读者**（全 `.c` 无命中）⇒ **无解**（[推测]：给别的 SDK 分支用）。**`moc.ts` 的 `colorGroupNo` 很可能就是把 +64 当成了它** —— 代码里没有独立的 "colorGroupNo" 字段，由 `optionFlag` 派生的颜色/混合字段只有 **+64**。
* `IDrawData+28`（ctor 置 1，raw 154353）**全 `.c` 无读者** ⇒ **无解**。
* `IDrawData+8`（= `averageDrawOrder`）在 DDTexture 路径里**没有找到读者** ⇒ 语义 **[推测]**（`pivotDrawOrders` 的 min/max 由 `sub_4C9DA0` 记到全局 `dword_552734/552738`，raw 154394-154425，那才是有读者的一对）。
* `IDrawData+12`（= `id`）在 DDTexture 路径里不被解引用；只有 generic 分支把它交给 `DrawParam`（raw 153159）⇒ 语义 **[推测]**。

---

## 5. 每帧求值入口与调用序列

### 5.1 序列（O，确定；两张 vtable 由 `.lst` 确证）

```
引擎帧绘制 sub_4B0360 (raw 134389 附近的节点循环)
  ├─ 设 Live2D 画布正交投影 D3DXMatrixOrthoLH(w, -h, -1.0, 1.0)        raw 134354
  ├─ SetTransform(3=PROJECTION / 2=VIEW / 256=WORLD)                     raw 134355/134372/134387
  └─ sub_4783D0(node, d3dDevice)                                        raw 134389
       ├─ if (!slot) 整块不出画                                          【见 §6 门控】
       ├─ if (node+21 /*待动作*/ || node+22 /*待提交*/)                    raw 92586
       │    ├─ sub_4BCCA0(node[3])   动作队列"全结束?"                        raw 92588
       │    ├─ sub_4BCA20(node[3], node[1], 1)   loop 重启                   raw 92596
       │    └─ sub_4BCB50(node[3], *node /*= SDK 模型*/)  ★★参数回写         raw 92603
       ├─ if (node+23 /*眨眼门控*/) sub_4BC550(node[4], *node)               raw 92605/92606
       ├─ SetVertexShader(NULL)  ← 顶点着色器清空，回固定管线                  raw 92607/92609
       ├─ (*(*node)->vptr[+8])(*node)   ★★模型绘制                         raw 92610
       │     = sub_4BD060 → DDTextureContext/ModelContext 绘制路径
       └─ (*(*node)->vptr[+12])(*node)  结束帧                              raw 92611
```

`sub_4783D0` 内 `*node` 是 `Live2DModelD3D*`（vtable `.data:0052E4FC`）：`+4 = sub_4BD390`（update）、`+8 = sub_4BD060`（draw）、`+12 = sub_4BD080`（endFrame）、`+16 = sub_4BD090`。

**`*node` 的 `+8` 里发生了什么（O，确定）**：
`sub_4BD060` raw 143627 `return sub_4C4320(*(_DWORD **)(_this + 8), *(_DWORD *)(_this + 12));` ⇒ `ModelContext::draw(Context*, DrawParam*)`，`sub_4C4320` raw 149645-149695：

```
sub_4C4320(ctx /*ModelContext*/, drawParam):
  n = count(ctx[17])                    # raw 149659  ctx+68: (u16 数组: drawOrder -> baseData 下标)
  drawParam->vptr[+4](drawParam)         # raw 149661  DrawParam::setup（开始一帧）
  for i in 0 .. n:                       # raw 149666-149692
      bd = ctx[17][i]                    # raw 149668  u16
      if bd == 0xFFFF: continue          # raw 149669
      while (1):                         # raw 149671  ★沿 ctx+76 的 u16 链表遍历"同 drawOrder 的链"
          data = ctx[15][bd]             # raw 149674  = baseData[bd]
          if (data+20 /*visible*/ && !data+12 /*!clip*/):       # raw 149675
              data+16 = baseDataID[data+32]+4                   # raw 149678  继承 opacity
              dctx = ctx[12][bd]                              # raw 149679  = 该 baseData 的 IDrawContext
              dctx->vptr[+20](dctx, drawParam, ctx, data)      # raw 149680  ★★真正按 drawData 画
          next = ctx[19][bd]              # raw 149683  u16 链表 next
          if (next <= bd || next == 0xFFFF) break             # raw 149684
          bd = next
```

`dctx->vptr[+20]` 的实现者就是 **`DDTexture` 的槽 +20 = `sub_4C87B0`**（raw 153116-153172）：

```
sub_4C87B0(ddctx /*=DrawData 的 context*/, drawParam, ctx, data):
  if (*(data+12)) return                                    # raw 153124  已画过
  if (ddctx->texNo < 0) ddctx->texNo = 1                     # raw 153126-153127
  alpha = data[6] * data[4] * data[2]                        # raw 153128  ← 三个 float 相乘（RGBA 的 a）
  drawParam->vptr[+?] = ddctx->+68                           # raw 153130
  if (dynamic_cast<DrawParam_D3D*>(drawParam)):              # raw 153132-153140
      sub_4C8620(ddctx, d3dParam, ctx, data)                 # raw 153141  建/填 VB+IB
      sub_4C1EA0(d3dParam, ..., ddctx->+32, 3*ddctx->+40, ddctx->+36, ddctx->+52, texNo, ddctx->+60, alpha, ...)
                                                             # raw 153142-153155  ★D3D 提交
```

⇒ **任务问的"vtable 的 update/draw 是哪个函数、走 `DrawParam_D3D` 还是别的"**：

* 模型对象是 **`Live2DModelD3D`**（不是裸 `ALive2DModel`）；`update` = `+4 = sub_4BD390`（raw 143759，`sub_4C5050` raw 150311），`draw` = `+8 = sub_4BD060`（raw 143625），`endFrame` = `+12 = sub_4BD080`。
* **`sub_4783D0` 只调 `+8` 和 `+12`，不调 `+4`**；参数回写走独立的 `sub_4BCB50`（raw 92603）。
* **绘制确实走 `DrawParam_D3D`**：`sub_4C87B0` raw 153132 用 `type_info::operator==` + `__RTDynamicCast` 把 `DrawParam*` 转成 `DrawParam_D3D*`（RTTI 名在 raw 153138-153139），转成功走 `sub_4C8620`+`sub_4C1EA0`（D3D9 路径），转失败走 `a2->vptr[+8]`（**CPU/通用路径**，raw 153160-153169，传 `3*polygonCount` 个索引）。⇒ **两条路径都存在，`DrawParam_D3D` 是 D3D9 专用支。**
* `DrawParam_D3D` vtable = `.data:0052EC04`（`.lst`）：`+0 = sub_4C39E0`（析构）、`+4 = sub_4C19E0`（raw 147517，**设置 Live2D 全套 D3D 渲染态**）、`+8 = sub_4C3290`（raw 148781，**发起 `DrawIndexedPrimitive`**）、`+12 = sub_4C2AC0`、…

### 5.2 `sub_4BCB50` 到底做什么

`sub_4BCB50` raw 143340-143433（`MotionQueueManager::updateParam`）：

* 遍历 `this[1]`（`MotionQueueEnt` 的 `LDVector`：`+4` = base、`+8` = count，raw 143368-143373）。
* 每个 ent：`+8` = `AMotion*`，调 `sub_4BFFF0(ent[2], model, ent)`（raw 143379）→ 内部按 `fps/fadein/fadeout` 算权重（`sub_4C8D00` raw 153438 = `1 - cos(πx)` 型缓入）后进 `Live2DMotion::updateParam`（`sub_4BDB40` raw 144130）→ 最终 `sub_4C43D0` raw 143792 → `sub_4C43D0` raw 149698 **写 `ParamDefSet+4` 的 float 值池**（raw 149731），并做 min/max 钳位（raw 149720-149729）。
* `ent+13` = "已结束"，`ent+12` 在 raw 143380/143381 被读；结束时移出队列（raw 143390-143394 / raw 143400-143416）。
* **`sub_4BCB50` 不碰变形器、不碰顶点**——它只把动作曲线写进参数值池。

⇒ 每帧顺序：**动作曲线 → 参数值池（`sub_4BCB50`）→ 模型 draw（`sub_4BD060`）→ 每个 drawData 的 context 求值（`sub_4C85A0`/`sub_4C8BC0`/`sub_4CCC60`/`sub_4CDFD0`）→ 建 VB/IB + 提交（`sub_4C8620`/`sub_4C1EA0`）**。**没有"先 update 再 draw"的两段式** [推测：`+4` 的 `sub_4BD390` 由别处的动画帧循环调用，`sub_4783D0` 路径里不调]。

---

## 6. 纹理绑定与 572B 节点门控

| 项 | 结论 | 依据 |
|---|---|---|
| `sub_4BD070(model, texNo, tex)` | `return sub_4C2F90(_this[3], a2, a3);` —— `_this[3]` = 模型对象 +12 的 `DDTextureContext` | raw 143631-143634 |
| 纹理槽存储 | `DDTextureContext+128` = 句柄数组 base、`+132` = 容量；`*(base + 4*texNo) = tex`；同时 `+104` 的 `TextureInfo` 数组[texNo] 建一个 32B 对象 | raw 148610-148624 |
| `texNo` 范围 | 数组按需增长（无硬上限）；引擎只喂 **0..9** | raw 148609-148616 / raw 92573 |
| **`sub_4A1D50` 是否选纹理** | **否**。只有 `SetTransform(+176)` / `SetLight(+204)` / `LightEnable(+212)` / `SetRenderState(+228)` | raw 122046-122048 / 122107-122124 |
| 绘制时用哪个纹理 | `sub_4C1EA0` raw 148063-148068 `SetTexture(0, 顶点缓冲, 0, 12)`；raw 148071-148076 `SetTexture(1, 当前 texNo 的纹理, 0, 8)` | raw 148063-148076 |
| 门控（572B 节点） | `if (LODWORD(v28[LODWORD(v29[1]) + 13953]))` —— 引擎对象 `+55812` 的 10 槽句柄数组；槽空则整块不出画 | raw 134320；装载写点在 raw 121675/121687 |

---

## 7. v8 / v10 / v11 差异核对（对 `moc.ts` 现有分支）

| `moc.ts` 现状 | oracle 事实 | 判定 |
|---|---|---|
| `version >= 8` ⇒ 读 `optionFlag`(+`&1` 时 `colorGroupNo`) | **成立**：raw 153314 `if ((int)a2[1] < 8) +44 = 0; else { +44 = i32; if (+44 & 1) +48 = i32; }`；另有 raw 143889 的 `0x88888888` 文件尾校验也在这个阈值 | ✅ 正确，但**理由写错容易走偏**：`>=8` 不是"对象级分支"，而是 `DDTexture`/`IDrawData` 的 `optionFlag` 段 + 文件尾 `0x88888888` |
| `version >= 10` ⇒ `AffineEnt` 读 2 个 bool | **成立**：raw 156907-156915（`+24`/`+25`） | ✅ 正确 |
| `version >= 10` ⇒ `BDAffine` / `BDBoxGrid` / `DrawData` 读 `pivotOpacities`(内联 float 数组) | **成立**：`a2[1] >= 10` ⇒ `sub_4C1660`（raw 158838-158843，BDAffine 存 `_this[4]`；BDBoxGrid 同函数 raw 158701 之后） | ✅ 正确 |
| `version >= 11` ⇒ `DrawData` 读 `clipId` | **❌ 错误 / 永远不执行**：全 `.c` 无 `>= 11` 分支（`grep '>= 11'` 无命中）；`sub_4BD560` raw 143882 只接受 `v5 <= 10`，**v11 文件会被 raw 143912 拒绝加载**。⇒ 这段分支既无 oracle 依据、也永远进不去 | ❌ 应删除或标为"oracle 不存在" |
| （隐含）`version >= 8` ⇒ `PartsData` 的读法变化 | **不存在**：`sub_4C9EF0` raw 154477-154487 无条件读 2 个 bit + 3 个 objRead | ⚠️ 需确认 `moc.ts` 未按版本切 `PartsData` |
| `PartData.locked/visible` 取自同一字节 bit7/bit6 | **成立**：`sub_4C6E30` raw 151830-151852 是**MSB 优先的位流**：`_this[18]` 读一字节，`(byte >> (7 - used)) & 1`；`sub_4C9EF0` raw 154481 先调一次 ⇒ **bit7 = `locked`**（写 `+5`），raw 154482 再调 ⇒ **bit6 = `visible`**（写 `+4`） | ✅ 正确 |
| `optionFlag & 0x1E` ⇒ `colorCompositionType = (optionFlag>>1) & 0xF` | **成立**：raw 153333-153334 | ✅ 正确（但 `moc.ts` 若只存 `&1` 的 colorGroupNo 就漏了这两条） |
| 版本上限 | 无 | ⚠️ 建议 `moc.ts` 显式拒绝 `> 10`（对齐 raw 143882） |
| `a2[1] >= 10` 里的 `a2` 是什么 | `BReader*`；`a2[1]` = **`BReader+4` = 版本号**（由 `sub_4BD560` raw 143881 写入）。**不是"moc 头 4 字节字"** | ⚠️ 文档/注释里若写成"头字"要改 |

---

## 8. 无解 / 未确证（不许编）

| # | 项 | 状态 | 已查范围 |
|---|---|---|---|
| 1 | 「顶点组数 / ∏pivots = 1/2/3/4/5/9」这组比值的**分母口径** | **oracle 侧已给出语义答案（见 §3.4）**：索引值域是 `∏K_i`、查表大小是 `2^m`，两者只在 `K_i≡2` 时相等；oracle 里**没有**任何代码把 `pivotPoints.length` 与这两个量换算或校验。**比值集合 {1,2,3,4,5,9} 对乘法不封闭（缺 6、8）⇒ 它不可能是"沿参数子集重算 ∏K"的结果**，最可能是 `moc.ts` 的 `∏pivotCounts` 与 oracle 的 `∏K_i` **口径不同**（[推测]；`moc.ts` 在 `app/` 下禁读，无法证实） | 全 `.c` 的 `pivotPoints`/`affines`/`pivotCount`/`pivotIndex` 每一处读写；`sub_4C7870`（raw 152325-152745）全分支；`sub_4CAD50`/`sub_4CAB10`/`sub_4CAF40`/`sub_4CB570`/`sub_4CBA60` 每一行 |
| 2 | 18490 个 `AffineEnt` 的**确切槽位映射** | **结论已给（§2.2），但"语料字节真的写了 tag 15 数组在那里"是 [推测]**。oracle 侧的证据是"读 + 用"双重（raw 156978 读、raw 157373 用），但 `.moc` 字节本身无法从 oracle 观察 | 全 `.c` 对 `sub_4CC8C0` 的引用（只有 raw 154713 与 raw 157008/157016）；`sub_4CCB10`/`sub_4CCB60`/`sub_4CCFB0`/`sub_4CC960` 全文；`sub_4C7220` 全部 24 个 `readObject` 点；`.lst` `.data:0052F098/0052F0AC` |
| 3 | `ParamDefSet`（tag 137）**与 `PivotManager`（tag 66）共用同一个反编译函数体** `sub_4CA9B0` raw 155012（identical-code folding：`.lst` `.data:0052EF00` 与 `.data:0052EF44` 都 `dd offset sub_4CA9B0`）⇒ 两者读法完全一致（各读 1 个对象进 `+4`） | **已解答**（不是缺口），但 `.c` 里看不到两个独立函数体，容易误判成"缺实现" | `.lst` `.data:0052EF00` / `.data:0052EF44` |
| 4 | `sub_4C1660` 返回值到底是"裸 float*"还是 `LDVector<float>*` 对象 | **已解答**：是 `LDVector<float>*`（raw 147371 `live2d__LDVector_float____vftable_`，`.lst` `.data:0052E6A4`），元素数**来自流的 varint**（raw 147355）。消费者把它当"`+4` = 数据基址、`+8` = 元素数"的向量用（`sub_4CB570` raw 155785 `*(_DWORD *)(a4 + 4) + 4 * …`） | `sub_4C1660` raw 147339-147405、`sub_4CAF40` raw 155403-155497、`sub_4CB570` raw 155700-155790 |
| 5 | `PartsData`/`DrawData` 的 context 由谁建、存哪 | **部分**：`sub_4C4320` raw 149679 `ctx[12][bd]` 取 `IDrawContext*`、raw 149674 `ctx[15][bd]` 取 `baseData` —— `ctx+48`/`ctx+60` 两套数组；但 `ModelContext` 的构造（`sub_4C3B80` raw 149192）如何从 `ModelImpl` 的 parts/draw 列表填这些数组未逐行读完 | raw 149192-149245 只读了部分 |
| 6 | 两处**未定**的"管线细节"：(a) `ByteBuffer+56`（字节交换开/关）与 `byte_551F84` 的实际组合；(b) D3D9 设备 vtable 槽 `+400` / `+260` 的确切方法名 | **两项都无解，且都不影响本报告的语义结论** | (a) `sub_4C0DF0` raw 146872 / `sub_4C0F50` raw 146990 的**不交换**分支要求 `byte_551F84 == *(_BYTE *)(_this + 56)`（`.lst`：`byte_551F84` 初值 1、`sub_4C0BC0` 给 `ByteBuffer+56` 写 1 ⇒ 应走不交换）；但同一 `.c` 里 `sub_4C1270`/`sub_4C13A0`/`sub_4C14E0` 又**无条件交换**（raw 147192/147260/147325），两者不能同时成立。查过：`sub_4C0BC0` raw 146773-146800、`sub_4C0DF0` raw 146850-146895、`sub_4C0F50` raw 146967-147013、`sub_4C1270` raw 147157-147202、`sub_4C13A0` raw 147206-147266、`sub_4C14E0` raw 147269-147335、`byte_551F84` raw 5692。(b) `+400` 的 5 参调用形态（raw 148063/148071）与 `SetTexture` 的 2 参签名不符，更像 `SetStreamSource`；`+260` 又在 raw 147830 被当 3 参 setter 用。查过：raw 147824-147835、148056-148076、149077 |
| 7 | [表外] 语料侧 `pivotPoints.length` / `col`/`row` / `pivotCounts` 的实际分布 | **本次未拿到**：为独立复核 §3.4 我写了一个一次性探针 `.tmp/mocprobe.mjs`（纯本地、非 oracle；**未采用其任何输出**），但受第 6 项的大小端/编码歧义影响，首个对象的 tag 序列读成 `136 → 137 → 15 → 9(=未实现类型)`，与 `sub_4BD560`/`sub_4CA280` 的读序不符，故探针未产出可信数据。要落地 §3.4 必须用能逐字节解析 `.moc` 的现成工具（`app/amayui-emulator/src/tools/live2dMoc.ts`）把同一对象的这几个量一起 dump | `.tmp/mocprobe.mjs`（本次新建，可删） |

---

## 9. 对 `app/amayui-emulator/src/live2d/moc.ts` 的修正建议

> 说明：按来源纪律，本节**只陈述 oracle 事实**；我没有读 `moc.ts` 正文，凡涉及"现状"的表述均引自 `CONTEXT.md` §3/§4.1 的转述，落地前请对照实际代码。

| # | 现状（据 `CONTEXT.md` §3/§4.1） | 应改为 | oracle 依据 |
|---|---|---|---|
| 1 | `drawData.pivotPoints.length == ∏pivots` | **删除该断言**。`pivotPoints` 是"指向 float 子数组的指针向量"，长度来自文件；oracle 从不把它与 `∏pivots` 比较。**正确的不变量是 `length ≥ ∏K_i`**（`K_i` = **该 DrawData 自己的** `PivotManager` 里每个 `ParamPivots.pivotCount`），且读侧**无越界检查** | raw 153306（`pivotPoints` = objRead）；raw 155351（`a4 *= pivotCount` 累乘）；raw 155321/155332/155334（下标 = `a4*seg`）；raw 155492/155785/156135-156138（无检查的取值） |
| 2 | `drawData.pivotDrawOrders.length == ∏pivots`、`pivotOpacities.length == ∏pivots` | **删除**。两者是**两个不同读取器**的内联数组（前者 int `sub_4C14E0`，后者 float `sub_4C1660`），长度各自来自文件 varint | raw 154453（`a4=1` → `sub_4C14E0`）；raw 154456（`a4=0` → `sub_4C1660`）；`sub_4C7220` `case 25` raw 152266-152276 |
| 3 | `bdAffine.affines.length ∈ {0, ∏pivots}` | **这条断言本身没错，但它掩盖了一个真 BUG**：`affines` 是 objRead（tag 15 对象数组），**内容应当就是那批 `AffineEnt`**（全语料 18490 个，`≈4.53 个/BDAffine`），运行时按元组下标直接索引（raw 157373）。**恒为 0 说明解析器把槽位/计数映射错了**，按 §2.2 的三条候选逐个核对；**不要**再把它当"正常值"或"运行时才填充" | raw 156978（第 4 个 objRead = `affines`）；raw 157373-157381（按下标取值）；raw 157169-157185（析构按元素析构）；`sub_4CCB60` raw 157006-157019（只造默认值 AffineEnt，**不是**数据来源） |
| 4 | `bdAffine.pivotOpacities.length == ∏pivots` | **删除**；改为"仅 `version >= 10` 读、内联 `LDVector<float>`、长度来自文件（raw 147355 的 varint）"；**注意它落在 `+16`**（`_this[4]`），而 `affines` 在 `+24`（`_this[6]`） | raw 158838-158843；`sub_4C1660` raw 147355；raw 156978（`_this[6]`） |
| 5 | `version >= 11` ⇒ 读 `clipId` | **删除该分支**（oracle 无 `>=11`；且 v>10 的文件在 raw 143882/143912 就被拒绝加载） | raw 143882 `if (v5 <= 10)`；raw 143912 `"Illegal data version"`；`grep '>= 11'` 无命中 |
| 6 | 版本区间 `version >= 8` / `>= 10` | **保留，但把语义写清**：`>=8` = 文件尾 `0x88888888` + `DDTexture+44` 的 `optionFlag` 块（含可选 `+48`）；`>=10` = (`AffineEnt+24/+25` 的 `reflectX/reflectY`) + (`BDAffine`/`BDBoxGrid+16` 的 `pivotOpacities`) | raw 143889（`0x88888888`）；raw 153314-153339（`+44` 块）；raw 156907-156915；raw 158838 |
| 7 | （协议）未校验版本上限 | **加**：`version > 10` 直接拒绝（与 `sub_4BD560` 一致） | raw 143882 / raw 143912 |
| 8 | 类名 | `moc.ts` 的 "DrawData" 在本作 SDK 里的 RTTI 名是 **`live2d::DDTexture`**（`DDTexture : IDrawData : ISerializableV2 : LDObject`）；**没有 `live2d::DrawData` 类、也没有 `DDTTexture`** | `.lst` 486178-486185（层次）、435521-435532（`DDTexture` vtable）；`sub_4CA280` `case 'F'`=70 raw 154715-154720 |
| 9 | 若按"`BDAffineContext` 有自己的 update/draw"建模 | **改成**：求值在 **`BDAffine`** 的虚槽上——`+12 = sub_4CCFB0`（选元组 + 混合）与 `+20 = sub_4CCC60`（把矩阵作用到点上）；`BDAffineContext`（vtable `.data:0052F0CC`）**只有析构**，字段是 `+4 owner / +8 own AffineEnt / +9 extra AffineEnt` | raw 156954-156970（`BDAffineContext` 只有一个析构）；raw 156997-157019（字段写入）；raw 157026-157076（`sub_4CCC60`） |
| 10 | `AffineEnt` 字段名/单位 | 命名为 `originX/originY(+4/+8)`、`scaleX/scaleY(+12/+16)`、`angle(+20, **度**)`、`reflectX/reflectY(+24/+25, 仅 v≥10)`；矩阵 = `R(angle·π/180) · diag(±sx, ±sy) · p + origin`，反射并入 scale 符号 | raw 156894-156914（读序）；raw 157048（`×0.017453292`）；raw 157053/157056（符号）；raw 157069-157070（展开式） |
| 11 | `BDAffine` 字段读序 | 保持 `id → targetId → pivotManager → affines → [v≥10] pivotOpacities`（**字段序是对的**）；真正要修的是 `affines` 的**内容**（见第 3 条） | raw 156977-156979（`_this[5]`/`_this[6]`）；raw 158803-158805（`_this[1]`/`_this[2]`） |
| 12 | `BDBoxGrid` 字段读序 | 保持 `id → targetId → columnCount(i32) → rowCount(i32) → pivotManager → pivotPoints → [v≥10] pivotOpacities`；**列最快变化**（`n % (col+1)` = 列） | raw 158695（`_this[6]=col` 先）；raw 158698（`_this[5]=row` 后）；raw 157905 `(row+1)*(col+1)`；raw 156127-156149（写点循环） |
| 13 | `DrawData.pivotPoints` 的第二维 | **不是固定 2**。`sub_4C7870` 外层每行是一个 **tag 27 float 数组**，长度来自文件（正常为 2，但代码不假设它等于 2）；`pivotPoints` 的元素是**指针**（指向各自 2·pointCount 个 float 的子数组） | raw 152325-152645（`size==1` 分支：`v5 = varint`，每行 `sub_4C7220`）；raw 156135-156138（元素当指针用） |
| 14 | `PartsData` 位序 | 保持 bit7=locked、bit6=visible（MSB 优先位流） | raw 151830-151852（`>> (7 - used) & 1`）；raw 154481-154482 |
| 15 | `optionFlag` 只取 `&1` | 补上（并且**改名**）：`+64 = (optionFlag>>1)&0xF` 在 oracle 里是**混合模式选择器**（`sub_4C1EA0` 按它切 SrcBlend/DestBlend，四分支见 §4.6）；`optionFlag & 0x20` ⇒ 清 `+68` ⇒ **`D3DRS_CULLMODE = NONE`（关背面剔除）**；`optionFlag & 1` 多读的 `+48` 在 DDTexture 路径**无读者**（`moc.ts` 的 `colorGroupNo` 很可能就是 `+64` 的误名） | raw 153326-153338；raw 147934-147975（blend 分支）；raw 147824-147828（cull）；全 `.c` 无 `+48` 读者 |
| 16 | `indexArray` 与 `polygonCount` 关系 | 断言 `indexArray` **元素数** `== 3 * polygonCount`（**三角形列表**、uint16）；`pointCount` 是**顶点数** | raw 153076-153087（`6*polygonCount` **字节** memcpy）；raw 148068（`DrawIndexedPrimitive(4=TRIANGLELIST, …, pointCount, 0, idxCount/3)`）；raw 153147（`3*polygonCount`） |
| 17 | 若把 `textureNo` 当"绘制时直接选纹理" | 改为：`textureNo` 用于三处——(a) `sub_4C85A0` 的"已绑/重试"门控（`ctx+52` ≤ 2）、(b) 缺省兜底（`<0 → 1`，raw 153126）、(c) 作为实参传给 `sub_4C1EA0` 选择纹理/索引缓冲记录；真正把 `IDirect3DTexture9*` 存起来的是 `sub_4BD070 → sub_4C2F90`（写 `DDTextureContext+128` 的句柄数组[texNo]） | raw 152994-153032；raw 153126-153127；raw 143631-143634；raw 148602-148624 |
| 18 | 顶点元组语义 | 工作缓冲 **5 float/顶点 = `{x, y, alpha, u, v}`**（stride 20）；上传时**只取前 3 个 float 做位置流（12 字节）**，UV 走独立流（8 字节/顶点，直接用 `+60 uvs`，且内部已存 `1−v`） | raw 152897（`5*pointCount`）；raw 152933-152936（初始化 `[2]=alpha=0`、`[3]=u`、`[4]=1-v`）；raw 153207（写 alpha）；raw 148018-148051（只拷 12 字节） |
| 19 | 若用 `∏pivots` 做"参数→元组"映射 | 改为：`m = 落在关键帧之间的参数个数`；**查表大小 `= 1 << m`**；**下标值域 `= ∏K_i`（同一个 `PivotManager` 内累乘）**——两者只在 `K_i≡2` 时相等；索引表 `sub_4CAD50`（**第 0 个 pivot 是最快变化位**）；段内 `w = (x-V[k-1])/(V[k]-V[k-1])`；端点 `±1e-4` 吸附；超界**钳到端点关键帧并置 changed** | raw 155083-155242（`sub_4CAB10`）；raw 155267-155362（`sub_4CAD50`，累乘在 raw 155351）；raw 5442（`flt_52F184`） |
| 20 | 若用"双三次固定"求曲面 | 改为：每个轴 Bernstein 次数由该轴的插值参数个数决定；`m≤4` 展开式、`m>4` 通用 Bernstein 乘积；`u` 在 `BDBoxGridContext+212`、`v[]` 从 `+216` 起；**`(row+1)*(col+1)` 是 BDBoxGrid 自己的网格点数，不是 DrawData 的点数** | raw 156133-156320（1/2/3/4 线性展开）；raw 156321-156441（default Bernstein）；raw 157918-157934（`sub_4CDFD0`）；raw 158751（`(row+1)*(col+1)` 只在 BDBoxGrid 的 updateParam 里） |
| 21 | 若把"每帧求值"实现成独立 tick | 改为：绑在**节点绘制那一次调用**上（`sub_4783D0` raw 92603 回写参数 + raw 92610 模型 draw）；没有独立逐帧 tick | raw 92579-92615（`sub_4783D0` 全文）；raw 134389（唯一调用点） |
| 22 | 绘制提交 | `DrawParam_D3D` 路径 = `sub_4C87B0`（raw 153141）→ `sub_4C8620`（建/填 VB `8*pointCount` 字节 + IB `6*polygonCount` 字节）→ `sub_4C1EA0`（`SetRenderState(22, cull)` → 按 `+64` 选 blend → `CreateVertexBuffer(FVF 8)` → `Lock` → **逐顶点 12 字节** (x,y,alpha) → `CreateIndexBuffer` → 索引 → 位置/UV 两条流 → `DrawIndexedPrimitive(4=TRIANGLELIST, NumVertices=pointCount, PrimCount=idxCount/3)`） | raw 153036-153091；raw 147755-149090（`DrawIndexedPrimitive` raw 148068；blend raw 147934-147975；cull raw 147824-147828；12 字节写 raw 148045-148051） |

---

## 10. oracle 确证的模型对象图（速查，供 `docs-new/03-engine/live2d-moc-format.md` 落库）

| tag | 类（RTTI 确证） | vftable | reader | ctor | 字段读序 |
|---|---|---|---|---|---|
| 65 | `BDBoxGrid` | `.data:0052F138` | `sub_4CEDF0` raw 158689 | `sub_4CDEC0` raw 157864 | id, targetId, **col**, **row**, pivotManager, pivotPoints, [≥10] pivotOpacities |
| 66 | `PivotManager` | `.data:0052EF44` | `sub_4CA9B0` raw 155012 | `sub_4CA990` raw 155002 | 仅一个 `<ParamPivots*>` 数组（走 `sub_4C7220`） |
| 67 | `ParamPivots` | `.data:0052F124` | `sub_4CDE00` raw 157838 | `sub_4CDD30` raw 157804 | paramIndex(i32), pivotValues(float[]), id(objRead) |
| 68 | `BDAffine` | `.data:0052F0AC` | `sub_4CCB10` raw 156974 | `sub_4CCA60` raw 156938 | id, targetId, pivotManager, affines, [≥10] pivotOpacities |
| 69 | `AffineEnt` | `.data:0052F098` | `sub_4CC960` raw 156890 | `sub_4CC8C0` raw 156844 | originX, originY, scaleX, scaleY, angle, [≥10] reflectX, reflectY |
| 70 | `DDTexture`（= DrawData） | `.data:0052EDF8` | `sub_4C8A60` raw 153284（基类部分在 `sub_4C9E20` raw 154440） | `sub_4C8200` raw 152776 | 见 §4.2 |
| 131 | `ParamDefFloat` | `.data:0052F08C` | `sub_4CC850` raw 156825 | `sub_4CC800` raw 156805 | min, max, default, paramId |
| 133 | `PartsData` | `.data:0052EEE0` 区 | `sub_4C9EF0` raw 154477 | `sub_4C9EC0` raw 154461 | bit7=locked, bit6=visible, id, baseDataList, drawDataList |
| 136 | `ModelImpl` | `.data:0052ED04` | `sub_4C6080` raw 151199 | `sub_4C5DC0` raw 151071 | paramDefSet, partsDataList, canvasWidth, canvasHeight |
| 137 | `ParamDefSet` | `.data:0052EF00` 区 | **与 tag 66 同一函数体 `sub_4CA9B0` raw 155012**（identical-code folding；`.lst` `.data:0052EF00` 与 `.data:0052EF44` 都指向它） | `sub_4CA180` raw 154614 | 仅 1 个 objRead → `+4`（`LDVector<ParamDefFloat*>`） |
| 142 | `AvatarPartsItem`（不是 Avatar） | `.data:0052F080` | `sub_4CC6A0` raw 156737 | `sub_4CC670` raw 156723 | 3 × objRead |

**对象创建/登记**（O，确定）：

* `sub_4CA280` raw 154664 = **类型 → 类的工厂**（`a2<60 → 0`；60..99 → `'A'..'F'` = 65..70；再 131/133/136/137/142 一档）。**不是"1..9/18..28 这些 throw 的编号"**——那些 throw 属于**基础对象 reader** `sub_4C7220` raw 152109-152128。
* 建完对象后由 raw 152303 `(*(...)(*(_DWORD *)v8 + 4))(v8, _this, v33)` 调该对象 vtable **+4 = 字段读取器**。
* 每个对象（含 `null`、基础数组）**后序**压进 `BReader+76` 的 refno 表（raw 152309-152319；表容量 = `_this[22]` = `BReader+88`，初值 10000 raw 152009）。
* **tag 33 = refno 引用**：`sub_4C7220` raw 152091-152101（`if (v5 == 33) { ref = sub_4C0F50(...); return *(_DWORD **)(_this[20] + 4*ref); }`）。
* `"DST_BASE"` 单例（raw 152028 字符串、raw 149107 `sub_4C3A10`）是**目标链的终止符**，被 `sub_4CCB60` raw 157012 / `sub_4C8BC0` raw 153368 当"无父目标"判据。

---

## 11. 关键地址速查（本次全部 raw 行号）

```
# 装载 / 版本 / 工厂
sub_4BD560 raw 143844    .moc 装载（magic raw 143869，版本 raw 143873/143881，上限 raw 143882，尾哨兵 raw 143889，拒绝 raw 143912）
sub_4BD0A0 raw 143649    从内存建 Live2DModelD3D
sub_4BCEB0 raw 143566    Live2DModelD3D ctor（vtable .data:0052E4FC）
sub_4C70D0 raw 151982    BReader ctor（+4 = 版本号）
sub_4C7220 raw 152026    基础对象 reader（type 0/1/10..33/50/51/60/134；default -> 工厂）
sub_4C7870 raw 152325    二维数组 reader（size==1 -> 一行 float 数组；size==2 -> 嵌套）
sub_4CA280 raw 154664    类型 -> 类工厂
sub_4C1000 raw 147037    变长整数（BE base-128）
sub_4C0F50 raw 146967    BE i32（带字节交换）
sub_4C0DF0 raw 146850    BE f32（带字节交换）
sub_4C0FE0 raw 147017    读 1 字节
sub_4C6E30 raw 151830    MSB 优先位流读一位
sub_4C14E0 raw 147269    int 向量（内联）
sub_4C1660 raw 147339    float 向量（内联）
sub_4C6E90 raw 151856    void* 向量
sub_4C9AA0 raw 154247    DrawDataID / BaseDataID 池化

# PivotManager / 参数
sub_4CA990 raw 155002    PivotManager ctor
sub_4CAA80 raw 155053    isParamChanged
sub_4CAB10 raw 155083    ★calcPivotValue（段定位 + 权重）
sub_4CAD50 raw 155267    ★buildPivotTable（组合索引表，1<<m）
sub_4CAF00 raw 155375    整数幂
sub_4CAF40 raw 155403    getPivotValueInt
sub_4CB570 raw 155701    getPivotValueFloat
sub_4C9D40 raw 154380    ★通用求值入口（写组合索引 + 属性值）
sub_4C9E20 raw 154440    IDrawData 字段 reader
sub_4C9DA0 raw 154394    记录 pivotDrawOrders 的 min/max（全局 552734/552738）

# BDAffine
sub_4CCA60 raw 156938    BDAffine ctor
sub_4CC8C0 raw 156844    AffineEnt ctor
sub_4CC8F0 raw 156863    拷贝 AffineEnt
sub_4CC930 raw 156879    AffineEnt dtor
sub_4CC960 raw 156890    AffineEnt reader
sub_4CCB10 raw 156974    ★BDAffine reader
sub_4CCB60 raw 156983    BDAffine context ctor（凭空造 AffineEnt）
sub_4CCA80 raw 156949    BDAffine 槽 +24：`return 1`（常真）
sub_4CCFB0 raw 157190    ★BDAffine 求值（选元组 + 混合）
sub_4CCC60 raw 157026    ★BDAffine 矩阵作用到点
sub_4CDB40 raw 157682    父目标链上的点的合成（offset/角度/scale）
sub_4CCA90 raw 156955    BDAffineContext dtor
sub_4CF010 raw 158798    id/targetId reader
sub_4CF050 raw 158809    ctx+20 = getPivotValueFloat(...)
sub_4CF0C0 raw 158832    [≥10] pivotOpacities reader

# BDBoxGrid
sub_4CDEC0 raw 157864    BDBoxGrid ctor
sub_4CEDF0 raw 158689    ★BDBoxGrid reader
sub_4CDEF0 raw 157883    BDBoxGrid context ctor（(row+1)*(col+1)*8 字节）
sub_4CDFD0 raw 157915    ★BDBoxGrid 求值入口
sub_4CEE70 raw 158704    继承父点缓冲的求值
sub_4CEF60 raw 158758    vtable+20 -> sub_4CE040
sub_4CE040 raw 157941    曲面求值内核
sub_4CBA60 raw 155982    ★Bernstein 曲面/UV 求值（m<=4 展开，m>4 通用）

# DrawData / DDTexture
sub_4C8200 raw 152776    DDTexture ctor
sub_4C8320 raw 152835    ★DrawData context ctor（VB 8*N / IB 6*poly）
sub_4C85A0 raw 152994    UV 求值（写 ctx+52 = 组合索引）
sub_4C8620 raw 153036    建/填 VB+IB + SetIndices(+416)
sub_4C8770 raw 153095    释放
sub_4C87B0 raw 153116    ★DrawData 槽+20（走 DrawParam_D3D）
sub_4C88B0 raw 153177    写 alpha
sub_4C8970 raw 153241    DDTexture dtor
sub_4C8A30 raw 153275    DDTextureContext dtor
sub_4C8A60 raw 153284    ★DrawData reader
sub_4C8BC0 raw 153345    ★DrawData 槽+16（targetId 传递）
sub_4C9050 raw 153674    AMemoryHolder ctor

# 绘制 / D3D
sub_4C1C10 raw 147579    CreateVertexBuffer 包
sub_4C1C30 raw 147585    CreateIndexBuffer 包
sub_4C1EA0 raw 147755    ★★D3D 提交（DrawIndexedPrimitive raw 148068）
sub_4C19E0 raw 147517    DrawParam_D3D 渲染态设置
sub_4C2960 raw 148211    DrawParam_D3D ctor
sub_4C2F90 raw 148602    ★纹理槽存储
sub_4C39E0 raw 149097    DrawParam_D3D dtor
sub_4C4320 raw 149645    ★★ModelContext::draw
sub_4C43D0 raw 149698    ★参数值钳位写入
sub_4C4470 raw 149750    BaseDataID -> baseData 下标
sub_4C4FD0 raw 150281    ParamID -> 参数下标
sub_4C5050 raw 150311    ModelContext::update
sub_4C2EA0 raw 148531    释放 DrawParam_D3D 缓冲

# 引擎侧
sub_4783D0 raw 92578    ★★572B 节点绘制（唯一每帧入口）
sub_478270 raw 92524    节点 ctor（76B）
sub_478330 raw 92556    挂 SDK 模型
sub_478490 raw 92618 / sub_4784B0 raw 92630   模型宽/高
sub_4A1860 raw 121664   模型装载进实例槽
sub_4A1D50 raw 122026   变换/渲染态恢复（不选纹理）
sub_4B0360 raw 134277   ★★引擎 Live2D 帧绘制入口
sub_4BC550 raw 143041   眨眼状态机（写参数）
sub_4BCB50 raw 143339   ★动作队列推进（写参数值池）
sub_4BCA20 raw 143281   动作队列 loop 重启
sub_4BCCA0 raw 143435   动作队列"全结束?"（整数除法）
sub_4BD060 raw 143624   模型 draw 槽（+8）
sub_4BD070 raw 143630   ★纹理槽设置
sub_4BD080 raw 143636   结束帧槽（+12）
sub_4BD390 raw 143758   模型 update 槽（+4）
sub_4BDB40 raw 144127?  Live2DMotion::updateParam
sub_4BFFF0 raw 14610x   AMotion::update（fade/loop）
sub_4C8D00 raw 153438   缓入曲线 1-cos(πx)
sub_4531B0 raw 65397    引擎节点渲染（3 矩阵喂 shader）

# 常量
flt_52F184 raw 5442  = 9.9999997e-05   （关键帧端点容差 ε）
flt_52F1B0 raw 5444  = 0.017453292     （度 -> 弧度）
flt_52F1B4 raw 5445  = 57.29578        （弧度 -> 度）
flt_526954 raw 4686  = 2.0             （flt_526954 用作"点数 = 2^m"的底）
flt_529294 raw 4920  = -0.1            （父目标链角度修正）
flt_52CAC4 raw 5183  = -1.0            （OrthoLH 的 zn）
flt_52F0F4 lst       = -10.0           （父目标链偏移放大/反向）
dword_552734/552738 raw 5697-5698 = 500 （pivotDrawOrders 的全局 min/max 记录）
```

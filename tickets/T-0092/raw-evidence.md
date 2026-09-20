# T-0092 raw 证据（-11 分支）

> 采集时间：2026-09-20（IMPLEMENTATION 子代理）。全部行号：
> `.c` = `engine/天结_unpacked.exe_utf8.c`（184091 行），`.lst` = `engine/天结_unpacked.exe_utf8.lst`（526189 行）。

## 1. `sub_41A820` 的 -11 分支：**权威是 listing，不是 .c**

函数定义：`.c:25628` / `.lst:41409`。

`.lst:41433-41454`（原文逐字）：

```text
.text:0041A84C                 cmp     eax, 0FFFFFFF5h
.text:0041A84F                 jnz     short loc_41A896
.text:0041A851                 mov     edx, [esi+0AA514h]
.text:0041A857                 mov     eax, [edx+4]
.text:0041A85A                 push    offset aSetSaveversion_0 ; "set:SaveVersion2"
.text:0041A85F                 lea     ecx, [esi+0AA514h]
.text:0041A865                 mov     dword ptr [esi+5D884h], 0FFFFFFFFh
.text:0041A86F                 call    eax
.text:0041A871                 mov     edx, [esi+0AA514h]
.text:0041A877                 push    eax
.text:0041A878                 mov     eax, [edx+4]
.text:0041A87B                 push    offset aSetSaveversion ; "set:SaveVersion1"
.text:0041A880                 lea     ecx, [esi+0AA514h]
.text:0041A886                 call    eax
.text:0041A888                 push    eax
.text:0041A889                 mov     ecx, esi
.text:0041A88B                 call    sub_40F750
.text:0041A890                 pop     edi
.text:0041A891                 pop     esi
.text:0041A892                 mov     esp, ebp
.text:0041A894                 pop     ebp
.text:0041A895                 retn
```

`.c:25649-25660`（**Hex-Rays 误渲染**，仅作对照）：

```c
    if ( v2 == -11 )
    {
      v3 = *(int (__thiscall **)(int))(*(_DWORD *)(_this + 697620) + 4);
      *(_DWORD *)(_this + 383108) = -1;
      v4 = v3(_this + 697620);
      v5 = (*(int (__thiscall **)(int, char *, int))(*(_DWORD *)(_this + 697620) + 4))(
             _this + 697620,
             aSetSaveversion,
             v4);
      sub_40F750((_DWORD *)_this, v5, (int)aSetSaveversion_0);
      return;
    }
```

### 为什么 .c 错了（栈走一遍）

`sub_4904D0`（vtable 槽 +4）= `.lst:241306-241335`，`retn 4` ⇒ **单参** `GetConfig(key)`：

```text
.text:004904D0 sub_4904D0      proc near               ; DATA XREF: .data:005297E0↓o
.text:004904D4                 mov     esi, [ebp+lpText]      ; lpText = dword ptr 8
.text:004904DB                 call    sub_428E00             ; 查表：取不到 ⇒ MessageBoxA("不正なキー") + 0
.text:004904F7                 retn    4
```

`00AA514h` = 配置注册表对象 `Reg` 的 vtable 槽 1（`.data:005297E0` = `sub_4904D0`；槽 +12 = `sub_492AB0` =
写）。栈（`B` = `push edi` 之后的 ESP）：

| 指令 | ESP | 栈上内容（自顶向下） |
|---|---|---|
| `push eax`(R2) | B-4 | R2 |
| `push aSetSaveversion` | B-8 | SV1str, R2 |
| `call eax`（`retn 4` ⇒ 只吃 key） | B-4 | R2 |
| `push eax`(R1) | B-8 | R1, R2（B-8 的 SV1str 被覆盖） |
| `call sub_40F750`（`retn 8`） | B | `[ebp+8] = R1 = a2`、`[ebp+0Ch] = R2 = a3` |

`sub_40F750` 的 prologue（`.lst:27067-27070`）确认 `arg_0 = dword ptr 8`（a2）、`arg_4 = dword ptr 0Ch`（a3）。
⇒ **a2 = GetConfig("set:SaveVersion1")、a3 = GetConfig("set:SaveVersion2")**，`_this[95777] = -1`。

同型误渲染的旁证：`0x42D5F4`（`.lst:73654-73670`）也是"先 push 一个后面才用到的实参、中间夹一次
`GetConfig`"，`.c:38169-38170` 同样把版本号渲染成字符串常量 `aSetSaveversion_0`。

## 2. `sub_40F750`（`.c:18876-18951`，`retn 8`）分派表

listing 侧只有这两种被调：`sub_40ED40`（`.lst:0040F78B / 0040F845 / 0040F900 / 0040FA46`）、
`sub_4380F0`（`.lst:0040FA15 / 0040FB55`）。**没有任何 `_CxxThrowException` / exit 调用**。

| a2 | a3 | 行为 |
|---|---|---|
| 1 | 10 | `sub_40ED40(this, _this[96981], _this[96981], _this[263*cur+124365])` + 还原表下标（`124626`/`498500` 起） |
| 1 | 20 | 同上，槽位组 `129938`/`130199`/`520792` |
| 1 | 其它 | `return result`（raw 18899）—— **什么都不做** |
| 2 | — | `sub_40ED40(…, _this[261*cur+140771])` + 恢复 ip/返回栈（`140772`/`140773+i`）+ `return sub_4380F0(_this+5191)` |
| 3 | — | 同上，槽位组 `156524`/`156525`/`156526` |
| 其它 | — | `return result`（raw 18934）—— **什么都不做** |

`sub_4380F0`（`.c:45094-45103`）= `_this[259] = _this[260]; _this[258] = timeGetTime()/1000;`（存档对象的
时间戳，不是退出）。

## 3. `-11` 的两个写入点（全库仅此两处：`grep '383108)'`）

都在 `sub_410160`（`.c:19276`，签名 `(a1, a2, a3, a4, a5, a6, a7)`；`a4` = 槽格式，`a5` = 版本 2）。

① `.c:19557-19579`（`a4 == 1 && a5 == 20` 的 `case 20` 走完 switch 落到 `LABEL_136`）：

```c
        v20 = sub_455000((_DWORD *)(a1 + 680092), String2);
        *(_DWORD *)(a1 + 383120) = 1;      // load_in_progress = 1
        *(_DWORD *)(a1 + 383104) = 0;      // cur = 0
        if ( v20 < 0 )
        {
          sub_40F750((_DWORD *)a1, 1, 20); // 回调打不开 ⇒ 当场直接装记录
          goto LABEL_137;
        }
        break;
      default:
        goto LABEL_137;
    }
    v81 = v20;
    v80 = *(void **)(a1 + 387924);
  LABEL_136:
    *(_DWORD *)(a1 + 383108) = -11;                 // ← 写点①（= _this[95777]，fields.json: call_ret）
    sub_40ED40(a1, v21, v80, v81);                  // 把 CALLBACK_LOAD 装进帧 0
    goto LABEL_137;
```

② `.c:19690-19701`（`a4 == 2`）：

```c
    v46 = sub_455000((_DWORD *)(a1 + 680092), String2);
    *(_DWORD *)(a1 + 383120) = 1;
    *(_DWORD *)(a1 + 383104) = 0;
    if ( v46 >= 0 )
    {
      *(_DWORD *)(a1 + 383108) = -11;               // ← 写点②
      sub_40ED40(a1, v47, *(void **)(a1 + 387924), v46);
    }
    else
    {
      sub_40F750((_DWORD *)a1, 2, a5);              // 打不开回调 ⇒ 当场直接装记录
    }
```

③ `a4 == 3`（本机真槽全是这一支）**没有自己的 `-11` 写点** —— 它在 `.c:19916-19927` 也 `goto LABEL_136`：

```c
      v79 = sub_455000((_DWORD *)(a1 + 680092), String2);
      *(_DWORD *)(a1 + 383120) = 1;
      *(_DWORD *)(a1 + 383104) = 0;
      if ( v79 < 0 )
      {
        sub_40F750((_DWORD *)a1, 3, a5);
        goto LABEL_137;
      }
      v81 = v79;
      v21 = *(_DWORD *)(a1 + 387924);
      v80 = (void *)v21;
      goto LABEL_136;                                 // ⇒ 写点①
```

⇒ **哪些 (a4,a5) 会武装 `-11`**（逐 case 读 `switch (a5)` 的出口）：

| a4 | a5 | 出口 | 是否走 `-11` |
|---|---|---|---|
| 1 | 0 | `.c:19441` `goto LABEL_137`（**不调 `sub_40F750`**） | ✗ |
| 1 | 10 | `.c:19462` `if (!a6) goto LABEL_137;` → 否则 `v20 = sub_455000(...)`；`v20 < 0` ⇒ `.c:19474` `sub_40F750(1,10)` 直接装；否则 `.c:19477 break` → `.c:19574` → `LABEL_136` | ✓（回调打得开且 a6≠0；打不开则当场直接装） |
| 1 | 20 | `.c:19567` `v20 < 0 ⇒ sub_40F750(1,20)`；否则 `break` → `LABEL_136` | ✓（同上） |
| 2 | * | 行内写 `-11` + `sub_40ED40`（`.c:19695`）；`v46 < 0` ⇒ `sub_40F750(2, a5)` | ✓ |
| 3 | * | `.c:19916-19927` `goto LABEL_136` | ✓ |

★即"`LABEL_136` 是三组共用的写点"（1/10、1/20、3/*），`a4==2` 有一份行内等价副本；
四种情况下 `v20/v46/v79 < 0`（= 打不开 `CALLBACK_LOAD`，`String2`）都退化成**当场直接** `sub_40F750(a4, a5)`
（`.c:19567`/`19700`/`19921`）—— 这正是 emulator `save-slot.ts:371-382` 那个"按名读不到回调 ⇒ 直接装记录 0"
分支的引擎依据。

## 4. `-11` 如何进到帧记录的 [0] 格

`.c:18636-18637`（`sub_40ED40` 装载时把 `call_ret` 抄进当前帧）：

```c
  *(_DWORD *)(a1 + 120 * *(_DWORD *)(a1 + 383104) + 383184) = a4;                       // scriptId
  *(_DWORD *)(a1 + 120 * *(_DWORD *)(a1 + 383104) + 383180) = *(_DWORD *)(a1 + 383108);  // return_frame ← call_ret
```

`sub_41A820` 开头读的就是这一格：`.c:25645` `v2 = *(_DWORD *)(_this + 120*cur + 383180);`。

## 5. 配置侧：`set:SaveVersion1/2` 的**全部**写入者（`grep aSetSaveversion` 的写侧）

| .c 行 | 内容 | 性质 |
|---|---|---|
| 111711 / 111713 | `sub_434D00(map, "set:SaveVersion1", &1)` / `(…, "set:SaveVersion2", &0)` | 注册表构造默认值（`sub_491880`） |
| 112666 / 112668 | 由一条 `SAVEVERSION`（`v10`）拆出 `v10/100` 与 `v10%100` | 注册表/INI 装载（`sub_494220` 系） |
| 112826-112833 | `!get(Menu:Save) && get(SV1)==1 && !get(SV2)` ⇒ 写 `SV1=1, SV2=10` | 一次迁移 |

⇒ `sub_41A820` 的 -11 分支**不在其中**（它只调 vtable 槽 +4 = `sub_4904D0`，写侧是槽 +12 = `sub_492AB0`，
本分支一次都没调）。审计 `op-2-10` 的"读配置 `set:SaveVersion1` 并把结果写回"是 Hex-Rays 误渲染的产物。

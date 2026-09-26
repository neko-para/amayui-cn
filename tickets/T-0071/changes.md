# T-0071 · 过程文档（changes.md）

## 2026-09-26

2026-09-27（由 T-0187 触发）：本条的前提被真机只读实测推翻 —— 装载的 memset 长度是**池容量** Engine+382952（实测 0x708ADC = 7,375,836），不是文件里的 count（1,015,792）⇒ 下标 [count, capacity) 装载后为 0。模拟器已按引擎改为 globals.int.clear() 后写回文件非零值（float/string 本来就是 clear()）；守卫 = test/slot-load-resume.test.ts 的「整池清零」用例。若 ADV 出现「背景/网格参数丢失」，缺的是装载路径的**重新派生**，不是保留旧值。

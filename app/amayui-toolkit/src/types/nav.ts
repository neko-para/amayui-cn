/**
 * 卡片/视图抽象（数据查看/检索/跳转 + 内存历史的基础）。
 *
 * 下半区是一个**通用渲染容器**，只认「当前视图」——一个有序卡片列表（View）。
 * 卡片内部把可点引用渲染成 RefChip，点击 → navigate([targetCard]) 直接替换整个下半区。
 * 后续可通过此抽象实现 URL 路由 / 更快的浏览历史。
 */

import type { Item, Building, Recipe } from './metadata';
/** 卡片类型 */
export type CardKind = 'item' | 'unit' | 'building' | 'recipe' | 'map' | 'location' | 'message';

/** 具体的卡片描述（每种卡片只需最小定位信息，其余由 dataset 反查） */
export type CardSpec =
  | { kind: 'item'; id: number }
  | { kind: 'unit'; id: number } // id = unit.unitId
  | { kind: 'building'; id: number }
  | { kind: 'recipe'; productId: number } // 按 productId 定位配方（type1 或 type2）
  | { kind: 'map'; mapNo: number } // mapNo = 十进制（0x121e2+mapNo 为名地址；由 byMapNum 反查）
  | { kind: 'location'; locationId: number } // 抽象地点（0x1216e+locationId 为名地址；由 byLocation 反查）
  | { kind: 'message'; text: string };

/** 当前视图 = 有序卡片列表（下半区直接渲染） */
export type View = CardSpec[];

/** 数据类型标签（用于展示/徽标/搜索分组） */
export type EntityTag = 'item' | 'unit' | 'building' | 'map' | 'location';

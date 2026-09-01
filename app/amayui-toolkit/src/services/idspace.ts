/**
 * 各实体的 **id 空间**：id 与「名串地址」的换算，以及卡片/搜索共用的展示格式。
 *
 * 工程里每类实体的 id 都是**名串地址减去一个基址**（1-based），各基址互不相干：
 * 物品与建筑的 id 会重叠（如 id 51 既是「城砦拡張図面Ⅰ」也是「小さな家（黄）」），
 * 因此 id 必须**连同它所属的 id 空间**一起解释。
 *
 * 这些基址原先散落在 `dataset.ts` 的搜索项构造与各卡片里，改一处易漏；统一收敛到本模块。
 * 详见 `docs/re/src/` 各篇与 `app/amayui-toolkit/docs/03-数据模型与数据管道.md`。
 */

/** id 空间 → 名串基址（名串地址 = 基址 + id） */
export const ID_BASE = {
  item: 0x18e40,
  building: 0x1f5ba,
  unit: 0x17ab6,
  map: 0x121e2,
  location: 0x1216e,
  skill: 0x1d4f4,
} as const;

export type IdSpace = keyof typeof ID_BASE;

/** id 空间 → 中文类型名（卡片徽标 / 搜索标签共用） */
export const ID_SPACE_LABEL: Record<IdSpace, string> = {
  item: '物品',
  building: '设施',
  unit: '单位',
  map: '地图',
  location: '地点',
  skill: '技能',
};

/**
 * 名串地址（十六进制小写、无 `0x` 前缀）。
 * 与搜索框接受的 16 进制查询串**同形**，故卡片上显示的地址可直接粘回搜索框定位。
 */
export function addrHex(space: IdSpace, id: number): string {
  return (ID_BASE[space] + id).toString(16);
}

/** id 本身（十六进制小写，无 `0x` 前缀）——全站 id 一律按 16 进制展示 */
export function idHex(id: number): string {
  return id.toString(16);
}

/**
 * 卡片徽标统一格式：`<类型> #<id16> · <名串地址16>`。
 * 例：物品「青铜导键」(id=1) → `物品 #1 · 18e41`；技能「防御」(id=1) → `技能 #1 · 1d4f5`。
 */
export function entityTagLabel(space: IdSpace, id: number): string {
  return `${ID_SPACE_LABEL[space]} #${idHex(id)} · ${addrHex(space, id)}`;
}

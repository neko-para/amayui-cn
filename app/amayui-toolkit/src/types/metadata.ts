/**
 * 天結いキャッスルマイスター —— 元数据（metadata）统一类型契约
 *
 * 数据来源：工程根 `src/`（权威数据源）中的 ITINIT / PLINIT / ALINIT / EBINIT 脚本。
 *           提取脚本 `scripts/extract-metadata.mjs` 将这些反推结果归一化为单一 `metadata.json`。
 * 注意：
 *   - `metadata.json` 是**中间产物**（不入 git），由 src 重新生成。
 *   - 名称统一来自 `src` 的 `set-string … "日文|中文"`：`name` 为 `|` 前半（日文），
 *     `nameZh` 为 `|` 后半（汉化）；若某名未汉化，则 `nameZh === name`。
 *   - 物品/建筑是两套独立 id 空间（`0x18e40` / `0x1f5ba`），产品名通过 `productRef` 消歧。
 *
 * 本文件是**前端消费**的权威类型；提取脚本产出与之同构的 JSON。
 */

/** 当前 schema 版本（变更需 bump，前端按版本兼容） */
export const METADATA_SCHEMA_VERSION = 1;

/** 数据源目录：权威 = src/ */
export const SOURCE_TREE = 'src' as const;

/* ---------------------------------- 基础 ---------------------------------- */

/** 带 id 与 日/中 名称的基础实体 */
export interface Named {
  /** 数字 id（物品 = 名串地址 − 0x18e40；建筑 = 名串地址 − 0x1f5ba） */
  id: number;
  /** 日文名（`set-string` 值 `日文|中文` 的 `|` 前半） */
  name: string;
  /** 中文名（`|` 后半；未汉化时与 `name` 相同） */
  nameZh: string;
  /** 定义它的源脚本文件名（如 ITINIT.txt / $1$ITINIT.txt / PLINIT.txt） */
  source: string;
}

/** 物品（id 空间 0x18e40） */
export interface Item extends Named {
  /** 是否可合成：是否出现在某条物品配方(productRef='item')的产品中。 */
  craftable: boolean;
}

/** 建筑 / 设施（id 空间 0x1f5ba，来自 PLINIT） */
export interface Building extends Named {
  /* 占位：未来可扩充建筑专属字段 */
}

/* ---------------------------------- 配方 ---------------------------------- */

/** 配方类型：1=物品合成，2=建筑/设施 */
export type RecipeType = 1 | 2;

/** 产品 id 使用哪套名表（物品 0x18e40 / 建筑 0x1f5ba） */
export type ProductRef = 'item' | 'building';

/** 单项材料需求（材料必为物品，名字由 items 反查） */
export interface MaterialRequirement {
  itemId: number;
  count: number;
}

/** ALINIT 中一行配方（物品与建筑共用同一结构，用 type + productRef 区分） */
export interface Recipe {
  type: RecipeType;
  productId: number;
  productRef: ProductRef;
  /** 日文产品名 */
  product: string;
  /** 中文产品名（来自 src 中文名） */
  productZh: string;
  /** 来源 ALINIT 脚本文件名 */
  source: string;
  /** 该行未知元数据（保序字符串数组，形如 `6bb1d7(3e8)=a21c`），语义未定 */
  metadata: string[];
  /** 材料清单（保序） */
  materials: MaterialRequirement[];
}

/* ---------------------------------- 单位掉落 ---------------------------------- */

/** 掉落率语义：未定。当前值域多为 5..64(100)，可能是掉落率或权重。 */
export type RateMeaning = 'percent' | 'weight' | 'unknown';

/** 一条掉落（rate/item 由 EBINIT 的 (rate@53eXXX, item@53dXXX) 双+1 配对） */
export interface DropEntry {
  itemId: number;
  /** 十进制掉落率/权重（语义未定，见 rateMeaning） */
  rate: number;
  /** 率 hex 原值 */
  rateRaw: string;
  /** 物品 id hex 原值 */
  itemRaw: string;
  rateMeaning: RateMeaning;
}

/** 单位（敌人/怪物；可玩角色名册已被排除，无掉落表者 drops 为空） */
export interface Unit {
  /** 名字串地址（十进制；如 0x17b6c = 狂える男） */
  unitId: number;
  name: string;
  nameZh: string;
  /** 副标题 / 阵营种族（日文） */
  title: string;
  /** 副标题 / 阵营种族（中文） */
  titleZh: string;
  /** 名字串在对应脚本中的行号 */
  nameLine: number;
  /** 是否有掉落表 */
  hasDrops: boolean;
  /** 掉落条目（可能为空） */
  drops: DropEntry[];
}

/* ---------------------------------- 聚合入口 ---------------------------------- */

/** 各表计数与统计 */
export interface MetadataCounts {
  items: number;
  buildings: number;
  recipes: number;
  itemRecipes: number;
  buildingRecipes: number;
  units: number;
  unitsWithDrops: number;
  dropEntries: number;
  distinctDropItemIds: number;
}

/** 统一后的元数据（单一 `metadata.json`） */
export interface Metadata {
  schemaVersion: number;
  generatedAt: string;
  sourceTree: typeof SOURCE_TREE;
  note: string;
  counts: MetadataCounts;
  items: Item[];
  buildings: Building[];
  /** 全部配方（type 1 物品 + type 2 建筑） */
  recipes: Recipe[];
  units: Unit[];
}

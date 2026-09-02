/**
 * 天結いキャッスルマイスター —— 元数据（metadata）统一类型契约
 *
 * 数据来源：工程根 `src/`（权威数据源）中的 ITINIT / PLINIT / ALINIT / EBINIT / STINIT / STINIT2 / SKINIT 脚本。
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
export const METADATA_SCHEMA_VERSION = 8;

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

/** 掉落率语义：暂按百分比理解（100=必定掉落）。 */
export type RateMeaning = 'percent' | 'weight' | 'unknown';

/** 一条掉落（rate/item 由 EBINIT 的 (rate@53eXXX, item@53dXXX) 双+1 配对） */
export interface DropEntry {
  itemId: number;
  /** 十进制掉落率，按百分比理解（100 = 必定掉落；rateMeaning='percent'） */
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
  /** 种族值（EBINIT `0x52a0b4 + unitId`；枚举见下），null=无 */
  race: number | null;
  /** 性别值（EBINIT `0x52a49c + unitId`；1=男 2=女 3=无性别），null=无 */
  gender: number | null;
  /** 属性值（EBINIT `0x52b054 + unitId`；1=物理 2=地脉 3=冷却 4=火炎 5=电击 6=神圣 7=暗黑），null=无（如 0xcb 系留系神殿兵） */
  attribute: number | null;
  /** 捕获星级（EBINIT `0x5461ec + unitId`；**0-based**：0=★1 .. 4=★5），null=无（0xcb 系留系神殿兵） */
  star: number | null;
}

/** 种族枚举（数值 → 名称），与 `Unit.race` 对应 */
export const RACE_NAME: Record<number, string> = {
  0x1: '人族', 0x2: '亜人', 0x3: '一般', 0x4: '鬼', 0x5: '巨人',
  0x6: '精霊', 0x7: '天使', 0x8: '悪魔', 0x9: '魔獣', 0xa: '幻獣',
  0xb: '霊体', 0xc: '不死', 0xd: '創造', 0xe: '魔神', 0xf: '特殊',
};

/** 性别枚举（数值 → 名称），与 `Unit.gender` 对应 */
export const GENDER_NAME: Record<number, string> = {
  0x1: '男', 0x2: '女', 0x3: '无性别',
};

/** 属性枚举（数值 → 名称），与 `Unit.attribute` 对应；与 DRINIT 训练所「类型-属性」同构 */
export const ATTR_NAME: Record<number, string> = {
  0x1: '物理', 0x2: '地脉', 0x3: '冷却', 0x4: '火炎', 0x5: '电击', 0x6: '神圣', 0x7: '暗黑',
};

/* ---------------------------------- 地图 / 地图内单位（STINIT + STINIT2 + EBINIT） ---------------------------------- */

/** 地图内一个单位槽（单位 id 行 14dd<0x40+i> 的前/后字段）。字段语义见 docs/地图内单位.md。 */
export interface MapUnit {
  /** 单位名串地址 = 0x17ab6 + 单位槽寄存器 id；与 `units[].unitId` 同键，用于反查单位名。 */
  unitRef: number;
  /**
   * 前部「是否可从刷怪点刷新」：`1` 可刷怪点刷出、`2` 疑似出击旗（待验证）、`null` 固定摆位/无此标记。
   * （EBINIT 掉落/单位表之外，这块是 STINIT 每关的单位槽自己的放置/刷新属性。）
   */
  spawnFlag: number | null;
  /** 前部「阵营」：`2` 敌方(红)、`3` 中立友方(黄绿)、`4` 中立敌方(黄)；`null` 未知。语义待验证。 */
  faction: number | null;
  /** 前部「放置坐标-行」（地图左上角为原点，1-based）；`null` 表示无固定位置。 */
  row: number | null;
  /** 前部「放置坐标-列」（地图左上角为原点，1-based）；`null` 表示无固定位置。 */
  col: number | null;
  /** 后部「等级下限」（`+0x1E`）；`null` 未知。 */
  levelMin: number | null;
  /** 后部「等级上限」（`+0x3C`，通常 = 下限 + 10）；`null` 未知。 */
  levelMax: number | null;
  /** 前/后其它尚未定义的字段（offset→值，作为 hex 字符串），保序显示用。 */
  extra: { off: string; val: string }[];
}

/** 一张地图（关卡） */
export interface MapData {
  /** mapNo（`eq (local-int 0) (global-int b222) <mapNo>` 第三个参数，hex 字符串） */
  mapNo: string;
  name: string;
  nameZh: string;
  /** 出现该地图的源脚本文件名（如 STINIT.txt / $1$STINIT.txt） */
  source: string;
  /**
   * 该地图所属地点 id（= STINIT2 场景 loc 字段值；地点 id = 名串地址 − 0x1216e）。
   * `null` = 无标准战场地点（事件/特殊图，loc 为 -1 或未定义）。
   */
  locationId: number | null;
  /** 场景在所属地点内的序号（STINIT2 场景 seq 槽 = 0x14e8c9 + sceneIdx；用于地点内排序） */
  seq: number | null;
  /** 该地图内的单位槽（按 STINIT 中出现顺序） */
  units: MapUnit[];
}

/* ---------------------------------- 地点 / 场景（STINIT2 loc 字段） ---------------------------------- */

/**
 * 抽象地点：由 STINIT2 场景记录的 loc 字段（= 地点 id）归并而成。
 * 地点 id = 地点名 `set-string` 地址 − 0x1216e；loc 槽 = 0x14e4e1 + sceneIdx，seq 槽 = loc + 0x3e8。
 * `sub 0 1` → loc = -1（无地点），此类场景所属为 null。
 */
export interface Location {
  /** 地点 id（0x1216e 编号） */
  locationId: number;
  name: string;
  nameZh: string;
  /** 定义它的源脚本文件名（如 STINIT2.txt） */
  source: string;
  /** 该地点包含的地图 mapNo（十进制字符串，去重；由 byMapNum 反查地图）
   *  —— 作为「地点 → 地图」的跳转键。 */
  maps: string[];
}

/* ---------------------------------- 技能（SKINIT） ---------------------------------- */

/**
 * 技能：SKINIT 的**技能名 + 三行描述文案**（日/中双份）。
 *
 * 地址模型（三段并列定长数组，stride = 0x3e8 = 1000，按 skillId 直接算地址）：
 * ```
 *   name  = 0x1d4f4 + skillId                    技能名
 *   short = 0x1d4f4 + 0x3e8 + skillId            单行简述（= 0x1d8dc + skillId）
 *   title = 0x1d4f4 + 2*0x3e8 + 2*skillId        题头（= 0x1dcc4 + 2*skillId）  ← 2 槽/技能的配对段
 *   body  = 0x1dcc4 + 2*skillId + 1              详述
 * ```
 * 全量实证见 `docs/re/src/05-技能数据.md`：450 个技能、id 稀疏分布于 1..803，
 * base 与 `$1$`..`$5$` 六个 SKINIT 之间零地址冲突。
 *
 * 注：`mov` 数值字段（威力/射程/消耗等）尚未提取，语义未定。
 */
export interface Skill {
  /** 技能 id = 名串地址 − 0x1d4f4（稀疏，实测 1..803） */
  skillId: number;
  /** 技能名（日文） */
  name: string;
  /** 技能名（中文） */
  nameZh: string;
  /**
   * 描述第 1 行 · 题头：`【<分类>：<技能名>（假名）】　<属性后缀>`。
   * 无描述的内部状态技能（如 #40 進行不可）为 `null`。
   */
  title: string | null;
  titleZh: string | null;
  /** 描述第 2 行 · 详述（多以全角空格起首，含射程/命中/消耗等文案）。无描述时 `null`。 */
  body: string | null;
  bodyZh: string | null;
  /** 描述第 3 行 · 单行简述（列表用紧凑摘要）。无描述时 `null`。 */
  short: string | null;
  shortZh: string | null;
  /** 是否带完整三行描述（false = 仅有名字的内部状态技能，实测仅 #40） */
  hasDesc: boolean;
  /** 定义它的源脚本文件名（如 SKINIT.txt / $3$SKINIT.txt） */
  source: string;
  /** 技能名串在源脚本中的行号 */
  nameLine: number | null;
}

/* ---------------------------------- 训练配方（DRINIT） ---------------------------------- */

/**
 * 一条训练配方（DRINIT）：训练者单位（四结骑 + 双傀）**消耗**满足条件的单位。
 *
 * TID = 描述串地址 − 0x1d490（块内槽）。字段按「K − TID」归位（见 docs/re/src/06-训练所数据.md）：
 *   - race/gender/attribute 用与 `Unit` 同构的枚举（RACE_NAME/GENDER_NAME/ATTR_NAME）。
 *   - 这些是**被消耗单位**的条件，不是训练者自身的属性（训练者自身见 `Unit.race/gender/attribute`）。
 */
export interface Training {
  /** 训练者单位 id（四结骑 + 双傀：0x32..0x38） */
  trainerId: number;
  /** 训练者名（日文） */
  trainerName: string;
  /** 训练者名（中文） */
  trainerNameZh: string;
  /** 训练内容槽（块内，1-based；base 1..0x36、追加 $3$ 从 0x37 续） */
  tid: number;
  /** 文案（日文） */
  text: string;
  /** 文案（中文） */
  textZh: string;
  /** 来源脚本文件名（DRINIT.txt / $3$DRINIT.txt） */
  source: string;
  /** 游戏内渲染顺序键（0x6c5595；按此升序展示），null=无 */
  order: number | null;
  /** 前置要求（0x6c55f9）；null=无 */
  prereq: number | null;
  /** 数量（0x6c565d） */
  quantity: number | null;
  /** 类型-种族（0x6c56c1），枚举同 `Unit.race` 的 RACE_NAME；null=无 */
  race: number | null;
  /** 类型-性别（0x6c5725），枚举同 `Unit.gender` 的 GENDER_NAME；null=无 */
  gender: number | null;
  /** 类型-属性（0x6c5789），枚举同 `Unit.attribute` 的 ATTR_NAME；null=无 */
  attribute: number | null;
  /** 等级（0x6c57ed，≧★N 的 N−1）；null=无 */
  level: number | null;
  /** 效果-技能 id（0x6c6085），可与 `skills[].skillId` 交叉反查；null=无 */
  skillId: number | null;
}

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
  maps: number;
  mapUnitEntries: number;
  mapUnitDistinctUnits: number;
  mapSpawnableEntries: number;
  locations: number;
  mapsWithLocation: number;
  /** 技能总数（SKINIT base + $1$..$5$ 合并） */
  skills: number;
  /** 带完整三行描述的技能数（其余为仅有名字的内部状态技能） */
  skillsWithDesc: number;
  /** 训练配方总数（DRINIT base + $3$ 合并） */
  trainings: number;
  /** 训练者单位数（四结骑 + 双傀） */
  trainers: number;
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
  /** 全部地图（关卡）与其内单位槽 */
  maps: MapData[];
  /** 全部抽象地点（场景按地点归并；地图 ↔ 地点互跳） */
  locations: Location[];
  /** 全部技能（SKINIT 技能名 + 三行描述文案） */
  skills: Skill[];
  /** 全部训练配方（DRINIT；训练者单位消耗满足条件的单位） */
  trainings: Training[];
}

#!/usr/bin/env node
/**
 * extract-metadata.mjs
 * 从工程根 `src/`（权威数据源）提取并归一化游戏元数据 → `app/amayui-toolkit/public/data/metadata.json`。
 *
 * 产物是**单一、统一、带中文名**的元数据，是前端 `fetch('./data/metadata.json')` 直接消费的数据。
 * 该文件为**衍生物**（`src/` 是权威源；CI 在 deploy 分支构建时重新生成），`public/` 已 gitignore。
 *
 * 关键事实（逆向确认）：
 *   - 名称来自 `src` 的 `set-string (global-string <addr>) "日文|中文"`（管道分隔）：
 *       物品 id = addr − 0x18e40；建筑/设施 id = addr − 0x1f5ba。
 *   - 配方表 ALINIT：每行 = 行标记(1 物品|2 建筑) + 产品(id) + 若干元数据(6b*) + {材料id,数量}*。
 *   - 单位 EBINIT：相邻 (名字串 17a-17e, 副标题串 17f-181) 的一组 set-string 对开新块；
 *       掉落表 = 交错 (rate@53eXXX, item@53dXXX) 双 +1 配对。
 *
 * 用法: node scripts/extract-metadata.mjs
 *   （可覆盖：`AMAYUI_SRC_DIR`、`AMAYUI_OUT_DIR`）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');                 // app/amayui-toolkit
const PROJECT_ROOT = path.resolve(APP_ROOT, '..', '..');        // 工程根
const SRC_DIR = path.resolve(process.env.AMAYUI_SRC_DIR || path.join(PROJECT_ROOT, 'src'));
const OUT_DIR = path.resolve(process.env.AMAYUI_OUT_DIR || path.join(APP_ROOT, 'public/data'));
const OUT_FILE = path.join(OUT_DIR, 'metadata.json');

const BASE_ITEM = 0x18e40;        // 物品 id 基数
const BASE_BUILDING = 0x1f5ba;    // 建筑/设施 id 基数
const BASE_UNIT = 0x17ab6;        // 单位名 addr = BASE_UNIT + 单位 id（1-based；单位统一用 1-based 下标而非名串地址）
const ITEM_ADDR_MAX = 0x1a000;    // 物品名地址上限
const BASE_SKILL = 0x1d4f4;       // SKINIT 技能名基址（skillId = 名串地址 − 0x1d4f4）
const SKILL_STRIDE = 0x3e8;       // 技能表段长 = 1000（三段并列数组的 stride）
const SKILL_SHORT_BASE = BASE_SKILL + SKILL_STRIDE;       // 0x1d8dc：单行简述段
const SKILL_DESC_BASE = BASE_SKILL + 2 * SKILL_STRIDE;    // 0x1dcc4：题头/详述配对段（2 槽/技能）
const SCHEMA_VERSION = 9;         // v9：trainings 新增「效果-耐性/能力值」多槽数组（6c5851 / 6c5b71）
const RACE_ADDR = 0x52a0b4;       // 单位种族：race_val = RACE_ADDR + unitId
const GENDER_ADDR = 0x52a49c;     // 单位性别：gender_val = GENDER_ADDR + unitId
const ATTR_ADDR = 0x52b054;       // 单位属性：attr_val = ATTR_ADDR + unitId
const STAR_ADDR = 0x5461ec;       // 单位星级：star_val = STAR_ADDR + unitId（0-based：0=★1 .. 4=★5）
const TID_BASE = 0x1d490;         // DRINIT 训练内容槽基数：TID = 描述串地址 − 0x1d490

// 训练「效果」**多槽数组**（K−TID=字段id 只对单槽字段成立；此处按 基址+槽 对齐，见 docs/re/src/06-训练所数据.md）：
//   效果-耐性    6c5851[配方×8 + 槽]，槽 0..7 → 無属/物理/地脈/冷却/火炎/電撃/神聖/暗黒（名表 INIT2 0x1f542+槽）
const RES_EFFECT_BASE = 0x6c5851, RES_EFFECT_STRIDE = 8;
const RES_NAME = ['無属', '物理', '地脉', '冷却', '火炎', '电击', '神圣', '暗黑'];
//   效果-能力值  6c5b71[配方×13 + 槽]，槽 0..12 → 命中/回避/物攻/物防/魔攻/魔防/敏捷/運/移動/ＣＰ/ＨＰ/ＳＰ/ＦＳ
//   （与 REACH 顶部状态名表 local-string 1..d 一致）
const ATTR_EFFECT_BASE = 0x6c5b71, ATTR_EFFECT_STRIDE = 13;
const STAT_NAME = ['命中', '回避', '物攻', '物防', '魔攻', '魔防', '敏捷', '運', '移動', 'ＣＰ', 'ＨＰ', 'ＳＰ', 'ＦＳ'];

/* ------------------------- 名称解析（src set-string "日|中"） ------------------------- */

/** 解析一行 `set-string (global-string <addr>) "jp|zh"` → {addr,name,nameZh} | null */
function parseNameLine(line) {
  const m = line.match(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
  if (!m) return null;
  const addr = parseInt(m[1], 16);
  const { jp, zh } = splitNameLine(m[2]);
  return { addr, name: jp, nameZh: zh };
}

/** 拆 `"日文|中文"` → {jp, zh}（无 | 时 zh=jp） */
function splitNameLine(seg) {
  const i = seg.indexOf('|');
  const jp = i < 0 ? seg : seg.slice(0, i);
  const zh = i < 0 ? seg : seg.slice(i + 1);
  return { jp, zh };
}

/**
 * 收集名表：扫 src 下匹配 fileRe 的文件，按 id = addr − base 建 Map<id,{id,name,nameZh,source}>。
 * 遇同名 id 保留首次；skipPrefix 用于剔除说明串（如建筑 `【施設：…】`）。
 */
function collectNames({ fileRe, base, addrMin, addrMax, idMin = 1, idMax = Infinity, skipPrefix }) {
  const out = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => fileRe.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p) continue;
      const id = p.addr - base;
      if (id < idMin || id > idMax) continue;
      if (p.addr < addrMin || p.addr > addrMax) continue;
      if (skipPrefix && skipPrefix.test(p.name)) continue;
      if (out.has(id)) continue;
      out.set(id, { id, name: p.name, nameZh: p.nameZh, source: f });
    }
  }
  return out;
}

const itemName = collectNames({
  fileRe: /itinit\.txt$/i,
  base: BASE_ITEM,
  addrMin: BASE_ITEM + 1,
  addrMax: ITEM_ADDR_MAX,
});
const buildingName = collectNames({
  fileRe: /plinit\.txt$/i,
  base: BASE_BUILDING,
  addrMin: BASE_BUILDING + 1,
  addrMax: BASE_BUILDING + 0x2d0,
  idMax: 0x2cf,
  skipPrefix: /^【/,
});

/* ------------------------- 配方表 ALINIT ------------------------- */

function parseAlinit(file) {
  const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  const movs = [];
  for (const l of text.split(/\r\n|\r|\n/)) {
    const m = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (m) movs.push({ addr: m[1], value: m[2] });
  }
  const isProductOfType = (type, v) => {
    const id = parseInt(v, 16);
    if (!Number.isFinite(id)) return false;
    return type === 1 ? itemName.has(id) : buildingName.has(id);
  };
  const isMarkerAt = (k) => {
    const val = movs[k].value;
    if (val !== '1' && val !== '2') return false;
    if (!/^6ba[5-9ab]/.test(movs[k].addr)) return false;
    return movs[k + 1] && isProductOfType(parseInt(val, 16), movs[k + 1].value);
  };

  const recipes = [];
  let i = 0;
  while (i < movs.length) {
    if (!isMarkerAt(i)) { i++; continue; }
    const type = parseInt(movs[i].value, 16);
    const productId = parseInt(movs[i + 1].value, 16);
    const productAddr = movs[i + 1].addr;
    let j = i + 2;
    const metadata = [];
    const cvals = [];
    let inMeta = true;
    while (j < movs.length && !isMarkerAt(j)) {
      const a = movs[j].addr;
      if (a.startsWith('6c')) { inMeta = false; cvals.push(movs[j].value); }
      else if (inMeta && a.startsWith('6b')) {
        const off = (parseInt(a, 16) - parseInt(productAddr, 16)).toString(16);
        metadata.push(`${a}(${off})=${movs[j].value}`);
      }
      j++;
    }
    const materials = [];
    for (let k = 0; k + 1 < cvals.length; k += 2) {
      materials.push({ itemId: parseInt(cvals[k], 16), count: parseInt(cvals[k + 1], 16) });
    }
    if (materials.length) {
      const ref = type === 1 ? itemName : buildingName;
      const ent = ref.get(productId);
      recipes.push({
        type,
        productId,
        productRef: type === 1 ? 'item' : 'building',
        product: ent ? ent.name : '',
        productZh: ent ? ent.nameZh : '',
        source: file,
        metadata,
        materials,
      });
    }
    i = Math.max(j, i + 2);
  }
  return recipes;
}

const recipes = [];
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /alinit\.txt$/i.test(x)).sort()) {
  recipes.push(...parseAlinit(f));
}
const itemRecipes = recipes.filter((r) => r.type === 1);
const buildRecipes = recipes.filter((r) => r.type === 2);

/* ------------------------- 单位 + 掉落 EBINIT ------------------------- */

function parseEbinit() {
  const allFiles = fs.readdirSync(SRC_DIR).filter((x) => /ebinit\.txt$/i.test(x)).sort();
  const units = [];
  const seenUnitId = new Set();
  for (const file of allFiles) {
    const lines = fs.readFileSync(path.join(SRC_DIR, file), 'utf8').split(/\r\n|\r|\n/);
    const ops = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const l = lines[idx];
      if (!l.trim()) continue;
      const ms = l.match(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
      if (ms) {
        const addr = parseInt(ms[1], 16);
        // 单位名 / 副标题均保留（不做「可玩角色」过滤）。kind 仅用于区分 set-string 与 mov。
        const kind = (addr >= 0x17a00) ? 'str' : 'str';
        const p = parseNameLine(l);
        ops.push({ line: idx + 1, kind, addr, name: p.name, nameZh: p.nameZh });
        continue;
      }
      const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
      if (mm) ops.push({ line: idx + 1, kind: 'mov', addr: parseInt(mm[1], 16), value: parseInt(mm[2], 16), valueRaw: mm[2] });
    }
    const isSetString = (op) => op.kind !== 'mov';   // set-string（name/sub/str 皆保留）
    const unitHeaders = [];
    for (let i = 0; i < ops.length - 1; i++) {
      const a = ops[i], b = ops[i + 1];
      // 相邻 set-string 对：第一个为单位名、第二个为副标题（命名地址升序）
      if (isSetString(a) && isSetString(b) && a.addr < b.addr) unitHeaders.push({ start: i, nameOp: a, subOp: b });
    }
    const isItem = (a) => (a & 0xffff000) === 0x53d000;
    const isRate = (a) => (a & 0xffff000) === 0x53e000;

    function extractDrops(startIdx, endIdx) {
      const kEnd = Math.min(endIdx, ops.length);
      const pairs = [];
      let k = startIdx;
      let lastRate = null, lastItem = null;
      while (k + 1 < kEnd) {
        const r = ops[k], it = ops[k + 1];
        if (r.kind === 'mov' && it.kind === 'mov' && isRate(r.addr) && isItem(it.addr)) break;
        k++;
      }
      while (k + 1 < kEnd) {
        const r = ops[k], it = ops[k + 1];
        if (r.kind === 'mov' && it.kind === 'mov' && isRate(r.addr) && isItem(it.addr)
            && (lastRate === null || (r.addr === lastRate + 1 && it.addr === lastItem + 1))) {
          pairs.push({ rate: r, item: it });
          lastRate = r.addr; lastItem = it.addr; k += 2;
          continue;
        }
        break;
      }
      return pairs;
    }

    for (let u = 0; u < unitHeaders.length; u++) {
      const h = unitHeaders[u];
      const start = h.start;
      const end = (u + 1 < unitHeaders.length) ? unitHeaders[u + 1].start : ops.length;
      if (seenUnitId.has(h.nameOp.addr)) continue;    // 跨文件按 单位名地址 去重（地址空间不重叠，去重仅兜底）
      // 单位自身 per-unit struct 字段：种族/性别/属性（详见 docs/re/src/07-单位种族与性别字段.md）
      // 依 1-based unitId 直接读全局 mov 表；缺值为 null（如 0xcb 系留系神殿兵 属性位在 src 中为空白）。
      const unitId = h.nameOp.addr - BASE_UNIT;
      const unitField = (base) => {
        const op = ops.find((o) => o.kind === 'mov' && o.addr === base + unitId);
        return op ? op.value : null;   // op.value 已是十进制数（parseInt(mm[2],16)），勿再转一次
      };
      const raceVal = unitField(RACE_ADDR);
      const genderVal = unitField(GENDER_ADDR);
      const attrVal = unitField(ATTR_ADDR);
      const starVal = unitField(STAR_ADDR);
      const pairs = extractDrops(start + 2, end);
      const drops = pairs.map(({ rate, item }) => ({
        itemId: item.value,
        rate: rate.value,
        rateRaw: rate.valueRaw,
        itemRaw: item.valueRaw,
        rateMeaning: 'percent',
      }));
      units.push({
        unitId,   // 统一 1-based 下标（addr − 0x17ab6），与地图 unitRef(=op.val) 同键
        name: h.nameOp.name,
        nameZh: h.nameOp.nameZh,
        title: h.subOp.name,
        titleZh: h.subOp.nameZh,
        nameLine: h.nameOp.line,
        source: file,
        hasDrops: drops.length > 0,
        drops,
        race: raceVal,
        gender: genderVal,
        attribute: attrVal,
        star: starVal,
      });
      seenUnitId.add(h.nameOp.addr);
    }
  }
  return units;
}

const units = parseEbinit();

/* ------------------------- 地图 + 地图内单位（STINIT/STINIT2） ------------------------- */

const BASE_MAP = 0x121e2;   // 地图名 addr = BASE_MAP + mapNo
// (BASE_UNIT 已提升到顶部常量区)
const UNIT_REG_BASE = 0x14dd00;
const UNIT_MIN = 0x41, UNIT_MAX = 0x5d;
const isMk = (a) => (a & 0xffffff00) === UNIT_REG_BASE && (a & 0xff) >= UNIT_MIN && (a & 0xff) <= UNIT_MAX;

/** 地图名表：addr → { name, nameZh, source } */
function collectMapNames() {
  const byAddr = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p) continue;
      if (!byAddr.has(p.addr)) byAddr.set(p.addr, { ...p, source: f });
    }
  }
  return byAddr;
}
const mapNameByAddr = collectMapNames();

/**
 * 解析所有 STINIT：把每个地图块的单位槽按 (mapNo, 单位槽寄存器 id) 合并成索引。
 * 注意：同一场景(mapNo)在 base + $1..$5 的 STINIT 里各出现一次（单位子集不同），
 *   这里按 mapNo 归并、并以「单位槽寄存器 id(addr&0xff)」去重（后续文件覆盖前面的），
 *   得到每张场景地图的**完整**单位清单。不含掉落（掉落走 EBINIT）。
 */
const unitByMapNo = new Map(); // mapNo → Map<registerId, MapUnit>
for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit\.txt$/i.test(x)).sort()) {
  const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  const ops = [];
  for (const l of text.split(/\r\n|\r|\n/)) {
    if (!l.trim()) continue;
    const me = l.match(/eq \(local-int 0\) \(global-int b222\) ([0-9a-f]+)(\s|$)/);
    if (me) { ops.push({ kind: 'map', mapNo: me[1] }); continue; }
    const mm = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (mm) { ops.push({ kind: 'mov', addr: parseInt(mm[1], 16), val: parseInt(mm[2], 16) }); continue; }
  }
  // 按地图块切分：[map header] .. [下一 map header)
  const headers = ops.map((o, i) => ({ o, i })).filter((x) => x.o.kind === 'map');
  for (let bi = 0; bi < headers.length; bi++) {
    const start = headers[bi].i;
    const end = bi + 1 < headers.length ? headers[bi + 1].i : ops.length;
    const mapNo = ops[start].mapNo;
    let slots = unitByMapNo.get(mapNo);
    if (!slots) { slots = new Map(); unitByMapNo.set(mapNo, slots); }
    for (let idx = start; idx < end; idx++) {
      const op = ops[idx];
      if (op.kind !== 'mov') continue;
      if (!isMk(op.addr)) continue;
      const K = op.addr;
      const regId = (op.addr & 0xff).toString(16);
      // 前部：单调递减、窗口 [K-0xF0,K]
      let j = idx, last = K;
      const pre = new Map();
      while (j > 0) {
        const a = ops[j - 1];
        if (a.kind === 'mov' && a.addr < last && a.addr >= K - 0xF0) { pre.set(K - a.addr, a.val); last = a.addr; j--; } else break;
      }
      // 后部：单调递增、窗口 [K,K+0xF0]
      let k = idx, last2 = K;
      const post = new Map();
      while (k + 1 < ops.length) {
        const a = ops[k + 1];
        if (a.kind === 'mov' && a.addr > last2 && a.addr <= K + 0xF0) { post.set(a.addr - K, a.val); last2 = a.addr; k++; } else break;
      }
      const extra = [];
      for (const [off, v] of pre) if (![0x1e, 0x96, 0xd2, 0xf0].includes(off)) extra.push({ off: `-${off.toString(16)}`, val: v.toString(16) });
      for (const [off, v] of post) if (![0x1e, 0x3c].includes(off)) extra.push({ off: `+${off.toString(16)}`, val: v.toString(16) });
      slots.set(regId, {
        unitRef: op.val,   // 1-based 单位 id（= EBINIT units[].unitId = 名串地址 − 0x17ab6）
        spawnFlag: pre.has(0x1e) ? pre.get(0x1e) : null,
        faction: pre.has(0x96) ? pre.get(0x96) : null,
        row: pre.has(0xd2) ? pre.get(0xd2) : null,
        col: pre.has(0xf0) ? pre.get(0xf0) : null,
        levelMin: post.has(0x1e) ? post.get(0x1e) : null,
        levelMax: post.has(0x3c) ? post.get(0x3c) : null,
        extra,
      });
    }
  }
}
// 转换为每个 mapNo 的数组（按寄存器 id 排序，保证稳定）
const unitByMapNoArr = new Map();
for (const [mapNo, slots] of unitByMapNo) {
  unitByMapNoArr.set(mapNo, [...slots.entries()].sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16)).map(([, v]) => v));
}

/* ------------------------- 场景 → 地点（STINIT2 场景记录 loc 字段） ------------------------- */

const BASE_LOC = 0x1216e;       // 地点名 addr = BASE_LOC + locationId
const LOC_SEQ_DIFF = 0x3e8;     // seq 槽 addr − loc 槽 addr 恒为 0x3e8（线性槽位）
const LOC_IDX_BASE = 0x14e4e1;  // loc 槽基址 = LOC_IDX_BASE + sceneIdx（仅作校验；实际直接从段尾读值）

/** 收集地点名表（STINIT2 中 addr∈[0x1216f,0x121e0) 的 set-string；locationId = addr − BASE_LOC） */
function collectLocationNames() {
  const byAddr = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (!p || p.addr < 0x1216f || p.addr >= 0x121e0) continue;
      if (!byAddr.has(p.addr)) byAddr.set(p.addr, { ...p, source: f });
    }
  }
  return byAddr;
}
const locationNameByAddr = collectLocationNames();
const locationName = (loc) => {
  const e = locationNameByAddr.get(BASE_LOC + loc);
  return e ? { name: e.name, nameZh: e.nameZh, source: e.source } : null;
};

/**
 * 解析 STINIT2 场景记录 → 场景名地址 → { locId, seq }。
 * 线性公式（已证实）：loc 槽 addr = 0x14e4e1 + sceneIdx，seq 槽 addr = 0x14e8c9 + sceneIdx，
 *   且 seq_addr − loc_addr 恒为 0x3e8。
 * 结构：每段（上一个 set-string → 下一个 set-string）**末尾**两 mov 为 (loc, seq)，
 *   它们属于**其下方**（紧随其后）的场景名（与「地点字段在名称上方」一致）。
 * `sub (global-int X) 0 1` → X = -1（无标准战场地点的特殊/事件图）。
 */
function parseStinit2SceneLoc() {
  const sceneLoc = new Map();
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => /stinit2\.txt$/i.test(x)).sort()) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    const toks = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const p = parseNameLine(line);
      if (p) { toks.push({ kind: 'NAME', addr: p.addr }); continue; }
      const mm = line.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
      if (mm) { toks.push({ kind: 'MOV', addr: parseInt(mm[1], 16), value: parseInt(mm[2], 16) }); continue; }
      const sm = line.match(/sub \(global-int ([0-9a-f]+)\) ([0-9a-f]+) ([0-9a-f]+)/);
      if (sm) toks.push({ kind: 'MOV', addr: parseInt(sm[1], 16), value: parseInt(sm[2], 16) - parseInt(sm[3], 16) });
    }
    let lastTwo = [];
    for (const t of toks) {
      if (t.kind === 'MOV') {
        lastTwo.push(t);
        if (lastTwo.length > 2) lastTwo.shift();
      } else if (t.kind === 'NAME' && t.addr >= 0x121e0) {
        const isPair = lastTwo.length === 2 && (lastTwo[1].addr - lastTwo[0].addr) === LOC_SEQ_DIFF;
        sceneLoc.set(t.addr, { locId: isPair ? lastTwo[0].value : null, seq: isPair ? lastTwo[1].value : null });
        lastTwo = [];
      }
    }
  }
  return sceneLoc;
}
const sceneLocByAddr = parseStinit2SceneLoc();

// maps = STINIT2 场景（每场景一张地图；mapNo = 场景名 addr − 0x121e2；单位由 STINIT 按 mapNo join）
const maps = [];
for (const [addr, ent] of [...mapNameByAddr.entries()].sort((a, b) => a[0] - b[0])) {
  if (addr < 0x121e0) continue;                       // 只取场景名（>=0x121e0）
  const mapNo = (addr - BASE_MAP).toString(16);
  const scene = sceneLocByAddr.get(addr);
  maps.push({
    mapNo,
    name: ent.name,
    nameZh: ent.nameZh,
    source: ent.source,
    seq: scene ? scene.seq : null,                 // 场景在所属地点内的序号（用于地点内排序）
    locationId: scene && scene.locId !== null && scene.locId >= 0 ? scene.locId : null,
    units: unitByMapNoArr.get(mapNo) ?? [],
  });
}
const mapUnitEntries = maps.reduce((s, m) => s + m.units.length, 0);
const mapUnitDistinct = new Set(maps.flatMap((m) => m.units.map((u) => u.unitRef)));
const mapSpawnableEntries = maps.reduce((s, m) => s + m.units.filter((u) => u.spawnFlag === 1).length, 0);

// 按 locationId 分组地图 → 抽象「地点」（mapNo 去重；同名地点保留不同 id —— 同名属正常，按 id 区分）
const locationMapNos = new Map();
for (const m of maps) {
  if (m.locationId == null) continue;
  let set = locationMapNos.get(m.locationId);
  if (!set) { set = new Set(); locationMapNos.set(m.locationId, set); }
  set.add(m.mapNo);
}
const locations = [];
const seqByMapNo = new Map(maps.map((m) => [m.mapNo, m.seq]));
for (const [locId, mapNoSet] of locationMapNos) {
  const nm = locationName(locId);
  // 地点内的场景按场景自己的 seq 字段（地点内序号）排序，非按 mapNo
  const mapNos = [...mapNoSet].sort((a, b) => {
    const sa = seqByMapNo.get(a) ?? Number.MAX_SAFE_INTEGER;
    const sb = seqByMapNo.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return parseInt(a, 16) - parseInt(b, 16);
  });
  locations.push({
    locationId: locId,
    name: nm ? nm.name : '',
    nameZh: nm ? nm.nameZh : `地点 #${locId}`,
    source: nm ? nm.source : '',
    maps: mapNos,
  });
}
locations.sort((a, b) => a.locationId - b.locationId);
const mapsWithLocation = maps.filter((m) => m.locationId != null).length;

/* ------------------------- 技能 SKINIT ------------------------- */

/**
 * SKINIT 技能表 = 三段并列定长数组，stride = 0x3e8(1000)，按 skillId 直接算地址（与掉落表同款模型）：
 *   name  (技能名)         = 0x1d4f4 + id
 *   short (单行简述)       = 0x1d4f4 + 0x3e8 + id            = 0x1d8dc + id
 *   title (【分类：名】题头) = 0x1d4f4 + 2*0x3e8 + 2*id        = 0x1dcc4 + 2id     ← 2 槽/技能的配对数组
 *   body  (详述)           = 0x1dcc4 + 2id + 1
 * 详见 docs/re/src/05-技能数据.md。本轮只导出这四行文案（日/中），mov 数值字段不提取。
 */
function parseSkinit() {
  const files = fs.readdirSync(SRC_DIR).filter((x) => /skinit\.txt$/i.test(x)).sort();
  const bySkillId = new Map();
  const conflicts = [];   // 同一 (skillId, field) 被多个文件重复定义
  const orphans = [];     // 落在 id 合法区间外的 set-string 地址

  for (const file of files) {
    const lines = fs.readFileSync(path.join(SRC_DIR, file), 'utf8').split(/\r\n|\r|\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const p = parseNameLine(lines[idx]);
      if (!p) continue;
      let skillId, field;
      if (p.addr < SKILL_SHORT_BASE) { skillId = p.addr - BASE_SKILL; field = 'name'; }
      else if (p.addr < SKILL_DESC_BASE) { skillId = p.addr - SKILL_SHORT_BASE; field = 'short'; }
      else {
        const off = p.addr - SKILL_DESC_BASE;
        skillId = off >> 1;
        field = (off & 1) ? 'body' : 'title';
      }
      if (skillId < 1 || skillId >= SKILL_STRIDE) { orphans.push(`${p.addr.toString(16)}@${file}:${idx + 1}`); continue; }

      let s = bySkillId.get(skillId);
      if (!s) {
        s = {
          skillId, name: null, nameZh: null, title: null, titleZh: null,
          body: null, bodyZh: null, short: null, shortZh: null,
          source: file, nameLine: null,
        };
        bySkillId.set(skillId, s);
      }
      if (s[field] !== null) conflicts.push(`#${skillId}.${field} (${s.source} vs ${file}:${idx + 1})`);
      s[field] = p.name;
      s[`${field}Zh`] = p.nameZh;
      if (field === 'name') { s.source = file; s.nameLine = idx + 1; }
    }
  }

  const skills = [...bySkillId.values()].sort((a, b) => a.skillId - b.skillId);
  // hasDesc：是否带三行描述（id=40「進行不可」为纯内部状态技能，只有名字）
  for (const s of skills) s.hasDesc = s.title !== null && s.body !== null && s.short !== null;
  return { skills, conflicts, orphans };
}

const { skills, conflicts: skillConflicts, orphans: skillOrphans } = parseSkinit();
const skillsMissingName = skills.filter((s) => s.name === null).map((s) => s.skillId);
const skillsWithDesc = skills.filter((s) => s.hasDesc).length;

/* ------------------------- 训练所 DRINIT ------------------------- */

/**
 * DRINIT 训练所：训练者单位（四结骑 + 双傀）**消耗**满足条件的单位。以「训练配方」为一行。
 *
 * 结构（详见 docs/re/src/06-训练所数据.md）：
 *   每个训练者一个块：eq … f8c44 <unitId>；块内每条训练配方 = set-string（描述文案）+ 若干 mov（meta 字段）。
 *   TID = 描述串地址 − 0x1d490（块内槽）。
 *   meta 字段 (K,V)：单槽按「列 = K − TID」归位；「效果」多槽数组按「基址 + TID×槽宽 + 槽」对齐。
 *
 * 已确认字段（样例见 docs/re/src/06-训练所数据.md §4）：
 *   6c55f9 前置要求   6c565d 数量   6c56c1 类型-种族   6c5725 类型-性别
 *   6c5789 类型-属性  6c57ed 等级   6c6085 效果-技能
 *   效果-耐性        6c5851[配方×8+槽]（槽 0..7 → RES_NAME，值=+N）
 *   效果-能力值      6c5b71[配方×13+槽]（槽 0..12 → STAT_NAME，值=+N）
 * 其中种族/性别/属性枚举与 units 的 race/gender/attribute 同构；每条配方只给一种奖励（技能/耐性/能力值三选一）。
 */
function parseDrinit() {
  const files = fs.readdirSync(SRC_DIR).filter((x) => /drinit\.txt$/i.test(x)).sort();
  const trainings = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(SRC_DIR, file), 'utf8').split(/\r\n|\r|\n/);
    let curUnit = null, curContent = null;
    for (const l of lines) {
      const meq = l.match(/^eq \(local-int 0\) \(global-int f8c44\) ([0-9a-f]+)/);
      if (meq) { curUnit = parseInt(meq[1], 16); curContent = null; continue; }
      if (!curUnit) continue;
      const ms = l.match(/^set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/);
      if (ms) {
        const addr = parseInt(ms[1], 16);
        const tid = addr - TID_BASE;
        const { jp, zh } = splitNameLine(ms[2]);
        curContent = { trainerId: curUnit, tid, addr, jp, zh, source: file, fields: {} };
        trainings.push(curContent);
        continue;
      }
      const mm = l.match(/^mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
      if (mm && curContent) {
        const k = parseInt(mm[1], 16);
        const tid = curContent.tid;
        const val = parseInt(mm[2], 16);
        // 「效果」多槽数组：配方索引 = TID（引擎按 base + TID*槽宽 + 槽 布局）。
        const relRes = k - RES_EFFECT_BASE;
        const relAttr = k - ATTR_EFFECT_BASE;
        if (relRes >= tid * RES_EFFECT_STRIDE && relRes < tid * RES_EFFECT_STRIDE + RES_EFFECT_STRIDE) {
          curContent.resistSlot = relRes - tid * RES_EFFECT_STRIDE;   // 耐性槽（0..7）
          curContent.resistValue = val;                                // +N
        } else if (relAttr >= tid * ATTR_EFFECT_STRIDE && relAttr < tid * ATTR_EFFECT_STRIDE + ATTR_EFFECT_STRIDE) {
          curContent.statSlot = relAttr - tid * ATTR_EFFECT_STRIDE;   // 能力值槽（0..12）
          curContent.statValue = val;                                  // +N
        } else {
          curContent.fields[(k - tid).toString(16)] = val;             // 单槽字段（K−TID 恒定）
        }
      }
    }
  }

  // 解码字段（枚举与 units 的 race/gender/attribute 同构）
  const field = (r, off) => r.fields[off] ?? null;
  const decoded = trainings.map((r) => ({
    trainerId: r.trainerId,
    trainerName: unitNameById.get(r.trainerId)?.jp ?? '',
    trainerNameZh: unitNameById.get(r.trainerId)?.zh ?? '',
    tid: r.tid,
    text: r.jp,
    textZh: r.zh,
    source: r.source,
    order: field(r, '6c5595'),         // 游戏内渲染顺序键（按此升序展示）
    prereq: field(r, '6c55f9'),      // 前置要求
    quantity: field(r, '6c565d'),    // 数量
    race: field(r, '6c56c1'),        // 类型-种族
    gender: field(r, '6c5725'),      // 类型-性别
    attribute: field(r, '6c5789'),   // 类型-属性
    level: field(r, '6c57ed'),       // 等级(★条件)
    skillId: field(r, '6c6085'),     // 效果-技能
    // 效果-耐性（6c5851[配方×8+槽]）：值=+N（数据恒 1）
    resistance: r.resistSlot ?? null,
    resistanceAmount: r.resistValue ?? null,
    // 效果-能力值（6c5b71[配方×13+槽]）：值=+N
    stat: r.statSlot ?? null,
    statAmount: r.statValue ?? null,
  }));
  // 游戏内顺序 = 按 order(6c5595) 升序；作为兜底再按 tid 稳定排序。
  decoded.sort((a, b) => (a.trainerId - b.trainerId) || ((a.order ?? 0) - (b.order ?? 0)) || (a.tid - b.tid));
  return decoded;
}

// DRINIT 需要单位名（训练者）；从 units 列表建 jp/zh 反查表
const unitNameById = new Map(units.map((u) => [u.unitId, { jp: u.name, zh: u.nameZh }]));
const trainings = parseDrinit();

/* ------------------------- 派生 / 校验 / 组装 ------------------------- */

const craftableIds = new Set(itemRecipes.map((r) => r.productId));
const items = [...itemName.values()]
  .map((e) => ({ ...e, craftable: craftableIds.has(e.id) }))
  .sort((a, b) => a.id - b.id);
const buildings = [...buildingName.values()].sort((a, b) => a.id - b.id);

const itemLookup = new Map(items.map((i) => [i.id, i]));
let dropEntries = 0;
const dropItemIds = new Set();
for (const u of units) for (const d of u.drops) { dropEntries++; dropItemIds.add(d.itemId); }

// 校验
const missingProduct = recipes.filter((r) => !r.product).length;
const missingMaterial = new Set();
for (const r of recipes) for (const m of r.materials) if (!itemLookup.has(m.itemId)) missingMaterial.add(m.itemId);
const missingDropItem = new Set();
for (const u of units) for (const d of u.drops) if (!itemLookup.has(d.itemId)) missingDropItem.add(d.itemId);

const counts = {
  items: items.length,
  buildings: buildings.length,
  recipes: recipes.length,
  itemRecipes: itemRecipes.length,
  buildingRecipes: buildRecipes.length,
  units: units.length,
  unitsWithDrops: units.filter((u) => u.hasDrops).length,
  dropEntries,
  distinctDropItemIds: dropItemIds.size,
  maps: maps.length,
  mapUnitEntries,
  mapUnitDistinctUnits: mapUnitDistinct.size,
  mapSpawnableEntries,
  locations: locations.length,
  mapsWithLocation,
  skills: skills.length,
  skillsWithDesc,
  trainings: trainings.length,
  trainers: new Set(trainings.map((t) => t.trainerId)).size,
};

const out = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  sourceTree: 'src',
  note: '天結いキャッスルマイスター 元数据（由 src/ ITINIT/PLINIT/ALINIT/EBINIT/STINIT/STINIT2/SKINIT/DRINIT 提取；中间产物，不入 git）。物品 id=addr-0x18e40，建筑 id=addr-0x1f5ba；名称=src set-string "日文|中文"。metadata 与 rate 语义未定。v3 新增 locations（场景→地点，地点 id=addr-0x1216e；loc 槽=0x14e4e1+sceneIdx，seq=loc+0x3e8；sub 0 1 即 loc=-1）。v4 新增 skills（技能 id=addr-0x1d4f4；三段并列数组 stride=0x3e8：name=base+id，short=base+0x3e8+id，title/body=base+2*0x3e8+2*id 与 +1）。v5 单位新增 race/gender/attribute（EBINIT per-unit struct：race=0x52a0b4+id，gender=0x52a49c+id，attribute=0x52b054+id）。v6 新增 trainings（DRINIT 训练所：训练者单位消耗满足条件的单位；TID=addr-0x1d490 块内槽；单槽字段按 K-TID 归位：6c55f9前置 6c565d数量 6c56c1种族 6c5725性别 6c5789属性 6c57ed等级 6c6085技能，枚举与 units 同构）。v9 trainings 新增「效果」多槽数组：耐性 6c5851[配方×8+槽]（槽 0..7→RES_NAME）、能力值 6c5b71[配方×13+槽]（槽 0..12→STAT_NAME）；仅 1 槽字段才用 K-TID 归位。',
  counts,
  items,
  buildings,
  recipes,
  units,
  maps,
  locations,
  skills,
  trainings,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
console.log('已写出', OUT_FILE);
console.log(`items=${items.length} buildings=${buildings.length} recipes=${recipes.length}` +
  ` (item=${itemRecipes.length}, building=${buildRecipes.length}) units=${units.length}` +
  ` (withDrops=${counts.unitsWithDrops}) dropEntries=${dropEntries} distinctDropItemIds=${dropItemIds.size}` +
  ` maps=${maps.length} mapUnitEntries=${mapUnitEntries} mapUnitDistinctUnits=${mapUnitDistinct.size} mapSpawnable=${mapSpawnableEntries}` +
  ` locations=${locations.length} mapsWithLocation=${mapsWithLocation}` +
  ` skills=${skills.length} (withDesc=${skillsWithDesc})` +
  ` trainings=${trainings.length} (trainers=${counts.trainers})`);
console.log('校验：缺产品名配方=', missingProduct, ' 缺物品的原材料 id=', [...missingMaterial].map(String).join(','), ' 缺物品的掉落 id=', [...missingDropItem].map(String).join(','));
console.log('校验(技能)：地址冲突=', skillConflicts.length, skillConflicts.slice(0, 5).join(' '),
  ' 越界地址=', skillOrphans.length, skillOrphans.slice(0, 5).join(' '),
  ' 无名技能 id=', skillsMissingName.join(','),
  ' 无描述技能 id=', skills.filter((s) => !s.hasDesc).map((s) => s.skillId).join(','));
console.log('校验(训练)：训练者=', [...new Set(trainings.map((t) => t.trainerId))].map((x) => x.toString(16)).join(','));
const badTrain = trainings.filter((t) => t.race !== null && (t.race < 2 || t.race > 0xd)).length;
console.log('校验(训练)：种族值域异常=', badTrain, ' 数量非空=', trainings.filter((t) => t.quantity !== null).length);
const rewardKinds = {
  skill: trainings.filter((t) => t.skillId != null).length,
  resist: trainings.filter((t) => t.resistance != null).length,
  stat: trainings.filter((t) => t.stat != null).length,
};
const rewardMulti = trainings.filter((t) => [t.skillId, t.resistance, t.stat].filter((x) => x != null).length > 1).length;
const resistByName = {};
for (const t of trainings) if (t.resistance != null) resistByName[RES_NAME[t.resistance]] = (resistByName[RES_NAME[t.resistance]] || 0) + 1;
const statByName = {};
for (const t of trainings) if (t.stat != null) statByName[STAT_NAME[t.stat]] = (statByName[STAT_NAME[t.stat]] || 0) + 1;
console.log('校验(训练)：奖励 技能=', rewardKinds.skill, ' 耐性=', rewardKinds.resist,
  '(', Object.entries(resistByName).map(([k, v]) => `${k}:${v}`).join(' '), ')',
  ' 能力值=', rewardKinds.stat, '(', Object.entries(statByName).map(([k, v]) => `${k}:${v}`).join(' '), ')',
  '（合计=', rewardKinds.skill + rewardKinds.resist + rewardKinds.stat, '；多奖励=', rewardMulti, '）');

// 采样展示（含中文名）
console.log('\n===== 采样 =====');
const sampleItem = items.find((i) => i.id === 1) || items[0];
console.log(`物品[${sampleItem.id}] ${sampleItem.name} → ${sampleItem.nameZh} (craftable=${sampleItem.craftable}, src=${sampleItem.source})`);
const sampleB = buildings.find((b) => b.id === 1);
if (sampleB) console.log(`建筑[${sampleB.id}] ${sampleB.name} → ${sampleB.nameZh} (src=${sampleB.source})`);
const r = itemRecipes.find((x) => x.materials.length) || itemRecipes[0];
if (r) console.log(`配方(${r.type}) ${r.product}→${r.productZh} : ${r.materials.map((m) => `${itemLookup.get(m.itemId)?.nameZh}×${m.count}`).join(' + ')}`);
const u = units.find((x) => x.hasDrops && x.drops.length >= 3);
if (u) console.log(`单位[${u.unitId.toString(16)}] ${u.name}→${u.nameZh} 〈${u.title}→${u.titleZh}〉 掉落: ${u.drops.map((d) => `${itemLookup.get(d.itemId)?.nameZh}(rate=${d.rate})`).join(' ') || '无'}`);
const mu = maps.find((x) => x.units.length >= 5);
if (mu) console.log(`地图[${mu.mapNo}] ${mu.name}→${mu.nameZh} (单位槽=${mu.units.length}, src=${mu.source}) 首个: ${mu.units.slice(0, 3).map((z) => `${z.unitRef.toString(16)}行=${z.row}列=${z.col}等=${z.levelMin}..${z.levelMax}`).join(' | ')}`);
const sk = skills.find((x) => x.hasDesc);
if (sk) {
  console.log(`技能[${sk.skillId}/${(BASE_SKILL + sk.skillId).toString(16)}] ${sk.name}→${sk.nameZh} (src=${sk.source}:${sk.nameLine})`);
  console.log(`  题头 ${sk.title} → ${sk.titleZh}`);
  console.log(`  详述 ${sk.body} → ${sk.bodyZh}`);
  console.log(`  简述 ${sk.short} → ${sk.shortZh}`);
}

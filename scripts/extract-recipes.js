#!/usr/bin/env node
// extract-recipes.js
// 提取天結的全部物品 id→名称 与 ALINIT 合成配方，输出 JSON。
//
// 关键事实（本次逆向确认）：
//   - 物品 id = 名字串地址(set-string (global-string <addr>)) - 0x18e40。
//   - 行结构：每行 = 行标记(值=1) + 产品(物品id, hex) + 若干元数据(6b*) + 若干 {材料id, 数量} 对。
//     材料顺序 = 出现顺序。
//   - 行标记覆盖 6ba7(钥匙/特殊物品区)/6ba9(base)/6baa($n$)；材料用 6c* 地址按 {id, 数量} 两两配对，
//     因此对 base(6c0d/6c1c 与 6c14/6c24)与追加包(6c1b/6c2a)都成立。
//   - 标记值=1 为“物品配方”；标记值=2 为另一类(建筑/设施)配方，暂不解析（另行标注）。
//
// 用法: node scripts/extract-recipes.js    → 写 项目根/metadata/items.json 与 recipes.json

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const DATA_DIR = path.join(ROOT_DIR, 'data');
const BASE     = 0x18e40;             // 物品 id 基数
const META_DIR = path.join(ROOT_DIR, 'metadata');   // 输出目录：项目根/metadata
const ITEMS_JSON   = path.join(META_DIR, 'items.json');
const BUILDINGS_JSON   = path.join(META_DIR, 'buildings.json');
const ITEMS_RECIPES_JSON   = path.join(META_DIR, 'recipe-items.json');
const BUILD_RECIPES_JSON   = path.join(META_DIR, 'recipe-buildings.json');

// ---------- 1) 物品 id→名称 ----------
const itemName = new Map();      // id -> name
const itemSource = new Map();    // id -> 来源文件
function collectNames(file) {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  for (const m of text.matchAll(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/g)) {
    const addr = parseInt(m[1], 16);
    const id = addr - BASE;
    if (addr >= BASE + 1 && addr <= 0x1a000 && !itemName.has(id)) {
      itemName.set(id, m[2]);
      itemSource.set(id, file);
    }
  }
}
for (const f of fs.readdirSync(DATA_DIR)) if (/itinit\.txt$/i.test(f)) collectNames(f);

// 建筑/设施名：id = 名称串地址 - 0x1f5ba（PLINIT 设施名表，アヴァロの工房@1f5bb = id 1）。
// 吸收 base + $n$PLINIT；排除以 【 开头的说明串。
const buildingName = new Map();    // id -> name
const buildingSource = new Map();  // id -> 来源文件
function collectBuildingNames(file) {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  for (const m of text.matchAll(/set-string \(global-string ([0-9a-f]+)\) "([^"]*)"/g)) {
    const addr = parseInt(m[1], 16);
    const id = addr - 0x1f5ba;
    if (id >= 1 && id < 500 && !/^【/.test(m[2]) && !buildingName.has(id)) {
      buildingName.set(id, m[2]);
      buildingSource.set(id, file);
    }
  }
}
for (const f of fs.readdirSync(DATA_DIR)) if (/plinit\.txt$/i.test(f)) collectBuildingNames(f);

// 把十六进制值(物品id)反查名称；解析失败或超范围返回 null
function nameOf(hexval) {
  const id = parseInt(hexval, 16);
  return Number.isFinite(id) && itemName.has(id) ? itemName.get(id) : null;
}

// ---------- 2) 解析 ALINIT 配方 ----------
// 行结构(标记值=1 的物品配方)： [marker=1, product, meta, meta, meta, {matid,matcnt}*]
// 我们按“出现顺序”扫描 mov：遇到标记(address前缀 6ba9 或 6baa 且值=1) 开新行，
// 下一 mov=产品；其后固定跳过 3 个元数据；再将其余配对为 {材料id, 数量}，直到下一行标记。
function parseAlinit(file) {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  const movs = [];
  for (const l of text.split(/\r\n|\r|\n/)) {
    const m = l.match(/mov \(global-int ([0-9a-f]+)\) ([0-9a-f]+)/);
    if (m) movs.push({ addr: m[1], value: m[2] });
  }
  // 行起点 = 值 1(物品) 或 2(建筑) 且地址前缀 6ba5-6bab，并紧随一个该类型的产品 id。
  // 不依赖产品数组的具体地址（其随 base/追加包/区段而变），避免固定正则漏检(如 6bae/6baf 产品)。
  // 产品 id 按类型选名表：标记值 1=物品(itemName)，2=建筑/设施(buildingName)，避免 id 空间重叠时错判。
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
    const type = parseInt(movs[i].value, 16);   // 1=物品配方, 2=建筑/设施配方
    const productId = parseInt(movs[i + 1].value, 16);
    const productAddr = movs[i + 1].addr;       // 产品地址，用于元数据"偏移"计算
    // 收集 元数据 与 材料，直到下一个行起点：
    //   材料 = 行内所有 6c* 的 mov，按出现顺序 {材料id, 数量} 两两配对(保序)；
    //   元数据 = 产品之后、首个 6c* 之前的那批 6b* 字段，格式 [地址]([相对产品地址偏移])=[值]。
    let j = i + 2;
    const metadata = [];
    const cvals = [];
    let inMeta = true;
    while (j < movs.length && !isMarkerAt(j)) {
      const a = movs[j].addr;
      if (a.startsWith('6c')) {
        inMeta = false;
        cvals.push(movs[j].value);
      } else if (inMeta && a.startsWith('6b')) {
        const off = (parseInt(a, 16) - parseInt(productAddr, 16)).toString(16);
        metadata.push(`${a}(${off})=${movs[j].value}`);
      }
      j++;
    }
    const materials = [];
    for (let k = 0; k + 1 < cvals.length; k += 2) {
      materials.push({ id: parseInt(cvals[k], 16), count: parseInt(cvals[k + 1], 16) });
    }
    if (materials.length) {
      recipes.push({
        type,
        productId,
        product: type === 1 ? (itemName.get(productId) || nameOf(movs[i + 1].value))
                            : (buildingName.get(productId) || nameOf(movs[i + 1].value)),
        source: file,
        metadata,       // 未知元数据，保序字符串数组
        materials,      // 保序
      });
    }
    i = Math.max(j, i + 2);
  }
  return recipes;
}

const alinitFiles = fs.readdirSync(DATA_DIR).filter(f => /alinit\.txt$/i.test(f));

// ---------- 3) 组 JSON ----------
const items = [...itemName].map(([id, name]) => ({ id, name, source: itemSource.get(id) })).sort((a, b) => a.id - b.id);
const buildings = [...buildingName].map(([id, name]) => ({ id, name, source: buildingSource.get(id) })).sort((a, b) => a.id - b.id);
const recipes = [];
for (const f of alinitFiles) {
  for (const r of parseAlinit(f)) {
    recipes.push({
      type: r.type,
      productId: r.productId,
      // 物品配方用物品名(catalog id)；建筑/设施配方用 PLINIT 建筑名表。
      product: r.type === 2
        ? (buildingName.get(r.productId) || r.product)
        : (itemName.get(r.productId) || r.product),
      source: r.source,
      metadata: r.metadata,          // 未知元数据，保序字符串数组 "addr=value"
      materials: r.materials.filter(m => m.count !== null).map(m => ({
        itemId: m.id,
        name: itemName.get(m.id) || null,
        count: m.count,
      })),
    });
  }
}

const itemRecipes  = recipes.filter(r => r.type === 1);
const buildRecipes = recipes.filter(r => r.type === 2);

const outItems = {
  _comment: '天結いキャッスルマイスター 物品 id→名称。物品 id = 名字串地址 - 0x18e40（青銅の導鍵@18e41 = id 1）。',
  itemBase: '0x' + BASE.toString(16),
  count: items.length,
  items,
};

const outBuildings = {
  _comment: '天結いキャッスルマイスター 建筑/设施 id→名称（来自 PLINIT 设施名表）。建筑 id = 名称串地址 - 0x1f5ba（アヴァロの工房@1f5bb = id 1）。',
  buildingBase: '0x1f5ba',
  count: buildings.length,
  buildings,
};

const outItemRecipes = {
  _comment: '天結いキャッスルマイスター ALINIT 物品合成配方(标记值=1)。产品/材料值为字符串地址派生的物品 id(hex)。metadata 为该行未知元数据(保序)。materials 保序。',
  itemBase: '0x' + BASE.toString(16),
  count: itemRecipes.length,
  recipes: itemRecipes,
};

const outBuildRecipes = {
  _comment: '天結いキャッスルマイスター ALINIT 建筑/设施配方(标记值=2)，产品多为 城砦拡張図面/设施 等物品。metadata 为该行未知元数据(保序)。materials 保序。',
  itemBase: '0x' + BASE.toString(16),
  count: buildRecipes.length,
  recipes: buildRecipes,
};

fs.mkdirSync(META_DIR, { recursive: true });
fs.writeFileSync(ITEMS_JSON, JSON.stringify(outItems, null, 2), 'utf8');
fs.writeFileSync(BUILDINGS_JSON, JSON.stringify(outBuildings, null, 2), 'utf8');
fs.writeFileSync(ITEMS_RECIPES_JSON, JSON.stringify(outItemRecipes, null, 2), 'utf8');
fs.writeFileSync(BUILD_RECIPES_JSON, JSON.stringify(outBuildRecipes, null, 2), 'utf8');
console.log(`已写出 ${ITEMS_JSON}`);
console.log(`已写出 ${BUILDINGS_JSON}`);
console.log(`已写出 ${ITEMS_RECIPES_JSON}`);
console.log(`已写出 ${BUILD_RECIPES_JSON}`);
console.log(`物品数=${items.length}  建筑数=${buildings.length}  物品配方=${itemRecipes.length}  建筑配方=${buildRecipes.length}`);

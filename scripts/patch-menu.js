#!/usr/bin/env node
// 天結いキャッスルマイスター — AGERC.DLL 菜单模板汉化补丁
//
// 背景：主窗口菜单模板存放在 AGERC.DLL 的“FONT 110 / FONT 124”资源数据里
// （引擎自定义格式，非标准 MENU 资源）。字符串为 \0 结尾的 UTF-16LE，
// 解析器依赖字符串终止符位置定位下一条结构，因此译文必须保持原 UTF-16
// 单元数：不足部分用零宽空格 U+200B 补齐（显示不可见，结构零变化）。
//
// 用法：node patch-menu.js
//   - 源：install/DATA1/AGERC.DLL（未修改的 849KB 版本）
//   - 输出：install/AGERC.DLL（覆盖运行用副本，原文件先备份到 .tmp）
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, INSTALL_DIR } from './config.js';

// 每个编辑项：offset = 字符串起始文件偏移；from = 原文（UTF-16 单元数即槽位长度）；
// to = 译文（单元数必须 <= 原文）。偏移来自 install/DATA1/AGERC.DLL（未修改版）。
//
// 结构备注：FONT 110 = 主菜单模板（0xC66C4..0xC6E30），FONT 124 = 调试菜单模板
// （0xC6E30..0xC6F70）。弹层 = pre 字(0x0001/0x0081) + 标题；FONT 110 菜单项 =
// id + 2 标志字 + 字符串（pre=0x0080 表示子菜单最后一项）；FONT 124 菜单项 =
// id(0x9Cxx) + 字符串。'...' 是原模板里的 ASCII 三个点。
const EDITS = [
  // ---- 主菜单 FONT 110 ----
  // ゲーム（运行时子菜单仅保留 終了；セーブ/ロード 被引擎过滤但仍翻译模板）
  { offset: 0xC66DA, from: 'ｹﾞｰﾑ(&G)', to: '游戏' },            // 顶级
  { offset: 0xC66FE, from: 'ｾｰﾌﾞ(&S)...', to: '保存(&S)...' },
  { offset: 0xC6726, from: 'ﾛｰﾄﾞ(&L)...', to: '读取(&L)...' },
  { offset: 0xC675E, from: '終了(&X)\tESC', to: '结束游戏' },
  // 画像の保存
  { offset: 0xC6782, from: '画像の保存(&C)', to: '保存图片(&C)' },
  { offset: 0xC67AA, from: '表示画面を保存(&S)', to: '保存当前画面(&S)' },
  { offset: 0xC67D2, from: '画像の保存場所(&P)...', to: '图片保存位置(&P)...' },
  // メッセージ
  { offset: 0xC67FE, from: 'ﾒｯｾｰｼﾞ(&M)', to: '消息(&M)' },
  { offset: 0xC6826, from: 'ﾒｯｾｰｼﾞｽｷｯﾌﾟ(&S)', to: '消息跳过(&S)' },
  { offset: 0xC6856, from: '既読ﾒｯｾｰｼﾞ ｽｷｯﾌﾟ(&R)', to: '跳过已读消息(&R)' },
  { offset: 0xC688A, from: 'ﾒｯｾｰｼﾞｳｲﾝﾄﾞｳを消す(&H)', to: '隐藏消息窗口(&H)' },
  { offset: 0xC68C2, from: 'ｵｰﾄﾒｯｾｰｼﾞ(&A)', to: '自动消息(&A)' },
  // 設定
  { offset: 0xC68EE, from: '設定(&O)', to: '设置(&O)' },
  { offset: 0xC690E, from: '画面表示(&W)', to: '画面显示(&W)' },
  { offset: 0xC6932, from: 'ﾌﾙｽｸﾘｰﾝ(&F)', to: '全屏(&F)' },
  { offset: 0xC695A, from: 'ｳｲﾝﾄﾞｳ(&W)', to: '窗口(&W)' },
  { offset: 0xC697E, from: 'ﾏｳｽの右ｸﾘｯｸ時の動作(&M)', to: '鼠标右键动作(&M)' },
  { offset: 0xC69B6, from: 'ﾒｯｾｰｼﾞｳｲﾝﾄﾞｳの消去(&H)', to: '关闭消息窗口(&H)' },
  { offset: 0xC69EE, from: 'ﾒｯｾｰｼﾞｽｷｯﾌﾟ(&S)', to: '消息跳过(&S)' },  // 与 0xC6826 重复出现
  { offset: 0xC6A1E, from: 'ﾒﾆｭｰの表示(&M)', to: '显示菜单(&M)' },
  { offset: 0xC6A46, from: '文字表示(&A)', to: '文字显示(&A)' },
  { offset: 0xC6A6A, from: 'ｱﾝﾁｴｲﾘｱｽを使用する(&U)', to: '使用抗锯齿(&U)' },
  { offset: 0xC6A9E, from: 'ｱﾝﾁｴｲﾘｱｽを使用しない(&N)', to: '不使用抗锯齿(&N)' },
  { offset: 0xC6AD2, from: 'ﾒｯｾｰｼﾞｽﾋﾟｰﾄﾞ(&T)', to: '消息速度(&T)' },
  { offset: 0xC6B06, from: 'ﾉｰｳｴｲﾄ(&W)', to: '无等待(&W)' },
  { offset: 0xC6B2A, from: '速い(&F)', to: '快(&F)' },
  { offset: 0xC6B46, from: '普通(&N)', to: '普通(&N)' },
  { offset: 0xC6B62, from: '遅い(&S)', to: '慢(&S)' },
  { offset: 0xC6B7E, from: 'ﾒｯｾｰｼﾞｳｲﾝﾄﾞｳの透過(&A)', to: '消息窗口透明(&A)' },
  { offset: 0xC6BBA, from: 'なし(&N)', to: '无(&N)' },
  // &25% / &50% / &75% / &ON / &OFF 保持原样，不编辑
  { offset: 0xC6C2E, from: 'BGMの設定(&B)', to: 'BGM设置(&B)' },
  { offset: 0xC6C86, from: 'SEの設定(&E)', to: 'SE设置(&E)' },
  { offset: 0xC6CDE, from: 'ﾒｯｾｰｼﾞの設定(&M)...', to: '消息设置(&M)...' },
  { offset: 0xC6D0E, from: 'ｵｰﾄﾒｯｾｰｼﾞの設定(&A)...', to: '自动消息设置(&A)...' },
  { offset: 0xC6D46, from: 'ｻｳﾝﾄﾞ設定(&S)...', to: '声音设置(&S)...' },
  { offset: 0xC6D72, from: 'その他の設定(&X)...', to: '其他设置(&X)...' },
  // ヘルプ
  { offset: 0xC6D9E, from: 'ﾍﾙﾌﾟ(&H)', to: '帮助(&H)' },
  { offset: 0xC6DC2, from: 'このｺﾝﾋﾟｭｰﾀの動作環境(&S)...', to: '本机运行环境(&S)...' },
  { offset: 0xC6E0E, from: 'ﾊﾞｰｼﾞｮﾝ情報(&V)...', to: '版本信息(&V)...' },

  // ---- 调试菜单 FONT 124 ----
  { offset: 0xC6E36, from: 'ﾃﾞﾊﾞｯｸﾞ(&D)', to: '调试(&D)' },  // 弹层标题：运行时读取路径特殊，需验证显示
  { offset: 0xC6E52, from: 'ﾃﾞﾊﾞｯｸﾞﾚﾎﾟｰﾄ(&P)\tF2', to: '调试报告(&P)\tF2' },
  { offset: 0xC6E84, from: 'BINﾌｧｲﾙの再読込(&R)\tF5', to: 'BIN文件重载(&R)\tF5' },
  { offset: 0xC6EAE, from: 'BINﾌｧｲﾙを再読込し，現在位置の10行前までスキップ(&S)\tF6', to: 'BIN文件重载后跳到当前位置前10行(&S)\tF6' },
  { offset: 0xC6F00, from: '実行行の表示(&L)\tF8', to: '显示执行行(&L)\tF8' },
  { offset: 0xC6F26, from: 'ﾀｲﾄﾙに戻る(&R)\tF11', to: '返回标题(&R)\tF11' },
  { offset: 0xC6F4A, from: 'ﾌﾟﾛｸﾞﾗﾑの終了(&X)\tF12', to: '结束程序(&X)\tF12' },
];

const PAD = '\u200B'; // 零宽空格

const SRC = path.join(INSTALL_DIR, 'DATA1', 'AGERC.DLL');
const DST = path.join(INSTALL_DIR, 'AGERC.DLL');
const TMP = path.join(ROOT_DIR, '.tmp');
const BAK = path.join(TMP, 'AGERC.dll.pre-patch.bak');

// 把 text 编码成固定 unitCount 个 UTF-16 单元，不足用 PAD 补齐（\0 终止符在槽位外保持原位）
function encodeSlot(text, unitCount) {
  const units = [...text];
  if (units.length > unitCount) {
    throw new Error(`text too long: ${units.length} > ${unitCount} units (${text})`);
  }
  const buf = Buffer.alloc(unitCount * 2);
  for (let i = 0; i < units.length; i++) buf.writeUInt16LE(units[i].charCodeAt(0), i * 2);
  for (let i = units.length; i < unitCount; i++) buf.writeUInt16LE(PAD.charCodeAt(0), i * 2);
  return buf;
}

function toUtf16le(text) {
  return Buffer.from([...text].map((c) => c.charCodeAt(0)).flatMap((u) => [u & 0xff, u >> 8]));
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`source not found: ${SRC}`);
    process.exit(1);
  }
  if (!fs.existsSync(DST)) {
    console.error(`target not found: ${DST} (run npm run setup first?)`);
    process.exit(1);
  }
  fs.mkdirSync(TMP, { recursive: true });
  if (!fs.existsSync(BAK)) {
    fs.copyFileSync(DST, BAK);
    console.log(`backup -> ${BAK}`);
  }

  const data = fs.readFileSync(SRC); // 从未修改的 DATA1 版本开始
  for (const { offset, from, to } of EDITS) {
    const fromBytes = toUtf16le(from);
    const cur = data.subarray(offset, offset + fromBytes.length);
    if (!cur.equals(fromBytes)) {
      console.error(`FAIL @0x${offset.toString(16)}: expected ${JSON.stringify(from)}, found ${cur.toString('hex')}`);
      process.exit(1);
    }
    const slot = fromBytes.length / 2;
    encodeSlot(to, slot).copy(data, offset);
    console.log(`patched 0x${offset.toString(16)}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  }
  fs.writeFileSync(DST, data);
  console.log(`written -> ${DST}`);
}

main();

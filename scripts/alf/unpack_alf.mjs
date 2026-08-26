#!/usr/bin/env node
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
/*                                                                                                   */
/*  <Ikusa Megami Zero> Chinese Translation Project                                                  */
/*  unpack_alf.mjs —— tools/alf/unpack_alf/unpack_alf.cpp 的 Node 移植                               */
/*  Modified version of asmodean's code to extract resources from ALF files                          */
/*  Modified by Xuan (xuan@moelab.org)                                                              */
/*  FPE added support for the SYS5INI.bin (foxofice.fpe@gmail.com)                                   */
/*                                                                                                   */
/*  用法：node scripts/alf/unpack_alf.mjs [--out <目录>] [SYS?INI.BIN | APPEND??.AAI]        */
/*        无参(且无 --out)时自动检测 SYS3INI.BIN / sys4ini.bin / SYS5INI.bin / APPEND??.AAI      */
/*        归档 *.ALF 按“索引所在目录”解析；输出目录使用 --out，默认当前目录                      */
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

// exs4alf.cpp, v1.1 2009/04/26
// coded by asmodean

// contact: 
//   web:   http://asmodean.reverse.net
//   email: asmodean [at] hush.com
//   irc:   asmodean on efnet (irc.efnet.net)

// This tool extracts S4IC413 (sys4ini.bin + *.ALF) and S4AC422 (*.AAI + *.ALF)
// archives.

import fs from 'node:fs';
import path from 'node:path';
import { unlzss } from './lzss.mjs';

//#include "as-util.h"
//#include "as-lzss.h"

const __countof = (arr) => arr.length;   // 对应 C 的 _countof(array) = sizeof(array)/sizeof(array[0])

const g_bin_files = [ 'SYS3INI.BIN', 'sys4ini.bin', 'SYS5INI.bin' ];

// ============================================================================
// 磁盘结构体布局（均 little-endian）。
// 与原版一致：整型字段按 32 位(4B)映射，宽字符按 UTF-16LE(2B)映射，不依赖平台原生宽度，
// 因此 64 位 Linux/macOS 上使用起来和 Windows 完全一致。
// ============================================================================
const S4HDR_SIZE        = 300;   // struct S4HDR { char signature_title[240]; unsigned char unknown[60]; }
const S5HDR_SIZE        = 540;   // struct S5HDR { WCHAR signature_title[240](480B); unsigned char unknown[60]; }
const S4SECTHDR_SIZE    = 12;    // struct S4SECTHDR { uint32 original_length; uint32 original_length2; uint32 length; }
const S4TOCARCHDR_SIZE  = 4;     // struct S4TOCARCHDR { uint32 entry_count; }
const S4TOCARCENTRY_SIZE = 256;  // struct S4TOCARCENTRY { char filename[256]; }
const S5TOCARCENTRY_SIZE = 512;  // struct S5TOCARCENTRY { WCHAR filename[256](512B); }
const S4TOCFILENTRY_SIZE = 80;   // struct S4TOCFILENTRY { char filename[64] + uint32 archive_index,file_index,offset,length }
const S5TOCFILENTRY_SIZE = 144;  // struct S5TOCFILENTRY { WCHAR filename[64](128B) + 4*uint32 }

// 当前运行目录（C 版相对 CWD 打开文件）
const OUT_DIR = process.cwd();

// ============================================================================
// 低层读取/字符串工具
// ============================================================================

function fileExists(name) {
	try { fs.accessSync(name); return true; } catch { return false; }
}

// 对应 C 的 _read 系列：从 fd 的绝对位置 position 读 size 字节（不依赖 fd 内部偏移）。
function readBytesAt(fd, position, size) {
	const b = Buffer.alloc(size);
	let off = 0;
	while (off < size) {
		const n = fs.readSync(fd, b, off, size - off, position + off);
		if (n <= 0) break;   // EOF
		off += n;
	}
	return b;
}

// 对应 C 的 get_file_prefix(char*) 与 get_file_prefix(WCHAR*)：
// 取文件名最后一个 '.' 之前的部分。Node 中宽/窄路径都是 string，合并为一个函数。
// 注意：C 在无 '.' 时 strrchr 返回 NULL 会算出负长度（未定义行为），这里保护为原样返回。
function get_file_prefix(filename) {
	const pch = filename.lastIndexOf('.');
	if (pch < 0) return filename;
	return filename.slice(0, pch);
}

// 解码 S4 系单字节文件名（char filename[64|256]），遇 NUL 截断。
function decodeAnsi(buf, offset, byteLen) {
	const limit = offset + byteLen;
	let end = offset;
	while (end < limit && buf[end] !== 0) end++;
	return buf.toString('latin1', offset, end);
}

// 解码 S5 系 UTF-16LE 文件名（WCHAR filename[64|256]），遇 2 字节 NUL(0x0000) 截断。
function decodeWide(buf, offset, byteLen) {
	const limit = offset + byteLen;
	let end = offset;
	for (let p = offset; p + 1 < limit; p += 2) {
		if (buf[p] === 0 && buf[p + 1] === 0) { end = p; break; }
		end = p + 2;
	}
	if (end > limit) end = limit;
	return buf.toString('utf16le', offset, end);
}

/* 对应 C 的 S4TOCFILENTRY / S5TOCFILENTRY 解析 */
function parseS4TOCFILENTRY(b, off) {
	return {
		filename: decodeAnsi(b, off, 64),
		archive_index: b.readUInt32LE(off + 64),
		file_index:    b.readUInt32LE(off + 68),   // within archive?
		offset:        b.readUInt32LE(off + 72),
		length:        b.readUInt32LE(off + 76),
	};
}

function parseS5TOCFILENTRY(b, off) {
	return {
		filename: decodeWide(b, off, 128),
		archive_index: b.readUInt32LE(off + 128),
		file_index:    b.readUInt32LE(off + 132),   // within archive?
		offset:        b.readUInt32LE(off + 136),
		length:        b.readUInt32LE(off + 140),
	};
}

// ============================================================================
// read_header —— 读 16 字节文件头到 g_header
// ============================================================================

const g_header = Buffer.alloc(16);   // BYTE g_header[16] = {};

function read_header(filename) {
	let fp = null;
	try { fp = fs.openSync(filename, 'r'); }
	catch { return false; }

	// fread(g_header, sizeof(BYTE), _countof(g_header), fp)
	fs.readSync(fp, g_header, 0, g_header.length, 0);
	fs.closeSync(fp);
	return true;
}

// ============================================================================
// read_sect —— 读一个 LZSS 压缩节，解压后返回原始长度与缓冲区
//    对应 C 的 read_sect(int fd, unsigned char*& out_buff, unsigned long& out_len)
//    C 版在 fd 当前偏移处读 S4SECTHDR，随后读 hdr.length 字节并 unlzss。
//    Node 版把“当前偏移”参数化为 sectionPos（由 main 依据 addon hack 计算）。
// ============================================================================

const DEBUG_DUMP = false;   // 原版总会写 lzssdata.bin / lzssdata2.bin 调试文件；设为 true 以复现

function read_sect(fd, sectionPos) {
	// struct S4SECTHDR { uint32 original_length; uint32 original_length2; uint32 length; };
	const hdr = readBytesAt(fd, sectionPos, S4SECTHDR_SIZE);
	const original_length  = hdr.readUInt32LE(0);
	// original_length2 —— 未使用（注释：why?）
	const length           = hdr.readUInt32LE(8);

	const len  = length;
	const buff = readBytesAt(fd, sectionPos + S4SECTHDR_SIZE, len);

	const out_len  = original_length;
	const out_buff = Buffer.alloc(out_len);

	// as::unlzss / unlzss(buff, len, out_buff, out_len)
	unlzss(buff, len, out_buff, out_len);

	if (DEBUG_DUMP) {
		// 原版：_open("lzssdata.bin") && _write(fd1, buff, len)
		let fd1 = -1, fd2 = -1;
		try { fd1 = fs.openSync(path.join(OUT_DIR, 'lzssdata.bin'), 'w'); fs.writeSync(fd1, buff); fs.closeSync(fd1); } catch {}
		try { fd2 = fs.openSync(path.join(OUT_DIR, 'lzssdata2.bin'), 'w'); fs.writeSync(fd2, out_buff); fs.closeSync(fd2); } catch {}
	}

	return { out_buff, out_len };
}

// ============================================================================
// main
// ============================================================================

function main() {
	const argv = process.argv.slice(2);
	const prog = path.basename(process.argv[1]);

	// 可选参数：--out <目录> 指定输出根目录（默认当前目录）。
	// 归档文件（*.ALF）按“索引文件所在目录”解析，而非 CWD，便于从任意位置调用。
	let outBase = process.cwd();
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--out') { outBase = path.resolve(argv[++i]); }
		else if (a.startsWith('--out=')) { outBase = path.resolve(a.slice('--out='.length)); }
		else { rest.push(a); }
	}
	let args = rest;

	const print_usage = () => {
		process.stderr.write(`exs4alf v1.01 by asmodean (FPE added support for the SYS3INI.bin/SYS5INI.bin)\n\n`);

		let u = `usage: ${prog} [--out <目录>] [`;
		for (let i = 0; i < __countof(g_bin_files); ++i)
			u += `<${g_bin_files[i]}>/`;
		u += `<APPEND??.AAI>]\n`;
		process.stderr.write(u);
	};

	let in_filename = null;

	if (args.length === 0) {
		// SYS?INI.bin
		for (let i = 0; i < __countof(g_bin_files); ++i) {
			if (fileExists(g_bin_files[i])) {
				in_filename = g_bin_files[i];
				console.log(`${g_bin_files[i]} found.`);
				break;
			}
		}	// for

		// APPEND??.AAI
		if (in_filename == null) {
			for (let i = 1; i <= 20; ++i) {
				const aai_file = `APPEND${String(i).padStart(2, '0')}.AAI`;
				if (fileExists(aai_file)) {
					in_filename = aai_file;
					break;
				}
			}	// for
		}

		if (in_filename == null) {
			print_usage();
			process.stderr.write(`<SYS?INI.bin> or <APPEND??.AAI> not found\n`);
			return -1;
		}
	}
	else if (args.length === 1)
		in_filename = args[0];
	else {
		print_usage();
		return -1;
	}

	// 归档文件（*.ALF）与索引同目录：以索引所在目录为基准解析归档名。
	const catalogDir = path.dirname(path.resolve(in_filename));
	const resolveArchive = (name) => path.join(catalogDir, name);

	// int fd = _open(in_filename.c_str(), _O_RDONLY | _O_BINARY);
	let fd;
	try { fd = fs.openSync(in_filename, 'r'); }
	catch { console.log('Died!'); return 1; }

	if (!read_header(in_filename)) {
		process.stderr.write(`read ${in_filename} failed!\n`);
		return -1;
	}

	// bool unicode_alf = !memcmp(g_header, L"S5IC", 8) || !memcmp(g_header, L"S5AC", 8);
	// 用 UTF-16LE 字节字面量替代 L"S5IC"（避免跨平台 wchar_t 宽度差异）。
	const SIG_S5IC = Buffer.from('S5IC', 'utf16le');   // 8 字节
	const SIG_S5AC = Buffer.from('S5AC', 'utf16le');
	const unicode_alf = g_header.subarray(0, 8).equals(SIG_S5IC)
	                 || g_header.subarray(0, 8).equals(SIG_S5AC);

	// 目录区（LZSS 节）的起始偏移，由 addon hack 决定。
	let sectionPos = 0;

	if (unicode_alf) {
		const hdr5 = readBytesAt(fd, 0, S5HDR_SIZE);   // S5HDR

		// Hack for addon archives
		if (hdr5.subarray(0, 8).equals(SIG_S5AC)) {
			// _lseek(fd, 532, SEEK_SET)
			sectionPos = 532;
		}
		else {
			sectionPos = S5HDR_SIZE;   // 540
		}
	}
	else {
		const hdr4 = readBytesAt(fd, 0, S4HDR_SIZE);   // S4HDR

		// Hack for addon archives
		if (hdr4.subarray(0, 4).equals(Buffer.from('S3AC', 'latin1')) ||
			hdr4.subarray(0, 4).equals(Buffer.from('S4AC', 'latin1'))) {
			// _lseek(fd, 268, SEEK_SET)
			sectionPos = 268;
		}
		else {
			sectionPos = S4HDR_SIZE;   // 300
		}
	}

	const { out_buff: toc_buff, out_len: toc_len } = read_sect(fd, sectionPos);
	fs.closeSync(fd);

	// S4TOCARCHDR* archdr = (S4TOCARCHDR*)toc_buff;
	// archdr->entry_count —— 前 4 字节
	const archdr_entry_count = toc_buff.readUInt32LE(0);
	void toc_len;

	// 原版在此有 vector<BYTE> buffer; buffer.reserve(1048576*20) 并在每文件循环里 resize 复用。
	// 本移植按文件独立分配（见下方读/写），故无需预先分配那 20MB。

	// 与 C 一致的进度清空：space[1024] 中 前 1023 个为空格，末位为 '\0'
	const SPACE = ' '.repeat(1024 - 1);
	let last_line_len = 0;

	if (unicode_alf) {
		/* 注意：指针加法并非数值加法。archdr + 1 表示 archdr + sizeof(archdr)*1，以下同理。 */
		// S5TOCARCENTRY* arcentries = (S5TOCARCENTRY*)(archdr + 1);
		const arcentriesBase = S4TOCARCHDR_SIZE;
		// S4TOCFILHDR*  filhdr     = (S4TOCFILHDR*)(arcentries + archdr->entry_count);
		const filhdrBase = arcentriesBase + archdr_entry_count * S5TOCARCENTRY_SIZE;
		// S5TOCFILENTRY* filentries = (S5TOCFILENTRY*)(filhdr + 1);
		const filentriesBase = filhdrBase + S4TOCARCHDR_SIZE;
		// filhdr->entry_count
		const filhdr_entry_count = toc_buff.readUInt32LE(filhdrBase);

		const arc_info = new Array(archdr_entry_count);

		for (let i = 0; i < archdr_entry_count; i++) {
			const off = arcentriesBase + i * S5TOCARCENTRY_SIZE;
			const filename = decodeWide(toc_buff, off, S5TOCARCENTRY_SIZE);

			// arc_info[i].fd = _wopen(arcentries[i].filename, _O_RDONLY | _O_BINARY)
			let afd;
			try { afd = fs.openSync(resolveArchive(filename), 'r'); }
			catch { afd = -1; }
			arc_info[i] = { fd: afd, dir: null };

			if (afd !== -1) {
				arc_info[i].dir = path.join(outBase, get_file_prefix(filename)) + '/';
				try { fs.mkdirSync(arc_info[i].dir); }   // _wmkdir（忽略失败：目录可能已存在）
				catch {}
			} else {
				// fwprintf(stderr, L"%s: could not open (skipped!)\n", ...)
				process.stderr.write(`${filename}: could not open (skipped!)\n`);
			}
		}

		for (let i = 0; i < filhdr_entry_count; i++) {
			if (i > 0) process.stdout.write('\r');

			const off = filentriesBase + i * S5TOCFILENTRY_SIZE;
			const entry = parseS5TOCFILENTRY(toc_buff, off);

			// swprintf_s(txt, L"Unpacking: [%u/%u] %s", i+1, filhdr->entry_count, filentries[i].filename)
			const txt = `Unpacking: [${i + 1}/${filhdr_entry_count}] ${entry.filename}`;
			process.stdout.write(txt);

			const line_len = txt.length;   // wcslen(txt)
			if (line_len < last_line_len)
				process.stdout.write(SPACE.slice(SPACE.length - (last_line_len - line_len)));
			last_line_len = line_len;

			const arc = arc_info[entry.archive_index];

			if (arc === undefined || arc.fd === -1 || !entry.length) {
				continue;
			}

			const len = entry.length;
			// buffer.resize(len); 这里用独立缓冲（原版复用预分配 vector）
			if (len > 0) {
				// _lseek(arc.fd, filentries[i].offset, SEEK_SET); _read(arc.fd, &buffer[0], len)
				const data = readBytesAt(arc.fd, entry.offset, len);

				// int out_fd = _wopen(dir + filename, _O_CREAT|_O_TRUNC|_O_WRONLY|_O_BINARY, _S_IREAD|_S_IWRITE);
				// C 版此处误写 if (fd == -1)（应为 out_fd）；Node 版 openSync 失败会 throw，此处不再复现该 bug。
				const outFilename = arc.dir + entry.filename;
				const out_fd = fs.openSync(outFilename, 'w');
				fs.writeSync(out_fd, data);
				fs.closeSync(out_fd);
			}
		}

		// delete [] arc_info;
	}
	else {
		// S4TOCARCENTRY* arcentries = (S4TOCARCENTRY*)(archdr + 1);
		const arcentriesBase = S4TOCARCHDR_SIZE;
		// S4TOCFILHDR*   filhdr     = (S4TOCFILHDR*)(arcentries + archdr->entry_count);
		const filhdrBase = arcentriesBase + archdr_entry_count * S4TOCARCENTRY_SIZE;
		// S4TOCFILENTRY* filentries = (S4TOCFILENTRY*)(filhdr + 1);
		const filentriesBase = filhdrBase + S4TOCARCHDR_SIZE;
		// filhdr->entry_count
		const filhdr_entry_count = toc_buff.readUInt32LE(filhdrBase);

		const arc_info = new Array(archdr_entry_count);

		for (let i = 0; i < archdr_entry_count; i++) {
			const off = arcentriesBase + i * S4TOCARCENTRY_SIZE;
			const filename = decodeAnsi(toc_buff, off, S4TOCARCENTRY_SIZE);

			// arc_info[i].fd = _open(arcentries[i].filename, _O_RDONLY | _O_BINARY)
			let afd;
			try { afd = fs.openSync(resolveArchive(filename), 'r'); }
			catch { afd = -1; }
			arc_info[i] = { fd: afd, dir: null };

			if (afd !== -1) {
				arc_info[i].dir = path.join(outBase, get_file_prefix(filename)) + '/';
				try { fs.mkdirSync(arc_info[i].dir); }   // _mkdir（忽略失败）
				catch {}
			} else {
				// fprintf(stderr, "%s: could not open (skipped!)\n", ...)
				process.stderr.write(`${filename}: could not open (skipped!)\n`);
			}
		}

		for (let i = 0; i < filhdr_entry_count; i++) {
			if (i > 0) process.stdout.write('\r');

			const off = filentriesBase + i * S4TOCFILENTRY_SIZE;
			const entry = parseS4TOCFILENTRY(toc_buff, off);

			// sprintf_s(txt, "Unpacking: [%u/%u] %s", i+1, filhdr->entry_count, filentries[i].filename)
			const txt = `Unpacking: [${i + 1}/${filhdr_entry_count}] ${entry.filename}`;
			process.stdout.write(txt);

			const line_len = txt.length;   // strlen(txt)
			if (line_len < last_line_len)
				process.stdout.write(SPACE.slice(SPACE.length - (last_line_len - line_len)));
			last_line_len = line_len;

			const arc = arc_info[entry.archive_index];

			if (arc === undefined || arc.fd === -1 || !entry.length) {
				continue;
			}

			const len = entry.length;
			if (len > 0) {
				const data = readBytesAt(arc.fd, entry.offset, len);

				const outFilename = arc.dir + entry.filename;
				const out_fd = fs.openSync(outFilename, 'w');
				fs.writeSync(out_fd, data);
				fs.closeSync(out_fd);
			}
		}

		// delete [] arc_info;
	}

	// delete [] toc_buff;

	// printf("\nUnpacking done!\n");
	process.stdout.write('\nUnpacking done!\n');

	return 0;
}

process.exitCode = main();

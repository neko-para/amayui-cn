/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
/*                                                                                                   */
/*  <Ikusa Megami Zero> Chinese Translation Project                                                  */
/*  lzss.mjs                                                                                          */
/*  lzss.cpp 的解压方向（unlzss / lzss_read）Node 移植                                                  */
/*  Modified version of Allegro's lzss code                                                          */
/*  Modified by Xuan (xuan@moelab.org)                                                              */
/*                                                                                                   */
/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

/*
 * 移植说明：
 *  - tools/alf/lzss/lzss.cpp 里同时实现了压缩与解压两个方向，并带流式中断恢复（goto pos1/pos2）。
 *  - unpack_alf.cpp 只用了解压（unlzss），且每次都是新建 state==0 的上下文做一次完整的解压，
 *    永远不会进入 pos1/pos2 的恢复分支。因此这里只移植解压方向，并且顺序执行即可（语义等同）。
 *  - 压缩方向（lzss / lzss_write / lzss_insertnode / lzss_deletenode）未被本工具使用，不再移植，
 *    以便后续排查时与 C 代码逐行对照不至于混淆。
 *
 * 算法（Okumura LZSS，Allegro 变体）：
 *  - 环形缓冲 text_buf，长度 N+F-1，读写指针 r 以 (N-1) 掩码回绕。
 *  - 每 8 个单位用一个 flag 字节（其高字节 0xFF00 计满 8 项后重读下一个 flag 字节）。
 *  - flag 位为 1 => 紧接 1 个字面量字节；为 0 => 紧接 2 字节的 (12 位位置, 长度) 对。
 */

export const N        = 4096;       /* 4k buffers for LZ compression */
export const F        = 18;         /* upper limit for LZ match length */
export const THRESHOLD = 2;         /* LZ encode string into pos and length if match size > this */

/*
 * 对应 C 里的 LZSS_UNPACK_DATA / create_lzss_unpack_data()。
 * state 只在流式中断恢复时有意义；单次解压始终从 0 开始，此处保留字段以对齐 C。
 */
export function createUnlzssData() {
	return {
		state: 0,                  /* 0=新建；C 中 1/2 表示中断位置 */
		i: 0, j: 0, k: 0, r: 0, c: 0,
		flags: 0,
		text_buf: new Uint8Array(N + F - 1).fill(0),   /* 环形缓冲, 带 F-1 个多余字节用于串比较 */
	};
}

/* 对应 C 的 free_lzss_unpack_data()：Node 依赖 GC，无需显式释放。 */
export function freeUnlzssData(dat) {
	void dat;
}

/*
 * 对应 C 的 lzss_read()：从 inputbuf 解出至多 s 个字节写入 buf，返回实际写入字节数。
 * 与 C 的差异：C 支持断点恢复（state==1/2 时跳 pos1/pos2），本函数因其调用方式为单次解压而省略。
 * 边界检查由“读取前判断 inputindex >= inputsize”完成，避免 C 里越界读到末尾之外（UB）。
 */
export function lzssRead(inputbuf, inputsize, dat, s, buf) {
	let inputindex = 0;
	let { i, j, k, r, c, flags } = dat;
	let size = 0;
	let done = false;   /* 因输出填满而提前结束，对应 C 的 goto getout */

	r  = N - F;
	flags = 0;

	for (;;) {
		if (((flags >>= 1) & 256) === 0) {
			if (inputindex >= inputsize) break;   /* EOF */
			c = inputbuf[inputindex++];
			flags = c | 0xFF00;                    /* 高字节用于计数 8 项 */
		}

		if (flags & 1) {
			/* 字面量 */
			if (inputindex >= inputsize) break;
			c = inputbuf[inputindex++];
			dat.text_buf[r++] = c;
			r &= (N - 1);
			buf[size++] = c;
			if (size >= s) { dat.state = 1; done = true; break; }
		}
		else {
			/* 位置-长度对 */
			if (inputindex >= inputsize) break;
			i = inputbuf[inputindex++];
			if (inputindex >= inputsize) break;
			j = inputbuf[inputindex++];
			i |= ((j & 0xF0) << 4);      /* 12 位位置：低 8 位 + 高 4 位 */
			j  = (j & 0x0F) + THRESHOLD; /* 长度 */
			for (k = 0; k <= j; k++) {
				c = dat.text_buf[(i + k) & (N - 1)];
				dat.text_buf[r++] = c;
				r &= (N - 1);
				buf[size++] = c;
				if (size >= s) { dat.state = 2; done = true; break; }
			}
			if (done) break;
		}
	}

	/* 只有走 EOF 分支才会把 state 归 0，对应 C 的 dat->state = 0（在 getout 之前）。 */
	if (!done) dat.state = 0;

	dat.i = i; dat.j = j; dat.k = k; dat.r = r; dat.c = c; dat.flags = flags;
	return size;
}

/*
 * 对应 C 的 unlzss(inputbuf, inputlen, outputbuf, outputlen)。
 * 写回 outputbuf 的字节数；C 里返回 n（此处未在 unpack_alf 中使用，仅保留）。
 */
export function unlzss(inputbuf, inputlen, outputbuf, outputlen) {
	const dat = createUnlzssData();
	const n = lzssRead(inputbuf, inputlen, dat, outputlen, outputbuf);
	freeUnlzssData(dat);
	return n;
}

namespace AmayuiInspector.Core.Decode;

/// <summary>
/// AGE 引擎整型槽的混淆编解码（异或 + 循环移位）。
/// 公式来自 <c>engine/engine.hpp</c>：#define DEC(x) __ROR4__( key ^ __ROL4__(x,11), 25 )，
/// ENC(a) = __ROL4__( key ^ __ROR4__(a,7), 21 )，key 相同且互为逆运算。
/// </summary>
public static class Dec
{
    private static uint Rol(uint v, int n)
    {
        n %= 32;
        if (n < 0) n += 32;
        if (n == 0) return v;
        return (v << n) | (v >> (32 - n));
    }

    private static uint Ror(uint v, int n)
    {
        n %= 32;
        if (n < 0) n += 32;
        if (n == 0) return v;
        return (v >> n) | (v << (32 - n));
    }

    /// <summary>DEC(x) = ROR4(key ^ ROL4(x, 11), 25)。int 槽（global/local int、ptr 目标、数组元素）都过它。</summary>
    public static uint Decode(uint x, uint key) => Ror(key ^ Rol(x, 11), 25);

    /// <summary>ENC(a) = ROL4(key ^ ROR4(a, 7), 21)。与 Decode 互为逆运算（key 相同）。</summary>
    public static uint Encode(uint a, uint key) => Rol(key ^ Ror(a, 7), 21);

    /// <summary>自校验：对任意 x，Decode(Encode(x), key) == x。</summary>
    public static bool RoundTripOk(uint key)
    {
        uint[] s = { 0u, 1u, 0xFFFFFFFFu, 0x80000000u, 0x12345678u, key, key ^ 0xA5A5A5A5u };
        foreach (var x in s)
            if (Decode(Encode(x, key), key) != x) return false;
        return true;
    }

    /// <summary>把字节缓冲里第 <paramref name="offset"/> 字节起的小端 4 字节拼成 uint。</summary>
    public static uint B32(byte[] buf, int offset)
        => (uint)(buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24));
}

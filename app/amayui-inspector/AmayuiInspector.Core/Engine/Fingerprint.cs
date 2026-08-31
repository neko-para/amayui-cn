using System.Text.Json;

namespace AmayuiInspector.Core.Engine;

/// <summary>dispatch 表指纹签名（从 <c>scripts/re/dispatch_signature.json</c> 载入）。</summary>
public sealed class DispatchSignature
{
    /// <summary>opcode → handler 的静态 VA。RVA = VA − PreferredBase。</summary>
    public required IReadOnlyDictionary<int, uint> Samples { get; init; }

    public required uint PreferredBase { get; init; }

    public required uint DefaultHandlerVa { get; init; }

    /// <summary>定位 `this` 时用作「锚点」的 opcode（该号在大量构建中恒有自定义 handler）。</summary>
    public int AnchorOp { get; init; } = 0x50;
}

public static class Fingerprint
{
    public static DispatchSignature Load(string jsonPath)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(jsonPath));
        var root = doc.RootElement;
        var samples = new Dictionary<int, uint>();
        foreach (var s in root.GetProperty("samples").EnumerateArray())
        {
            int op = s.GetProperty("op").GetInt32();
            string va = s.GetProperty("va").GetString()!;
            samples[op] = (uint)Convert.ToUInt64(va.Substring(2), 16);
        }

        uint preferred = Hex(root.GetProperty("preferred_base").GetString()!);

        uint def = Hex(root.GetProperty("default_handler_va").GetString()!);

        return new DispatchSignature
        {
            Samples = samples,
            PreferredBase = preferred,
            DefaultHandlerVa = def,
        };
    }

    private static uint Hex(string s) => (uint)Convert.ToUInt64(s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? s.Substring(2) : s, 16);
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace AmayuiInspector.Core.Engine;

/// <summary>
/// 「脚本 id（frame_arg / call-script 参数）→ 文件名」映射。
/// 数据来自解 SYS4INI.BIN 得到的文件表（<c>.tmp/sys4ini-files.json</c>），
/// 其中 <c>i</c> 即脚本在文件表中的索引（= frame_arg 的值），<c>filename</c> 是其文件名。
/// </summary>
public sealed class ScriptIndex
{
    private readonly IReadOnlyDictionary<uint, string> _index;

    private ScriptIndex(IReadOnlyDictionary<uint, string> index)
    {
        _index = index;
        Count = index.Count;
        Loaded = index.Count > 0;
    }

    public bool Loaded { get; }
    public int Count { get; }

    public static ScriptIndex Load(string? explicitPath = null)
    {
        string? path = explicitPath;
        if (string.IsNullOrEmpty(path)) path = LocateDefault();
        if (string.IsNullOrEmpty(path) || !File.Exists(path))
            return new ScriptIndex(new Dictionary<uint, string>());

        try
        {
            var map = new Dictionary<uint, string>();
            using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                uint id = e.GetProperty("i").GetUInt32();
                string name = e.GetProperty("filename").GetString() ?? "";
                if (!map.ContainsKey(id)) map[id] = name;
            }
            return new ScriptIndex(map);
        }
        catch
        {
            return new ScriptIndex(new Dictionary<uint, string>());
        }
    }

    /// <summary>按脚本 id 取文件名；未命中返回 null。若不加载（id≥0x01000000 的 APPEND/派发编码）由调用方自行标注。</summary>
    public string? Resolve(uint id) => _index.TryGetValue(id, out var name) ? name : null;

    private static string? LocateDefault()
    {
        string? dir = AppContext.BaseDirectory;
        for (int i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir!, ".tmp", "sys4ini-files.json");
            if (File.Exists(candidate)) return candidate;
            var parent = Directory.GetParent(dir!);
            if (parent == null) break;
            dir = parent.FullName;
        }
        return null;
    }
}

using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;
using AmayuiInspector.Core.Model;
using AmayuiInspector.App.Services;

namespace AmayuiInspector.App.ViewModels;

/// <summary>
/// 全局表 VM：批量读取 + 解码 global-int 数组，内存中过滤（非空/掉落区/搜索）后按页显示。
/// 支持全量（≈8M 槽）加载 —— 不预设行数/范围硬上限，用分页避免一次物化过多行。
/// </summary>
public sealed class GlobalTableVm : ViewModelBase
{
    private const int MinPageSize = 1000;
    private const int MaxPageSize = 500000;
    private const long MaxSlotsCap = 0x800000L; // ~8M 槽（方案实测「8M 内」），超出按区段实际长度截断

    private string _header = "就绪（先「扫描this」）";
    private string _search = "";
    private string _from = EngineOffsets.DropItemStart.ToString("X");
    private string _to = EngineOffsets.DropEnd.ToString("X");
    private int _filterIndex = 0; // 0=仅非空 1=仅掉落区 2=全部
    private int _pageSize = 10000;
    private int _currentPage = 0;
    private int _totalPages = 1;
    private long _maxSlots = -1;

    private EngineSession? _session;
    private uint[]? _decoded;       // 解码后的值，下标 = 槽位 − _startIndex
    private uint _startIndex = 0;
    private List<int>? _view;       // 命中槽（相对 _decoded 的下标）；null = 全量顺序
    private long _totalCount = 0;
    private int _pageGen = 0;

    private static readonly Lazy<TextMapper> _mapper = new(() => TextMapper.LoadFromEmbedded());

    public GlobalTableVm()
    {
        LoadCommand = new RelayCommand(async _ => await LoadAsync());
        FullLoadCommand = new RelayCommand(async _ => await FullLoadAsync());
        PrevPageCommand = new RelayCommand(_ => GoToPage(CurrentPage - 1));
        NextPageCommand = new RelayCommand(_ => GoToPage(CurrentPage + 1));
    }

    public ObservableCollection<GlobalSlotRow> Rows { get; } = new();

    public int[] PageSizes { get; } = { 1000, 10000, 100000, 500000 };

    public string HeaderText { get => _header; set => SetProperty(ref _header, value); }
    public string SearchText { get => _search; set { if (SetProperty(ref _search, value)) RebuildFilter(); } }
    public string FromText { get => _from; set => SetProperty(ref _from, value); }
    public string ToText { get => _to; set => SetProperty(ref _to, value); }
    public int FilterIndex { get => _filterIndex; set { if (SetProperty(ref _filterIndex, value)) RebuildFilter(); } }
    public int PageSize { get => _pageSize; set { if (SetProperty(ref _pageSize, value)) { Clamp(); RebuildFilter(); } } }
    public int CurrentPage { get => _currentPage; set => SetProperty(ref _currentPage, value); }
    public int TotalPages { get => _totalPages; set => SetProperty(ref _totalPages, value); }

    public string PageInfo => $"第 {Math.Max(1, _currentPage + 1)} / {Math.Max(1, _totalPages)} 页";
    public string MaxSlotsText => _maxSlots >= 0 ? $"≈{_maxSlots:N0} 槽" : "未知";
    public bool CanPrev => _currentPage > 0;
    public bool CanNext => _currentPage + 1 < _totalPages;

    public RelayCommand LoadCommand { get; }
    public RelayCommand FullLoadCommand { get; }
    public RelayCommand PrevPageCommand { get; }
    public RelayCommand NextPageCommand { get; }

    /// <summary>绑定会话：置空旧数据，取 global 区段槽数上限，更新表头。</summary>
    public void Attach(EngineSession? session)
    {
        _session = session;
        _decoded = null;
        _view = null;
        _totalCount = 0;
        _totalPages = 1;
        _currentPage = 0;
        _maxSlots = session?.MaxGlobalSlots() ?? -1;
        OnPropertyChanged(nameof(MaxSlotsText));
        OnPropertyChanged(nameof(PageInfo));
        OnPropertyChanged(nameof(CanPrev));
        OnPropertyChanged(nameof(CanNext));
        HeaderText = session == null
            ? "就绪（先「扫描this」）"
            : $"就绪 · 基址 0x{session.GlobalIntBase:X} · 区段上限 {MaxSlotsText}";
    }

    /// <summary>按当前 过滤/范围 载入并解码，随后过滤+回到第 0 页。</summary>
    public async Task LoadAsync()
    {
        if (_session == null) { HeaderText = "请先「扫描this」"; return; }
        (uint from, uint to, bool includeEmpty) = ResolveRange();
        if (to < from) { HeaderText = "范围无效：from > to"; return; }

        HeaderText = "扫描中…";
        var session = _session;
        int count = (int)Math.Min((ulong)to - from + 1, MaxSlotsCap);
        var decoded = await Task.Run(() => session.ReadGlobalIntsRange(from, count));

        _startIndex = from;
        _decoded = decoded;
        _currentPage = 0;
        RebuildFilter();
        HeaderText = decoded.Length == 0
            ? "该范围无数据"
            : $"已载入 [0x{from:X}..0x{from + (uint)decoded.Length - 1:X}] 共 {decoded.Length:N0} 槽";
    }

    /// <summary>全量：范围 0..区段上限，一次载入到末尾（≈8M）。</summary>
    public async Task FullLoadAsync()
    {
        if (_session == null) { HeaderText = "请先「扫描this」"; return; }
        int max = _session.MaxGlobalSlots();
        if (max <= 0) { HeaderText = "无法确定 global 区段上限"; return; }
        FromText = "0";
        ToText = (max - 1).ToString("X");
        await LoadAsync();
    }

    private void GoToPage(int page)
    {
        if (_totalPages <= 0) return;
        CurrentPage = Math.Clamp(page, 0, _totalPages - 1);
        OnPropertyChanged(nameof(CanPrev));
        OnPropertyChanged(nameof(CanNext));
        Materialize();
    }

    /// <summary>按 过滤/搜索 重算命中集与总页数，并重画当前页。</summary>
    private void RebuildFilter()
    {
        if (_decoded == null) return;
        string search = (SearchText ?? "").Trim().ToLower();
        bool includeEmpty = _filterIndex == 2;
        bool dropOnly = _filterIndex == 1;
        long count = _decoded.Length;
        List<int>? view = null;

        if (!includeEmpty || !string.IsNullOrEmpty(search))
        {
            view = new List<int>();
            for (int i = 0; i < _decoded.Length; i++)
            {
                uint val = _decoded[i];
                if (!includeEmpty && val == 0) continue;
                uint idx = _startIndex + (uint)i;
                if (dropOnly && !(idx >= EngineOffsets.DropItemStart && idx < EngineOffsets.DropEnd)) continue;
                if (!string.IsNullOrEmpty(search))
                {
                    if (!Fmt.Hex(idx).Contains(search, StringComparison.OrdinalIgnoreCase) &&
                        !val.ToString().Contains(search, StringComparison.OrdinalIgnoreCase))
                        continue;
                }
                view.Add(i);
            }
            count = view.Count;
        }

        _view = view;
        _totalCount = count;
        _totalPages = (int)Math.Max(1, (_totalCount + _pageSize - 1) / _pageSize);
        _currentPage = Math.Clamp(_currentPage, 0, _totalPages - 1);
        OnPropertyChanged(nameof(TotalPages));
        OnPropertyChanged(nameof(PageInfo));
        OnPropertyChanged(nameof(CanPrev));
        OnPropertyChanged(nameof(CanNext));
        Materialize();
    }

    private void Materialize()
    {
        if (_decoded == null) return;
        _pageGen++;
        Rows.Clear();
        int start = _currentPage * _pageSize;
        int end = (int)Math.Min(start + _pageSize, _totalCount);
        var page = new List<GlobalSlotRow>(end - start);
        for (int i = start; i < end; i++)
        {
            int off = _view == null ? i : _view[i];
            uint idx = _startIndex + (uint)off;
            uint val = _decoded[off];
            var row = new GlobalSlotRow(idx, val, idx >= EngineOffsets.DropItemStart && idx < EngineOffsets.DropEnd);
            page.Add(row);
            Rows.Add(row);
        }
        OnPropertyChanged(nameof(PageInfo));
        _ = RefillStringsAsync(page, _pageGen);
    }

    /// <summary>为当前页逐槽读取 global-string（还原简体、截断 16 字符），后台执行，页码代际防过期。</summary>
    private async Task RefillStringsAsync(IReadOnlyList<GlobalSlotRow> page, int gen)
    {
        if (_session == null || page.Count == 0) return;
        var session = _session;
        var mapper = _mapper.Value;
        var texts = await Task.Run(() =>
        {
            var r = new string[page.Count];
            for (int k = 0; k < page.Count; k++)
                r[k] = mapper.MapAndTruncate(session.ReadGlobalString(page[k].Index), 16);
            return r;
        });
        if (gen != _pageGen) return; // 已翻页/换数据，丢弃过期结果
        for (int k = 0; k < page.Count && k < texts.Length; k++)
            page[k].StringText = texts[k];
    }

    private void Clamp()
    {
        _pageSize = Math.Clamp(_pageSize, MinPageSize, MaxPageSize);
        OnPropertyChanged(nameof(PageSize));
    }

    private (uint from, uint to, bool includeEmpty) ResolveRange()
    {
        if (_filterIndex == 1) // 仅掉落区：固定为掉落表区间，只显示非空
            return (EngineOffsets.DropItemStart, EngineOffsets.DropEnd, false);
        bool empty = _filterIndex == 2;
        uint from = ParseHex(_from);
        uint to = ParseHex(_to);
        if (to == 0 && from > 0) to = from;
        return (from, to, empty);
    }

    private static uint ParseHex(string s)
    {
        s = (s ?? "").Trim();
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s.Substring(2);
        return uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out uint v) ? v : 0;
    }
}

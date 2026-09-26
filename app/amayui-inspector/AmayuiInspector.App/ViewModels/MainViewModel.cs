using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Threading;
using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Model;
using AmayuiInspector.Core.Process;
using AmayuiInspector.App.Services;

namespace AmayuiInspector.App.ViewModels;

public sealed class MainViewModel : ViewModelBase
{
    /// <summary>延迟采集时长（ms）：点按钮后等待这么久，自动执行一次与「刷新快照」相同的采集。</summary>
    public const int DelayedCaptureMs = 5000;

    private const string DelayIdleText = "5 秒后采集";

    private ProcessOption? _selectedProcess;
    private string _status = "就绪";
    private bool _scanned;
    private EngineSession? _session;
    private DispatcherTimer? _delayTimer;
    private int _delayRemainSec;
    private string _delayButtonText = DelayIdleText;

    public MainViewModel()
    {
        Engine = new EnginePanelVm();
        GlobalTable = new GlobalTableVm();
        Frames = new FrameStackVm();

        RefreshProcessesCommand = new RelayCommand(_ => RefreshProcesses());
        ScanThisCommand = new RelayCommand(async _ => await ScanThisAsync());
        RefreshSnapshotCommand = new RelayCommand(async _ => await RefreshSnapshotAsync());
        DelayCaptureCommand = new RelayCommand(_ => ToggleDelayedCapture());
    }

    public ObservableCollection<ProcessOption> Processes { get; } = new();

    public ProcessOption? SelectedProcess
    {
        get => _selectedProcess;
        set => SetProperty(ref _selectedProcess, value);
    }

    public EnginePanelVm Engine { get; }
    public GlobalTableVm GlobalTable { get; }
    public FrameStackVm Frames { get; }

    public string Status { get => _status; set => SetProperty(ref _status, value); }

    public bool Scanned { get => _scanned; private set => SetProperty(ref _scanned, value); }

    /// <summary>倒计时进行中（按钮文字变成「取消（Ns）」，再次点击即取消）。</summary>
    public bool DelayCounting => _delayTimer != null;

    /// <summary>延迟采集按钮上的文字：空闲时「5 秒后采集」，倒计时中「取消（Ns）」。</summary>
    public string DelayButtonText { get => _delayButtonText; private set => SetProperty(ref _delayButtonText, value); }

    public RelayCommand RefreshProcessesCommand { get; }
    public RelayCommand ScanThisCommand { get; }
    public RelayCommand RefreshSnapshotCommand { get; }
    public RelayCommand DelayCaptureCommand { get; }

    private void RefreshProcesses()
    {
        Processes.Clear();
        foreach (var p in ProcessLocator.FindTargets())
            Processes.Add(new ProcessOption(p.Id, p.ProcessName));
        SelectedProcess = Processes.FirstOrDefault();
        Status = Processes.Count == 0 ? "未发现 AGE/天結 进程" : $"发现 {Processes.Count} 个候选进程，请选择后「扫描this」";
    }

    private async Task ScanThisAsync()
    {
        if (SelectedProcess == null)
        {
            RefreshProcesses();
            if (SelectedProcess == null) { Status = "没有可扫描的进程"; return; }
        }

        Status = "扫描 this…";
        try
        {
            var sig = Fingerprint.Load(EngineSession.DefaultSignaturePath());
            var target = SelectedProcess;
            var session = await Task.Run(() => EngineSession.Locate(target!.ProcessId, target.Name + ".exe", sig));
            var prev = _session;
            _session = session;
            prev?.Dispose();

            var snap = await Task.Run(() => session.ReadSnapshot());
            Engine.Update(snap);
            Frames.Update(snap);
            GlobalTable.Attach(session);
            Scanned = true;
            Status = $"this=0x{session.ThisAddr:X} module=0x{session.ModuleBase:X} key=0x{session.Key:X}";
        }
        catch (Exception ex)
        {
            Status = "扫描失败：" + ex.Message;
        }
    }

    private async Task RefreshSnapshotAsync() => await RefreshSnapshotAsync(null);

    /// <summary>手动快照（与「刷新快照」按钮完全相同的一条采集路径）；<paramref name="captureLabel"/> 非空时用于延迟采集的可见反馈。</summary>
    private async Task RefreshSnapshotAsync(string? captureLabel)
    {
        if (_session == null)
        {
            Status = "请先「扫描this」";
            return;
        }
        Status = "刷新快照…";
        try
        {
            var session = _session;
            var snap = await Task.Run(() => session.ReadSnapshot());
            Engine.Update(snap);
            Frames.Update(snap);
            Status = (captureLabel == null ? "快照已刷新" : $"快照已刷新（{captureLabel}）")
                     + $" · {DateTime.Now:HH:mm:ss} · this=0x{snap.This:X}";
        }
        catch (Exception ex)
        {
            Status = "刷新失败：" + ex.Message;
        }
    }

    /// <summary>按钮入口：空闲时启动倒计时，倒计时中再次点击 = 取消。</summary>
    private void ToggleDelayedCapture()
    {
        if (_delayTimer != null)
        {
            CancelDelayedCapture("已取消延迟采集");
            return;
        }

        if (_session == null)
        {
            Status = "请先「扫描this」";
            return;
        }

        _delayRemainSec = DelayedCaptureMs / 1000;
        _delayTimer = new DispatcherTimer(DispatcherPriority.Normal) { Interval = TimeSpan.FromSeconds(1) };
        _delayTimer.Tick += OnDelayTick;
        _delayTimer.Start();
        DelayButtonText = $"取消（{_delayRemainSec}s）";
        Status = $"延迟采集：{_delayRemainSec}s 后采集…（再次点击按钮取消）";
        OnPropertyChanged(nameof(DelayCounting));
    }

    private async void OnDelayTick(object? sender, EventArgs e)
    {
        if (_delayTimer == null) return;

        _delayRemainSec--;
        if (_delayRemainSec > 0)
        {
            DelayButtonText = $"取消（{_delayRemainSec}s）";
            Status = $"延迟采集：{_delayRemainSec}s 后采集…（再次点击按钮取消）";
            return;
        }

        StopDelayTimer();
        await RefreshSnapshotAsync("延迟采集");
    }

    private void CancelDelayedCapture(string reason)
    {
        StopDelayTimer();
        Status = reason;
    }

    private void StopDelayTimer()
    {
        if (_delayTimer == null) return;
        _delayTimer.Stop();
        _delayTimer.Tick -= OnDelayTick;
        _delayTimer = null;
        _delayRemainSec = 0;
        DelayButtonText = DelayIdleText;
        OnPropertyChanged(nameof(DelayCounting));
    }
}

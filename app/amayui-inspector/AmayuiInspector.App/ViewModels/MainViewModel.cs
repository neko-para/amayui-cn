using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using AmayuiInspector.Core.Engine;
using AmayuiInspector.Core.Model;
using AmayuiInspector.Core.Process;
using AmayuiInspector.App.Services;

namespace AmayuiInspector.App.ViewModels;

public sealed class MainViewModel : ViewModelBase
{
    private ProcessOption? _selectedProcess;
    private string _status = "就绪";
    private bool _scanned;
    private EngineSession? _session;

    public MainViewModel()
    {
        Engine = new EnginePanelVm();
        GlobalTable = new GlobalTableVm();
        Frames = new FrameStackVm();

        RefreshProcessesCommand = new RelayCommand(_ => RefreshProcesses());
        ScanThisCommand = new RelayCommand(async _ => await ScanThisAsync());
        RefreshSnapshotCommand = new RelayCommand(async _ => await RefreshSnapshotAsync());
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

    public RelayCommand RefreshProcessesCommand { get; }
    public RelayCommand ScanThisCommand { get; }
    public RelayCommand RefreshSnapshotCommand { get; }

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

    private async Task RefreshSnapshotAsync()
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
            Status = $"快照已刷新 · {DateTime.Now:HH:mm:ss} · this=0x{snap.This:X}";
        }
        catch (Exception ex)
        {
            Status = "刷新失败：" + ex.Message;
        }
    }
}

using System.Runtime.InteropServices;
using System.Text;

namespace AmayuiInspector.Core.Interop;

/// <summary>
/// 进程内存读取所需的 Win32 P/Invoke。宿主 64 位、目标 32 位：用 x64 <c>MEMORY_BASIC_INFORMATION</c>
/// （IntPtr 字段天然 64 位），目标 32 位地址落在低 32 位即正确。已验证（docs/re/engine/07 §6）。
/// </summary>
internal static class Win32
{
    public const uint PROCESS_QUERY_INFORMATION = 0x0400;
    public const uint PROCESS_VM_READ = 0x0010;
    public const uint PROCESS_ACCESS = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ; // 0x0410
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    public const uint MEM_COMMIT = 0x1000;
    public const uint PAGE_NOACCESS = 0x01;
    public const uint PAGE_GUARD = 0x100;
    public const uint PAGE_EXECUTE_WRITECOPY = 0x80; // 常出现的可执行区，仅参考

    [StructLayout(LayoutKind.Sequential)]
    public struct MBI
    {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, [Out] byte[] buf, int size, out IntPtr read);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, int length);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EnumProcessModules(IntPtr h, [Out] IntPtr[] modules, int cb, out int needed);

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern uint GetModuleFileNameEx(IntPtr h, IntPtr module, StringBuilder name, int size);
}

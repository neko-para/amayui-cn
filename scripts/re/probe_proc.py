# -*- coding: utf-8 -*-
"""probe_proc.py -- read (NOT attach, NOT debug) a same-user process's module list.
Read-only OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ) + ReadProcessMemory.
Does NOT require SeDebugPrivilege for a same-user process. No debug attach, no write.
Usage: python probe_proc.py <pid> <abs_out_dir>
"""
import sys, ctypes, struct, os
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 30624
OUTDIR = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()

k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype = wintypes.BOOL; k.CloseHandle.argtypes = [wintypes.HANDLE]
k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE; k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
k.Module32FirstW.restype = wintypes.BOOL; k.Module32FirstW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.Module32NextW.restype = wintypes.BOOL; k.Module32NextW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]

def rd(a, n):
    b = ctypes.create_string_buffer(n); r = ctypes.c_size_t(0)
    if not k.ReadProcessMemory(h, ctypes.c_void_p(a), b, n, ctypes.byref(r)):
        return None
    return b.raw[:r.value]

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
h = k.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, PID)
if not h:
    print('OpenProcess FAILED err=%d (0x%X)' % (ctypes.get_last_error(), ctypes.get_last_error()))
    sys.exit(1)
print('OpenProcess OK  pid=%d' % PID)

snap = k.CreateToolhelp32Snapshot(0x00000008, PID)  # TH32CS_SNAPMODULE
print('snapshot handle=%d err=%d' % (snap, ctypes.get_last_error() if snap == -1 else 0))
class ME(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("th32ModuleID", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
        ("GlblcntUsage", wintypes.DWORD), ("ProccntUsage", wintypes.DWORD),
        ("modBaseAddr", ctypes.c_void_p), ("modBaseSize", wintypes.DWORD),
        ("hModule", wintypes.HMODULE), ("szModule", ctypes.c_wchar*256), ("szExePath", ctypes.c_wchar*260)]
me = ME(); me.dwSize = ctypes.sizeof(me)
mods = []
if snap != -1 and k.Module32FirstW(snap, ctypes.byref(me)):
    while True:
        mods.append((me.modBaseAddr, me.modBaseSize, me.szModule))
        if not k.Module32NextW(snap, ctypes.byref(me)): break
if snap != -1: k.CloseHandle(snap)
print('modules:', len(mods))
lines = []
for b, sz, nm in mods:
    lines.append('%X|%X|%s' % (b, sz, nm))
    print('  %08X  %08X  %s' % (b, sz, nm))
ko = os.path.join(OUTDIR, 'age_modules_30624.txt')
with open(ko, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('saved', ko)

engine = None
for b, sz, nm in mods:
    if nm.lower() == 'age.exe':
        engine = (b, sz)
if engine:
    head = rd(engine[0], 0x1000)
    if head:
        e = struct.unpack_from('<I', head, 0x3C)[0]
        print('engine base=%08X size=%X  e_lfanew=%X  pe_magic=%02X %02X' % (engine[0], engine[1], e, head[e], head[e+1]))
else:
    print('WARN: AGE.EXE not in module list')
k.CloseHandle(h)

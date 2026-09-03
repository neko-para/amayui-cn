# -*- coding: utf-8 -*-
"""attach_capture.py  (RUN WITH ADMIN 32-BIT python.exe)

Attach to ALREADY-RUNNING AGE, set ONE hardware exec breakpoint (DR0) at the import
dispatch 'call eax' (engine_base+0x25E601), and capture the first hit in full:
real registers (via GetThreadContext, immune to tampered SS/SP display) + stack
bytes + EAX (resolved API target). Captures programmatically -> no manual dump.

Usage (elevated):  <admin 32bit python> attach_capture.py <pid> <outfile>
"""
import sys, ctypes, struct, json, time, os
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 6864
OUT = sys.argv[2] if len(sys.argv) > 2 else r'..\tmp\capture_sample.json'
OUT = os.path.abspath(OUT)
LOGPATH = OUT + '.log'
BASE = 0x400000
DISPV = 0x65E601
DISP = BASE + (0x65E601 - BASE)   # 0x65E601 (engine at 0x400000)
TIMEOUT_S = 120

def log(msg):
    line = '[%s] %s' % (time.strftime('%H:%M:%S'), msg)
    print(line, flush=True)
    try:
        with open(LOGPATH, 'a', encoding='utf-8') as f: f.write(line + '\n')
    except Exception: pass

k = ctypes.WinDLL('kernel32', use_last_error=True)
def enable_debug_privilege():
    adv = ctypes.WinDLL('advapi32', use_last_error=True)
    tok = wintypes.HANDLE()
    adv.OpenProcessToken.restype = wintypes.BOOL
    adv.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    if not adv.OpenProcessToken(k.GetCurrentProcess(), 0x20|0x08, ctypes.byref(tok)): return False
    class LUID(ctypes.Structure):
        _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]
    class LA(ctypes.Structure):
        _fields_ = [("Luid", LUID), ("Attributes", wintypes.DWORD)]
    class TP(ctypes.Structure):
        _fields_ = [("PrivilegeCount", wintypes.DWORD), ("Privileges", LA*1)]
    adv.LookupPrivilegeValueW.restype = wintypes.BOOL
    adv.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(LUID)]
    luid = LUID()
    if not adv.LookupPrivilegeValueW(None, "SeDebugPrivilege", ctypes.byref(luid)): return False
    tp = TP(); tp.PrivilegeCount = 1; tp.Privileges[0].Luid = luid; tp.Privileges[0].Attributes = 0x2
    adv.AdjustTokenPrivileges.restype = wintypes.BOOL
    adv.AdjustTokenPrivileges.argtypes = [wintypes.HANDLE, wintypes.BOOL, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    return adv.AdjustTokenPrivileges(tok, False, ctypes.byref(tp), 0, None, None)

k.DebugActiveProcess.restype = wintypes.BOOL; k.DebugActiveProcess.argtypes = [wintypes.DWORD]
k.DebugActiveProcessStop.restype = wintypes.BOOL; k.DebugActiveProcessStop.argtypes = [wintypes.DWORD]
k.WaitForDebugEvent.restype = wintypes.BOOL; k.WaitForDebugEvent.argtypes = [ctypes.c_void_p, wintypes.DWORD]
k.ContinueDebugEvent.restype = wintypes.BOOL; k.ContinueDebugEvent.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.OpenThread.restype = wintypes.HANDLE; k.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.SuspendThread.restype = wintypes.DWORD; k.SuspendThread.argtypes = [wintypes.HANDLE]
k.ResumeThread.restype = wintypes.DWORD; k.ResumeThread.argtypes = [wintypes.HANDLE]
k.GetThreadContext.restype = wintypes.BOOL; k.GetThreadContext.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.SetThreadContext.restype = wintypes.BOOL; k.SetThreadContext.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype = wintypes.BOOL; k.CloseHandle.argtypes = [wintypes.HANDLE]
k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE; k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
k.Module32FirstW.restype = wintypes.BOOL; k.Module32FirstW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.Module32NextW.restype = wintypes.BOOL; k.Module32NextW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.Thread32First.restype = wintypes.BOOL; k.Thread32First.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
k.Thread32Next.restype = wintypes.BOOL; k.Thread32Next.argtypes = [wintypes.HANDLE, ctypes.c_void_p]

class CONTEXT32(ctypes.Structure):
    _fields_ = [("ContextFlags", wintypes.DWORD), ("Dr0", wintypes.DWORD), ("Dr1", wintypes.DWORD),
        ("Dr2", wintypes.DWORD), ("Dr3", wintypes.DWORD), ("Dr6", wintypes.DWORD), ("Dr7", wintypes.DWORD),
        ("FloatSave", ctypes.c_ubyte*112), ("SegGs", wintypes.DWORD), ("SegFs", wintypes.DWORD),
        ("SegEs", wintypes.DWORD), ("SegDs", wintypes.DWORD), ("Edi", wintypes.DWORD), ("Esi", wintypes.DWORD),
        ("Ebx", wintypes.DWORD), ("Edx", wintypes.DWORD), ("Ecx", wintypes.DWORD), ("Eax", wintypes.DWORD),
        ("Ebp", wintypes.DWORD), ("Eip", wintypes.DWORD), ("SegCs", wintypes.DWORD), ("EFlags", wintypes.DWORD),
        ("Esp", wintypes.DWORD), ("SegSs", wintypes.DWORD), ("ExtendedRegisters", ctypes.c_ubyte*512)]
CTX_ALL = 0x1001F
DBG_CONTINUE = 0x00010002
EXCEPTION_DEBUG_EVENT = 1
EXCEPTION_SINGLE_STEP = 0x80000004
EXCEPTION_BREAKPOINT = 0x80000003
CEVENT_NAMES = {1:'EXCEPTION',2:'CREATE_THREAD',3:'CREATE_PROCESS',4:'EXIT_THREAD',5:'EXIT_PROCESS',
    6:'LOAD_DLL',7:'UNLOAD_DLL',8:'OUTPUT',9:'RIP'}
class EXCEPTION_RECORD(ctypes.Structure):
    _fields_ = [("ExceptionCode", wintypes.DWORD), ("ExceptionFlags", wintypes.DWORD),
        ("ExceptionRecord", ctypes.c_void_p), ("ExceptionAddress", ctypes.c_void_p),
        ("NumberParameters", wintypes.DWORD), ("ExceptionInformation", ctypes.c_ulonglong*15)]
class EXCEPTION_DEBUG_INFO(ctypes.Structure):
    _fields_ = [("ExceptionRecord", EXCEPTION_RECORD), ("dwFirstChance", wintypes.DWORD)]
class U(ctypes.Union):
    _fields_ = [("Exception", EXCEPTION_DEBUG_INFO), ("pad", ctypes.c_ubyte*224)]
class DEBUG_EVENT(ctypes.Structure):
    _fields_ = [("dwDebugEventCode", wintypes.DWORD), ("dwProcessId", wintypes.DWORD),
        ("dwThreadId", wintypes.DWORD), ("u", U)]

_ph = None
def find_engine_base():
    snap = k.CreateToolhelp32Snapshot(0x00000008, PID)   # TH32CS_SNAPMODULE
    class ME(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("th32ModuleID", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
            ("GlblcntUsage", wintypes.DWORD), ("ProccntUsage", wintypes.DWORD),
            ("modBaseAddr", ctypes.c_void_p), ("modBaseSize", wintypes.DWORD),
            ("hModule", wintypes.HMODULE), ("szModule", ctypes.c_wchar*256), ("szExePath", ctypes.c_wchar*260)]
    me = ME(); me.dwSize = ctypes.sizeof(me)
    found = None
    if k.Module32FirstW(snap, ctypes.byref(me)):
        while True:
            if me.szModule.lower() == 'age.exe':
                found = me.modBaseAddr; break
            if not k.Module32NextW(snap, ctypes.byref(me)): break
    k.CloseHandle(snap)
    return found

def enum_threads():
    snap = k.CreateToolhelp32Snapshot(0x00000004, PID)   # TH32CS_SNAPTHREAD
    class TE(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ThreadID", wintypes.DWORD),
            ("th32OwnerProcessID", wintypes.DWORD), ("tpBasePri", wintypes.LONG), ("tpDeltaPri", wintypes.LONG),
            ("dwFlags", wintypes.DWORD)]
    te = TE(); te.dwSize = ctypes.sizeof(te)
    out = []
    if k.Thread32First(snap, ctypes.byref(te)):
        while True:
            if te.th32OwnerProcessID == PID: out.append(te.th32ThreadID)
            if not k.Thread32Next(snap, ctypes.byref(te)): break
    k.CloseHandle(snap)
    return out

def set_dr0(tid, addr):
    ht = k.OpenThread(0x02|0x08|0x10|0x40, False, tid)
    if not ht: return False
    k.SuspendThread(ht)
    c = CONTEXT32(); c.ContextFlags = CTX_ALL
    if not k.GetThreadContext(ht, ctypes.byref(c)):
        k.ResumeThread(ht); k.CloseHandle(ht); return False
    c.Dr0 = addr; c.Dr7 = 0x1   # only DR0, exec breakpoint
    c.ContextFlags = CTX_ALL
    ok = k.SetThreadContext(ht, ctypes.byref(c))
    k.ResumeThread(ht); k.CloseHandle(ht)
    return ok

def capture(tid):
    ht = k.OpenThread(0x02|0x08|0x10|0x40, False, tid)
    if not ht: return None
    c = CONTEXT32(); c.ContextFlags = CTX_ALL
    if not k.GetThreadContext(ht, ctypes.byref(c)):
        k.CloseHandle(ht); return None
    # read stack at real ESP (robust to tampered SS/SP display)
    lo = (c.Esp - 0x20) & 0xFFFFFFFF; n = 0x80
    stack = None
    b = ctypes.create_string_buffer(n); r = ctypes.c_size_t(0)
    if k.ReadProcessMemory(_ph, ctypes.c_void_p(lo), b, n, ctypes.byref(r)):
        stack = bytes(b.raw[:r.value])
    k.CloseHandle(ht)
    return {'eip': c.Eip, 'esp': c.Esp, 'ebp': c.Ebp, 'eax': c.Eax, 'ebx': c.Ebx, 'ecx': c.Ecx,
        'edx': c.Edx, 'esi': c.Esi, 'edi': c.Edi, 'eflags': c.EFlags, 'seg_ss': c.SegSs,
        'seg_cs': c.SegCs, 'dr6': c.Dr6, 'dr7': c.Dr7,
        'stack': stack.hex() if stack else None, 'stack_lo': lo}

def main():
    global _ph
    log('SeDebugPrivilege: %s' % enable_debug_privilege())
    base = find_engine_base()
    if base:
        disp = base + (0x65E601 - BASE)
        log('engine base=0x%X -> dispatch=0x%X' % (base, disp))
    else:
        disp = DISP; base = BASE
        log('engine base not found; assume 0x%X -> dispatch=0x%X' % (base, disp))
    if not k.DebugActiveProcess(PID):
        log('DebugActiveProcess FAILED err=%d' % ctypes.get_last_error())
        log('  err==5 -> still under another debugger, or not admin. Detach OllyDbg / elevate.')
        return 1
    _ph = k.OpenProcess(0x0010|0x0400, False, PID)
    tids = enum_threads()
    armed = 0
    for t in tids:
        if set_dr0(t, disp): armed += 1
    log('attached PID %d; armed DR0 on %d/%d threads @0x%X' % (PID, armed, len(tids), disp))
    stub_ctx = None; dispatch_ctx = None; target = None
    start = time.time()
    while time.time() - start < TIMEOUT_S:
        ev = DEBUG_EVENT()
        if not k.WaitForDebugEvent(ctypes.byref(ev), 1000):
            continue
        code = ev.dwDebugEventCode; tid = ev.dwThreadId
        if code == EXCEPTION_DEBUG_EVENT:
            exc = ev.u.Exception.ExceptionRecord
            ecode = exc.ExceptionCode; addr = exc.ExceptionAddress or 0
            first = ev.u.Exception.dwFirstChance
            log('  EV exc=0x%08X @0x%08X first=%d tid=%d' % (ecode, addr, first, tid))
            if ecode == EXCEPTION_SINGLE_STEP:
                ctx = capture(tid) or {}
                log('  -> SINGLE_STEP @0x%08X dr6=0x%X eax=0x%X esp=0x%X  (match=%s)' % (
                    addr, ctx.get('dr6',0), ctx.get('eax',0), ctx.get('esp',0), str(addr==disp)))
                if addr == disp or (ctx.get('dr6') is not None and (ctx['dr6'] & 1)):
                    dispatch_ctx = ctx
                    target = ctx.get('eax')
                    log('  [HIT dispatch @0x%X eax=0x%X esp=0x%X] captured' % (addr, target, ctx.get('esp',0)))
                    break
        k.ContinueDebugEvent(ev.dwProcessId, tid, DBG_CONTINUE)

    sample = {'pid': PID, 'dispatch': disp, 'engine_base': base, 'armed_threads': armed,
        'dispatch_ctx': dispatch_ctx, 'target_eax': target,
        'target_hex': hex(target) if target is not None else None}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(sample, f, indent=2)
    log('saved %s' % OUT)
    log('  armed_threads=%s  captured=%s  target=0x%X (eax)' % (armed, bool(dispatch_ctx), target or 0))
    try: k.DebugActiveProcessStop(PID)
    except Exception: pass
    return 0 if (armed and dispatch_ctx) else 2

if __name__ == '__main__':
    sys.exit(main())

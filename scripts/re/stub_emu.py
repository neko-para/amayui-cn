# -*- coding: utf-8 -*-
"""Prototype: treat the import stub (0x1340000) as a black box and use Unicorn to
bulk-evaluate it per call site, catching the dispatch target. Tests determinism.

Usage: python stub_emu.py <pid> [n_sites]
Reads call->0x1340000 sites from runtime .text, maps engine+stub into Unicorn,
feeds each site's return address, and captures the unmapped (DLL/API) address the
emulation jumps to = the resolved API. Runs each site with two different register
baselines to verify the mapping is a pure function of the return address.
"""
import sys, os, ctypes, struct
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.abspath(r'.tmp\utmp'))

from unicorn import *
from unicorn.x86_const import *

PID = int(sys.argv[1]) if len(sys.argv) > 1 else 39096
NSITES = int(sys.argv[2]) if len(sys.argv) > 2 else 4
EB = 0x400000; IMGEND = EB + 0x26F000
STUB = 0x1340000; STUBEND = STUB + 0x1000
STACK = 0x20000000; STACKSZ = 0x10000
TEB = 0x10000000
MODTXT = r'.tmp\age_modules.txt'

mods = []
for line in open(MODTXT, encoding='utf-8'):
    b, sz, nm = line.rstrip('\n').split('|')
    mods.append((int(b,16), int(sz or '0',16), nm))

k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype = wintypes.HANDLE; k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.ReadProcessMemory.restype = wintypes.BOOL; k.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype = wintypes.BOOL; k.CloseHandle.argtypes = [wintypes.HANDLE]
h = k.OpenProcess(0x0410, False, PID)
def read(a, n, cap=0x400000):
    out = bytearray(); dd = 0
    while dd < n:
        m = min(cap, n-dd); b = ctypes.create_string_buffer(m); r = ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h, ctypes.c_void_p(a+dd), b, m, ctypes.byref(r)) or r.value == 0:
            return bytes(out) if dd else None
        out += b.raw[:r.value]; dd += r.value
    return bytes(out)

# enumerate call->0x1340000 sites
rt = read(EB+0x1000, 0x11C000)
sites = []
for i in range(len(rt)-5):
    if rt[i]==0xE8:
        rel = rt[i+1]|(rt[i+2]<<8)|(rt[i+3]<<16)|(rt[i+4]<<24)
        if rel & 0x80000000: rel -= 0x100000000
        sv = EB+0x1000+i
        if sv+5+rel == STUB:
            sites.append(sv+5)   # return address pushed = site+5
print('call sites (return addresses):', len(sites), ' testing first', NSITES)

# build emu
ENGINE_SIZE = 0x26F000
def make_emu(ra, regbaseline):
    mu = Uc(UC_ARCH_X86, UC_MODE_32)
    # map engine image [EB, EB+ENGINE_SIZE): read committed pages, zero-fill gaps
    mu.mem_map(EB, ENGINE_SIZE, UC_PROT_ALL)
    img = bytearray(ENGINE_SIZE)
    for p in range(0, ENGINE_SIZE, 0x1000):
        b = read(EB+p, 0x1000)
        if b:
            img[p:p+len(b)] = b
    mu.mem_write(EB, bytes(img))
    # stub region (0x1340000 outside engine)
    st = read(STUB, 0x1000) or b'\x00'*0x1000
    mu.mem_map(STUB, 0x2000, UC_PROT_ALL)
    mu.mem_write(STUB, st)
    # stack
    mu.mem_map(STACK, STACKSZ, UC_PROT_ALL)
    mu.mem_write(STACK, b'\x00'*STACKSZ)
    ESP0 = STACK + 0x8000
    mu.mem_write(ESP0, struct.pack('<I', ra))
    # fake TEB at address 0 (fs:[0] reads 0x0; don't touch FS -> flat access works)
    mu.mem_map(0, 0x1000, UC_PROT_ALL)
    mu.mem_write(0, b'\x00'*0x1000)
    mu.reg_write(UC_X86_REG_ESP, ESP0)
    mu.reg_write(UC_X86_REG_EBP, ESP0)
    for nm, v in {'eax':0x11111111,'ebx':0x22222222,'ecx':0x33333333,'edx':0x44444444,
                  'esi':0x55555555,'edi':0x66666666}.items():
        r = {'eax':UC_X86_REG_EAX,'ebx':UC_X86_REG_EBX,'ecx':UC_X86_REG_ECX,'edx':UC_X86_REG_EDX,
             'esi':UC_X86_REG_ESI,'edi':UC_X86_REG_EDI}[nm]
        mu.reg_write(r, v + regbaseline)
    return mu

def run(mu):
    """Run from stub; keep a code trace; on fetch-unmapped evaluate the dispatch target."""
    trace = []
    def hook(uc, address, size, user):
        trace.append(address)
        if len(trace) > 400: trace.pop(0)
    mu.hook_add(UC_HOOK_CODE, hook)
    try:
        mu.emu_start(STUB, 0x1400000, count=20000)
        return ('no-dispatch', mu.reg_read(UC_X86_REG_EIP))
    except UcError as e:
        pc = mu.reg_read(UC_X86_REG_EIP)
        esp = mu.reg_read(UC_X86_REG_ESP)
        import os
        if os.environ.get('STUBEMU_TRACE'):
            print('   [trace tail]')
            base = max(0, len(trace)-18)
            for a in trace[base:]:
                print('      %08X' % a)
        print('   exit err=%d(%s) EIP=%08X esp=%08X lastPC=%s' % (
            e.errno, e, pc, esp, hex(trace[-1]) if trace else '?'))
        if e.errno in (UC_ERR_FETCH_UNMAPPED,):
            return ('dispatch', pc)
        return ('err:%d' % e.errno, pc)

def resolve_t(tgt):
    for b,sz,nm in mods:
        if b <= tgt < b+(sz or 0): return nm
    return '?'

print('\n%-10s %-12s %-12s %-10s' % ('siteRA', 'baseline0', 'baseline1', 'mod'))
for ra in sites[:NSITES]:
    m0 = make_emu(ra, 0)
    t0 = run(m0)
    m1 = make_emu(ra, 0x1234)
    t1 = run(m1)
    det = 'SAME' if t0[1] == t1[1] else 'DIFF'
    print('%-10s %-12s %-12s %-10s  %s' % (hex(ra), '%s:%s'%(t0[0],hex(t0[1])), '%s:%s'%(t1[0],hex(t1[1])), resolve_t(t0[1]) if t0[0]=='dispatch' else '-', det))
k.CloseHandle(h)

# -*- coding: utf-8 -*-
"""engread.py -- read AGE.EXE image from process, dump section table + save .text.
Same-user read only (no admin). Usage:
  python engread.py <pid> <outdir>
Saves: <outdir>/engine_image.bin (whole image up to SizeOfImage),
       <outdir>/engine_sections.txt
"""
import sys, ctypes, struct, os
from ctypes import wintypes
sys.stdout.reconfigure(encoding='utf-8')
PID = int(sys.argv[1]) if len(sys.argv)>1 else 30624
OUTDIR = sys.argv[2] if len(sys.argv)>2 else r'.tmp'
BASE = 0x400000

k = ctypes.WinDLL('kernel32', use_last_error=True)
k.OpenProcess.restype=wintypes.HANDLE; k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
k.ReadProcessMemory.restype=wintypes.BOOL; k.ReadProcessMemory.argtypes=[wintypes.HANDLE,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_size_t)]
k.CloseHandle.restype=wintypes.BOOL; k.CloseHandle.argtypes=[wintypes.HANDLE]
h = k.OpenProcess(0x0400|0x0010, False, PID)
if not h:
    print('OpenProcess FAIL err=%d'%ctypes.get_last_error()); sys.exit(1)
def rd(a,n):
    out=bytearray(); d=0
    while d<n:
        m=min(0x10000,n-d); b=ctypes.create_string_buffer(m); r=ctypes.c_size_t(0)
        if not k.ReadProcessMemory(h, ctypes.c_void_p(a+d), b, m, ctypes.byref(r)) or r.value==0:
            return bytes(out) if d else None
        out+=b.raw[:r.value]; d+=r.value
    return bytes(out)

head = rd(BASE, 0x200) or b''
assert head[:2]==b'MZ', 'not MZ'
e = struct.unpack_from('<I', head, 0x3C)[0]
for delta in (0, 0x200):
    pass
# read the full header block at e_lfanew, need enough
nh = rd(BASE+e, 0x200) or b''
sig = nh[:4]
fic = struct.unpack_from('<H', nh, 4)[0]          # FileHeader.machine
nsec = struct.unpack_from('<H', nh, 6)[0]          # FileHeader.NumberOfSections
tsize = struct.unpack_from('<I', nh, 8)[0]         # TimeDateStamp
optsz = struct.unpack_from('<H', nh, 20)[0]        # SizeOfOptionalHeader
opt = nh[24:24+optsz]
magic = struct.unpack_from('<H', opt, 0)[0]
is_pe32 = magic == 0x10b
# PE32 optional header field offsets (IMAGE_OPTIONAL_HEADER32)
# 16: AddressOfEntryPoint, 20: BaseOfCode, 24: BaseOfData, 28: ImageBase,
# 32: SectionAlignment, 36: FileAlignment, 56: SizeOfImage, 60: SizeOfHeaders
if is_pe32:
    ImageBase = struct.unpack_from('<I', opt, 28)[0]
    AddressOfEntryPoint = struct.unpack_from('<I', opt, 16)[0]
    BaseOfCode = struct.unpack_from('<I', opt, 20)[0]
    SectionAlignment = struct.unpack_from('<I', opt, 32)[0]
    FileAlignment = struct.unpack_from('<I', opt, 36)[0]
    SizeOfImage = struct.unpack_from('<I', opt, 56)[0]
    SizeOfHeaders = struct.unpack_from('<I', opt, 60)[0]
    nRvaSizes = struct.unpack_from('<I', opt, 92)[0]
    print('  ImageBase=%X BaseOfCode=%X SectAlign=%X FileAlign=%X SizeOfImage=%X SizeOfHeaders=%X nRva=%d' % (
        ImageBase, BaseOfCode, SectionAlignment, FileAlignment, SizeOfImage, SizeOfHeaders, nRvaSizes))
else:
    ImageBase = struct.unpack_from('<Q', opt, 24)[0]
    AddressOfEntryPoint = struct.unpack_from('<I', opt, 16)[0]
    SizeOfImage = struct.unpack_from('<I', opt, 56)[0]
    print('PE32+ (64-bit) unexpected for 32-bit game')

# section headers start right after optional header (Signature4 + FileHeader20 + OptionalHeader)
secdir_base = 24 + optsz
print('machine=%04X nsec=%d optsz=%d magic=%04X ImageBase=%X SizeOfImage=%X EntryPoint=%X' % (
    fic, nsec, optsz, magic, ImageBase, SizeOfImage, AddressOfEntryPoint))

sections=[]
for i in range(nsec):
    off = secdir_base + i*40
    sh = nh[off:off+40]
    name = sh[:8].split(b'\0')[0].decode('ascii','replace')
    vsize, vaddr, rawsz, rawptr = struct.unpack_from('<IIII', sh, 8)
    sec = {'name':name,'vsize':vsize,'vaddr':vaddr,'rawsz':rawsz,'rawptr':rawptr,
           'char':struct.unpack_from('<I', sh, 36)[0]}
    sections.append(sec)
    print('  sec %-8s  VA=%08X vsize=%X size=%X ptr=%X char=%08X' % (name, BASE+vaddr, vsize, rawsz, rawptr, sec['char']))

with open(os.path.join(OUTDIR,'engine_sections.txt'),'w',encoding='utf-8') as f:
    f.write('machine=%04X nsec=%d ImageBase=%X SizeOfImage=%X EntryPoint=%X\n'%(fic,nsec,ImageBase,SizeOfImage,AddressOfEntryPoint))
    for s in sections:
        f.write('%-8s VA=%08X vsize=%X size=%X ptr=%X char=%08X\n'%(s['name'],BASE+s['vaddr'],s['vsize'],s['rawsz'],s['rawptr'],s['char']))

# save whole image
img = rd(BASE, SizeOfImage)
imgpath = os.path.join(OUTDIR,'engine_image.bin')
with open(imgpath,'wb') as f: f.write(img)
print('saved', imgpath, len(img))
k.CloseHandle(h)

# -*- coding: utf-8 -*-
"""emit_mapping.py -- from .tmp/stub_import_map_full.json, write a clean site->import
summary (CSV + JSON) to .tmp, and print cross-check diagnostics against the doc's known
missing-import set. Usage: python emit_mapping.py
"""
import json, csv, collections, os
J=r'.tmp\stub_import_map_full.json'
j=json.load(open(J,encoding='utf-8'))
res=j['results']
SITE=r'.tmp\stub_site_import_map.json'
CSVF=r'.tmp\stub_site_import_map.csv'

rows=[]
for r in res:
    imp=r['import']
    dll,fn = imp.split('!',1) if '!' in imp else ('?','?')
    rows.append({'site_va':r['site_va'],'site_rva':r['site_rva'],'thunk_va':r['thunk_va'] or 0,
                 'iat_slot':r['slot'] or 0,'dll':dll,'func':fn})
rows.sort(key=lambda x:x['site_va'])
with open(SITE,'w',encoding='utf-8') as f:
    json.dump({'stub':j['stub'],'n_rows':len(rows),'rows':rows},f,indent=2,ensure_ascii=False)
with open(CSVF,'w',encoding='utf-8',newline='') as f:
    w=csv.writer(f); w.writerow(['site_va','site_rva','thunk_va','iat_slot','dll','func'])
    for r in rows: w.writerow([hex(r['site_va']),hex(r['site_rva']),hex(r['thunk_va']),hex(r['iat_slot']),r['dll'],r['func']])
print('rows',len(rows))
print('unique funcs',len(set((r['dll'],r['func']) for r in rows)))
print('distinct slots',len(set(r['iat_slot'] for r in rows)))
print('distinct dlls',sorted(set(r['dll'] for r in rows)))
by_dll=collections.Counter(r['dll'] for r in rows)
print('by dll',dict(by_dll))
print('saved',SITE,'and',CSVF)
# cross-check against doc 13 missing imports sample
doc_missing=['WriteFile','HeapAlloc','GetProcAddress','WaitForSingleObject',
 'WaitForMultipleObjects','CreateProcessA','CreateEventA','CreateSemaphoreA','FreeLibrary',
 'TerminateProcess','GetCurrentProcessId','GetCurrentThreadId','GetModuleHandleA','GetFileSize',
 'SetFileTime','OutputDebugStringA','SetThreadPriority','CopyFileA','MoveFileA','DeleteFileA',
 'GetVolumeInformationA','GetDriveTypeA','GetLogicalDrives','GetStartupInfoA','GetACP','GetOEMCP',
 'IsDebuggerPresent','SignalObjectAndWait','SetStdHandle','GetStdHandle','GetConsoleMode',
 'FlushFileBuffers','SwitchToThread','FreeLibraryAndExitThread','IsValidCodePage','IsValidLocale',
 'EnumSystemLocalesA','MessageBoxA','SHGetSpecialFolderPathA','PathRemoveFileSpecA',
 'RegOpenKeyExA','RegQueryValueExA','RegCreateKeyExA','GetUserDefaultLCID','GetSystemDefaultLCID',
 'lstrlenA','SetCurrentDirectoryA','GetCurrentDirectoryA','GetTempPathA','GetTempFileNameA',
 'GetComputerNameA','FindClose','GetFileType','GetCPInfo','SetThreadAffinityMask',
 'GetModuleFileNameA','DuplicateHandle','GetProcessAffinityMask','ReleaseSemaphore','ExitThread',
 'GetCurrentProcess','GetCurrentThread']
found=set(r['func'] for r in rows)
missing_in_doc=[x for x in doc_missing if x not in found]
print('\nDoc-listed functions NOT in our 60:', missing_in_doc)
print('Our funcs not in doc sample:', sorted(found - set(doc_missing)))

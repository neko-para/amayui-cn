# -*- coding: utf-8 -*-
"""missing_imports.py: list the unpacked(天结_unpacked) 303 imports that the runtime
DIRECT-import scan did NOT cover -> i.e. the stub-mediated imports we can't map
independently. These are the interfaces to construct runtime scenarios for."""
import json, sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

UNP = r'scripts\re\engine_imports.json'
RT = r'.tmp\import_map.json'

unp = json.load(open(UNP, encoding='utf-8'))
unp_perdll = {}
for dll in unp['dlls']:
    unp_perdll[dll['dll'].lower()] = [f['name'] for f in dll['functions'] if 'name' in f]

rt = json.load(open(RT, encoding='utf-8'))
sm = rt['slotmap']
rt_set = defaultdict(set)
for k, v in sm.items():
    mod = (v.get('module') or '').lower()
    if v.get('func') and v['func'] != '?':
        rt_set[mod].add(v['func'])

tot_missing = 0
print('=== 无壳导入中「运行态直接调用未覆盖」= 过桩型(独立拿不到) ===')
for dll, names in unp_perdll.items():
    rtset = rt_set.get(dll, set())
    missing = [n for n in names if n not in rtset]
    tot_missing += len(missing)
    print('\n[%s]  unpacked=%d  runtime-direct=%d  MISSING=%d' % (dll, len(names), len(rtset), len(missing)))
    if missing:
        print('   ' + ', '.join(missing))
    else:
        print('   (all covered)')

# runtime extra not in unpacked
print('\n=== 运行态额外(导入目录外/动态加载,已直接映射) ===')
for mod in rt_set:
    if mod not in unp_perdll:
        print('  %s (%d): %s' % (mod, len(rt_set[mod]), ', '.join(sorted(rt_set[mod]))))

unp_total = sum(len(v) for v in unp_perdll.values())
print('\nunpacked total = %d ; MISSING(过桩型) total = %d' % (unp_total, tot_missing))

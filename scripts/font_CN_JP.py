# ------------------------------------------------------------
# 源自 https://github.com/satan53x/SExtractor/tree/main/tools/Font
# 本项目已复制到 scripts/；字典与字体资产位于 res/（详见 docs/font-build.md）
# 安装依赖: pip install fonttools
# 会尝试写入多个平台和编码，有部分编码提示不存在是正常现象
# ------------------------------------------------------------
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

# 路径基于本脚本位置解析，与执行时的工作目录无关。
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
FONT_DIR = ROOT_DIR / 'res' / 'fonts'
DICT_PATH = ROOT_DIR / 'res' / 'subs_cn_jp.json'

FontSrc = str(FONT_DIR / 'MSGothic_WenQuanYi.ttf') #替换前的字体名
Reverse = True #字典键值交换位置

def parse_args(argv):
    fnt = FontSrc
    subs = DICT_PATH
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == '--dict':
            if i + 1 >= len(argv):
                print('用法: python font_CN_JP.py [字体.ttf] [--dict 字典.json]')
                sys.exit(2)
            subs = Path(argv[i + 1])
            i += 2
        elif arg.startswith('--'):
            print('未知参数:', arg)
            print('用法: python font_CN_JP.py [字体.ttf] [--dict 字典.json]')
            sys.exit(2)
        else:
            fnt = arg
            i += 1
    return fnt, subs

def main():
    fnt, SubsJson = parse_args(sys.argv)

    obj = TTFont(fnt)

    with open(SubsJson, encoding='utf-8') as f:
        print('读入Json', SubsJson)
        data:dict = json.load(f)
        #键值互换
        if Reverse:
            newDic = {}
            for key, value in data.items():
                if value in newDic:
                    print('新Key已存在', value)
                else:
                    newDic[value] = key
            data = newDic
        #替换
        for table in obj['cmap'].tables:
            if table.platformID == 1: continue #平台过滤：mac
            for key, value in data.items():
                if key == value:
                    continue
                s = ord(key)
                j = ord(value)
                try:
                    table.cmap[s] = table.cmap[j]
                except:
                    print(f'平台{table.platformID} 编码{table.platEncID} 不存在: {key} {value}')
            #break
        #更改定义
        #changeDef(obj)

    newfile = '%s_cnjp.ttf' % fnt[0:fnt.rfind('.')]
    obj.save(newfile)
    print('会尝试写入多个平台和编码，有部分编码提示不存在是正常现象')
    print('生成font:', newfile)

if __name__ == '__main__':
    main()

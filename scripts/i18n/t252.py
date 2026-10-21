import json,glob,opencc
D='/workspace/world-tree/scripts/i18n/'; base=json.load(open(D+'t252_base.json')); K=base['keys']; T={'zh-CN':base['zh-CN'],'en':base['en']}
for f in ['t252_more.json','t252_eu.json','t252_rest.json']: T.update(json.load(open(D+f)))
cc=opencc.OpenCC('s2t'); T['zh-TW']=[cc.convert(x).replace('上鏈','上鏈') for x in base['zh-CN']]
assert len(T)==16, sorted(T)
for loc,v in T.items():
    assert len(v)==len(K),(loc,len(v))
    p=f'/workspace/world-tree/public/i18n/{loc}.json'; j=json.load(open(p,encoding='utf8')); j.update(dict(zip(K,v)))
    json.dump(j,open(p,'w',encoding='utf8'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print('ok')

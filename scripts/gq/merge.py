import json,os
T={}
for f in 'abcdef':
    g={}; exec(open(f'text_{f}.py').read(),g); T.update(g['T'])
z={}; exec(open('text_zh.py').read(),z); T['zh-CN']=dict(F=z['F'],B=z['B'],G=z['G'])
D='../../public/i18n'
assert len(T)==16, sorted(T)
for loc,d in T.items():
    p=f'{D}/{loc}.json'; j=json.load(open(p,encoding='utf8'))
    for n,(t,l1,l2,m) in enumerate(d['F'],1):
        j[f'gqf{n}.t']=t;j[f'gqf{n}.l1']=l1;j[f'gqf{n}.l2']=l2;j[f'gqf{n}.m']=m
    for n,b in enumerate(d['B'],1): j[f'gqb{n}']=b
    G=d['G']
    for k,v in zip(['t','l1','l2','m'],G['fl']): j['gc.fl.'+k]=v
    for k,v in zip(['t','p1','p2','l1'],G['gr']): j['gc.gr.'+k]=v
    for k,v in zip(['t','h','l1','l2'],G['rs']): j['gc.rs.'+k]=v
    json.dump(j,open(p,'w',encoding='utf8'),indent=2,ensure_ascii=False); open(p,'a').write('\n')
print('ok',sorted(T))

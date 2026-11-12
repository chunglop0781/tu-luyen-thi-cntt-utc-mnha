import re,sys,colorsys,os
root=sys.argv[1]  # frontend dir
def strip_comments(s): return re.sub(r'/\*.*?\*/','',s,flags=re.S)
def split_rules(css):
    out=[];i=0;n=len(css)
    while i<n:
        j=css.find('{',i)
        if j<0:break
        sel=css[i:j].strip();d=1;k=j+1
        while k<n and d:
            if css[k]=='{':d+=1
            elif css[k]=='}':d-=1
            k+=1
        out.append((sel,css[j+1:k-1]));i=k
    return out
def split_decls(body):
    res=[];cur='';d=0
    for ch in body:
        if ch=='(':d+=1
        elif ch==')':d-=1
        if ch==';' and d==0: res.append(cur);cur=''
        else: cur+=ch
    if cur.strip():res.append(cur)
    return res
NAMED={'white':(255,255,255),'black':(0,0,0)}
def conv(r,g,b,a=None):
    h,l,s=colorsys.rgb_to_hls(r/255,g/255,b/255)
    l2=0.08+(1-l)*0.84
    if l2<0.3: s=min(s,0.45)
    r2,g2,b2=colorsys.hls_to_rgb(h,l2,s)
    R,G,B=[round(x*255) for x in (r2,g2,b2)]
    if a is None: return '#%02x%02x%02x'%(R,G,B)
    return 'rgba(%d,%d,%d,%s)'%(R,G,B,a)
def conv_value(v):
    def hexrep(m):
        x=m.group(1)
        if len(x) in(3,4): x=''.join(c*2 for c in x)
        r,g,b=int(x[0:2],16),int(x[2:4],16),int(x[4:6],16)
        a=None
        if len(x)==8: a=round(int(x[6:8],16)/255,2)
        return conv(r,g,b,a)
    def rgbrep(m):
        p=[t.strip() for t in re.split(r'[,\s/]+',m.group(2).strip()) if t.strip()]
        r,g,b=[float(t) for t in p[:3]]
        a=p[3] if len(p)>3 else None
        return conv(r,g,b,a)
    v=re.sub(r'(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b',hexrep,v)
    v=re.sub(r'\b(rgba?)\(([^)]*)\)',rgbrep,v)
    v=re.sub(r'\bwhite\b',lambda m:conv(255,255,255),v)
    return v
SKIP_PROP=re.compile(r'shadow|filter|^--sh',re.I)
def process(css,out,in_media=None):
    for sel,body in split_rules(strip_comments(css)):
        if sel.startswith('@keyframes') or sel.startswith('@font-face') or sel.startswith('@-webkit-keyframes'): continue
        if sel.startswith('@media') or sel.startswith('@supports'):
            sub=[];process(body,sub)
            if sub: out.append('%s{\n%s}'%(sel,''.join(sub)))
            continue
        decls=[]
        for d in split_decls(body):
            if ':' not in d: continue
            p,v=d.split(':',1);p=p.strip();v=v.strip()
            if SKIP_PROP.search(p) or 'url(' in v and 'gradient' not in v: continue
            nv=conv_value(v)
            if nv!=v: decls.append('%s:%s'%(p,nv))
        if not decls: continue
        parts=[]
        for s in sel.split(','):
            s=s.strip()
            if s.startswith(':root'): break
            if re.match(r'^html\b',s): s=re.sub(r'^html','html[data-theme="dark"]',s,1)
            else: s='html[data-theme="dark"] '+s
            parts.append(s)
        else:
            out.append('%s{%s}\n'%(',\n'.join(parts),';'.join(decls)))
srcs=[]
for f in sys.argv[2:]:
    t=open(os.path.join(root,f),encoding='utf-8').read()
    if f.endswith('.js'):
        for m in re.finditer(r'<style>(.*?)</style>',t,re.S): srcs.append((f,m.group(1)))
    else: srcs.append((f,t))
res=['/* css/theme-dark.css — TỰ SINH bởi tools/gen_dark.py từ các file CSS (đảo độ sáng mọi màu cứng). Chỉ áp dụng khi <html data-theme="dark">.\n   Biến màu của app (--bg, --card…) khai báo tay ở css/theme.css. Sửa CSS gốc xong chạy lại: python3 tools/gen_dark.py frontend css/style.css … > frontend/css/theme-dark.css */']
for f,t in srcs:
    o=[];process(t,o);res.append('/* ── %s ── */\n%s'%(f,''.join(o)))
print('\n'.join(res))

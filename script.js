(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

/* ====== CẤU HÌNH ====== */
// Phần tử nào được coi là tiêu đề chương:
const CHAPTER_SELECTOR='h1,h2,h3,.chapter';
// Nếu nội dung không có thẻ tiêu đề, nhận diện chương theo văn bản:
const CHAPTER_RE=/^(chương|phần|quyển|hồi|chapter|part|book)\s+\S+/i;

/* ====== TRẠNG THÁI ====== */
let docKey='reader:'+document.title;
let S={fs:20,lh:1.7,font:'serif',theme:'sepia',spread:'auto'};
try{Object.assign(S,JSON.parse(localStorage.getItem('reader:settings')||'{}'))}catch(e){}
const saveS=()=>{try{localStorage.setItem('reader:settings',JSON.stringify(S))}catch(e){}};
const area=$('#area'), vp=$('#vp'), book=$('#book');
let cols=1,gap=40,colW=0,step=0,pages=1,page=0,chapters=[];

/* ====== CHUẨN HOÁ NỘI DUNG ====== */
const ALIGN={center:'al-center',right:'al-right',left:'al-left',justify:'al-justify'};
const DROP=['font-family','font-size','line-height','color','background','background-color'];
function clean(root){
  [root,...root.querySelectorAll('*')].forEach(n=>{
    const a=(n.getAttribute('align')||'').toLowerCase();
    if(ALIGN[a])n.classList.add(ALIGN[a]);
    ['align','face','size','color','bgcolor','width','height'].forEach(k=>n.removeAttribute(k));
    if(n.style){DROP.forEach(p=>n.style.removeProperty(p));if(!n.getAttribute('style'))n.removeAttribute('style')}
  });
}
// Một <p> chứa nhiều đoạn ngăn bằng <br><br> sẽ được tách thành nhiều <p>
// (giữ nguyên thẻ in nghiêng/đậm đang mở ở chỗ tách)
function splitParas(p){
  const html=p.innerHTML;
  if(!/<br\s*\/?>\s*<br/i.test(html))return [p];
  const re=/(?:<br\s*\/?>\s*){2,}|<(\/?)([a-z][a-z0-9]*)[^>]*>/gi,VOID=/^(br|img|hr|wbr)$/i;
  const stack=[],chunks=[];let cur='',last=0,m;
  while((m=re.exec(html))){
    cur+=html.slice(last,m.index);last=re.lastIndex;
    if(m[2]===undefined){
      chunks.push(cur+stack.map(s=>'</'+s.n+'>').reverse().join(''));
      cur=stack.map(s=>s.o).join('');
    }else{
      if(!VOID.test(m[2])){m[1]?stack.pop():stack.push({n:m[2],o:m[0]})}
      cur+=m[0];
    }
  }
  chunks.push(cur+html.slice(last));
  return chunks.map(h=>{const q=document.createElement('p');q.className=p.className;q.innerHTML=h;return q})
    .filter(q=>q.textContent.replace(/\u00a0/g,'').trim());
}
function normalize(html){
  const body=new DOMParser().parseFromString(html,'text/html').body, out=[];
  const WRAP=/^(DIV|SECTION|ARTICLE|CENTER|MAIN)$/;
  (function walk(node,al){
    node.childNodes.forEach(c=>{
      if(c.nodeType===3){
        if(c.textContent.trim()){const p=document.createElement('p');p.textContent=c.textContent.trim();if(al)p.className=al;out.push(p)}
      }else if(c.nodeType===1){
        if(c.tagName==='SCRIPT'||c.tagName==='STYLE'||c.tagName==='BR')return;
        if(WRAP.test(c.tagName)){
          const a=c.tagName==='CENTER'?'al-center':ALIGN[(c.getAttribute('align')||'').toLowerCase()]||al;
          walk(c,a);
        }else{
          const had=!!ALIGN[(c.getAttribute('align')||'').toLowerCase()];
          clean(c);if(al&&!had)c.classList.add(al);
          (c.tagName==='P'?splitParas(c):[c]).forEach(x=>out.push(x));
        }
      }
    });
  })(body,'');
  return out;
}
function markChapters(out){
  let ch=out.filter(e=>e.matches(CHAPTER_SELECTOR));
  if(!ch.length)ch=out.filter(e=>e.tagName==='P'&&e.textContent.trim().length<80&&CHAPTER_RE.test(e.textContent.trim()));
  ch.forEach(e=>e.classList.add('chapter'));
}

/* ====== DỰNG TRANG ====== */
const pageOf=el=>Math.floor(Math.round(el.offsetLeft/(colW+gap))/cols);
function anchor(){
  const k=book.children,lim=page*cols;
  for(let i=0;i<k.length;i++)if(Math.round(k[i].offsetLeft/(colW+gap))>=lim)return i;
  return 0;
}
function layout(startIdx){
  const a=startIdx!=null?startIdx:(colW&&book.children.length?anchor():0);
  const W=area.clientWidth,H=area.clientHeight;
  cols=S.spread==='2'||(S.spread==='auto'&&W>H&&W>=900)?2:1;
  gap=cols===2?Math.round(Math.min(72,W*.05)):40;
  const px=W>700?56:22, top=Math.max(24,Math.round(H*.03)), bot=48;
  colW=Math.floor((W-2*px-(cols-1)*gap)/cols);
  const PW=cols*colW+(cols-1)*gap, PH=H-top-bot;
  Object.assign(vp.style,{left:Math.round((W-PW)/2)+'px',top:top+'px',width:PW+'px',height:PH+'px'});
  $('#foot').style.padding='0 '+Math.round((W-PW)/2)+'px';
  Object.assign(book.style,{width:PW+'px',columnCount:cols,columnGap:gap+'px'});
  document.documentElement.style.setProperty('--fs',S.fs+'px');
  document.documentElement.style.setProperty('--lh',S.lh);
  book.classList.toggle('sans',S.font==='sans');
  document.documentElement.dataset.theme=S.theme;
  step=cols*(colW+gap);
  const total=Math.max(1,Math.round((book.scrollWidth+gap)/(colW+gap)));
  pages=Math.ceil(total/cols);
  chapters.forEach(c=>c.page=pageOf(c.el));
  const el=book.children[a];
  go(el?pageOf(el):0,false);
  renderToc();
}
function go(p,anim=true){
  page=Math.max(0,Math.min(pages-1,p));
  book.style.transition=anim?'':'none';
  book.style.transform='translateX('+(-page*step)+'px)';
  const c=[...chapters].reverse().find(c=>c.page<=page);
  $('#fchap').textContent=c?c.title:'';
  $('#fpage').textContent=(page+1)+' / '+pages;
  $('#bar').style.width=(pages>1?(page+1)/pages*100:100)+'%';
  $$('#toc button').forEach(b=>b.classList.toggle('cur',c&&b.dataset.i==chapters.indexOf(c)));
  try{localStorage.setItem(docKey+':pos',anchor())}catch(e){}
}
const next=()=>go(page+1), prev=()=>go(page-1);

/* ====== NẠP NỘI DUNG ====== */
function load(html,key){loadNodes(normalize(html),key)}
function loadNodes(nodes,key){
  if(key)docKey=key;
  markChapters(nodes);
  book.replaceChildren(...nodes);
  if(!nodes.length)book.innerHTML='<p class="empty">Chưa có nội dung. Khai báo CHAPTER_FILES trong index.html hoặc bấm “Mở file”.</p>';
  chapters=[...book.querySelectorAll('.chapter')].map(el=>({el,title:(()=>{const t=el.cloneNode(true);t.querySelectorAll('br').forEach(b=>b.replaceWith(' | '));
    return t.textContent.replace(/(\s*\|\s*)+/g,' – ').replace(/\s+/g,' ').replace(/^ – | – $/g,'').trim()})(),page:0}));
  let pos=0;try{pos=+localStorage.getItem(docKey+':pos')||0}catch(e){}
  layout(Math.min(pos,Math.max(0,book.children.length-1)));
}
function renderToc(){
  const t=$('#toc');
  t.innerHTML=chapters.length?'':'<p style="margin:4px">Không tìm thấy chương nào.</p>';
  chapters.forEach((c,i)=>{
    const b=document.createElement('button');b.dataset.i=i;
    b.innerHTML='<small>'+(c.page+1)+'</small>';
    b.prepend(document.createTextNode(c.title));
    b.onclick=()=>{go(c.page);hideUI()};
    t.append(b);
  });
}

/* ====== ĐIỀU KHIỂN ====== */
let sx=0,sy=0;
area.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY});
area.addEventListener('pointerup',e=>{
  const dx=e.clientX-sx,dy=e.clientY-sy;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3){dx<0?next():prev();hideUI();return}
  if(Math.abs(dx)>10||Math.abs(dy)>10)return;
  if(uiOpen()){hideUI();return}
  const w=area.clientWidth;
  e.clientX<w*.3?prev():e.clientX>w*.7?next():$('#top').classList.add('show');
});
addEventListener('keydown',e=>{
  if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();next()}
  else if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();prev()}
  else if(e.key==='Home')go(0);else if(e.key==='End')go(pages-1);
  else if(e.key==='Escape')hideUI();
});
const uiOpen=()=>$('#top').classList.contains('show')||$('.panel.open');
function hideUI(){$('#top').classList.remove('show');$$('.panel').forEach(p=>p.classList.remove('open'))}
function toggle(id){const p=$(id),was=p.classList.contains('open');$$('.panel').forEach(x=>x.classList.remove('open'));if(!was)p.classList.add('open')}
$('#bToc').onclick=()=>{toggle('#pToc');const c=$('#toc .cur');c&&c.scrollIntoView({block:'center'})};
$('#bSet').onclick=()=>toggle('#pSet');
$('#file').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();r.onload=()=>{load(r.result,'reader:file:'+f.name);hideUI()};r.readAsText(f,'utf-8');
};
const de=document.documentElement,fsOn=()=>document.fullscreenElement||document.webkitFullscreenElement;
if(!(de.requestFullscreen||de.webkitRequestFullscreen))$('#bFs').hidden=true;
$('#bFs').onclick=()=>{
  if(fsOn())(document.exitFullscreen||document.webkitExitFullscreen).call(document);
  else(de.requestFullscreen||de.webkitRequestFullscreen).call(de);
};
$('#pSet').addEventListener('click',e=>{
  const b=e.target.closest('[data-k]');if(!b)return;
  const k=b.dataset.k;
  if(b.dataset.d){
    const d=+b.dataset.d;
    S[k]=k==='fs'?Math.max(12,Math.min(40,S.fs+d)):Math.max(1.2,Math.min(2.4,Math.round((S.lh+d)*10)/10));
  }else S[k]=b.dataset.v;
  saveS();syncUI();layout();
});
function syncUI(){
  $('#vFs').textContent=S.fs;$('#vLh').textContent=S.lh.toFixed(1);
  $$('#pSet [data-v]').forEach(b=>b.classList.toggle('on',S[b.dataset.k]===b.dataset.v));
}
let rt;
['resize','orientationchange','fullscreenchange','webkitfullscreenchange'].forEach(ev=>addEventListener(ev,()=>{clearTimeout(rt);rt=setTimeout(()=>layout(),150)}));

syncUI();
document.documentElement.dataset.theme=S.theme;
const FILES=window.CHAPTER_FILES||[];
async function init(){
  if(!FILES.length){loadNodes([]);return}
  book.innerHTML='<p class="empty">Đang tải…</p>';
  try{
    const texts=await Promise.all(FILES.map(f=>fetch(f).then(r=>{
      if(!r.ok)throw new Error(f+' ('+r.status+')');return r.text()})));
    loadNodes(texts.flatMap(t=>normalize(t)));
  }catch(err){
    book.innerHTML='<p class="empty">Không tải được nội dung: '+err.message+
      '<br>Hãy mở trang qua máy chủ web (ví dụ Live Server), không mở trực tiếp file://</p>';
  }
}
init();
})();
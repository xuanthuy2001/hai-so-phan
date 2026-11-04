(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  /* ====== CẤU HÌNH ====== */
  const CHAPTER_SELECTOR = 'h1,h2,h3,.chapter';
  const CHAPTER_RE = /^(chương|phần|quyển|hồi|chapter|part|book)\s+\S+/i;
  const PALETTE = ['#ffe08a', '#a8e6a1', '#9fd3ff', '#ffb3c1', '#d9b8ff'];

  /* ====== TRẠNG THÁI ====== */
  let docKey = 'reader:' + document.title;
  // Đã bỏ 'mode' và 'spread': luôn ở chế độ cuộn
  let S = { fs: 20, lh: 1.7, font: 'serif', theme: 'sepia', nodia: true, hlc: PALETTE[0], hlCustom: '' };
  try { Object.assign(S, JSON.parse(localStorage.getItem('reader:settings') || '{}')) } catch (e) { }
  const saveS = () => { try { localStorage.setItem('reader:settings', JSON.stringify(S)) } catch (e) { } };
  const area = $('#area'), vp = $('#vp'), book = $('#book');
  let chapters = [], scrollMax = 1, ready = false, st, hits = [];

  /* ====== CHUẨN HOÁ NỘI DUNG ====== */
  const ALIGN = { center: 'al-center', right: 'al-right', left: 'al-left', justify: 'al-justify' };
  const DROP = ['font-family', 'font-size', 'line-height', 'color', 'background', 'background-color'];
  function clean(root) {
    [root, ...root.querySelectorAll('*')].forEach(n => {
      const a = (n.getAttribute('align') || '').toLowerCase();
      if (ALIGN[a]) n.classList.add(ALIGN[a]);
      ['align', 'face', 'size', 'color', 'bgcolor', 'width', 'height'].forEach(k => n.removeAttribute(k));
      if (n.style) { DROP.forEach(p => n.style.removeProperty(p)); if (!n.getAttribute('style')) n.removeAttribute('style') }
    });
  }
  function splitParas(p) {
    const html = p.innerHTML;
    if (!/<br\s*\/?>\s*<br/i.test(html)) return [p];
    const re = /(?:<br\s*\/?>\s*){2,}|<(\/?)([a-z][a-z0-9]*)[^>]*>/gi, VOID = /^(br|img|hr|wbr)$/i;
    const stack = [], chunks = []; let cur = '', last = 0, m;
    while ((m = re.exec(html))) {
      cur += html.slice(last, m.index); last = re.lastIndex;
      if (m[2] === undefined) {
        chunks.push(cur + stack.map(s => '</' + s.n + '>').reverse().join(''));
        cur = stack.map(s => s.o).join('');
      } else {
        if (!VOID.test(m[2])) { m[1] ? stack.pop() : stack.push({ n: m[2], o: m[0] }) }
        cur += m[0];
      }
    }
    chunks.push(cur + html.slice(last));
    return chunks.map(h => { const q = document.createElement('p'); q.className = p.className; q.innerHTML = h; return q })
      .filter(q => q.textContent.replace(/\u00a0/g, '').trim());
  }
  function normalize(html) {
    const body = new DOMParser().parseFromString(html.normalize('NFC'), 'text/html').body, out = [];
    const WRAP = /^(DIV|SECTION|ARTICLE|CENTER|MAIN)$/;
    (function walk(node, al) {
      node.childNodes.forEach(c => {
        if (c.nodeType === 3) {
          if (c.textContent.trim()) { const p = document.createElement('p'); p.textContent = c.textContent.trim(); if (al) p.className = al; out.push(p) }
        } else if (c.nodeType === 1) {
          if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.tagName === 'BR') return;
          if (WRAP.test(c.tagName)) {
            const a = c.tagName === 'CENTER' ? 'al-center' : ALIGN[(c.getAttribute('align') || '').toLowerCase()] || al;
            walk(c, a);
          } else {
            const had = !!ALIGN[(c.getAttribute('align') || '').toLowerCase()];
            clean(c); if (al && !had) c.classList.add(al);
            (c.tagName === 'P' ? splitParas(c) : [c]).forEach(x => out.push(x));
          }
        }
      });
    })(body, '');
    return out;
  }
  function markChapters(out) {
    let ch = out.filter(e => e.matches(CHAPTER_SELECTOR));
    if (!ch.length) ch = out.filter(e => e.tagName === 'P' && e.textContent.trim().length < 80 && CHAPTER_RE.test(e.textContent.trim()));
    ch.forEach(e => e.classList.add('chapter'));
  }

  /* ====== VỊ TRÍ ĐỌC ====== */
  // Dùng scrollTop (pixel) — key mới để không đụng dữ liệu "index chương" của bản cũ
  const savePos = () => { try { localStorage.setItem(docKey + ':scroll', vp.scrollTop) } catch (e) { } };
  const loadPos = () => { try { return +localStorage.getItem(docKey + ':scroll') || 0 } catch (e) { return 0 } };
  function markCur(c) { $$('#toc button').forEach(b => b.classList.toggle('cur', !!c && +b.dataset.i === chapters.indexOf(c))) }

  /* ====== DỰNG TRANG (chỉ cuộn) ====== */
  function layout(startTop) {
    if (startTop == null) startTop = vp.scrollTop || 0;
    const W = area.clientWidth, H = area.clientHeight, root = document.documentElement;
    const px = W > 700 ? 56 : 22;
    const PW = Math.min(W - 2 * px, 760);

    // #vp luôn cuộn dọc, full chiều ngang để scrollbar sát mép
    Object.assign(vp.style, {
      top: '0',
      left: '0',
      width: W + 'px',
      height: (H - 34) + 'px',
      overflowY: 'auto',
      overflowX: 'hidden',
      touchAction: 'pan-y'
    });
    // #book chỉ còn là khối nội dung, KHÔNG transform/transition/will-change
    Object.assign(book.style, {
      width: PW + 'px',
      marginLeft: Math.round((W - PW) / 2) + 'px',
      height: 'auto',
      padding: '28px 0 48px',
      transform: 'none',
      transition: 'none',
      willChange: 'auto'
    });
    $('#foot').style.padding = '0 ' + Math.round((W - PW) / 2) + 'px';
    root.style.setProperty('--fs', S.fs + 'px');
    root.style.setProperty('--lh', S.lh);
    book.classList.toggle('sans', S.font === 'sans');
    root.dataset.theme = S.theme;
    ready = true;

    // Cache các phép đo — chỉ đọc DOM 1 lần
    scrollMax = Math.max(1, vp.scrollHeight - vp.clientHeight);
    chapters.forEach(c => c.top = c.el.offsetTop);

    // Khôi phục vị trí (browser tự clamp nếu vượt max)
    if (startTop) vp.scrollTop = startTop;
    updateScroll();
    renderToc();
  }

  function updateScroll() {
    const t = vp.scrollTop;
    const pct = scrollMax > 1 ? Math.min(100, Math.round(t / scrollMax * 100)) : 0;
    const c = [...chapters].reverse().find(c => c.top <= t + 40);
    $('#fchap').textContent = c ? c.title : '';
    $('#fpage').textContent = pct + '%';
    $('#bar').style.width = pct + '%';
    markCur(c);
    clearTimeout(st); st = setTimeout(savePos, 300);
  }

  vp.addEventListener('scroll', () => {
    updateScroll();
    // Popup mới (đang bôi) đóng khi cuộn; popup đang sửa ghi chú thì đi theo đoạn
    if (pend) closePop();
    else if (!pop.hidden && editId) repop();
  }, { passive: true });

  const next = () => { closePop(); vp.scrollBy({ top: vp.clientHeight * .9, behavior: 'smooth' }) };
  const prev = () => { closePop(); vp.scrollBy({ top: -vp.clientHeight * .9, behavior: 'smooth' }) };
  function jumpEl(el) {
    vp.scrollTo({ top: Math.max(0, el.offsetTop - 16), behavior: 'smooth' });
  }

  /* ====== NẠP NỘI DUNG ====== */
  function loadNodes(nodes, key) {
    if (key) docKey = key;
    markChapters(nodes);
    book.replaceChildren(...nodes);
    $('#qRes').textContent = ''; $('#qInfo').textContent = '';
    if (!nodes.length) book.innerHTML = '<p class="empty">Chưa có nội dung. Khai báo CHAPTER_FILES trong index.html.</p>';
    chapters = [...book.querySelectorAll('.chapter')].map(el => ({
      el, idx: [...book.children].indexOf(el), title: (() => {
        const t = el.cloneNode(true); t.querySelectorAll('br').forEach(b => b.replaceWith(' | '));
        return t.textContent.replace(/(\s*\|\s*)+/g, ' – ').replace(/\s+/g, ' ').replace(/^ – | – $/g, '').trim()
      })(), top: 0
    }));
    loadHL();
    layout(loadPos());
  }
  function renderToc() {
    const t = $('#toc');
    t.innerHTML = chapters.length ? '' : '<p style="margin:4px">Không tìm thấy chương nào.</p>';
    chapters.forEach((c, i) => {
      const b = document.createElement('button');
      b.dataset.i = i;
      b.textContent = c.title;
      b.onclick = () => { jumpEl(c.el); hideUI() };
      t.append(b);
    });
  }

  /* ====== ĐIỀU KHIỂN ====== */
  let sx = 0, sy = 0, popDown = false;
  area.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; popDown = !$('#hlPop').hidden });
  area.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (curSel()) return;                        // đang bôi chọn chữ
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return; // là thao tác kéo/cuộn
    if (popDown) { closePop(); return }
    if (uiOpen()) { hideUI(); return }
    const hl = e.target.closest && e.target.closest('.hl');
    if (hl) { openEdit(hl.dataset.id, hl.getBoundingClientRect()); return }
    bars(true);
  });
  addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input,textarea')) { if (e.key === 'Escape') hideUI(); return }
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next() }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev() }
    else if (e.key === 'Home') vp.scrollTo({ top: 0 });
    else if (e.key === 'End') vp.scrollTo({ top: 1e9 });
    else if (e.key === 'Escape') hideUI();
  });
  const bars = on => $$('#top,#side').forEach(b => b.classList.toggle('show', on));
  const uiOpen = () => $('#top').classList.contains('show') || $('.panel.open');
  function hideUI() { closePop(); bars(false); $$('.panel').forEach(p => p.classList.remove('open')) }
  function toggle(id) { const p = $(id), was = p.classList.contains('open'); $$('.panel').forEach(x => x.classList.remove('open')); if (!was) p.classList.add('open') }
  $('#bToc').onclick = () => { toggle('#pToc'); const c = $('#toc .cur'); c && c.scrollIntoView({ block: 'center' }) };
  $('#bSet').onclick = () => toggle('#pSet');
  $('#bNotes').onclick = () => { renderNotes(); toggle('#pNotes') };
  const de = document.documentElement, fsOn = () => document.fullscreenElement || document.webkitFullscreenElement;
  if (!(de.requestFullscreen || de.webkitRequestFullscreen)) $('#bFs').hidden = true;
  $('#bFs').onclick = () => {
    if (fsOn()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (de.requestFullscreen || de.webkitRequestFullscreen).call(de);
  };
  $('#pSet').addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (b.dataset.d) {
      const d = +b.dataset.d;
      S[k] = k === 'fs' ? Math.max(12, Math.min(40, S.fs + d)) : Math.max(1.2, Math.min(2.4, Math.round((S.lh + d) * 10) / 10));
    } else S[k] = b.dataset.v;
    saveS(); syncUI();
    layout(); // giữ nguyên vị trí đang đọc
  });
  function syncUI() {
    $('#qDia').classList.toggle('on', !!S.nodia);
    $('#vFs').textContent = S.fs;
    $('#vLh').textContent = S.lh.toFixed(1);
    $$('#pSet [data-v]').forEach(b => b.classList.toggle('on', S[b.dataset.k] === b.dataset.v));
  }
  let rt;
  ['resize', 'orientationchange', 'fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
    addEventListener(ev, () => {
      clearTimeout(rt);
      rt = setTimeout(() => { layout(); repop(); }, 150);
    })
  );

  /* ====== TÌM KIẾM ====== */
  const fold = s => { s = s.toLowerCase(); return S.nodia ? s.replace(/[^\u0000-\u007f]/g, c => c === 'đ' ? 'd' : c.normalize('NFD')[0]) : s };
  function clearMarks() {
    const ms = [...book.querySelectorAll('mark')]; if (!ms.length) return;
    const ps = new Set(ms.map(m => m.parentNode)); ms.forEach(m => m.replaceWith(m.textContent)); ps.forEach(p => p.normalize());
  }
  function markEl(el, f) {
    clearMarks();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), ns = []; while (w.nextNode()) ns.push(w.currentNode);
    ns.forEach(n => {
      const t = n.nodeValue, ft = fold(t); let i = ft.indexOf(f); if (i < 0) return;
      const fr = document.createDocumentFragment(); let last = 0;
      while (i >= 0) { fr.append(t.slice(last, i)); const m = document.createElement('mark'); m.textContent = t.slice(i, i + f.length); fr.append(m); last = i + f.length; i = ft.indexOf(f, last) }
      fr.append(t.slice(last)); n.replaceWith(fr);
    });
  }
  function doSearch() {
    const q = $('#q').value.normalize('NFC').trim(), res = $('#qRes'), info = $('#qInfo');
    res.textContent = ''; clearMarks(); hits = [];
    if (q) showFind(); else $('#pFind').classList.remove('open');
    if (q.length < 2) { info.textContent = q ? 'Nhập ít nhất 2 ký tự' : ''; return }
    const f = fold(q); let ci = 0;
    [...book.children].forEach((el, k) => {
      const t = el.textContent.normalize('NFC'), i = fold(t).indexOf(f); if (i < 0) return;
      while (ci + 1 < chapters.length && chapters[ci + 1].idx <= k) ci++;
      hits.push({ el, i, t, ch: chapters.length && chapters[0].idx <= k ? chapters[ci].title : '' });
    });
    info.textContent = hits.length ? hits.length + ' đoạn có kết quả' + (hits.length > 200 ? ' (hiện 200 đầu)' : '') : 'Không tìm thấy';
    hits.slice(0, 200).forEach(h => {
      const b = document.createElement('button'), a = Math.max(0, h.i - 30), s = document.createElement('b');
      s.textContent = h.t.slice(h.i, h.i + f.length);
      b.append((a ? '…' : '') + h.t.slice(a, h.i), s, h.t.slice(h.i + f.length, h.i + f.length + 60) + '…');
      if (h.ch) { const sm = document.createElement('small'); sm.textContent = h.ch; b.prepend(sm) }
      b.onclick = () => { markEl(h.el, f); jumpEl(h.el); hideUI() };
      res.append(b);
    });
  }
  let qt;
  $('#q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(doSearch, 250) });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(qt); doSearch(); e.target.blur() } });
  $('#qDia').onclick = () => { S.nodia = !S.nodia; saveS(); syncUI(); doSearch() };
  function showFind() { $$('.panel').forEach(x => x.classList.remove('open')); $('#pFind').classList.add('open') }
  $('#q').addEventListener('focus', () => { if (hits.length) showFind() });

  /* ====== BÚT GHI NHỚ ====== */
  let HL = [], pend = null, editId = null, nf = '', selT = 0, nt = 0;
  const pop = $('#hlPop'), hlNote = $('#hlNote');
  const hlKey = () => docKey + ':hl';
  const uid = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hlEls = id => book.querySelectorAll('.hl[data-id="' + id + '"]');
  const strip = h => { const { lost, ...r } = h; return r };
  const saveHL = () => { try { localStorage.setItem(hlKey(), JSON.stringify(HL.map(strip))) } catch (e) { } renderNotes() };
  const chOf = b => { let r = ''; for (const c of chapters) { if (c.idx <= b) r = c.title; else break } return r };
  const posKey = h => h.segs.length ? h.segs[0].b * 1e6 + h.segs[0].s : 0;

  function wrapSeg(el, s, e, h) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), list = []; let pos = 0, n;
    while ((n = w.nextNode())) {
      const len = n.nodeValue.length, a = Math.max(s, pos), b = Math.min(e, pos + len);
      if (a < b) list.push([n, a - pos, b - pos]);
      pos += len; if (pos >= e) break;
    }
    list.forEach(([n, a, b]) => {
      let t = n; if (a > 0) t = n.splitText(a);
      if (b - a < t.nodeValue.length) t.splitText(b - a);
      const sp = document.createElement('span'); sp.className = 'hl'; sp.dataset.id = h.id;
      t.replaceWith(sp); sp.append(t);
    });
  }
  function paint(h) { hlEls(h.id).forEach(sp => { sp.style.setProperty('--c', h.c); sp.classList.toggle('has-note', !!h.note) }) }
  function drawHL(h) {
    h.lost = false;
    h.segs.forEach(g => {
      const el = book.children[g.b]; if (!el) { h.lost = true; return }
      const t = el.textContent;
      if (t.slice(g.s, g.e) !== g.x) {
        const i = t.indexOf(g.x); if (i < 0) { h.lost = true; return }
        g.s = i; g.e = i + g.x.length;
      }
      wrapSeg(el, g.s, g.e, h);
    });
    paint(h);
  }
  function loadHL() {
    try { HL = JSON.parse(localStorage.getItem(hlKey()) || '[]') } catch (e) { HL = [] }
    if (!Array.isArray(HL)) HL = [];
    HL.forEach(h => drawHL(h)); closePop(); renderNotes();
  }
  function removeHL(id) {
    const els = [...hlEls(id)], ps = new Set(els.map(sp => sp.parentNode));
    els.forEach(sp => sp.replaceWith(...sp.childNodes)); ps.forEach(p => p.normalize());
    HL = HL.filter(h => h.id !== id);
  }
  function curSel() {
    const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0); return book.contains(r.commonAncestorContainer) ? r : null;
  }
  const blockOf = (n, o, end) => {
    if (n === book) return book.children[Math.max(0, Math.min(book.children.length - 1, end ? o - 1 : o))];
    while (n && n.parentNode !== book) n = n.parentNode; return n;
  };
  const offIn = (el, n, o) => { const q = document.createRange(); q.selectNodeContents(el); q.setEnd(n, o); return q.toString().length };
  function segsOf(r) {
    const a = blockOf(r.startContainer, r.startOffset), z = blockOf(r.endContainer, r.endOffset, true), segs = [];
    if (!a || !z) return segs;
    let i = [...book.children].indexOf(a);
    for (let el = a; el; el = el.nextElementSibling, i++) {
      const t = el.textContent; let s = 0, e = t.length;
      if (el === a) s = offIn(el, r.startContainer, r.startOffset);
      if (el === z) e = offIn(el, r.endContainer, r.endOffset);
      while (s < e && /\s/.test(t[s])) s++;
      while (e > s && /\s/.test(t[e - 1])) e--;
      if (e > s) segs.push({ b: i, s, e, x: t.slice(s, e) });
      if (el === z) break;
    }
    return segs;
  }
  function placePop(rect) {
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight, coarse = matchMedia('(pointer:coarse)').matches;
    const x = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8);
    let y = coarse ? rect.bottom + 14 : rect.top - h - 10;
    if (y < 8) y = rect.bottom + 10;
    pop.style.left = x + 'px'; pop.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  }
  function repop() { if (!pop.hidden && editId) { const s = hlEls(editId)[0]; if (s) placePop(s.getBoundingClientRect()) } }
  function drawSw(cur) {
    const box = $('#hlSw'); box.textContent = '';
    const cs = [...PALETTE]; if (S.hlCustom && !cs.includes(S.hlCustom)) cs.push(S.hlCustom);
    cs.forEach(c => {
      const b = document.createElement('button'); b.className = 'sw' + (c === cur ? ' on' : '');
      b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', 'Màu ' + c); box.append(b);
    });
    const l = document.createElement('label'); l.className = 'sw custom'; l.title = 'Chọn màu khác';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = S.hlCustom || cur || S.hlc;
    l.append(inp); box.append(l);
  }
  function closePop() {
    if (nt) { clearTimeout(nt); nt = 0; saveHL() }
    pop.hidden = true; pend = null; editId = null; hlNote.blur();
  }
  function openEdit(id, rect) {
    const h = HL.find(x => x.id === id); if (!h) return;
    pend = null; editId = id;
    $('#hlQ').textContent = h.text.length > 120 ? h.text.slice(0, 120) + '…' : h.text;
    hlNote.value = h.note || ''; drawSw(h.c);
    pop.dataset.mode = 'edit'; placePop(rect);
  }
  function addHL(c) {
    clearMarks();
    const h = { id: uid(), segs: pend.segs, text: pend.segs.map(g => g.x).join(' '), c, note: '', t: Date.now() };
    HL.push(h); drawHL(h); saveHL();
    const sel = getSelection(); sel && sel.removeAllRanges(); pend = null; return h;
  }
  function pickColor(c) {
    S.hlc = c; saveS();
    if (editId) { const h = HL.find(x => x.id === editId); if (h) { h.c = c; paint(h); saveHL(); drawSw(c) } }
    else if (pend) { addHL(c); closePop() }
  }
  function onSel() {
    if (editId && !pop.hidden) return;
    const r = curSel(); if (!r) { closePop(); return }
    const segs = segsOf(r); if (!segs.length) { closePop(); return }
    pend = { segs }; editId = null; pop.dataset.mode = 'new'; drawSw(S.hlc); placePop(r.getBoundingClientRect());
  }
  document.addEventListener('selectionchange', () => { clearTimeout(selT); selT = setTimeout(onSel, 250) });
  pop.addEventListener('mousedown', e => { if (!e.target.closest('textarea,input')) e.preventDefault() });
  $('#hlSw').addEventListener('click', e => { const b = e.target.closest('.sw[data-c]'); if (b) pickColor(b.dataset.c) });
  $('#hlSw').addEventListener('change', e => {
    if (e.target.type !== 'color') return;
    S.hlCustom = e.target.value; saveS(); pickColor(e.target.value);
  });
  $('#hlNoteBtn').onclick = () => {
    if (!pend) return;
    const h = addHL(S.hlc), s = hlEls(h.id)[0];
    openEdit(h.id, s ? s.getBoundingClientRect() : pop.getBoundingClientRect()); hlNote.focus();
  };
  hlNote.addEventListener('input', () => {
    const h = HL.find(x => x.id === editId); if (!h) return;
    h.note = hlNote.value; paint(h); clearTimeout(nt); nt = setTimeout(() => { nt = 0; saveHL() }, 400);
  });
  $('#hlDel').onclick = () => {
    const h = HL.find(x => x.id === editId); if (!h) return;
    if (h.note && !confirm('Xoá đoạn bôi và ghi chú này?')) return;
    clearTimeout(nt); nt = 0; removeHL(h.id); saveHL(); closePop();
  };
  $('#hlOk').onclick = closePop;

  function renderNotes() {
    const L = $('#nList'), F = $('#nFilter'); L.textContent = ''; F.textContent = '';
    const all = [...HL].sort((a, b) => posKey(a) - posKey(b)), cs = [...new Set(all.map(h => h.c))];
    $('#nCnt').textContent = HL.length ? '(' + HL.length + ')' : '';
    if (nf && !cs.includes(nf)) nf = '';
    if (cs.length > 1) cs.forEach(c => {
      const b = document.createElement('button'); b.className = 'sw sm' + (c === nf ? ' on' : ''); b.style.background = c;
      b.setAttribute('aria-label', 'Lọc theo màu'); b.onclick = () => { nf = nf === c ? '' : c; renderNotes() }; F.append(b);
    });
    const list = nf ? all.filter(h => h.c === nf) : all;
    $('#nInfo').textContent = list.length ? list.length + ' đoạn đã bôi' : 'Chưa có đoạn nào. Bôi chữ trong sách để bắt đầu.';
    list.forEach(h => {
      const d = document.createElement('button'); d.className = 'note' + (h.lost ? ' lost' : ''); d.style.setProperty('--c', h.c);
      const ch = chOf(h.segs.length ? h.segs[0].b : 0);
      if (ch) { const sm = document.createElement('small'); sm.textContent = ch; d.append(sm) }
      const q = document.createElement('span'); q.className = 'q'; q.textContent = h.text; d.append(q);
      if (h.note) { const n = document.createElement('span'); n.className = 'n'; n.textContent = h.note; d.append(n) }
      d.onclick = () => jumpHL(h); L.append(d);
    });
  }
  function jumpHL(h) {
    const sp = hlEls(h.id)[0];
    if (!sp) {
      if (confirm('Không tìm thấy đoạn này trong sách (nội dung có thể đã thay đổi). Xoá khỏi danh sách?')) { removeHL(h.id); saveHL() }
      return;
    }
    hideUI(); jumpEl(sp);
    requestAnimationFrame(() => {
      hlEls(h.id).forEach(s => s.classList.add('flash'));
      setTimeout(() => hlEls(h.id).forEach(s => s.classList.remove('flash')), 1600);
    });
  }

  function dl(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#nTxt').onclick = () => {
    const out = [document.title, ''], last = { c: null };
    [...HL].sort((a, b) => posKey(a) - posKey(b)).forEach(h => {
      const ch = chOf(h.segs.length ? h.segs[0].b : 0);
      if (ch !== last.c) { out.push('', '## ' + ch); last.c = ch }
      out.push('- ' + h.text + (h.note ? '\n    → ' + h.note.replace(/\n/g, '\n      ') : ''));
    });
    dl(document.title + ' - ghi chú.txt', '\ufeff' + out.join('\n') + '\n', 'text/plain;charset=utf-8');
  };
  $('#nJson').onclick = () => dl(document.title + ' - sao lưu ghi chú.json', JSON.stringify({ v: 1, title: document.title, hl: HL.map(strip) }, null, 1), 'application/json');
  $('#nImp').onclick = () => $('#nFile').click();
  $('#nFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text()), arr = Array.isArray(data) ? data : data.hl, have = new Set(HL.map(h => h.id)); let n = 0;
      if (!Array.isArray(arr)) throw 0;
      clearMarks();
      arr.forEach(h => {
        if (!h || have.has(h.id) || !Array.isArray(h.segs) || !h.segs.length || !/^#[0-9a-f]{6}$/i.test(h.c)) return;
        if (!h.segs.every(g => Number.isInteger(g.b) && Number.isInteger(g.s) && Number.isInteger(g.e) && typeof g.x === 'string' && g.x)) return;
        const x = { id: String(h.id || uid()), segs: h.segs.map(g => ({ b: g.b, s: g.s, e: g.e, x: g.x })), text: String(h.text || ''), c: h.c, note: String(h.note || ''), t: +h.t || Date.now() };
        HL.push(x); drawHL(x); n++;
      });
      saveHL(); $('#nInfo').textContent = 'Đã khôi phục ' + n + ' đoạn';
    } catch (err) { $('#nInfo').textContent = 'File sao lưu không hợp lệ' }
  };

  /* ====== KHỞI ĐỘNG ====== */
  syncUI();
  document.documentElement.dataset.theme = S.theme;
  const FILES = window.CHAPTER_FILES || [];
  async function init() {
    if (!FILES.length) { loadNodes([]); return }
    book.innerHTML = '<p class="empty">Đang tải…</p>';
    try {
      const texts = await Promise.all(FILES.map(f => fetch(f).then(r => {
        if (!r.ok) throw new Error(f + ' (' + r.status + ')'); return r.text()
      })));
      loadNodes(texts.flatMap(t => normalize(t)));

      // Khi font tải xong → chiều cao thay đổi → phải tính lại top chương & vị trí cuộn
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          const top = vp.scrollTop;
          scrollMax = Math.max(1, vp.scrollHeight - vp.clientHeight);
          chapters.forEach(c => c.top = c.el.offsetTop);
          vp.scrollTop = top;
          updateScroll();
        });
      }
    } catch (err) {
      book.innerHTML = '<p class="empty">Không tải được nội dung: ' + err.message +
        '<br>Hãy mở trang qua máy chủ web (ví dụ Live Server), không mở trực tiếp file://</p>';
    }
  }
  init();
})();
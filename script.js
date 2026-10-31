(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  /* ====== CẤU HÌNH ====== */
  // Phần tử nào được coi là tiêu đề chương:
  const CHAPTER_SELECTOR = 'h1,h2,h3,.chapter';
  // Nếu nội dung không có thẻ tiêu đề, nhận diện chương theo văn bản:
  const CHAPTER_RE = /^(chương|phần|quyển|hồi|chapter|part|book)\s+\S+/i;

  /* ====== TRẠNG THÁI ====== */
  let docKey = 'reader:' + document.title;
  let S = { fs: 20, lh: 1.7, font: 'serif', theme: 'sepia', spread: 'auto', mode: 'page', nodia: true };
  try { Object.assign(S, JSON.parse(localStorage.getItem('reader:settings') || '{}')) } catch (e) { }
  const saveS = () => { try { localStorage.setItem('reader:settings', JSON.stringify(S)) } catch (e) { } };
  const area = $('#area'), vp = $('#vp'), book = $('#book');
  let cols = 1, gap = 40, colW = 0, step = 0, pages = 1, page = 0, chapters = [], ready = false, lastMode = 'page', st, hits = [];

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
  // Một <p> chứa nhiều đoạn ngăn bằng <br><br> sẽ được tách thành nhiều <p>
  // (giữ nguyên thẻ in nghiêng/đậm đang mở ở chỗ tách)
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

  /* ====== DỰNG TRANG ====== */
  const scrollMode = () => lastMode === 'scroll';
  const pageOf = el => Math.floor(Math.round(el.offsetLeft / (colW + gap)) / cols);
  function anchor() {
    const k = book.children;
    if (scrollMode()) { const t = vp.scrollTop; for (let i = 0; i < k.length; i++)if (k[i].offsetTop + k[i].offsetHeight > t + 2) return i; return 0 }
    const lim = page * cols;
    for (let i = 0; i < k.length; i++)if (Math.round(k[i].offsetLeft / (colW + gap)) >= lim) return i;
    return 0;
  }
  const savePos = () => { try { localStorage.setItem(docKey + ':pos', anchor()) } catch (e) { } };
  function markCur(c) { $$('#toc button').forEach(b => b.classList.toggle('cur', !!c && +b.dataset.i === chapters.indexOf(c))) }
  function layout(startIdx) {
    const a = startIdx != null ? startIdx : (ready && book.children.length ? anchor() : 0);
    const W = area.clientWidth, H = area.clientHeight, sc = S.mode === 'scroll', root = document.documentElement;
    const px = W > 700 ? 56 : 22; let PW;
    if (sc) {
      cols = 1; gap = 0; PW = Math.min(W - 2 * px, 760);
      Object.assign(vp.style, { top: '0', height: (H - 34) + 'px', overflowY: 'auto', touchAction: 'pan-y' });
      Object.assign(book.style, { height: 'auto', columnCount: '', columnGap: '', padding: '28px 0 48px', transform: 'none', transition: 'none' });
    } else {
      cols = S.spread === '2' || (S.spread === 'auto' && W > H && W >= 900) ? 2 : 1;
      gap = cols === 2 ? Math.round(Math.min(72, W * .05)) : 40;
      const top = Math.max(24, Math.round(H * .03)), bot = 48;
      colW = Math.floor((W - 2 * px - (cols - 1) * gap) / cols); PW = cols * colW + (cols - 1) * gap;
      Object.assign(vp.style, { top: top + 'px', height: (H - top - bot) + 'px', overflowY: 'hidden', touchAction: 'none' });
      Object.assign(book.style, { height: '100%', columnCount: cols, columnGap: gap + 'px', padding: '0' });
    }
    // Chế độ cuộn: khung #vp rộng full màn hình để thanh cuộn nằm sát mép ngoài cùng
    vp.style.left = sc ? '0' : Math.round((W - PW) / 2) + 'px';
    vp.style.width = (sc ? W : PW) + 'px';
    book.style.width = PW + 'px';
    book.style.marginLeft = sc ? Math.round((W - PW) / 2) + 'px' : '0';
    $('#foot').style.padding = '0 ' + Math.round((W - PW) / 2) + 'px';
    root.style.setProperty('--fs', S.fs + 'px'); root.style.setProperty('--lh', S.lh);
    book.classList.toggle('sans', S.font === 'sans');
    root.dataset.theme = S.theme; root.dataset.mode = S.mode;
    lastMode = S.mode; ready = true;
    const el = book.children[a];
    if (sc) {
      chapters.forEach(c => c.top = c.el.offsetTop);
      vp.scrollTop = el ? Math.max(0, el.offsetTop - 8) : 0;
      updateScroll();
    } else {
      step = cols * (colW + gap);
      pages = Math.ceil(Math.max(1, Math.round((book.scrollWidth + gap) / (colW + gap))) / cols);
      chapters.forEach(c => c.page = pageOf(c.el));
      go(el ? pageOf(el) : 0, false);
    }
    renderToc();
  }
  function go(p, anim = true) {
    page = Math.max(0, Math.min(pages - 1, p));
    book.style.transition = anim ? '' : 'none';
    book.style.transform = 'translateX(' + (-page * step) + 'px)';
    const c = [...chapters].reverse().find(c => c.page <= page);
    $('#fchap').textContent = c ? c.title : '';
    $('#fpage').textContent = (page + 1) + ' / ' + pages;
    $('#bar').style.width = (pages > 1 ? (page + 1) / pages * 100 : 100) + '%';
    markCur(c); savePos();
  }
  function updateScroll() {
    const max = Math.max(1, vp.scrollHeight - vp.clientHeight), t = vp.scrollTop;
    const c = [...chapters].reverse().find(c => c.top <= t + 40);
    $('#fchap').textContent = c ? c.title : '';
    $('#fpage').textContent = Math.round(t / max * 100) + '%';
    $('#bar').style.width = (t / max * 100) + '%';
    markCur(c); clearTimeout(st); st = setTimeout(savePos, 300);
  }
  vp.addEventListener('scroll', () => { if (scrollMode()) requestAnimationFrame(updateScroll) });
  function jumpEl(el) {
    if (scrollMode()) { vp.scrollTo({ top: Math.max(0, el.offsetTop - 16) }); updateScroll() }
    else go(pageOf(el));
  }
  const next = () => scrollMode() ? vp.scrollBy({ top: vp.clientHeight * .9, behavior: 'smooth' }) : go(page + 1);
  const prev = () => scrollMode() ? vp.scrollBy({ top: -vp.clientHeight * .9, behavior: 'smooth' }) : go(page - 1);

  /* ====== NẠP NỘI DUNG ====== */
  function load(html, key) { loadNodes(normalize(html), key) }
  function loadNodes(nodes, key) {
    if (key) docKey = key;
    markChapters(nodes);
    book.replaceChildren(...nodes); $('#qRes').textContent = ''; $('#qInfo').textContent = '';
    if (!nodes.length) book.innerHTML = '<p class="empty">Chưa có nội dung. Khai báo CHAPTER_FILES trong index.html.</p>';
    chapters = [...book.querySelectorAll('.chapter')].map(el => ({
      el, idx: [...book.children].indexOf(el), title: (() => {
        const t = el.cloneNode(true); t.querySelectorAll('br').forEach(b => b.replaceWith(' | '));
        return t.textContent.replace(/(\s*\|\s*)+/g, ' – ').replace(/\s+/g, ' ').replace(/^ – | – $/g, '').trim()
      })(), page: 0
    }));
    let pos = 0; try { pos = +localStorage.getItem(docKey + ':pos') || 0 } catch (e) { }
    layout(Math.min(pos, Math.max(0, book.children.length - 1)));
  }
  function renderToc() {
    const t = $('#toc');
    t.innerHTML = chapters.length ? '' : '<p style="margin:4px">Không tìm thấy chương nào.</p>';
    chapters.forEach((c, i) => {
      const b = document.createElement('button'); b.dataset.i = i;
      b.innerHTML = '<small>' + (scrollMode() ? '' : c.page + 1) + '</small>';
      b.prepend(document.createTextNode(c.title));
      b.onclick = () => { jumpEl(c.el); hideUI() };
      t.append(b);
    });
  }

  /* ====== ĐIỀU KHIỂN ====== */
  let sx = 0, sy = 0;
  area.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY });
  area.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!scrollMode() && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? next() : prev(); hideUI(); return }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    if (uiOpen()) { hideUI(); return }
    const w = area.clientWidth;
    e.clientX < w * .3 ? prev() : e.clientX > w * .7 ? next() : bars(true);
  });
  addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input')) { if (e.key === 'Escape') hideUI(); return }
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next() }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev() }
    else if (e.key === 'Home') scrollMode() ? vp.scrollTo({ top: 0 }) : go(0); else if (e.key === 'End') scrollMode() ? vp.scrollTo({ top: 1e9 }) : go(pages - 1);
    else if (e.key === 'Escape') hideUI();
  });
  const bars = on => $$('#top,#side').forEach(b => b.classList.toggle('show', on));
  const uiOpen = () => $('#top').classList.contains('show') || $('.panel.open');
  function hideUI() { bars(false); $$('.panel').forEach(p => p.classList.remove('open')) }
  function toggle(id) { const p = $(id), was = p.classList.contains('open'); $$('.panel').forEach(x => x.classList.remove('open')); if (!was) p.classList.add('open') }
  $('#bToc').onclick = () => { toggle('#pToc'); const c = $('#toc .cur'); c && c.scrollIntoView({ block: 'center' }) };
  $('#bSet').onclick = () => toggle('#pSet');
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
    saveS(); syncUI(); layout();
  });
  function syncUI() {
    $('#qDia').classList.toggle('on', !!S.nodia); $('#vFs').textContent = S.fs; $('#vLh').textContent = S.lh.toFixed(1);
    $$('#pSet [data-v]').forEach(b => b.classList.toggle('on', S[b.dataset.k] === b.dataset.v));
  }
  let rt;
  ['resize', 'orientationchange', 'fullscreenchange', 'webkitfullscreenchange'].forEach(ev => addEventListener(ev, () => { clearTimeout(rt); rt = setTimeout(() => layout(), 150) }));

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
    } catch (err) {
      book.innerHTML = '<p class="empty">Không tải được nội dung: ' + err.message +
        '<br>Hãy mở trang qua máy chủ web (ví dụ Live Server), không mở trực tiếp file://</p>';
    }
  }
  init();
})();
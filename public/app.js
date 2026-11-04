import * as pdfjsLib from '/lib/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/pdf.worker.min.mjs';
const { PDFDocument, StandardFonts, degrees, rgb } = window.PDFLib;

// ---------- state ----------
// sources: imported PDFs { bytes: Uint8Array, doc: pdfjs document }
// images:  imported images { bytes, mime, url, w, h }
// pages:   { id, src (index|null), index, w, h (displayed size in pt), rot, items: [] }
// items:   { id, x, y, w, h (pt, top-left origin of the displayed page), opacity } plus
//          image: { img }  or  text: { type: 'text', text, font, bold, italic, size, color, align }
// Pages and items are plain data so undo/redo can snapshot them; the DOM is derived.
const sources = [];
const images = new Map();
let pages = [];
let zoom = 1;
let currentPageId = null;
let selectedId = null;
let nextId = 1;
let docName = null;
const uid = () => nextId++;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const pagesEl = $('pages');
const isMobile = () => matchMedia('(max-width: 720px)').matches;

// ---------- icons ----------
const ICONS = {
  filePlus: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 18v-6 M9 15h6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21',
  type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  undo: 'M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  redo: 'M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  minus: 'M5 12h14',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  copy: 'M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  arrowUp: 'M12 19V5 M5 12l7-7 7 7',
  arrowDown: 'M12 5v14 M19 12l-7 7-7-7',
  up2: 'M17 11l-5-5-5 5 M17 18l-5-5-5 5',
  down2: 'M7 6l5 5 5-5 M7 13l5 5 5-5',
  pencil: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z M15 5l4 4',
  alignLeft: 'M21 6H3 M15 12H3 M17 18H3',
  alignCenter: 'M21 6H3 M17 12H7 M19 18H5',
  alignRight: 'M21 6H3 M21 12H9 M21 18H7',
  bold: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8',
  italic: 'M19 4h-9 M14 20H5 M15 4L9 20',
  fit: 'M18 8l4 4-4 4 M6 8l-4 4 4 4 M2 12h20',
  droplet: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  upload: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2 M12 12v9 M16 16l-4-4-4 4',
  check: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M8 12l3 3 5-6',
  alert: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M12 8v4 M12 16h.01',
  info: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M12 16v-4 M12 8h.01',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));

// ---------- feedback ----------
function busy(on, text = 'Working…') {
  $('busy').hidden = !on;
  $('busyText').textContent = text;
}

function toast(message, { type = 'info', action, duration = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info');
  el.append(message);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); close(); };
    el.appendChild(b);
  }
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(close, action ? duration + 2500 : duration);
}

const readBytes = (file) => file.arrayBuffer().then((b) => new Uint8Array(b));

function loadImageEl(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Could not decode image'));
    im.src = url;
  });
}

const pageById = (id) => pages.find((p) => p.id === id);
const currentPage = () => pageById(currentPageId) || pages[0] || null;
function findItem(id) {
  for (const page of pages) {
    const item = page.items.find((it) => it.id === id);
    if (item) return { page, item };
  }
  return null;
}
const selection = () => (selectedId == null ? null : findItem(selectedId));

// ---------- history ----------
const history = { stack: [], index: -1 };

function snapshot() {
  return JSON.stringify({
    pages: pages.map((p) => ({ ...p, items: p.items.map(({ lines, ...it }) => it) })),
    currentPageId,
  });
}

function commit() {
  const s = snapshot();
  if (history.stack[history.index] === s) return;
  history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push(s);
  if (history.stack.length > 200) history.stack.shift();
  history.index = history.stack.length - 1;
  updateChrome();
}

function restore(s) {
  const d = JSON.parse(s);
  pages = d.pages;
  for (const p of pages) for (const it of p.items) if (it.type === 'text') relayoutText(it);
  currentPageId = d.currentPageId;
  selectedId = null;
  // item objects were replaced, so rebuild their elements
  for (const r of pageEls.values()) { for (const el of r.itemEls.values()) el.remove(); r.itemEls.clear(); }
  render();
}

function undo() { if (history.index > 0) restore(history.stack[--history.index]); }
function redo() { if (history.index < history.stack.length - 1) restore(history.stack[++history.index]); }

// Run a mutation, re-render and record it for undo.
function change(fn) { fn(); render(); commit(); }

// ---------- text ----------
// The 14 standard PDF fonts: wrapping is measured with pdf-lib's metrics so the
// editor and the exported PDF break lines identically.
const FONTS = {
  Helvetica: { css: 'Helvetica, Arial, "Liberation Sans", sans-serif', std: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  Times: { css: '"Times New Roman", Times, "Liberation Serif", serif', std: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  Courier: { css: '"Courier New", Courier, "Liberation Mono", monospace', std: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
};
const LINE_HEIGHT = 1.2, BASELINE = 0.95; // multiples of font size
const stdFontName = (it) => FONTS[it.font].std[(it.bold ? 1 : 0) + (it.italic ? 2 : 0)];
const cssFont = (it, size) => `${it.italic ? 'italic ' : ''}${it.bold ? 'bold ' : ''}${size}px ${FONTS[it.font].css}`;
const metricsDoc = await PDFDocument.create();
const metricFonts = new Map();
for (const f of Object.values(FONTS)) for (const n of f.std) metricFonts.set(n, await metricsDoc.embedFont(StandardFonts[n]));

// Characters outside the fonts' WinAnsi encoding can't be written; show them as '?'.
function encodable(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += ch === '\t' ? '    ' : '?'; }
  }
  return out;
}

function layoutText(item) {
  const font = metricFonts.get(stdFontName(item));
  const width = (t) => font.widthOfTextAtSize(t, item.size);
  const lines = [];
  for (const para of item.text.split('\n').map((t) => encodable(font, t))) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (width(line + word) <= item.w || !line.trim()) {
        line += word;
        // a single word wider than the box gets broken by character
        while (width(line) > item.w && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && width(line.slice(0, cut)) > item.w) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = /^\s+$/.test(word) ? '' : word;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.map((t) => {
    const w = width(t);
    const dx = item.align === 'center' ? (item.w - w) / 2 : item.align === 'right' ? item.w - w : 0;
    return { text: t, dx };
  });
}

function relayoutText(item) {
  item.lines = layoutText(item);
  item.h = Math.max(1, item.lines.length) * item.size * LINE_HEIGHT;
}

function drawTextItem(el, item) {
  const c = el.querySelector('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.ceil(item.w * zoom * dpr));
  c.height = Math.max(1, Math.ceil(item.h * zoom * dpr));
  const ctx = c.getContext('2d');
  ctx.scale(zoom * dpr, zoom * dpr);
  ctx.font = cssFont(item, item.size);
  ctx.fillStyle = item.color;
  ctx.textBaseline = 'alphabetic';
  item.lines.forEach((l, i) => ctx.fillText(l.text, l.dx, i * item.size * LINE_HEIGHT + item.size * BASELINE));
}

function addText() {
  const fresh = !pages.length;
  if (fresh) addBlankPage();
  const page = currentPage();
  const w = Math.min(260, page.w * 0.8);
  const off = page.items.length * 12 % 120;
  const item = {
    id: uid(), type: 'text', text: 'Your text', font: 'Helvetica', bold: false, italic: false,
    size: 18, color: '#101828', align: 'left', opacity: 1, w, x: (page.w - w) / 2 + off, y: page.h / 3 + off,
  };
  relayoutText(item);
  page.items.push(item);
  if (fresh) fitZoom();
  render();
  commit();
  select(item.id);
  scrollItemIntoView(item.id);
  editText(item.id);
}

// Edit text in place with a textarea laid over the item.
function editText(id) {
  const loc = findItem(id);
  const el = loc && pageEls.get(loc.page.id)?.itemEls.get(id);
  if (!el || el.querySelector('textarea')) return;
  const { item } = loc;
  const ta = document.createElement('textarea');
  ta.value = item.text;
  Object.assign(ta.style, { font: cssFont(item, item.size * zoom), color: item.color, textAlign: item.align, lineHeight: LINE_HEIGHT });
  el.classList.add('editing');
  el.appendChild(ta);
  const fit = () => { ta.style.height = '0'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) ta.blur();
  });
  ta.addEventListener('blur', () => {
    ta.remove();
    el.classList.remove('editing');
    const loc = findItem(id);
    if (!loc) return;
    change(() => {
      if (ta.value.trim()) {
        loc.item.text = ta.value;
        relayoutText(loc.item);
      } else {
        // emptied text removes the box
        loc.page.items.splice(loc.page.items.indexOf(loc.item), 1);
        if (selectedId === id) selectedId = null;
      }
    });
  });
  fit();
  ta.focus({ preventScroll: true });
  ta.select();
}

// ---------- import ----------
async function importPdf(file) {
  const bytes = await readBytes(file);
  // pdf.js may detach the buffer it is given, so hand it a copy.
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const src = sources.push({ bytes, doc }) - 1;
  docName ??= file.name.replace(/\.pdf$/i, '');
  let first = null;
  for (let i = 0; i < doc.numPages; i++) {
    const p = await doc.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    const page = { id: uid(), src, index: i, w: vp.width, h: vp.height, rot: p.rotate % 360, items: [] };
    pages.push(page);
    first ??= page;
  }
  return first;
}

async function importImage(file, page, at) {
  const bytes = await readBytes(file);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  const el = await loadImageEl(url);
  const id = uid();
  images.set(id, { bytes, mime: file.type, url, w: el.naturalWidth, h: el.naturalHeight });
  if (!page) {
    if (!pages.length) addBlankPage();
    page = currentPage();
  }
  // Fit within half the page, never upscale beyond 1px = 1pt.
  const scale = Math.min(1, (page.w * 0.5) / el.naturalWidth, (page.h * 0.5) / el.naturalHeight);
  const w = el.naturalWidth * scale, h = el.naturalHeight * scale;
  let x = at ? at.x - w / 2 : (page.w - w) / 2;
  let y = at ? at.y - h / 2 : (page.h - h) / 2;
  const off = page.items.length * 12 % 120; // stagger centred drops
  if (!at) { x += off; y += off; }
  const item = { id: uid(), img: id, x, y, w, h, opacity: 1 };
  page.items.push(item);
  return item;
}

async function handleFiles(files, targetPage, at) {
  const list = [...files];
  if (!list.length) return;
  const wasEmpty = !pages.length;
  busy(true, 'Importing…');
  let last = null, firstPage = null, added = 0, skipped = 0;
  try {
    for (const f of list) {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        firstPage ??= await importPdf(f);
        added++;
      } else if (f.type.startsWith('image/')) {
        last = await importImage(f, targetPage, at);
        added++;
      } else {
        skipped++;
      }
    }
  } catch (e) {
    console.error(e);
    toast(`Couldn't import: ${e.message}`, { type: 'error' });
  } finally {
    busy(false);
  }
  if (wasEmpty && pages.length) fitZoom();
  render();
  if (added) commit();
  if (last) { select(last.id); scrollItemIntoView(last.id); }
  else if (firstPage && !wasEmpty) scrollPageIntoView(firstPage.id);
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — only PDFs and images are supported`, { type: 'error' });
}

function addBlankPage(size = '595.28x841.89') {
  const [w, h] = size.split('x').map(Number);
  const page = { id: uid(), src: null, index: 0, w, h, rot: 0, items: [] };
  const cur = pages.indexOf(currentPage());
  pages.splice(cur < 0 ? pages.length : cur + 1, 0, page);
  currentPageId = page.id;
  return page;
}

// ---------- rendering ----------
const pageEls = new Map(); // page.id -> { wrap, el, canvas, label, up, down, itemEls, renderedZoom, visible }
const MAX_CANVAS_PIXELS = 12e6; // keep mobile browsers within their canvas memory limits

// Only pages near the viewport keep a rendered background.
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const id = +en.target.dataset.pageId;
    const r = pageEls.get(id), page = pageById(id);
    if (!r || !page) continue;
    r.visible = en.isIntersecting;
    if (r.visible && r.renderedZoom !== zoom) drawBackground(page, r);
    if (!r.visible && r.renderedZoom != null && page.src !== null) {
      r.token++;
      r.task?.cancel();
      r.canvas.width = r.canvas.height = 0;
      r.renderedZoom = null;
    }
  }
}, { root: stage, rootMargin: '1200px 0px' });

function render({ live = false } = {}) {
  $('empty').hidden = pages.length > 0;
  pagesEl.hidden = !pages.length;
  for (const [id, r] of pageEls) {
    if (!pageById(id)) { io.unobserve(r.el); r.wrap.remove(); pageEls.delete(id); }
  }
  pages.forEach((page, i) => {
    const r = pageEls.get(page.id) || createPageEl(page.id);
    r.label.textContent = `Page ${i + 1}`;
    r.up.disabled = i === 0;
    r.down.disabled = i === pages.length - 1;
    if (pagesEl.children[i] !== r.wrap) pagesEl.insertBefore(r.wrap, pagesEl.children[i] || null);
    r.el.style.width = page.w * zoom + 'px';
    r.el.style.height = page.h * zoom + 'px';
    r.wrap.classList.toggle('current', page.id === currentPageId);
    if (!live && r.visible && r.renderedZoom !== zoom) drawBackground(page, r);
    renderItems(page, r, live);
  });
  updateChrome();
  updateInspector();
}

function updateChrome() {
  $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
  $('undoBtn').disabled = history.index <= 0;
  $('redoBtn').disabled = history.index >= history.stack.length - 1;
  $('exportBtn').disabled = !pages.length;
  $('clearAll').disabled = !pages.length;
  $('docMeta').textContent = pages.length ? `${pages.length} page${pages.length > 1 ? 's' : ''}` : '';
  $('docMeta').hidden = !pages.length;
}

function createPageEl(id) {
  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  const head = document.createElement('div');
  head.className = 'page-head';
  const label = document.createElement('span');
  label.className = 'page-label';
  const actions = document.createElement('div');
  actions.className = 'page-actions';
  const mk = (ic, title, fn, cls = '') => {
    const b = document.createElement('button');
    b.innerHTML = icon(ic);
    b.title = title;
    b.className = cls;
    b.setAttribute('aria-label', title);
    b.onclick = fn;
    actions.appendChild(b);
    return b;
  };
  const up = mk('arrowUp', 'Move page up', () => movePage(id, -1));
  const down = mk('arrowDown', 'Move page down', () => movePage(id, 1));
  mk('copy', 'Duplicate page', () => duplicatePage(id));
  mk('trash', 'Delete page', () => deletePage(id), 'danger');
  head.append(label, actions);

  const el = document.createElement('div');
  el.className = 'page';
  el.dataset.pageId = id;
  const canvas = document.createElement('canvas');
  canvas.className = 'bg';
  el.appendChild(canvas);
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== el) return;
    currentPageId = id;
    select(null);
  });
  wrap.append(head, el);
  const r = { wrap, el, canvas, label, up, down, renderedZoom: null, visible: false, token: 0, itemEls: new Map() };
  pageEls.set(id, r);
  io.observe(el);
  return r;
}

function movePage(id, dir) {
  const i = pages.findIndex((p) => p.id === id), j = i + dir;
  if (j < 0 || j >= pages.length) return;
  change(() => { [pages[i], pages[j]] = [pages[j], pages[i]]; currentPageId = id; });
  scrollPageIntoView(id);
}

function duplicatePage(id) {
  const i = pages.findIndex((p) => p.id === id);
  const src = pages[i];
  const copy = { ...src, id: uid(), items: src.items.map((it) => ({ ...it, id: uid() })) };
  change(() => { pages.splice(i + 1, 0, copy); currentPageId = copy.id; });
  scrollPageIntoView(copy.id);
}

function deletePage(id) {
  const i = pages.findIndex((p) => p.id === id);
  change(() => {
    if (selection()?.page.id === id) selectedId = null;
    pages.splice(i, 1);
    if (currentPageId === id) currentPageId = pages[Math.min(i, pages.length - 1)]?.id ?? null;
  });
  toast(`Page ${i + 1} deleted`, { action: { label: 'Undo', fn: undo } });
}

async function drawBackground(page, r) {
  r.renderedZoom = zoom;
  if (page.src === null) { r.canvas.width = r.canvas.height = 0; return; }
  const token = ++r.token;
  r.task?.cancel();
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(zoom * dpr, Math.sqrt(MAX_CANVAS_PIXELS / (page.w * page.h)));
  const p = await sources[page.src].doc.getPage(page.index + 1);
  if (token !== r.token) return;
  const vp = p.getViewport({ scale });
  // Render off-screen and swap in, so zooming never flashes a blank page.
  const off = document.createElement('canvas');
  off.width = Math.round(vp.width);
  off.height = Math.round(vp.height);
  r.task = p.render({ canvasContext: off.getContext('2d'), viewport: vp });
  try {
    await r.task.promise;
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.error(e);
    return;
  }
  if (token !== r.token) return;
  r.canvas.width = off.width;
  r.canvas.height = off.height;
  r.canvas.getContext('2d').drawImage(off, 0, 0);
}

function renderItems(page, r, live) {
  const ids = new Set(page.items.map((it) => it.id));
  for (const [id, el] of r.itemEls) if (!ids.has(id)) { el.remove(); r.itemEls.delete(id); }
  page.items.forEach((item, z) => {
    let el = r.itemEls.get(item.id);
    if (!el) { el = createItemEl(item); r.itemEls.set(item.id, el); }
    if (el.parentNode !== r.el) r.el.appendChild(el);
    positionItem(el, item);
    if (item.type === 'text' && !live) drawTextItem(el, item);
    el.style.zIndex = z + 1;
    el.style.opacity = item.opacity;
    el.classList.toggle('selected', item.id === selectedId);
  });
}

function positionItem(el, item) {
  el.style.left = item.x * zoom + 'px';
  el.style.top = item.y * zoom + 'px';
  el.style.width = item.w * zoom + 'px';
  el.style.height = item.h * zoom + 'px';
}

function createItemEl(item) {
  const el = document.createElement('div');
  el.className = 'item';
  if (item.type === 'text') {
    el.classList.add('text');
    el.appendChild(document.createElement('canvas'));
  } else {
    const img = document.createElement('img');
    img.src = images.get(item.img).url;
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
  }
  // text boxes only change width, so they get side handles instead of corners
  for (const corner of item.type === 'text' ? ['w', 'e'] : ['nw', 'ne', 'sw', 'se']) {
    const h = document.createElement('div');
    h.className = 'handle ' + corner;
    h.dataset.corner = corner;
    el.appendChild(h);
  }
  const id = item.id;
  el.addEventListener('pointerdown', (e) => startDrag(e, id, el));
  return el;
}

function scrollPageIntoView(id) {
  requestAnimationFrame(() => pageEls.get(id)?.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function scrollItemIntoView(id) {
  const loc = findItem(id);
  requestAnimationFrame(() => pageEls.get(loc?.page.id)?.itemEls.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
}

// ---------- zoom ----------
const MIN_ZOOM = 0.2, MAX_ZOOM = 4;

function setZoom(z, { anchor, live = false } = {}) {
  z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const rect = stage.getBoundingClientRect();
  const ax = (anchor?.x ?? rect.left + rect.width / 2) - rect.left;
  const ay = (anchor?.y ?? rect.top + rect.height / 2) - rect.top;
  const ratio = z / zoom;
  const cx = stage.scrollLeft + ax, cy = stage.scrollTop + ay;
  zoom = z;
  render({ live });
  // keep the point under the anchor where it was
  stage.scrollLeft = cx * ratio - ax;
  stage.scrollTop = cy * ratio - ay;
}

function fitZoom() {
  if (!pages.length) return;
  const pad = isMobile() ? 24 : 64;
  const maxW = Math.max(...pages.map((p) => p.w));
  zoom = Math.min(1, Math.max(MIN_ZOOM, (stage.clientWidth - pad) / maxW));
}

let settleTimer;
function liveZoom(z, anchor) {
  setZoom(z, { anchor, live: true });
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => render(), 160);
}

stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl+wheel
  e.preventDefault();
  liveZoom(zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
}, { passive: false });

// two-finger pinch on touch screens
let pinch = null;
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const touchMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
stage.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) pinch = { d: touchDist(e.touches), z: zoom };
}, { passive: true });
stage.addEventListener('touchmove', (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  liveZoom(pinch.z * touchDist(e.touches) / pinch.d, touchMid(e.touches));
}, { passive: false });
stage.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });

// ---------- selection ----------
function select(id) {
  selectedId = id;
  const loc = selection();
  if (loc) currentPageId = loc.page.id;
  for (const p of pages) {
    const r = pageEls.get(p.id);
    if (!r) continue;
    r.wrap.classList.toggle('current', p.id === currentPageId);
    for (const [iid, el] of r.itemEls) el.classList.toggle('selected', iid === selectedId);
  }
  updateInspector();
}

function updateInspector() {
  const loc = selection();
  $('inspector').hidden = !loc;
  if (!loc) return;
  const it = loc.item, isText = it.type === 'text';
  $('textTools').hidden = !isText;
  $('imageTools').hidden = isText;
  $('opacity').value = it.opacity;
  $('opacityVal').textContent = Math.round(it.opacity * 100) + '%';
  if (isText) {
    $('tFont').value = it.font;
    if (document.activeElement !== $('tSize')) $('tSize').value = it.size;
    $('tColor').value = it.color;
    $('tColorDot').style.background = it.color;
    $('tBold').classList.toggle('on', it.bold);
    $('tItalic').classList.toggle('on', it.italic);
    for (const a of ['left', 'center', 'right']) $('tAlign-' + a).classList.toggle('on', it.align === a);
  }
  const i = loc.page.items.indexOf(it);
  $('back').disabled = i === 0;
  $('fwd').disabled = i === loc.page.items.length - 1;
}

// ---------- drag / resize ----------
function pageAt(clientX, clientY) {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el.classList.contains('page')) return pageById(+el.dataset.pageId);
  }
  return null;
}

function startDrag(e, id, el) {
  if (e.button !== 0 || pinch) return;
  const loc = findItem(id);
  if (!loc) return;
  const wasSelected = selectedId === id;
  // On touch, the first tap only selects, so swiping across items still scrolls.
  if (e.pointerType === 'touch' && !wasSelected) { e.stopPropagation(); select(id); return; }
  e.preventDefault();
  e.stopPropagation();
  document.activeElement?.blur?.();
  select(id);
  let { page } = loc;
  const { item } = loc;
  const corner = e.target.dataset?.corner;
  const start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y, iw: item.w, ih: item.h };
  const aspect = item.w / item.h;
  let moved = false;
  el.setPointerCapture(e.pointerId);

  const onMove = (ev) => {
    if (pinch) return;
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
    moved = true;
    const dx = (ev.clientX - start.x) / zoom, dy = (ev.clientY - start.y) / zoom;
    if (!corner) {
      item.x = start.ix + dx;
      item.y = start.iy + dy;
      // Move to another page when the pointer crosses onto it.
      const target = pageAt(ev.clientX, ev.clientY);
      if (target && target !== page) {
        const from = pageEls.get(page.id), to = pageEls.get(target.id);
        const a = from.el.getBoundingClientRect(), b = to.el.getBoundingClientRect();
        const shiftX = (a.left - b.left) / zoom, shiftY = (a.top - b.top) / zoom;
        start.ix += shiftX; start.iy += shiftY;
        item.x += shiftX; item.y += shiftY;
        page.items.splice(page.items.indexOf(item), 1);
        target.items.push(item);
        from.itemEls.delete(item.id);
        to.itemEls.set(item.id, el);
        to.el.appendChild(el);
        el.style.zIndex = target.items.length;
        page = target;
        currentPageId = page.id;
        for (const p of pages) pageEls.get(p.id).wrap.classList.toggle('current', p === page);
      }
    } else {
      const west = corner.includes('w'), north = corner.includes('n');
      if (item.type === 'text') {
        // text boxes resize horizontally; height follows the wrapped lines
        item.w = Math.max(item.size, start.iw + (west ? -dx : dx));
        item.x = west ? start.ix + start.iw - item.w : start.ix;
        relayoutText(item);
        positionItem(el, item);
        drawTextItem(el, item);
        return;
      }
      let w = Math.max(8, start.iw + (west ? -dx : dx));
      let h = Math.max(8, start.ih + (north ? -dy : dy));
      if (!ev.shiftKey) {
        // keep aspect ratio: follow whichever axis moved more
        if (w / start.iw > h / start.ih) h = w / aspect; else w = h * aspect;
      }
      item.w = w; item.h = h;
      item.x = west ? start.ix + start.iw - w : start.ix;
      item.y = north ? start.iy + start.ih - h : start.iy;
    }
    positionItem(el, item);
  };
  const onUp = (ev) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    if (moved) { render(); commit(); }
    else if (ev.type === 'pointerup' && wasSelected && item.type === 'text' && !corner) editText(id);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

stage.addEventListener('pointerdown', (e) => {
  if (e.target === stage || e.target === pagesEl || e.target.classList.contains('page-wrap')) select(null);
});

// ---------- inspector actions ----------
function withSel(fn) { return () => { const loc = selection(); if (loc) change(() => fn(loc.page, loc.item)); }; }

const deleteSelected = withSel((page, item) => {
  page.items.splice(page.items.indexOf(item), 1);
  selectedId = null;
  toast(item.type === 'text' ? 'Text deleted' : 'Image deleted', { action: { label: 'Undo', fn: undo } });
});
const duplicateSelected = withSel((page, item) => {
  const copy = { ...item, id: uid(), x: item.x + 16, y: item.y + 16 };
  page.items.push(copy);
  selectedId = copy.id;
});
$('del').onclick = deleteSelected;
$('dup').onclick = duplicateSelected;
$('fwd').onclick = withSel((page, item) => {
  const i = page.items.indexOf(item);
  if (i < page.items.length - 1) [page.items[i], page.items[i + 1]] = [page.items[i + 1], page.items[i]];
});
$('back').onclick = withSel((page, item) => {
  const i = page.items.indexOf(item);
  if (i > 0) [page.items[i], page.items[i - 1]] = [page.items[i - 1], page.items[i]];
});
$('fitW').onclick = withSel((page, item) => {
  const a = item.w / item.h;
  item.w = page.w; item.h = page.w / a;
  if (item.h > page.h) { item.h = page.h; item.w = page.h * a; }
  item.x = (page.w - item.w) / 2;
  item.y = (page.h - item.h) / 2;
});
$('opacity').oninput = (e) => {
  const loc = selection();
  if (!loc) return;
  loc.item.opacity = +e.target.value;
  $('opacityVal').textContent = Math.round(loc.item.opacity * 100) + '%';
  pageEls.get(loc.page.id).itemEls.get(loc.item.id).style.opacity = loc.item.opacity;
};
$('opacity').onchange = commit;

function setTextProp(key, value, record = true) {
  const loc = selection();
  if (loc?.item.type !== 'text') return;
  loc.item[key] = value;
  relayoutText(loc.item);
  render();
  if (record) commit();
}
const clampSize = (v) => Math.min(400, Math.max(4, Math.round(v)));
const stepSize = (dir) => {
  const it = selection()?.item;
  if (it) setTextProp('size', clampSize(it.size + dir * (it.size >= 24 ? 2 : 1)));
};
$('tEdit').onclick = () => selectedId != null && editText(selectedId);
$('tFont').onchange = (e) => setTextProp('font', e.target.value);
$('tSize').oninput = (e) => { const v = +e.target.value; if (v >= 4 && v <= 400) setTextProp('size', v, false); };
$('tSize').onchange = (e) => { setTextProp('size', clampSize(+e.target.value || 18)); e.target.value = selection()?.item.size ?? ''; };
$('tSizeDown').onclick = () => stepSize(-1);
$('tSizeUp').onclick = () => stepSize(1);
$('tColor').oninput = (e) => setTextProp('color', e.target.value, false);
$('tColor').onchange = commit;
$('tBold').onclick = () => setTextProp('bold', !selection().item.bold);
$('tItalic').onclick = () => setTextProp('italic', !selection().item.italic);
for (const a of ['left', 'center', 'right']) $('tAlign-' + a).onclick = () => setTextProp('align', a);

// ---------- keyboard ----------
let nudgeTimer;
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && (key === '=' || key === '+')) { e.preventDefault(); setZoom(zoom * 1.25); return; }
  if (mod && key === '-') { e.preventDefault(); setZoom(zoom / 1.25); return; }
  if (mod && key === '0') { e.preventDefault(); fitZoom(); render(); return; }
  const loc = selection();
  if (!loc) return;
  const step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    e.preventDefault();
    loc.item.x += moves[e.key][0];
    loc.item.y += moves[e.key][1];
    render();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(commit, 400);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (mod && key === 'd') {
    e.preventDefault();
    duplicateSelected();
  } else if (e.key === 'Escape') {
    select(null);
  } else if (e.key === 'Enter' && loc.item.type === 'text') {
    e.preventDefault();
    editText(loc.item.id);
  }
});

// ---------- toolbar / dock ----------
const sizeMenu = $('sizeMenu');
let menuAnchor = null;
function toggleSizeMenu(anchor) {
  if (!sizeMenu.hidden && menuAnchor === anchor) return closeMenu();
  closeMenu();
  menuAnchor = anchor;
  anchor.classList.add('open');
  sizeMenu.hidden = false;
  const r = anchor.getBoundingClientRect(), m = sizeMenu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - m.width - 8, Math.max(8, r.left + r.width / 2 - m.width / 2));
  const above = r.top - m.height - 8;
  sizeMenu.style.left = left + 'px';
  sizeMenu.style.top = (above > 8 ? above : r.bottom + 8) + 'px';
}
function closeMenu() {
  sizeMenu.hidden = true;
  menuAnchor?.classList.remove('open');
  menuAnchor = null;
}
document.addEventListener('pointerdown', (e) => {
  if (!sizeMenu.hidden && !sizeMenu.contains(e.target) && !menuAnchor?.contains(e.target)) closeMenu();
}, true);
for (const b of sizeMenu.querySelectorAll('button')) {
  b.onclick = () => {
    closeMenu();
    const fresh = !pages.length;
    const page = addBlankPage(b.dataset.size);
    if (fresh) fitZoom();
    select(null);
    render();
    commit();
    scrollPageIntoView(page.id);
  };
}

const ACTIONS = {
  pdf: () => $('pdfInput').click(),
  image: () => $('imgInput').click(),
  text: addText,
  page: (btn) => toggleSizeMenu(btn),
};
for (const b of document.querySelectorAll('[data-action]')) b.onclick = () => ACTIONS[b.dataset.action](b);

$('pdfInput').onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
$('imgInput').onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redo;
$('zoomIn').onclick = () => setZoom(zoom * 1.25);
$('zoomOut').onclick = () => setZoom(zoom / 1.25);
$('zoomLabel').onclick = () => { fitZoom(); render(); };
$('clearAll').onclick = () => {
  if (!pages.length) return;
  change(() => { pages = []; selectedId = null; currentPageId = null; });
  toast('Document cleared', { action: { label: 'Undo', fn: undo } });
};

// drag & drop files from the desktop
let dropPage = null, dragDepth = 0;
const setDropPage = (p) => {
  if (dropPage === p) return;
  if (dropPage) pageEls.get(dropPage.id)?.el.classList.remove('drop');
  dropPage = p;
  if (p) pageEls.get(p.id)?.el.classList.add('drop');
};
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('dropOverlay').hidden = false; } });
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  setDropPage(pageAt(e.clientX, e.clientY));
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').hidden = true; setDropPage(null); }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  const page = pageAt(e.clientX, e.clientY);
  setDropPage(null);
  let at = null;
  if (page) {
    const rect = pageEls.get(page.id).el.getBoundingClientRect();
    at = { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }
  handleFiles(e.dataTransfer.files, page, at);
});

// ---------- export ----------
async function embedImage(out, img) {
  if (img.mime === 'image/png') return out.embedPng(img.bytes);
  if (img.mime === 'image/jpeg' || img.mime === 'image/jpg') return out.embedJpg(img.bytes);
  // Anything else (webp, gif, svg…) is rasterised to PNG first.
  const el = await loadImageEl(img.url);
  const scale = img.mime === 'image/svg+xml' ? 4 : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, (el.naturalWidth || 512) * scale);
  c.height = Math.max(1, (el.naturalHeight || 512) * scale);
  c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return out.embedPng(new Uint8Array(await blob.arrayBuffer()));
}

// A point (X, Y) on the displayed page maps to PDF user space like this; content
// drawn there with rotate = rot reads left-to-right on screen.
function mapPoint(X, Y, mb, rot) {
  const W = mb.width, H = mb.height;
  let x, y;
  switch (rot) {
    case 90: x = Y; y = X; break;
    case 180: x = W - X; y = Y; break;
    case 270: x = W - Y; y = H - X; break;
    default: x = X; y = H - Y;
  }
  return { x: x + mb.x, y: y + mb.y };
}

function placement(item, mb, rot) {
  // images are anchored at their bottom-left corner
  return { ...mapPoint(item.x, item.y + item.h, mb, rot), width: item.w, height: item.h, rotate: degrees(rot) };
}

const hexToRgb = (hex) => rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

async function exportPdf() {
  if (!pages.length) return;
  document.activeElement?.blur?.(); // commit any text being edited
  busy(true, 'Building your PDF…');
  try {
    const out = await PDFDocument.create();
    const libSources = new Map();
    const embedded = new Map();
    const fonts = new Map();
    for (const page of pages) {
      let p;
      if (page.src === null) {
        p = out.addPage([page.w, page.h]);
      } else {
        if (!libSources.has(page.src)) {
          libSources.set(page.src, await PDFDocument.load(sources[page.src].bytes, { ignoreEncryption: true }));
        }
        [p] = await out.copyPages(libSources.get(page.src), [page.index]);
        out.addPage(p);
      }
      const rot = ((p.getRotation().angle % 360) + 360) % 360;
      const mb = p.getCropBox();
      for (const item of page.items) {
        if (item.type === 'text') {
          const name = stdFontName(item);
          if (!fonts.has(name)) fonts.set(name, await out.embedFont(StandardFonts[name]));
          item.lines.forEach((l, i) => {
            if (!l.text) return;
            const baseline = item.y + i * item.size * LINE_HEIGHT + item.size * BASELINE;
            p.drawText(l.text, {
              ...mapPoint(item.x + l.dx, baseline, mb, rot), rotate: degrees(rot),
              font: fonts.get(name), size: item.size, color: hexToRgb(item.color), opacity: item.opacity,
            });
          });
          continue;
        }
        if (!embedded.has(item.img)) embedded.set(item.img, await embedImage(out, images.get(item.img)));
        p.drawImage(embedded.get(item.img), { ...placement(item, mb, rot), opacity: item.opacity });
      }
    }
    const bytes = await out.save();
    const filename = (docName ? `${docName}-edited` : 'document') + '.pdf';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    busy(false);
    toast(`Exported ${filename}`, { type: 'success' });
  } catch (e) {
    console.error(e);
    busy(false);
    toast(`Export failed: ${e.message}`, { type: 'error' });
  }
}
$('exportBtn').onclick = exportPdf;

// work lives only in this tab, so warn before it is lost
window.addEventListener('beforeunload', (e) => { if (pages.length) e.preventDefault(); });

render();
commit();

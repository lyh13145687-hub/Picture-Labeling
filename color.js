(() => {
  'use strict';

  const STATE_KEY = 'colorJudgment_state_v1';
  const DB_NAME = 'colorJudgmentDB';
  const STORE = 'files';
  const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
  const STATUS_ORDER = ['pending', 'pass', 'fail', 'optimize'];
  const STATUS_TEXT = { pending: '未取到', pass: '合格', fail: '不合格', optimize: '待优化' };
  const OVERALL_TEXT = { auto: '自动', pending: '未验收', pass: '合格', fail: '不合格' };
  const MATCH_TEXT = { manual: '手动匹配', name: '按名称匹配', similar: '按相似名称匹配', order: '按顺序匹配' };
  const SORT_WEIGHTS = [0.58, 0.28, 0.14];
  const DEDUPE_THRESHOLDS = [54, 42, 30, 18, 0];
  const PASS_SCORE = 60;
  const FILTER_OPTIONS = [
    { value: '', label: '全部' },
    { value: 'allPass', label: '全部通过' },
    { value: 'allFail', label: '全部不通过' },
    { value: 'partial', label: '部分通过' },
    { value: 'optimize', label: '含待优化' },
    { value: 'missing', label: '含未取到颜色' },
    { value: 'pending', label: '未验收（无标记）' },
    { value: 'imagePass', label: '图片合格' },
    { value: 'imageFail', label: '图片不合格' },
    { value: 'hasIssue', label: '有问题标签' },
    { value: 'hasNote', label: '有备注' },
    { value: 'unmatched', label: '未匹配验证图' },
  ];

  const $ = (id) => document.getElementById(id);
  const dom = {
    stageExtract: $('colorStageExtract'), stageReview: $('colorStageReview'),
    stat: $('colorStat'), import: $('colorImport'), importValidation: $('colorImportValidation'),
    export: $('colorExport'), search: $('colorSearch'),
    countSetting: $('colorCountSetting'), count: $('colorCount'),
    sortSetting: $('colorSortSetting'), sort: $('colorSort'),
    recalculate: $('colorRecalculate'), reviewSettings: $('colorReviewSettings'),
    filter: $('colorFilter'), judgeMode: $('colorJudgeMode'), threshold: $('colorPassThreshold'),
    grid: $('colorGrid'), review: $('colorReview'), empty: $('colorEmpty'), emptyImport: $('colorEmptyImport'),
    prev: $('colorPrev'), next: $('colorNext'), position: $('colorPosition'),
    manageIssues: $('colorManageIssues'), clear: $('colorClear'), toast: $('colorToastWrap'),
    folderInput: $('colorFolderInput'), zipInput: $('colorZipInput'),
    validationFolderInput: $('colorValidationFolderInput'), validationZipInput: $('colorValidationZipInput'),
    importModal: $('colorImportModal'), importTitle: $('colorImportTitle'),
    chooseFolder: $('colorChooseFolder'), chooseZip: $('colorChooseZip'),
    detailModal: $('colorDetailModal'), detailTitle: $('colorDetailTitle'),
    detailClose: $('colorDetailClose'), canvas: $('colorCanvas'), pickerPin: $('colorPickerPin'),
    paletteEditor: $('colorPaletteEditor'), addSwatch: $('colorAddSwatch'),
    referenceNote: $('colorReferenceNote'),
    matchModal: $('colorMatchModal'), matchTitle: $('colorMatchTitle'), matchList: $('colorMatchList'),
    issuesModal: $('colorIssuesModal'), issueManager: $('colorIssueManager'),
    newIssue: $('colorNewIssue'), addIssue: $('colorAddIssue'),
    exportModal: $('colorExportModal'), exportJson: $('colorExportJson'), exportCsv: $('colorExportCsv'),
    api: $('colorApi'), aiMount: $('colorAiMount'),
  };

  const LLM = window.PicLabelingLlm;
  let apiDialog = null;

  let state = defaultState();
  let dbPromise;
  let currentIndex = 0;
  let currentId = null;
  let editingId = null;
  let selectedSwatchId = null;
  let importTarget = 'reference';
  let working = false;
  let countApplyQueued = false;
  const urls = new Map();

  const LEGACY_ISSUE_TAGS = ['偏色', '漏取色', '重复色', '颜色不准确'];

  function defaultState() {
    return {
      version: 2,
      stage: 'extract',
      settings: { colorCount: 10, sort: 'area,saturation,lightness', passThreshold: 10, scoreMode: false },
      reviewFilter: '',
      images: [],
      validations: [],
      issueTags: [],
      updatedAt: Date.now(),
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    const next = raw && typeof raw === 'object' ? raw : {};
    next.settings = { ...base.settings, ...(next.settings || {}) };
    next.images = Array.isArray(next.images) ? next.images : [];
    next.validations = Array.isArray(next.validations) ? next.validations : [];
    next.issueTags = Array.isArray(next.issueTags) ? next.issueTags : [];
    const injectedDefaults = Number(next.version) < 2
      && next.issueTags.length === LEGACY_ISSUE_TAGS.length
      && next.issueTags.every((tag, index) => tag === LEGACY_ISSUE_TAGS[index]);
    if (injectedDefaults) next.issueTags = [];
    next.version = base.version;
    next.stage = next.stage === 'review' ? 'review' : 'extract';
    next.reviewFilter = FILTER_OPTIONS.some((option) => option.value === next.reviewFilter) ? next.reviewFilter : '';
    next.images.forEach((image) => {
      image.palette = Array.isArray(image.palette) ? image.palette : [];
      image.note = image.note || '';
      image.review = image.review || {};
      image.review.verdicts = image.review.verdicts || {};
      image.review.scores = image.review.scores || {};
      image.review.issues = Array.isArray(image.review.issues) ? image.review.issues : [];
      image.review.note = image.review.note || '';
      image.review.manualOverall = image.review.manualOverall || 'auto';
      image.review.matchId = image.review.matchId || '';
    });
    return next;
  }

  function saveState() {
    state.updatedAt = Date.now();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function dbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbClear() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function basename(path) {
    return String(path || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  }

  function relativeTail(path) {
    const parts = String(path || '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    return (parts.length > 1 ? parts.slice(1) : parts).join('/');
  }

  function nameStem(name) {
    return basename(name).replace(/\.[^.]+$/, '');
  }

  function commonPrefixLength(a, b) {
    const max = Math.min(a.length, b.length);
    let length = 0;
    while (length < max && a[length] === b[length]) length += 1;
    return length;
  }

  // 名称完全一致时直接配对，否则容忍一侧多出的后缀（如 A室内3.jpg ↔ A室内3_色卡.jpg）。
  function matchScore(image, validation) {
    if (relativeTail(image.path) === relativeTail(validation.path)) return 1000;
    const a = nameStem(image.name);
    const b = nameStem(validation.name);
    if (!a || !b) return 0;
    if (a === b) return 900;
    if (b.startsWith(a)) return 800 - (b.length - a.length);
    if (a.startsWith(b)) return 700 - (a.length - b.length);
    if (b.includes(a) || a.includes(b)) return 600 - Math.abs(a.length - b.length);
    const prefix = commonPrefixLength(a, b);
    if (prefix >= 3) return 300 + Math.round(prefix / Math.max(a.length, b.length) * 100);
    return 0;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function toast(message, tone = '') {
    const node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = `<div class="toast__v">${escapeHtml(message)}</div>`;
    if (tone) node.dataset.tone = tone;
    dom.toast.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function openModal(node) { node.hidden = false; }
  function closeModal(node) { node.hidden = true; }

  async function objectUrl(key) {
    if (urls.has(key)) return urls.get(key);
    const blob = await dbGet(key);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  }

  function releaseUrls() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.clear();
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    return { saturation, lightness };
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  async function blobToBitmap(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function colorCandidates(blob, sortOrder) {
    const bitmap = await blobToBitmap(blob);
    const scale = Math.min(1, 112 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    if (bitmap.close) bitmap.close();
    const bins = new Map();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3] < 160) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const bin = bins.get(key) || { r: 0, g: 0, b: 0, x: 0, y: 0, count: 0 };
        bin.r += r; bin.g += g; bin.b += b; bin.x += x; bin.y += y; bin.count += 1;
        bins.set(key, bin);
      }
    }
    const maxArea = Math.max(1, ...Array.from(bins.values(), (bin) => bin.count));
    const order = String(sortOrder).split(',');
    return Array.from(bins.values()).map((bin) => {
      const r = bin.r / bin.count, g = bin.g / bin.count, b = bin.b / bin.count;
      const hsl = rgbToHsl(r, g, b);
      const values = { area: bin.count / maxArea, saturation: hsl.saturation, lightness: hsl.lightness };
      return {
        r, g, b, x: bin.x / bin.count / width, y: bin.y / bin.count / height,
        score: order.reduce((sum, key, index) => sum + (values[key] || 0) * SORT_WEIGHTS[index], 0),
      };
    }).sort((a, b) => b.score - a.score);
  }

  function pickColors(candidates, count, existing = []) {
    const chosen = [];
    for (const threshold of DEDUPE_THRESHOLDS) {
      for (const color of candidates) {
        if (chosen.length >= count) break;
        if (chosen.includes(color)) continue;
        const conflict = [...existing, ...chosen].some((other) => colorDistance(color, other) < threshold);
        if (!conflict) chosen.push(color);
      }
      if (chosen.length >= count) break;
    }
    return chosen.slice(0, count);
  }

  function toSwatch(color) {
    const r = Math.round(color.r), g = Math.round(color.g), b = Math.round(color.b);
    return { id: uid('color'), hex: rgbToHex(r, g, b), r, g, b, x: color.x, y: color.y, source: 'auto' };
  }

  function dropSwatchData(image, colorId) {
    delete image.review.verdicts[colorId];
    delete image.review.scores[colorId];
  }

  async function extractForImage(image) {
    const blob = await dbGet(image.fileKey);
    if (!blob) return;
    const candidates = await colorCandidates(blob, state.settings.sort);
    image.palette.forEach((color) => dropSwatchData(image, color.id));
    image.palette = pickColors(candidates, state.settings.colorCount).map(toSwatch);
  }

  async function resizeForImage(image) {
    const count = state.settings.colorCount;
    if (image.palette.length === count) return;
    if (image.palette.length > count) {
      image.palette.splice(count).forEach((color) => dropSwatchData(image, color.id));
      return;
    }
    const blob = await dbGet(image.fileKey);
    if (!blob) return;
    const candidates = await colorCandidates(blob, state.settings.sort);
    const extra = pickColors(candidates, count - image.palette.length, image.palette);
    image.palette.push(...extra.map(toSwatch));
  }

  async function runForImages(images, handler, label) {
    if (working || !images.length) return;
    working = true;
    dom.recalculate.disabled = true;
    dom.sort.disabled = true;
    try {
      for (let i = 0; i < images.length; i += 1) {
        dom.stat.textContent = `${label} ${i + 1}/${images.length}`;
        await handler(images[i]);
        renderGrid();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      saveState();
    } catch (error) {
      console.error(error);
      toast(`取色失败：${error.message || error}`, 'bad');
    } finally {
      working = false;
      dom.recalculate.disabled = false;
      dom.sort.disabled = false;
      renderAll();
      if (countApplyQueued) {
        countApplyQueued = false;
        applyColorCount();
      }
    }
  }

  function hasManualEdits() {
    return state.images.some((image) => image.palette.some((color) => color.source && color.source !== 'auto'));
  }

  function extractMissing() {
    return runForImages(state.images.filter((image) => !image.palette.length), extractForImage, '正在取色');
  }

  function extractAll() {
    if (hasManualEdits() && !confirm('重新取色会覆盖手动调整过的颜色，是否继续？')) return Promise.resolve();
    return runForImages(state.images, extractForImage, '正在重新取色');
  }

  function applyColorCount() {
    const count = state.settings.colorCount;
    return runForImages(
      state.images.filter((image) => image.palette.length !== count),
      resizeForImage,
      '正在调整取色数量',
    );
  }

  async function filesFromZip(file) {
    if (!window.JSZip) throw new Error('ZIP 组件未加载');
    const zip = await JSZip.loadAsync(file);
    const result = [];
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !IMAGE_RE.test(entry.name)) continue;
      const blob = await entry.async('blob');
      result.push({ file: new File([blob], basename(entry.name), { type: blob.type || 'image/*' }), path: entry.name });
    }
    return result;
  }

  async function ingest(items, target) {
    const valid = items.filter((item) => IMAGE_RE.test(item.file.name || item.path));
    if (!valid.length) return toast('没有找到可用图片', 'bad');
    for (const item of valid) {
      const prefix = target === 'reference' ? 'ref' : 'val';
      const id = uid(prefix);
      const fileKey = `${prefix}:${id}`;
      await dbSet(fileKey, item.file);
      const record = {
        id, fileKey, name: item.file.name,
        path: item.path || item.file.webkitRelativePath || item.file.name,
      };
      if (target === 'reference') {
        state.images.push({
          ...record, palette: [], note: '',
          review: { verdicts: {}, scores: {}, issues: [], note: '', manualOverall: 'auto', matchId: '' },
        });
      } else {
        state.validations.push(record);
      }
    }
    if (target === 'validation') state.stage = 'review';
    saveState();
    closeModal(dom.importModal);
    renderAll();
    if (target === 'reference') await extractMissing();
    else toast(`已导入 ${valid.length} 张验证图`);
  }

  function buildPairs() {
    const pairs = new Map();
    const used = new Set();
    state.images.forEach((image) => {
      if (!image.review.matchId) return;
      const validation = state.validations.find((item) => item.id === image.review.matchId);
      if (!validation || used.has(validation.id)) return;
      pairs.set(image.id, { validation, mode: 'manual' });
      used.add(validation.id);
    });
    const candidates = [];
    state.images.forEach((image) => {
      if (pairs.has(image.id)) return;
      state.validations.forEach((validation) => {
        if (used.has(validation.id)) return;
        const score = matchScore(image, validation);
        if (score > 0) candidates.push({ image, validation, score });
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    candidates.forEach(({ image, validation, score }) => {
      if (pairs.has(image.id) || used.has(validation.id)) return;
      pairs.set(image.id, { validation, mode: score >= 900 ? 'name' : 'similar' });
      used.add(validation.id);
    });
    const rest = state.validations.filter((item) => !used.has(item.id));
    let cursor = 0;
    state.images.forEach((image) => {
      if (pairs.has(image.id) || cursor >= rest.length) return;
      pairs.set(image.id, { validation: rest[cursor], mode: 'order' });
      cursor += 1;
    });
    return pairs;
  }

  function reviewSnapshot(image) {
    const snapshot = { total: image.palette.length, pass: 0, fail: 0, optimize: 0, pending: 0 };
    image.palette.forEach((color) => {
      if (state.settings.scoreMode) {
        const score = Number(image.review.scores[color.id]);
        if (!Number.isFinite(score)) snapshot.pending += 1;
        else if (score >= PASS_SCORE) snapshot.pass += 1;
        else snapshot.fail += 1;
        return;
      }
      const status = image.review.verdicts[color.id] || 'pending';
      if (status === 'pass') snapshot.pass += 1;
      else if (status === 'fail') snapshot.fail += 1;
      else if (status === 'optimize') snapshot.optimize += 1;
      else snapshot.pending += 1;
    });
    return snapshot;
  }

  // 未判定的颜色视为验证集没取到，不影响“是否验收过”，只影响合格率。
  function judgedCount(snapshot) {
    return snapshot.pass + snapshot.fail + snapshot.optimize;
  }

  function hasAnyMark(image) {
    return judgedCount(reviewSnapshot(image)) > 0
      || image.review.issues.length > 0
      || Boolean(image.review.note.trim())
      || image.review.manualOverall !== 'auto';
  }

  function aggregateOverall(image) {
    const manual = image.review.manualOverall;
    if (manual && manual !== 'auto') return manual;
    const snapshot = reviewSnapshot(image);
    if (!snapshot.total || !judgedCount(snapshot)) return 'pending';
    const threshold = Math.min(state.settings.passThreshold, snapshot.total);
    return snapshot.pass >= threshold ? 'pass' : 'fail';
  }

  function matchesFilter(image, pairs) {
    const filter = state.reviewFilter;
    if (!filter) return true;
    const snapshot = reviewSnapshot(image);
    switch (filter) {
      case 'allPass': return snapshot.total > 0 && snapshot.pass === snapshot.total;
      case 'allFail': return snapshot.total > 0 && snapshot.fail === snapshot.total;
      case 'partial': return snapshot.pass > 0 && snapshot.pass < snapshot.total;
      case 'optimize': return snapshot.optimize > 0;
      case 'missing': return snapshot.pending > 0;
      case 'pending': return !hasAnyMark(image);
      case 'imagePass': return aggregateOverall(image) === 'pass';
      case 'imageFail': return aggregateOverall(image) === 'fail';
      case 'hasIssue': return image.review.issues.length > 0;
      case 'hasNote': return Boolean(image.note.trim() || image.review.note.trim());
      case 'unmatched': return !pairs.get(image.id);
      default: return true;
    }
  }

  function filteredImages(pairs) {
    const query = dom.search.value.trim().toLowerCase();
    return state.images.filter((image) => {
      if (query && !image.name.toLowerCase().includes(query)) return false;
      if (state.stage !== 'review') return true;
      return matchesFilter(image, pairs || buildPairs());
    });
  }

  // 当前图片被筛选条件排除后仍继续停留，避免打标后自动跳到下一张。
  function reviewContext() {
    const pairs = buildPairs();
    const images = filteredImages(pairs);
    let index = images.findIndex((image) => image.id === currentId);
    let image = index >= 0 ? images[index] : state.images.find((item) => item.id === currentId) || null;
    if (!image) {
      index = Math.max(0, Math.min(currentIndex, images.length - 1));
      image = images[index] || null;
    }
    if (index >= 0) currentIndex = index;
    currentId = image?.id || null;
    return { pairs, images, image, index };
  }

  function currentImage() {
    return reviewContext().image;
  }

  function renderGrid() {
    if (state.stage !== 'extract') return;
    dom.grid.innerHTML = '';
    filteredImages().forEach((image) => {
      const card = document.createElement('button');
      card.className = 'colorCard';
      card.type = 'button';
      card.dataset.id = image.id;
      card.innerHTML = `
        <span class="colorCardMedia"><span class="colorLoading">加载中</span></span>
        <span class="colorCardBody">
          <span class="colorCardName">${escapeHtml(image.name)}</span>
          <span class="colorPalette">${image.palette.map((color) => `<i style="--swatch:${color.hex}" title="${color.hex}"></i>`).join('')}</span>
          <span class="colorCardMeta">${image.palette.length} 色${image.note ? ' · 有备注' : ''}</span>
        </span>`;
      dom.grid.appendChild(card);
      objectUrl(image.fileKey).then((url) => {
        const media = card.querySelector('.colorCardMedia');
        if (media && url) media.innerHTML = `<img src="${url}" alt="" />`;
      });
    });
  }

  function renderIssueRow(image) {
    const chips = state.issueTags.map((tag) => `
      <button class="taxonomyIssueChip" data-action="issue" data-tag="${escapeHtml(tag)}" data-active="${image.review.issues.includes(tag) ? 1 : 0}">${escapeHtml(tag)}</button>
    `).join('');
    return `<div class="colorIssueRow">
      <span>问题：</span>${chips}
      <button class="taxonomyIssueChip taxonomyIssueChip--add" data-action="add-issue">+问题标签</button>
    </div>`;
  }

  async function renderReview() {
    if (state.stage !== 'review') return;
    const { pairs, images, image, index } = reviewContext();
    if (!image) {
      dom.review.innerHTML = '<div class="colorReviewEmpty">当前筛选条件下没有图片</div>';
      dom.position.textContent = `第 0 / ${images.length} 张`;
      return;
    }
    const pair = pairs.get(image.id);
    const overall = aggregateOverall(image);
    const referenceUrl = await objectUrl(image.fileKey);
    const validationUrl = pair ? await objectUrl(pair.validation.fileKey) : '';
    const scoreMode = state.settings.scoreMode;
    dom.review.innerHTML = `
      <div class="colorCompare">
        <section class="colorCompareCell">
          <div class="colorCompareHead">对比图 <strong>${escapeHtml(image.name)}</strong></div>
          <div class="colorCompareMedia"><img src="${referenceUrl}" alt="" /></div>
        </section>
        <section class="colorCompareCell">
          <div class="colorCompareHead">
            验证图 <strong>${pair ? escapeHtml(pair.validation.name) : '未匹配'}</strong>
            ${pair ? `<span class="colorMatchTag" data-mode="${pair.mode}">${MATCH_TEXT[pair.mode]}</span>` : ''}
            <span class="colorMatchControls">
              <button class="colorMiniBtn" data-action="match-shift-prev" title="与上一张交换验证图">↑</button>
              <button class="colorMiniBtn" data-action="match-shift-next" title="与下一张交换验证图">↓</button>
              <button class="colorMiniBtn" data-action="match-pick">更换</button>
            </span>
          </div>
          <div class="colorCompareMedia">${validationUrl ? `<img src="${validationUrl}" alt="" />` : '<span>未匹配到验证图</span>'}</div>
        </section>
        <section class="colorReviewPanel">
          <div class="colorReviewSummary">
            <strong>颜色判定</strong>
            <button class="colorOverall" data-action="overall" data-status="${overall}" title="点击切换：自动 / 合格 / 不合格">
              图片：${OVERALL_TEXT[overall]}${image.review.manualOverall === 'auto' ? '' : '（手动）'}
            </button>
            <span class="colorReviewHint">${scoreMode ? `${PASS_SCORE} 分及以上计为通过色` : '点击色块循环：合格 → 不合格 → 待优化 → 未取到'}</span>
          </div>
          <div class="colorVerdictList">
            ${image.palette.map((color, index) => {
              const status = image.review.verdicts[color.id] || 'pending';
              const score = image.review.scores[color.id];
              return `<div class="colorVerdict" data-status="${status}" data-color-id="${color.id}">
                <button class="colorVerdictSwatch" data-action="cycle" style="--swatch:${color.hex}" title="点击切换状态"></button>
                <span class="colorVerdictIndex">${index + 1}</span>
                <code>${color.hex}</code>
                ${scoreMode
                  ? `<input class="textInput colorScore" data-action="score" type="number" min="0" max="100" value="${score ?? ''}" placeholder="0-100" /><span>分</span>`
                  : `<span class="colorVerdictText">${STATUS_TEXT[status]}</span>`}
              </div>`;
            }).join('')}
            <div class="colorBulkActions">
              <button class="colorBulkBtn colorBulkBtn--ok" data-action="all-pass" title="全部通过">✓</button>
              <button class="colorBulkBtn colorBulkBtn--bad" data-action="all-fail" title="全部不通过">✗</button>
            </div>
          </div>
          ${renderIssueRow(image)}
          <textarea class="textInput colorReviewNote" data-action="note" placeholder="验证备注">${escapeHtml(image.review.note)}</textarea>
        </section>
      </div>`;
    dom.position.textContent = index >= 0
      ? `第 ${index + 1} / ${images.length} 张`
      : `筛选外 · 共 ${images.length} 张`;
  }

  function refreshOverallBadge(image) {
    const badge = dom.review.querySelector('.colorOverall');
    if (!badge) return;
    const overall = aggregateOverall(image);
    badge.dataset.status = overall;
    badge.textContent = `图片：${OVERALL_TEXT[overall]}${image.review.manualOverall === 'auto' ? '' : '（手动）'}`;
  }

  function renderStats() {
    if (state.stage === 'extract') {
      const ready = state.images.filter((image) => image.palette.length).length;
      dom.stat.textContent = `已取色 ${ready}/${state.images.length}`;
      return;
    }
    let total = 0, pass = 0, scored = 0, scoreSum = 0, imagesPass = 0;
    state.images.forEach((image) => {
      const snapshot = reviewSnapshot(image);
      total += snapshot.total;
      pass += snapshot.pass;
      image.palette.forEach((color) => {
        const score = Number(image.review.scores[color.id]);
        if (Number.isFinite(score)) { scored += 1; scoreSum += score; }
      });
      if (aggregateOverall(image) === 'pass') imagesPass += 1;
    });
    const rate = total ? (pass / total * 100).toFixed(1) : '0.0';
    dom.stat.textContent = state.settings.scoreMode
      ? `平均分 ${scored ? (scoreSum / scored).toFixed(1) : '0.0'} · 通过色 ${rate}% · 图片合格 ${imagesPass}/${state.images.length}`
      : `颜色合格率 ${rate}% · 图片合格 ${imagesPass}/${state.images.length}`;
  }

  function renderAll() {
    const review = state.stage === 'review';
    dom.stageExtract.classList.toggle('chip--active', !review);
    dom.stageReview.classList.toggle('chip--active', review);
    dom.grid.hidden = review;
    dom.review.hidden = !review;
    dom.reviewSettings.hidden = !review;
    dom.recalculate.hidden = review;
    dom.countSetting.hidden = review;
    dom.sortSetting.hidden = review;
    dom.empty.hidden = state.images.length > 0;
    dom.importValidation.hidden = !state.images.length;
    dom.count.value = String(state.settings.colorCount);
    dom.sort.value = state.settings.sort;
    dom.filter.value = state.reviewFilter;
    dom.judgeMode.value = state.settings.scoreMode ? 'score' : 'verdict';
    dom.threshold.max = String(Math.max(1, state.settings.colorCount));
    dom.threshold.value = String(state.settings.passThreshold);
    renderStats();
    if (review) renderReview(); else renderGrid();
    if (!state.images.length) dom.position.textContent = '第 0 / 0 张';
  }

  async function openDetail(id) {
    const image = state.images.find((item) => item.id === id);
    if (!image) return;
    editingId = id;
    selectedSwatchId = image.palette[0]?.id || null;
    dom.detailTitle.textContent = image.name;
    dom.referenceNote.value = image.note || '';
    openModal(dom.detailModal);
    await drawDetailImage(image);
    renderPaletteEditor();
  }

  async function drawDetailImage(image) {
    const blob = await dbGet(image.fileKey);
    if (!blob) return;
    const bitmap = await blobToBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    dom.canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    dom.canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    dom.canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, dom.canvas.width, dom.canvas.height);
    if (bitmap.close) bitmap.close();
    updatePickerPin();
  }

  function editingImage() {
    return state.images.find((item) => item.id === editingId);
  }

  function renderPaletteEditor() {
    const image = editingImage();
    if (!image) return;
    dom.paletteEditor.innerHTML = image.palette.map((color, index) => `
      <div class="colorEditorRow ${selectedSwatchId === color.id ? 'colorEditorRow--selected' : ''}" draggable="true" data-id="${color.id}">
        <button class="colorEditorSwatch" data-action="select-swatch" style="--swatch:${color.hex}"></button>
        <span>${index + 1}</span>
        <input class="textInput colorHexInput" data-action="hex" value="${color.hex}" maxlength="7" />
        <button class="iconBtn" data-action="remove-swatch" title="删除">×</button>
      </div>`).join('');
    updatePickerPin();
  }

  function updatePickerPin() {
    const image = editingImage();
    const color = image?.palette.find((item) => item.id === selectedSwatchId);
    if (!color) { dom.pickerPin.hidden = true; return; }
    dom.pickerPin.hidden = false;
    dom.pickerPin.style.left = `${dom.canvas.offsetLeft + color.x * dom.canvas.offsetWidth}px`;
    dom.pickerPin.style.top = `${dom.canvas.offsetTop + color.y * dom.canvas.offsetHeight}px`;
    dom.pickerPin.style.setProperty('--swatch', color.hex);
  }

  function sampleCanvasAt(clientX, clientY) {
    const image = editingImage();
    const color = image?.palette.find((item) => item.id === selectedSwatchId);
    if (!image || !color) return;
    const rect = dom.canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const x = Math.round(xNorm * (dom.canvas.width - 1));
    const y = Math.round(yNorm * (dom.canvas.height - 1));
    const sx = Math.max(0, x - 2), sy = Math.max(0, y - 2);
    const width = Math.min(5, dom.canvas.width - sx), height = Math.min(5, dom.canvas.height - sy);
    const data = dom.canvas.getContext('2d').getImageData(sx, sy, width, height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 100) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
    }
    if (!n) return;
    Object.assign(color, { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), x: xNorm, y: yNorm, source: 'picker' });
    color.hex = rgbToHex(color.r, color.g, color.b);
    saveState();
    renderPaletteEditor();
  }

  function setStage(stage) {
    if (stage === 'review' && !state.images.length) return toast('请先导入对比图');
    state.stage = stage;
    currentIndex = 0;
    currentId = null;
    saveState();
    renderAll();
  }

  function cycleVerdict(image, colorId) {
    const current = image.review.verdicts[colorId] || 'pending';
    image.review.verdicts[colorId] = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
  }

  function cycleOverall(image) {
    const order = ['auto', 'pass', 'fail'];
    const current = order.includes(image.review.manualOverall) ? image.review.manualOverall : 'auto';
    image.review.manualOverall = order[(order.indexOf(current) + 1) % order.length];
  }

  function applyManualMatch(image, validationId) {
    if (!validationId) {
      image.review.matchId = '';
      return;
    }
    const pairs = buildPairs();
    const previous = pairs.get(image.id)?.validation.id || '';
    const owner = state.images.find((item) => item.id !== image.id && pairs.get(item.id)?.validation.id === validationId);
    if (owner) owner.review.matchId = previous;
    image.review.matchId = validationId;
  }

  function shiftMatch(delta) {
    const { images, image, index } = reviewContext();
    const neighbor = index >= 0 ? images[index + delta] : null;
    if (!image || !neighbor) return toast('没有可交换的相邻图片');
    const pairs = buildPairs();
    const current = pairs.get(image.id)?.validation.id || '';
    const other = pairs.get(neighbor.id)?.validation.id || '';
    image.review.matchId = other;
    neighbor.review.matchId = current;
    saveState();
    renderAll();
  }

  async function openMatchPicker() {
    const image = currentImage();
    if (!image) return;
    if (!state.validations.length) return toast('请先导入验证集');
    const pairs = buildPairs();
    const currentValidationId = pairs.get(image.id)?.validation.id || '';
    dom.matchTitle.textContent = `为「${image.name}」选择验证图`;
    dom.matchList.innerHTML = '';
    const rows = [{ id: '', name: '自动匹配', meta: '先同名，再相似名称（如多出后缀），剩余按顺序对齐' }].concat(
      state.validations.map((validation) => {
        const owner = state.images.find((item) => item.id !== image.id
          && pairs.get(item.id)?.validation.id === validation.id);
        return {
          id: validation.id, fileKey: validation.fileKey, name: validation.name,
          meta: owner ? `当前属于「${owner.name}」，选择后互换` : validation.path,
        };
      }),
    );
    rows.forEach((row) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'taxonomyMatchRow';
      node.dataset.matchId = row.id;
      node.innerHTML = `
        <span class="taxonomyMatchRow__thumb">${row.fileKey ? '<span class="taxonomyMatchRow__missing">…</span>' : '自动'}</span>
        <span class="taxonomyMatchRow__text">
          <span class="taxonomyMatchRow__name">${escapeHtml(row.name)}${row.id === currentValidationId ? '（当前）' : ''}</span>
          <span class="taxonomyMatchRow__meta">${escapeHtml(row.meta)}</span>
        </span>`;
      dom.matchList.appendChild(node);
      if (row.fileKey) {
        objectUrl(row.fileKey).then((url) => {
          const thumb = node.querySelector('.taxonomyMatchRow__thumb');
          if (thumb && url) thumb.innerHTML = `<img src="${url}" alt="" />`;
        });
      }
    });
    openModal(dom.matchModal);
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPayload() {
    const pairs = buildPairs();
    let total = 0, pass = 0, scored = 0, scoreSum = 0, imagesPass = 0;
    state.images.forEach((image) => {
      const snapshot = reviewSnapshot(image);
      total += snapshot.total;
      pass += snapshot.pass;
      image.palette.forEach((color) => {
        const score = Number(image.review.scores[color.id]);
        if (Number.isFinite(score)) { scored += 1; scoreSum += score; }
      });
      if (aggregateOverall(image) === 'pass') imagesPass += 1;
    });
    return {
      type: 'color-judgment-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      summary: {
        referenceImages: state.images.length,
        validationImages: state.validations.length,
        totalColors: total,
        passedColors: pass,
        colorPassRate: total ? pass / total : 0,
        averageScore: scored ? scoreSum / scored : null,
        passedImages: imagesPass,
      },
      issueTags: state.issueTags,
      images: state.images.map((image) => {
        const pair = pairs.get(image.id);
        return {
          name: image.name, path: image.path, note: image.note,
          validation: pair?.validation.path || null,
          matchMode: pair?.mode || null,
          palette: image.palette.map((color) => ({
            ...color,
            verdict: image.review.verdicts[color.id] || 'pending',
            score: Number.isFinite(Number(image.review.scores[color.id])) ? Number(image.review.scores[color.id]) : null,
          })),
          overall: aggregateOverall(image),
          manualOverall: image.review.manualOverall,
          issues: image.review.issues,
          reviewNote: image.review.note,
        };
      }),
    };
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const pairs = buildPairs();
    const rows = [['对比图', '验证图', '匹配方式', '颜色序号', 'HEX', '判定', '分数', '图片结论', '问题标签', '对比备注', '验收备注']];
    state.images.forEach((image) => {
      const pair = pairs.get(image.id);
      image.palette.forEach((color, index) => rows.push([
        image.path, pair?.validation.path || '', pair ? MATCH_TEXT[pair.mode] : '未匹配',
        index + 1, color.hex,
        STATUS_TEXT[image.review.verdicts[color.id] || 'pending'],
        image.review.scores[color.id] ?? '', OVERALL_TEXT[aggregateOverall(image)],
        image.review.issues.join('|'), image.note, image.review.note,
      ]));
    });
    download(`取色判定_${Date.now()}.csv`, `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
  }

  function updateApiButton() {
    const ready = LLM.isConfigured(LLM.load());
    dom.api.dataset.configured = ready ? '1' : '';
    dom.api.title = ready ? 'API 已配置（所有模式共用）' : '配置 LLM API';
  }

  function setupLlm() {
    apiDialog = LLM.createApiDialog({
      toast: (title, message) => toast(`${title}：${message}`),
      onChange: updateApiButton,
    });
    dom.api.addEventListener('click', () => apiDialog.open());
    LLM.createExportPanel({
      mount: dom.aiMount,
      dialog: apiDialog,
      toast: (title, message) => toast(`${title}：${message}`, 'bad'),
      hasData: () => state.images.length > 0,
      fileName: () => `取色判定AI结论_${new Date().toISOString().slice(0, 10)}.txt`,
      contexts: [
        {
          value: 'summary',
          label: '统计摘要',
          build: () => {
            const { images: _images, ...summary } = exportPayload();
            return summary;
          },
        },
        { value: 'full', label: '完整明细', build: exportPayload },
      ],
    });
    updateApiButton();
  }

  function addIssueTag(value) {
    const tag = String(value || '').trim();
    if (!tag) return false;
    if (state.issueTags.includes(tag)) {
      toast('该问题标签已存在');
      return false;
    }
    state.issueTags.push(tag);
    saveState();
    return true;
  }

  function renderIssueManager() {
    dom.issueManager.innerHTML = state.issueTags.map((tag) => `
      <div class="taxonomyTagRow"><span class="taxonomyTagRow__name">${escapeHtml(tag)}</span><button class="btn" data-remove-issue="${escapeHtml(tag)}">删除</button></div>
    `).join('') || '<p class="colorHint">暂无问题标签，先在下方添加</p>';
  }

  function bindEvents() {
    dom.stageExtract.addEventListener('click', () => setStage('extract'));
    dom.stageReview.addEventListener('click', () => setStage('review'));
    [dom.import, dom.emptyImport].forEach((button) => button.addEventListener('click', () => {
      importTarget = 'reference'; dom.importTitle.textContent = '导入对比图'; openModal(dom.importModal);
    }));
    dom.importValidation.addEventListener('click', () => {
      importTarget = 'validation'; dom.importTitle.textContent = '导入验证集'; openModal(dom.importModal);
    });
    dom.chooseFolder.addEventListener('click', () => (importTarget === 'reference' ? dom.folderInput : dom.validationFolderInput).click());
    dom.chooseZip.addEventListener('click', () => (importTarget === 'reference' ? dom.zipInput : dom.validationZipInput).click());
    const handleFolder = (target) => async (event) => {
      const items = Array.from(event.target.files).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
      event.target.value = '';
      await ingest(items, target);
    };
    dom.folderInput.addEventListener('change', handleFolder('reference'));
    dom.validationFolderInput.addEventListener('change', handleFolder('validation'));
    const handleZip = (target) => async (event) => {
      const file = event.target.files[0]; event.target.value = '';
      if (!file) return;
      try { await ingest(await filesFromZip(file), target); } catch (error) { toast(error.message, 'bad'); }
    };
    dom.zipInput.addEventListener('change', handleZip('reference'));
    dom.validationZipInput.addEventListener('change', handleZip('validation'));
    dom.search.addEventListener('input', renderAll);

    let countTimer;
    dom.count.addEventListener('input', () => {
      if (state.stage === 'review') return;
      clearTimeout(countTimer);
      const value = Math.max(1, Math.min(20, Number(dom.count.value) || 1));
      state.settings.colorCount = value;
      state.settings.passThreshold = Math.min(state.settings.passThreshold, value);
      saveState();
      countTimer = setTimeout(() => {
        if (working) countApplyQueued = true;
        else applyColorCount();
      }, 350);
    });
    dom.sort.addEventListener('change', async () => {
      if (state.stage === 'review') return;
      const value = dom.sort.value;
      if (hasManualEdits() && !confirm('调整排序权重会重新取色并覆盖手动修改，是否继续？')) {
        dom.sort.value = state.settings.sort;
        return;
      }
      state.settings.sort = value;
      saveState();
      await runForImages(state.images, extractForImage, '正在重新取色');
    });
    dom.recalculate.addEventListener('click', extractAll);
    dom.filter.addEventListener('change', () => {
      state.reviewFilter = dom.filter.value;
      currentIndex = 0;
      currentId = null;
      saveState();
      renderAll();
    });
    dom.judgeMode.addEventListener('change', () => {
      state.settings.scoreMode = dom.judgeMode.value === 'score';
      saveState();
      renderAll();
    });
    dom.threshold.addEventListener('change', () => {
      state.settings.passThreshold = Math.max(1, Math.min(state.settings.colorCount, Number(dom.threshold.value) || 1));
      saveState(); renderAll();
    });

    dom.grid.addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (card) openDetail(card.dataset.id);
    });
    dom.detailClose.addEventListener('click', () => closeModal(dom.detailModal));
    dom.referenceNote.addEventListener('input', () => {
      const image = editingImage(); if (!image) return;
      image.note = dom.referenceNote.value; saveState();
    });
    dom.paletteEditor.addEventListener('click', (event) => {
      const row = event.target.closest('[data-id]');
      const image = editingImage();
      if (!row || !image) return;
      const action = event.target.dataset.action;
      if (action === 'select-swatch') selectedSwatchId = row.dataset.id;
      if (action === 'remove-swatch') {
        image.palette = image.palette.filter((color) => color.id !== row.dataset.id);
        dropSwatchData(image, row.dataset.id);
        if (selectedSwatchId === row.dataset.id) selectedSwatchId = image.palette[0]?.id || null;
        saveState();
      }
      renderPaletteEditor();
    });
    dom.paletteEditor.addEventListener('change', (event) => {
      if (event.target.dataset.action !== 'hex') return;
      const row = event.target.closest('[data-id]');
      const image = editingImage();
      const color = image?.palette.find((item) => item.id === row?.dataset.id);
      const value = event.target.value.trim().toUpperCase();
      if (!color || !/^#[0-9A-F]{6}$/.test(value)) return toast('请输入 #RRGGBB 格式', 'bad');
      color.hex = value;
      color.r = parseInt(value.slice(1, 3), 16);
      color.g = parseInt(value.slice(3, 5), 16);
      color.b = parseInt(value.slice(5, 7), 16);
      color.source = 'manual'; saveState(); renderPaletteEditor();
    });
    let draggedId = null;
    dom.paletteEditor.addEventListener('dragstart', (event) => { draggedId = event.target.closest('[data-id]')?.dataset.id || null; });
    dom.paletteEditor.addEventListener('dragover', (event) => event.preventDefault());
    dom.paletteEditor.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetId = event.target.closest('[data-id]')?.dataset.id;
      const image = editingImage();
      if (!draggedId || !targetId || draggedId === targetId || !image) return;
      const from = image.palette.findIndex((color) => color.id === draggedId);
      const to = image.palette.findIndex((color) => color.id === targetId);
      image.palette.splice(to, 0, image.palette.splice(from, 1)[0]);
      image.palette.forEach((color) => { if (color.source === 'auto') color.source = 'reordered'; });
      saveState(); renderPaletteEditor();
    });
    dom.addSwatch.addEventListener('click', () => {
      const image = editingImage(); if (!image) return;
      const id = uid('color');
      image.palette.push({ id, hex: '#808080', r: 128, g: 128, b: 128, x: .5, y: .5, source: 'manual' });
      selectedSwatchId = id; saveState(); renderPaletteEditor();
    });
    let picking = false;
    dom.canvas.addEventListener('pointerdown', (event) => {
      picking = true;
      dom.canvas.setPointerCapture(event.pointerId);
      sampleCanvasAt(event.clientX, event.clientY);
    });
    dom.canvas.addEventListener('pointermove', (event) => { if (picking) sampleCanvasAt(event.clientX, event.clientY); });
    dom.canvas.addEventListener('pointerup', () => { picking = false; renderGrid(); });

    dom.review.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      if (!action || action === 'note' || action === 'score') return;
      if (action === 'match-pick') return openMatchPicker();
      if (action === 'match-shift-prev') return shiftMatch(-1);
      if (action === 'match-shift-next') return shiftMatch(1);
      const image = currentImage();
      if (!image) return;
      if (action === 'cycle') cycleVerdict(image, event.target.closest('[data-color-id]').dataset.colorId);
      if (action === 'all-pass' || action === 'all-fail') {
        const target = action === 'all-pass' ? 'pass' : 'fail';
        image.palette.forEach((color) => {
          image.review.verdicts[color.id] = target;
          if (state.settings.scoreMode) image.review.scores[color.id] = target === 'pass' ? 100 : 0;
        });
      }
      if (action === 'overall') cycleOverall(image);
      if (action === 'add-issue') {
        if (!addIssueTag(window.prompt('新增问题标签'))) return renderAll();
      }
      if (action === 'issue') {
        const tag = event.target.dataset.tag;
        image.review.issues = image.review.issues.includes(tag)
          ? image.review.issues.filter((item) => item !== tag)
          : [...image.review.issues, tag];
      }
      saveState(); renderAll();
    });
    dom.review.addEventListener('change', (event) => {
      if (event.target.dataset.action !== 'score') return;
      const image = currentImage(); if (!image) return;
      const id = event.target.closest('[data-color-id]').dataset.colorId;
      const raw = event.target.value.trim();
      if (!raw) delete image.review.scores[id];
      else image.review.scores[id] = Math.max(0, Math.min(100, Number(raw) || 0));
      saveState(); renderStats(); refreshOverallBadge(image);
    });
    dom.review.addEventListener('input', (event) => {
      if (event.target.dataset.action !== 'note') return;
      const image = currentImage(); if (!image) return;
      image.review.note = event.target.value; saveState();
    });
    dom.matchList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-match-id]');
      if (!row) return;
      const image = currentImage();
      if (!image) return;
      applyManualMatch(image, row.dataset.matchId);
      saveState();
      closeModal(dom.matchModal);
      renderAll();
    });

    const move = (delta) => {
      const { images, index } = reviewContext();
      const length = images.length;
      if (!length) return;
      let target;
      if (index >= 0) {
        target = (index + delta + length) % length;
      } else {
        // 当前图片已被筛选排除，它原本的位置现在是下一张。
        const slot = Math.max(0, Math.min(currentIndex, length - 1));
        target = delta > 0 ? slot : (slot - 1 + length) % length;
      }
      currentIndex = target;
      currentId = images[target].id;
      renderReview();
    };
    dom.prev.addEventListener('click', () => move(-1));
    dom.next.addEventListener('click', () => move(1));
    dom.manageIssues.addEventListener('click', () => { renderIssueManager(); openModal(dom.issuesModal); });
    dom.addIssue.addEventListener('click', () => {
      if (!addIssueTag(dom.newIssue.value)) return;
      dom.newIssue.value = '';
      renderIssueManager();
      renderAll();
    });
    dom.issueManager.addEventListener('click', (event) => {
      const tag = event.target.dataset.removeIssue; if (!tag) return;
      state.issueTags = state.issueTags.filter((item) => item !== tag);
      state.images.forEach((image) => { image.review.issues = image.review.issues.filter((item) => item !== tag); });
      saveState(); renderIssueManager(); renderAll();
    });
    dom.export.addEventListener('click', () => openModal(dom.exportModal));
    dom.exportJson.addEventListener('click', () => download(`取色判定_${Date.now()}.json`, JSON.stringify(exportPayload(), null, 2), 'application/json'));
    dom.exportCsv.addEventListener('click', exportCsv);
    dom.clear.addEventListener('click', async () => {
      if (!confirm('确定清空取色判定的全部图片和结果吗？')) return;
      releaseUrls(); await dbClear();
      state = defaultState(); currentIndex = 0; currentId = null;
      saveState(); renderAll();
    });
    document.addEventListener('click', (event) => {
      const closeId = event.target.dataset.closeModal;
      if (closeId) closeModal($(closeId));
      if (event.target.matches('.modal__backdrop[data-close="1"]')) closeModal(event.target.parentElement);
    });
    document.addEventListener('keydown', (event) => {
      if (state.stage !== 'review' || event.target.matches('input,textarea,select')) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
    });
  }

  function boot() {
    try {
      const saved = localStorage.getItem(STATE_KEY);
      if (saved) state = normalizeState(JSON.parse(saved));
    } catch (error) {
      console.warn('无法恢复取色项目', error);
    }
    dom.filter.innerHTML = FILTER_OPTIONS
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join('');
    setupLlm();
    bindEvents();
    renderAll();
  }

  window.addEventListener('beforeunload', releaseUrls);
  boot();
})();

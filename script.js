/* global JSZip */

const DB_NAME = 'imageLabelingDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

const LS_KEYS = {
  fileInfo: 'imageLabeling_fileInfo',
  // legacy: single-dimension statuses
  sequenceStatus: 'imageLabeling_sequenceStatus',
  // v2: multi-dimension statuses
  sequenceStatusByDim: 'imageLabeling_sequenceStatusByDim',
  dimensions: 'imageLabeling_dimensions',
  currentDimId: 'imageLabeling_currentDimId',
  currentIndex: 'imageLabeling_currentIndex',
  referenceSequences: 'imageLabeling_referenceSequences',
  hoveredSequenceIndex: 'imageLabeling_hoveredSequenceIndex',
  collapsedSequences: 'imageLabeling_collapsedSequences',
  previewSize: 'imageLabeling_previewSize',
  version: 'imageLabeling_backupVersion',
};

const BACKUP_VERSION = '1.1-seq-dims';

const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
]);

/** @type {{ sequences: Array<{ folderName: string, files: File[] }> }} */
let folders = { sequences: [] };

/**
 * imageData item:
 * { nameKey, displayName, sequences: [{ folderName, file: File|null, isReference: boolean }] }
 * @type {Array<any>}
 */
let imageData = [];

/** @typedef {{ id: string, name: string, desc: string }} Dimension */

/**
 * sequenceStatusByDim:
 * { [dimId]: { [nameKey]: { [sequenceIndex]: 'approved'|'rejected'|'needs_optimization'|'pending' } } }
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
let sequenceStatusByDim = {};

/** @type {Dimension[]} */
let dimensions = [{ id: 'default', name: '无维度', desc: '' }];

/** @type {string} */
let currentDimId = 'default';

let currentIndex = 0;
let referenceSequences = new Set(); // seqIdx
let collapsedSequences = new Set(); // seqIdx
let hoveredSequenceIndex = null;
let lastHoveredSequenceIndex = null;

const COLLAPSED_COL_WIDTH = '44px';

// --------- DOM ----------
const $ = (id) => document.getElementById(id);

const inputFolder = $('inputFolder');
const inputZip = $('inputZip');
const btnPrev = $('btnPrev');
const btnNext = $('btnNext');
const btnNextPending = $('btnNextPending');
const btnClearAll = $('btnClearAll');
const sequenceList = $('sequenceList');
const grid = $('grid');
const currentTitle = $('currentTitle');
const overallPill = $('overallPill');
const viewerHeadSingle = $('viewerHeadSingle');
const viewerHeadMulti = $('viewerHeadMulti');
const footCenter = $('footCenter');

let dragSeqIdx = null;

const statsSingle = $('statsSingle');
const statsMulti = $('statsMulti');
const statPassRate = $('statPassRate');
const statReviewed = $('statReviewed');
const statReviewedMulti = $('statReviewedMulti');
const viewerFoot = $('viewerFoot');

const btnImport = $('btnImport');
const btnExport = $('btnExport');

const btnMarkApproved = $('btnMarkApproved');
const btnMarkNeedsOpt = $('btnMarkNeedsOpt');
const btnMarkRejected = $('btnMarkRejected');
const btnClearMark = $('btnClearMark');

const btnExportApproved = $('btnExportApproved');
const btnExportRejected = $('btnExportRejected');
const btnExportNeedsOpt = $('btnExportNeedsOpt');
const btnExportAll = $('btnExportAll');
const btnExportBackup = $('btnExportBackup');
const inputImportBackup = $('inputImportBackup');
const exportSeqRow = $('exportSeqRow');
const exportSeqSelect = $('exportSeqSelect');
const btnExportSeqApproved = $('btnExportSeqApproved');
const btnExportSeqRejected = $('btnExportSeqRejected');

const exportModal = $('exportModal');
const btnCloseExportModal = $('btnCloseExportModal');
const dimensionModal = $('dimensionModal');

const restoreBar = $('restoreBar');
const restoreText = $('restoreText');
const btnQuickLoad = $('btnQuickLoad');
const btnDismissRestore = $('btnDismissRestore');
const toastWrap = $('toastWrap');

const dimensionChips = $('dimensionChips');
const dimensionEditor = $('dimensionEditor');
const dimName = $('dimName');
const dimDesc = $('dimDesc');
const btnDimSave = $('btnDimSave');
const btnDimCancel = $('btnDimCancel');
const btnDimAdd = $('btnDimAdd');
const btnDimDelete = $('btnDimDelete');

// --------- Utils ----------
function toast(title, msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast__k"></div><div class="toast__v"></div>`;
  el.querySelector('.toast__k').textContent = title;
  el.querySelector('.toast__v').textContent = msg;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
  }, ms);
  setTimeout(() => el.remove(), ms + 350);
}

function extLower(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isAllowedFile(file) {
  const ext = extLower(file.name);
  if (ALLOWED_EXT.has(ext)) return true;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type.startsWith('video/')) return true;
  return false;
}

function getBaseFileName(name) {
  const base = name.replace(/\\/g, '/').split('/').pop() || name;
  const i = base.lastIndexOf('.');
  return (i >= 0 ? base.slice(0, i) : base).toLowerCase();
}

function safeFolderName(name) {
  return String(name || 'sequence')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'sequence';
}

function statusToPill(status) {
  if (overallPill) overallPill.textContent = status;
}

function iconSvg(name) {
  if (name === 'eye') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  if (name === 'trash') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`;
  }
  if (name === 'pin') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v8M8 10l8-2-2 8 6-6"/></svg>`;
  }
  return '';
}

function getGridColumnTemplate() {
  const n = folders.sequences.length;
  if (n <= 0) return '1fr';
  return Array.from({ length: n }, (_, i) =>
    collapsedSequences.has(i) ? COLLAPSED_COL_WIDTH : 'minmax(0, 1fr)',
  ).join(' ');
}

function applyColumnLayout() {
  const tpl = getGridColumnTemplate();
  if (grid) grid.style.gridTemplateColumns = tpl;
  if (viewerHeadMulti && !viewerHeadMulti.hidden) {
    viewerHeadMulti.style.gridTemplateColumns = tpl;
  }
}

function clearColumnLayout() {
  if (grid) grid.style.gridTemplateColumns = '';
  if (viewerHeadMulti) viewerHeadMulti.style.gridTemplateColumns = '';
}

function getAlignedGroupStats() {
  const dimMap = activeStatusMap();
  const lens = [];
  for (let si = 0; si < folders.sequences.length; si++) {
    if (referenceSequences.has(si)) continue;
    lens.push(sortSeqFiles(folders.sequences[si].files).length);
  }
  if (!lens.length) return { reviewed: 0, paired: 0, remainder: 0 };

  const paired = Math.min(...lens);
  const remainder = Math.max(...lens) - paired;

  let reviewed = 0;
  for (let i = 0; i < paired && i < imageData.length; i++) {
    const item = imageData[i];
    let complete = true;
    for (let si = 0; si < folders.sequences.length; si++) {
      if (referenceSequences.has(si)) continue;
      const seq = item.sequences[si];
      if (!seq?.file) continue;
      const st = (dimMap[item.nameKey] || {})[String(si)] || 'pending';
      if (!isReviewedStatus(st)) {
        complete = false;
        break;
      }
    }
    if (complete) reviewed++;
  }

  return { reviewed, paired, remainder };
}

function reindexSetAfterDelete(set, deletedIdx) {
  const next = new Set();
  for (const i of set) {
    if (i === deletedIdx) continue;
    next.add(i > deletedIdx ? i - 1 : i);
  }
  return next;
}

function reindexSetAfterMove(set, fromIdx, toIdx) {
  const next = new Set();
  for (const i of set) {
    if (i === fromIdx) next.add(toIdx);
    else if (fromIdx < toIdx && i > fromIdx && i <= toIdx) next.add(i - 1);
    else if (fromIdx > toIdx && i >= toIdx && i < fromIdx) next.add(i + 1);
    else next.add(i);
  }
  return next;
}

function normalizeSequenceStatusKeys(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    const nv = {};
    for (const [seqIdx, st] of Object.entries(v)) nv[String(seqIdx)] = st;
    out[String(k)] = nv;
  }
  return out;
}

function normalizeSequenceStatusByDim(obj) {
  if (!obj || typeof obj !== 'object') return {};
  /** @type {Record<string, Record<string, Record<string, string>>>} */
  const out = {};
  for (const [dimId, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    /** @type {Record<string, Record<string, string>>} */
    const dimMap = {};
    for (const [nameKey, st] of Object.entries(v)) {
      dimMap[String(nameKey)] = normalizeSequenceStatusKeys(st);
    }
    out[String(dimId)] = dimMap;
  }
  return out;
}

function ensureDefaultDimension() {
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    dimensions = [{ id: 'default', name: '无维度', desc: '' }];
  } else if (!dimensions.some((d) => d.id === 'default')) {
    dimensions.unshift({ id: 'default', name: '无维度', desc: '' });
  }
  if (!currentDimId) currentDimId = 'default';
  if (!dimensions.some((d) => d.id === currentDimId)) currentDimId = 'default';
}

function activeStatusMap() {
  if (!sequenceStatusByDim[currentDimId]) sequenceStatusByDim[currentDimId] = {};
  return sequenceStatusByDim[currentDimId];
}

function ensureItemKeyInAllDims(nameKey) {
  for (const d of dimensions) {
    if (!sequenceStatusByDim[d.id]) sequenceStatusByDim[d.id] = {};
    if (!sequenceStatusByDim[d.id][nameKey]) sequenceStatusByDim[d.id][nameKey] = {};
  }
}

function nonReferenceSeqIndices() {
  const idx = [];
  for (let i = 0; i < folders.sequences.length; i++) {
    if (!referenceSequences.has(i)) idx.push(i);
  }
  return idx;
}

function isReviewedStatus(st) {
  return st === 'approved' || st === 'rejected' || st === 'needs_optimization';
}

// --------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function saveFilesToDB() {
  const seqCount = folders.sequences.length;
  await dbPut('sequenceCount', seqCount);
  for (let i = 0; i < seqCount; i++) {
    const files = folders.sequences[i].files;
    const packed = [];
    for (const f of files) {
      const ab = await f.arrayBuffer();
      packed.push({
        name: f.name,
        type: f.type || '',
        lastModified: f.lastModified || Date.now(),
        data: ab,
        rel: f.webkitRelativePath || '',
      });
    }
    await dbPut(`sequence_${i}`, {
      folderName: folders.sequences[i].folderName,
      files: packed,
    });
  }
}

async function loadFilesFromDB() {
  const seqCount = await dbGet('sequenceCount');
  if (!seqCount || typeof seqCount !== 'number' || seqCount <= 0) return false;
  const sequences = [];
  for (let i = 0; i < seqCount; i++) {
    const entry = await dbGet(`sequence_${i}`);
    if (!entry) continue;
    const files = [];
    for (const p of entry.files || []) {
      try {
        const blob = new Blob([p.data], { type: p.type || '' });
        const file = new File([blob], p.name, {
          type: p.type || '',
          lastModified: p.lastModified || Date.now(),
        });
        // keep hint
        Object.defineProperty(file, 'webkitRelativePath', {
          value: p.rel || '',
          writable: false,
        });
        files.push(file);
      } catch (_) {
        // ignore broken
      }
    }
    sequences.push({ folderName: entry.folderName, files });
  }
  folders = { sequences };
  return folders.sequences.length > 0;
}

// --------- localStorage ----------
function saveFileInfo() {
  const fileInfo = {
    sequences: folders.sequences.map((s) => ({
      folderName: s.folderName,
      count: s.files.length,
      names: s.files.map((f) => f.name),
    })),
    timestamp: Date.now(),
  };
  localStorage.setItem(LS_KEYS.fileInfo, JSON.stringify(fileInfo));
}

function loadFileInfo() {
  const raw = localStorage.getItem(LS_KEYS.fileInfo);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStatus() {
  localStorage.setItem(
    LS_KEYS.sequenceStatusByDim,
    JSON.stringify(sequenceStatusByDim),
  );
  localStorage.setItem(LS_KEYS.currentIndex, String(currentIndex));
  localStorage.setItem(
    LS_KEYS.referenceSequences,
    JSON.stringify(Array.from(referenceSequences)),
  );
  localStorage.setItem(
    LS_KEYS.collapsedSequences,
    JSON.stringify(Array.from(collapsedSequences)),
  );
  localStorage.setItem(LS_KEYS.dimensions, JSON.stringify(dimensions));
  localStorage.setItem(LS_KEYS.currentDimId, String(currentDimId || 'default'));
  if (lastHoveredSequenceIndex != null) {
    localStorage.setItem(
      LS_KEYS.hoveredSequenceIndex,
      String(lastHoveredSequenceIndex),
    );
  }
  saveFileInfo();
}

function loadStatus() {
  const dimRaw = localStorage.getItem(LS_KEYS.sequenceStatusByDim);
  if (dimRaw) {
    try {
      sequenceStatusByDim = normalizeSequenceStatusByDim(JSON.parse(dimRaw));
    } catch {
      sequenceStatusByDim = {};
    }
  } else {
    // migrate legacy single-dim -> default
    const raw = localStorage.getItem(LS_KEYS.sequenceStatus);
    if (raw) {
      try {
        const legacy = normalizeSequenceStatusKeys(JSON.parse(raw));
        sequenceStatusByDim = { default: legacy };
      } catch {
        sequenceStatusByDim = {};
      }
    }
  }

  const dimsRaw = localStorage.getItem(LS_KEYS.dimensions);
  if (dimsRaw) {
    try {
      const arr = JSON.parse(dimsRaw);
      if (Array.isArray(arr)) {
        dimensions = arr
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            id: String(x.id || ''),
            name: String(x.name || ''),
            desc: String(x.desc || ''),
          }))
          .filter((x) => x.id && x.name);
      }
    } catch {
      // ignore
    }
  }
  currentDimId = String(localStorage.getItem(LS_KEYS.currentDimId) || 'default');
  ensureDefaultDimension();
  const idx = Number(localStorage.getItem(LS_KEYS.currentIndex) || '0');
  currentIndex = Number.isFinite(idx) ? idx : 0;

  const refRaw = localStorage.getItem(LS_KEYS.referenceSequences);
  referenceSequences = new Set();
  if (refRaw) {
    try {
      const arr = JSON.parse(refRaw);
      if (Array.isArray(arr)) arr.forEach((i) => referenceSequences.add(Number(i)));
    } catch {
      // ignore
    }
  }

  const hovRaw = localStorage.getItem(LS_KEYS.hoveredSequenceIndex);
  if (hovRaw != null) {
    const n = Number(hovRaw);
    if (Number.isFinite(n)) lastHoveredSequenceIndex = n;
  }

  collapsedSequences = new Set();
  const colRaw = localStorage.getItem(LS_KEYS.collapsedSequences);
  if (colRaw) {
    try {
      const arr = JSON.parse(colRaw);
      if (Array.isArray(arr)) arr.forEach((i) => collapsedSequences.add(Number(i)));
    } catch {
      // ignore
    }
  }
}

function clearStatusOnly() {
  localStorage.removeItem(LS_KEYS.sequenceStatus);
  localStorage.removeItem(LS_KEYS.sequenceStatusByDim);
  localStorage.removeItem(LS_KEYS.dimensions);
  localStorage.removeItem(LS_KEYS.currentDimId);
  localStorage.removeItem(LS_KEYS.currentIndex);
  localStorage.removeItem(LS_KEYS.referenceSequences);
  localStorage.removeItem(LS_KEYS.hoveredSequenceIndex);
  localStorage.removeItem(LS_KEYS.collapsedSequences);
  // keep fileInfo? user wants clear-all for both
}

// --------- Import handling ----------
function inferFolderNameFromFiles(files) {
  // best effort: common first dir in webkitRelativePath
  const rel = files.find((f) => f.webkitRelativePath)?.webkitRelativePath;
  if (rel) {
    const first = rel.split('/')[0];
    if (first) return first;
  }
  return null;
}

function groupByTopFolder(files) {
  /** @type {Map<string, File[]>} */
  const map = new Map();
  for (const f of files) {
    const rel = f.webkitRelativePath;
    if (!rel) continue;
    const parts = rel.split('/');
    const top = parts[0];
    if (!top) continue;
    if (!map.has(top)) map.set(top, []);
    map.get(top).push(f);
  }
  return map;
}

async function handleFolderInput(files) {
  const valid = Array.from(files).filter(isAllowedFile);
  if (valid.length === 0) {
    toast('导入失败', '没发现支持的图片/视频文件');
    return;
  }

  const grouped = groupByTopFolder(valid);
  if (grouped.size === 0) {
    const maybe = inferFolderNameFromFiles(valid);
    if (!maybe) {
      toast('导入失败', '请用“选择文件夹”或拖拽包含 webkitRelativePath 的文件夹内容');
      return;
    }
    grouped.set(maybe, valid);
  }

  const sequences = [];
  for (const [folderName, fs] of grouped.entries()) {
    sequences.push({
      folderName: safeFolderName(folderName),
      files: fs,
    });
  }

  // merge: if already exists, append as new sequences
  if (folders.sequences.length > 0) {
    const base = folders.sequences.map((s) => s.folderName);
    for (const s of sequences) {
      let name = s.folderName;
      if (base.includes(name)) {
        let k = 2;
        while (base.includes(`${name} (${k})`)) k++;
        name = `${name} (${k})`;
      }
      base.push(name);
      folders.sequences.push({ folderName: name, files: s.files });
    }
  } else {
    folders = { sequences };
  }

  // status alignment: new sequences start pending
  processImages(true);
  updateSequenceList();
  await saveFilesToDB();
  saveStatus();
  toast('导入完成', `已加载 ${folders.sequences.length} 个序列文件夹`);
  showCurrent();
}

async function handleZipFile(zipFile) {
  if (!zipFile) return;
  if (typeof JSZip === 'undefined') {
    toast('缺依赖', '未加载 JSZip（本地 jszip.min.js）');
    return;
  }

  const zip = await JSZip.loadAsync(zipFile);
  /** @type {Map<string, Array<{name:string, blob:Blob, type:string}>>} */
  const folderStructure = new Map();

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    const rel = entry.name;
    const parts = rel.split('/');
    if (parts.length < 2) continue;
    const top = parts[0];
    const fileName = parts[parts.length - 1];
    if (!fileName) continue;

    const ext = extLower(fileName);
    if (!ALLOWED_EXT.has(ext)) continue;
    const blob = await entry.async('blob');
    const type = blob.type || (ext === '.mp4' ? 'video/mp4' : ext === '.mov' ? 'video/quicktime' : 'image/*');

    if (!folderStructure.has(top)) folderStructure.set(top, []);
    folderStructure.get(top).push({ name: fileName, blob, type });
  }

  if (folderStructure.size === 0) {
    toast('ZIP 为空', 'ZIP 里没找到支持的文件/目录结构');
    return;
  }

  const sequences = [];
  for (const [folderKey, items] of folderStructure.entries()) {
    const files = items.map(
      (it) =>
        new File([it.blob], it.name, {
          type: it.type || '',
          lastModified: Date.now(),
        }),
    );
    sequences.push({ folderName: safeFolderName(folderKey), files });
  }

  if (folders.sequences.length > 0) {
    const base = folders.sequences.map((s) => s.folderName);
    for (const s of sequences) {
      let name = s.folderName;
      if (base.includes(name)) {
        let k = 2;
        while (base.includes(`${name} (${k})`)) k++;
        name = `${name} (${k})`;
      }
      base.push(name);
      folders.sequences.push({ folderName: name, files: s.files });
    }
  } else {
    folders = { sequences };
  }

  processImages(true);
  updateSequenceList();
  await saveFilesToDB();
  saveStatus();
  toast('ZIP 导入完成', `已加载 ${folders.sequences.length} 个序列文件夹`);
  showCurrent();
}

// --------- Core: processImages ----------
function sortSeqFiles(files) {
  return files
    .filter(isAllowedFile)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

function nameKeyForAlignedRow(rowIndex, sortedPerSeq) {
  for (let s = 0; s < sortedPerSeq.length; s++) {
    const f = sortedPerSeq[s][rowIndex];
    if (f) return getBaseFileName(f.name);
  }
  return `row_${rowIndex}`;
}

function displayNameForAlignedRow(rowIndex, sortedPerSeq) {
  for (let s = 0; s < sortedPerSeq.length; s++) {
    const f = sortedPerSeq[s][rowIndex];
    if (f) return f.name;
  }
  return `第 ${rowIndex + 1} 组`;
}

// --------- Core: processImages ----------
function processImages(alignOldStatus = false) {
  const seqCount = folders.sequences.length;
  const prevItems = imageData.slice();

  if (seqCount === 0) {
    imageData = [];
    currentIndex = 0;
    updateStats();
    return;
  }

  // 多序列按“排序后索引”一一对齐（并列显示），不再仅靠文件名交集
  const sortedPerSeq = folders.sequences.map((s) => sortSeqFiles(s.files));
  const rowCount = Math.max(0, ...sortedPerSeq.map((fs) => fs.length));

  imageData = [];
  for (let i = 0; i < rowCount; i++) {
    imageData.push({
      nameKey: nameKeyForAlignedRow(i, sortedPerSeq),
      displayName: displayNameForAlignedRow(i, sortedPerSeq),
      rowIndex: i,
      sequences: Array.from({ length: seqCount }, (_, seqIdx) => ({
        folderName: folders.sequences[seqIdx].folderName,
        file: sortedPerSeq[seqIdx][i] || null,
        isReference: referenceSequences.has(seqIdx),
      })),
    });
  }

  if (alignOldStatus) {
    ensureDefaultDimension();
    for (const d of dimensions) {
      if (!sequenceStatusByDim[d.id]) sequenceStatusByDim[d.id] = {};
      const oldDim = sequenceStatusByDim[d.id] || {};
      /** @type {Record<string, Record<string, string>>} */
      const next = {};
      for (let i = 0; i < imageData.length; i++) {
        const item = imageData[i];
        const oldKey = prevItems[i]?.nameKey;
        const old =
          oldDim[item.nameKey] ||
          (oldKey ? oldDim[oldKey] : null) ||
          {};
        const rebuilt = {};
        for (let si = 0; si < seqCount; si++) {
          const st = old[String(si)];
          if (st) rebuilt[String(si)] = st;
        }
        next[item.nameKey] = rebuilt;
      }
      sequenceStatusByDim[d.id] = next;
    }
  } else {
    ensureDefaultDimension();
    for (const item of imageData) ensureItemKeyInAllDims(item.nameKey);
  }

  if (currentIndex >= imageData.length) currentIndex = Math.max(0, imageData.length - 1);
  if (imageData.length === 0) currentIndex = 0;

  updateStats();
}

function getOverallStatus(nameKey) {
  const item = imageData.find((x) => x.nameKey === nameKey);
  if (!item) return 'pending';
  const dimMap = activeStatusMap();
  let hasApproved = false;
  let hasNeedsOpt = false;
  for (let i = 0; i < item.sequences.length; i++) {
    const seq = item.sequences[i];
    if (!seq.file) continue;
    if (referenceSequences.has(i)) continue;
    const st = (dimMap[nameKey] || {})[String(i)] || 'pending';
    if (st === 'rejected') return 'rejected';
    if (st === 'approved') hasApproved = true;
    if (st === 'needs_optimization') hasNeedsOpt = true;
  }
  if (hasApproved) return 'approved';
  if (hasNeedsOpt) return 'needs_optimization';
  return 'pending';
}

function itemIsComplete(item) {
  const dimMap = activeStatusMap();
  for (let i = 0; i < item.sequences.length; i++) {
    const seq = item.sequences[i];
    if (!seq.file) continue;
    if (referenceSequences.has(i)) continue;
    const st = (dimMap[item.nameKey] || {})[String(i)] || 'pending';
    if (!isReviewedStatus(st)) return false;
  }
  return true;
}

function resetMarkUIForNewItem() {
  hoveredSequenceIndex = null;
  const nonRef = nonReferenceSeqIndices();
  lastHoveredSequenceIndex = nonRef.length ? nonRef[0] : 0;
}

function jumpToNextPending() {
  if (!imageData.length) return;
  for (let step = 1; step <= imageData.length; step++) {
    const idx = (currentIndex + step) % imageData.length;
    if (!itemIsComplete(imageData[idx])) {
      currentIndex = idx;
      resetMarkUIForNewItem();
      saveStatus();
      showCurrent();
      return;
    }
  }
  toast('完成', '所有项目都已标完（对非参考列）');
}

// --------- Marking ----------
function getTargetSequenceIndex() {
  const max = folders.sequences.length - 1;
  if (max < 0) return null;

  if (hoveredSequenceIndex != null) return hoveredSequenceIndex;
  if (lastHoveredSequenceIndex != null) return lastHoveredSequenceIndex;

  const nonRef = nonReferenceSeqIndices();
  return nonRef.length ? nonRef[0] : 0;
}

function markSequence(nameKey, seqIdx, status) {
  if (seqIdx == null) return;
  if (referenceSequences.has(seqIdx)) {
    toast('参考列', '这列被设为参考，不参与打标');
    return;
  }

  const item = imageData[currentIndex];
  if (!item) return;
  const seq = item.sequences[seqIdx];
  if (!seq || !seq.file) {
    toast('无文件', '该序列这格没有文件，无法打标');
    return;
  }

  const dimMap = activeStatusMap();
  if (!dimMap[nameKey]) dimMap[nameKey] = {};
  const cur = dimMap[nameKey][String(seqIdx)] || 'pending';
  if (cur === status) {
    delete dimMap[nameKey][String(seqIdx)];
  } else {
    dimMap[nameKey][String(seqIdx)] = status;
  }

  saveStatus();
  updateStats();
  renderGridForItem(item);
  renderViewerHead(item);
  updateMarkButtonUI();

  if (itemIsComplete(item)) {
    setTimeout(() => jumpToNextPending(), 260);
  }
}

function clearMark(nameKey, seqIdx) {
  const dimMap = activeStatusMap();
  if (!dimMap[nameKey]) return;
  delete dimMap[nameKey][String(seqIdx)];
  saveStatus();
  updateStats();
  showCurrent();
}

// --------- UI: sequences list ----------
function updateSequenceList() {
  if (!sequenceList) return;
  sequenceList.innerHTML = '';
  folders.sequences.forEach((s, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'seqItem';
    wrap.innerHTML = `
      <div class="seqTop">
        <div class="seqName" title="${s.folderName}"></div>
        <div class="seqMeta"></div>
      </div>
      <div class="seqControls">
        <label class="toggle" title="参考列不参与打标/进度/自动跳转">
          <input type="checkbox" data-ref="${idx}" />
          参考列
        </label>
        <button class="btn" data-export-approved="${idx}">导出该序列·合格</button>
        <button class="btn" data-export-rejected="${idx}">导出该序列·不合格</button>
      </div>
    `;
    wrap.querySelector('.seqName').textContent = s.folderName;
    wrap.querySelector('.seqMeta').textContent = `${s.files.length} files`;
    const cb = wrap.querySelector('input[type="checkbox"]');
    cb.checked = referenceSequences.has(idx);
    cb.addEventListener('change', () => {
      if (cb.checked) referenceSequences.add(idx);
      else referenceSequences.delete(idx);
      // reprocess just for UI flag, keep status but progress rules change
      processImages(true);
      saveStatus();
      updateStats();
      showCurrent();
    });
    wrap
      .querySelector('[data-export-approved]')
      .addEventListener('click', () => exportSequenceByStatus(idx, 'approved'));
    wrap
      .querySelector('[data-export-rejected]')
      .addEventListener('click', () => exportSequenceByStatus(idx, 'rejected'));
    sequenceList.appendChild(wrap);
  });
}

// --------- UI: grid rendering ----------
const GRID_COL_CLASSES = [
  'grid--cols-1',
  'grid--cols-2',
  'grid--cols-3',
  'grid--cols-4',
  'grid--cols-5',
  'grid--cols-6',
];

function clearGridColClasses() {
  if (!grid) return;
  grid.classList.remove(...GRID_COL_CLASSES);
}

function setGridCols(n) {
  clearGridColClasses();
  const c = Math.max(1, Math.min(6, n));
  grid.classList.add(`grid--cols-${c}`);
}

function statusText(st) {
  if (!st || st === 'pending') return 'pending';
  return st;
}

function createMediaEl(file) {
  const type = (file.type || '').toLowerCase();
  const ext = extLower(file.name);
  const url = URL.createObjectURL(file);
  if (type.startsWith('video/') || ext === '.mp4' || ext === '.mov') {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.preload = 'metadata';
    v.onloadeddata = () => URL.revokeObjectURL(url);
    v.onerror = () => URL.revokeObjectURL(url);
    return v;
  }
  const img = document.createElement('img');
  img.src = url;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => {
    URL.revokeObjectURL(url);
    img.replaceWith(
      Object.assign(document.createElement('div'), {
        className: 'cell__empty',
        textContent: '无法预览（可能是 HEIC/HEIF 或浏览器不支持）',
      }),
    );
  };
  return img;
}

function moveArrayItem(arr, fromIdx, toIdx) {
  const next = arr.slice();
  const [x] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, x);
  return next;
}

async function reorderSequenceColumns(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const n = folders.sequences.length;
  if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n) return;

  folders.sequences = moveArrayItem(folders.sequences, fromIdx, toIdx);

  const refFlags = Array.from({ length: n }, (_, i) => referenceSequences.has(i));
  referenceSequences = new Set();
  moveArrayItem(refFlags, fromIdx, toIdx).forEach((isRef, i) => {
    if (isRef) referenceSequences.add(i);
  });
  collapsedSequences = reindexSetAfterMove(collapsedSequences, fromIdx, toIdx);

  for (const item of imageData) {
    item.sequences = moveArrayItem(item.sequences, fromIdx, toIdx);
  }

  for (const dimId of Object.keys(sequenceStatusByDim)) {
    const dimMap = sequenceStatusByDim[dimId];
    for (const nameKey of Object.keys(dimMap)) {
      const st = dimMap[nameKey];
      const dense = Array.from({ length: n }, (_, i) => st[String(i)]);
      const moved = moveArrayItem(dense, fromIdx, toIdx);
      const newSt = {};
      moved.forEach((v, i) => {
        if (v) newSt[String(i)] = v;
      });
      dimMap[nameKey] = newSt;
    }
  }

  saveStatus();
  await saveFilesToDB();
  showCurrent();
}

function setupSequenceColumnDrag(el, seqIdx) {
  if (folders.sequences.length <= 1) return;
  el.dataset.seqIdx = String(seqIdx);
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    if (e.target.closest('.iconBtn, [data-cell-mark], button')) {
      e.preventDefault();
      return;
    }
    dragSeqIdx = seqIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(seqIdx));
    el.classList.add('cell--dragging');
  });
  el.addEventListener('dragend', () => {
    dragSeqIdx = null;
    el.classList.remove('cell--dragging');
    document
      .querySelectorAll('.seqHeadCol--dragover, .cell--dragover')
      .forEach((node) => node.classList.remove('seqHeadCol--dragover', 'cell--dragover'));
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    const targetIdx = Number(el.dataset.seqIdx);
    if (dragSeqIdx == null || targetIdx === dragSeqIdx) return;
    if (el.classList.contains('seqHeadCol')) el.classList.add('seqHeadCol--dragover');
    else el.classList.add('cell--dragover');
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('seqHeadCol--dragover', 'cell--dragover');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('seqHeadCol--dragover', 'cell--dragover');
    const toIdx = Number(el.dataset.seqIdx);
    const fromIdx =
      dragSeqIdx != null ? dragSeqIdx : Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isFinite(fromIdx) || !Number.isFinite(toIdx)) return;
    reorderSequenceColumns(fromIdx, toIdx).catch((err) => {
      console.error(err);
      toast('排序失败', String(err?.message || err));
    });
  });
}

function updateSeqHeadActiveState() {
  document.querySelectorAll('.seqHeadCol').forEach((col) => {
    const idx = Number(col.dataset.seqIdx);
    col.classList.toggle('seqHeadCol--active', hoveredSequenceIndex === idx);
    const tools = col.querySelector('.seqHeadCol__tools');
    if (tools) tools.hidden = hoveredSequenceIndex !== idx;
  });
}

function toggleSequenceCollapsed(seqIdx) {
  if (collapsedSequences.has(seqIdx)) collapsedSequences.delete(seqIdx);
  else collapsedSequences.add(seqIdx);
  saveStatus();
  const item = imageData[currentIndex];
  if (item) {
    renderGridForItem(item);
    renderViewerHead(item);
    applyColumnLayout();
  }
}

function toggleSequenceReference(seqIdx) {
  if (referenceSequences.has(seqIdx)) referenceSequences.delete(seqIdx);
  else referenceSequences.add(seqIdx);
  saveStatus();
  const item = imageData[currentIndex];
  if (item) {
    renderGridForItem(item);
    renderViewerHead(item);
    updateStats();
  }
}

async function deleteSequenceAt(seqIdx) {
  const n = folders.sequences.length;
  if (n <= 1) return toast('无法删除', '至少保留 1 个序列');
  const name = folders.sequences[seqIdx]?.folderName || `序列 ${seqIdx + 1}`;
  if (!window.confirm(`确认删除序列「${name}」？会删除该列文件与打标状态。`)) return;

  folders.sequences.splice(seqIdx, 1);
  for (const item of imageData) {
    item.sequences.splice(seqIdx, 1);
  }

  for (const dimId of Object.keys(sequenceStatusByDim)) {
    const dimMap = sequenceStatusByDim[dimId];
    for (const nameKey of Object.keys(dimMap)) {
      const st = dimMap[nameKey];
      const next = {};
      for (const [k, v] of Object.entries(st)) {
        const i = Number(k);
        if (!Number.isFinite(i) || i === seqIdx) continue;
        next[String(i > seqIdx ? i - 1 : i)] = v;
      }
      dimMap[nameKey] = next;
    }
  }

  referenceSequences = reindexSetAfterDelete(referenceSequences, seqIdx);
  collapsedSequences = reindexSetAfterDelete(collapsedSequences, seqIdx);
  if (hoveredSequenceIndex === seqIdx) hoveredSequenceIndex = null;
  else if (hoveredSequenceIndex != null && hoveredSequenceIndex > seqIdx) {
    hoveredSequenceIndex -= 1;
  }
  if (lastHoveredSequenceIndex === seqIdx) lastHoveredSequenceIndex = 0;
  else if (lastHoveredSequenceIndex != null && lastHoveredSequenceIndex > seqIdx) {
    lastHoveredSequenceIndex -= 1;
  }

  saveStatus();
  await saveFilesToDB();
  updateStats();
  updateActionModeUI();
  showCurrent();
  toast('已删除', `已移除序列：${name}`);
}

function bindSeqHeadCol(col, idx, item) {
  const seq = item.sequences[idx];
  const collapsed = collapsedSequences.has(idx);
  const isRef = referenceSequences.has(idx);

  col.className = 'seqHeadCol';
  if (collapsed) col.classList.add('seqHeadCol--collapsed');
  if (hoveredSequenceIndex === idx) col.classList.add('seqHeadCol--active');
  col.dataset.seqIdx = String(idx);

  if (collapsed) {
    col.innerHTML = `<div class="seqHeadCol__body"><button type="button" class="iconBtn iconBtn--on" data-action="hide" title="展开序列">${iconSvg('eye')}</button></div>`;
    col.querySelector('[data-action="hide"]').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSequenceCollapsed(idx);
    });
    col.addEventListener('mouseenter', () => {
      hoveredSequenceIndex = idx;
      lastHoveredSequenceIndex = idx;
      updateSeqHeadActiveState();
      highlightHoveredCell();
    });
    return;
  }

  const fileName = seq.file ? seq.file.name : '缺文件';
  const folderName = seq.folderName || folders.sequences[idx]?.folderName || '';

  col.innerHTML = `
    <div class="seqHeadCol__body">
      <div class="seqHeadCol__file"></div>
      <div class="seqHeadCol__folder"></div>
      <div class="seqHeadCol__tools" hidden>
        <button type="button" class="iconBtn" data-action="hide" title="隐藏序列">${iconSvg('eye')}</button>
        <button type="button" class="iconBtn" data-action="delete" title="删除序列">${iconSvg('trash')}</button>
        <button type="button" class="iconBtn${isRef ? ' iconBtn--on' : ''}" data-action="pin" title="参考列（不参与打标）">${iconSvg('pin')}</button>
      </div>
    </div>
  `;
  const fileEl = col.querySelector('.seqHeadCol__file');
  fileEl.textContent = fileName;
  fileEl.title = fileName;
  col.querySelector('.seqHeadCol__folder').textContent = folderName;

  const tools = col.querySelector('.seqHeadCol__tools');
  if (tools) tools.hidden = hoveredSequenceIndex !== idx;

  col.querySelector('[data-action="hide"]').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSequenceCollapsed(idx);
  });
  col.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSequenceAt(idx).catch(console.error);
  });
  col.querySelector('[data-action="pin"]').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSequenceReference(idx);
  });

  if (!collapsed) setupSequenceColumnDrag(col, idx);

  col.addEventListener('mouseenter', () => {
    hoveredSequenceIndex = idx;
    lastHoveredSequenceIndex = idx;
    localStorage.setItem(LS_KEYS.hoveredSequenceIndex, String(idx));
    updateSeqHeadActiveState();
    highlightHoveredCell();
  });
  col.addEventListener('mouseleave', () => {
    hoveredSequenceIndex = null;
    updateSeqHeadActiveState();
    highlightHoveredCell();
  });
}

function renderViewerHead(item) {
  const multi = folders.sequences.length > 1;
  if (viewerHeadSingle) viewerHeadSingle.hidden = multi;
  if (viewerHeadMulti) viewerHeadMulti.hidden = !multi;
  if (!multi) {
    if (!item || !viewerHeadSingle) return;
    const seq = item.sequences[0];
    const stMap = activeStatusMap()[item.nameKey] || {};
    const st = stMap['0'] || 'pending';
    if (currentTitle) {
      currentTitle.textContent = seq?.file ? seq.file.name : item.displayName;
    }
    statusToPill(st);
    return;
  }
  if (!viewerHeadMulti || !item) return;

  viewerHeadMulti.innerHTML = '';
  item.sequences.forEach((_, idx) => {
    const col = document.createElement('div');
    bindSeqHeadCol(col, idx, item);
    viewerHeadMulti.appendChild(col);
  });
  applyColumnLayout();
  updateSeqHeadActiveState();
}

function syncCellMarkButtons(cell, st) {
  cell.querySelectorAll('[data-cell-mark]').forEach((b) => {
    b.classList.remove('btn--selected');
    if (isReviewedStatus(st) && b.getAttribute('data-cell-mark') === st) {
      b.classList.add('btn--selected');
    }
  });
}

function renderGridForItem(item) {
  grid.innerHTML = '';
  if (!item) return;

  const multi = folders.sequences.length > 1;
  if (multi) {
    clearGridColClasses();
    applyColumnLayout();
  } else {
    clearColumnLayout();
    setGridCols(1);
  }

  const nameKey = item.nameKey;
  const stMap = activeStatusMap()[nameKey] || {};

  item.sequences.forEach((seq, idx) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.seqIdx = String(idx);
    const st = stMap[String(idx)] || 'pending';

    if (multi && collapsedSequences.has(idx)) {
      cell.classList.add('cell--collapsed');
      cell.innerHTML = `<div class="cell__collapsedOnly"><button type="button" class="iconBtn iconBtn--on" data-action="hide" title="展开序列">${iconSvg('eye')}</button></div>`;
      cell.querySelector('[data-action="hide"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSequenceCollapsed(idx);
      });
      cell.addEventListener('mouseenter', () => {
        hoveredSequenceIndex = idx;
        lastHoveredSequenceIndex = idx;
        updateSeqHeadActiveState();
        highlightHoveredCell();
      });
      cell.addEventListener('mouseleave', () => {
        hoveredSequenceIndex = null;
        updateSeqHeadActiveState();
        highlightHoveredCell();
      });
      grid.appendChild(cell);
      return;
    }

    cell.innerHTML = multi
      ? `
      <div class="cell__media"></div>
      <div class="cell__actions">
        <button type="button" class="btn btn--mark btn--mark-ok" data-cell-mark="approved">合格</button>
        <button type="button" class="btn btn--mark btn--mark-warn" data-cell-mark="needs_optimization">待优化</button>
        <button type="button" class="btn btn--mark btn--mark-bad" data-cell-mark="rejected">不合格</button>
      </div>
    `
      : `<div class="cell__media"></div>`;

    const media = cell.querySelector('.cell__media');
    if (seq.file) media.appendChild(createMediaEl(seq.file));
    else {
      const empty = document.createElement('div');
      empty.className = 'cell__empty';
      empty.textContent = '缺文件';
      media.appendChild(empty);
    }

    if (referenceSequences.has(idx)) {
      const tag = document.createElement('div');
      tag.className = 'refTag';
      tag.textContent = '参考列';
      cell.appendChild(tag);
      const actions = cell.querySelector('.cell__actions');
      if (actions) actions.style.display = 'none';
    }

    if (multi) {
      syncCellMarkButtons(cell, st);
      cell.querySelectorAll('[data-cell-mark]').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (referenceSequences.has(idx)) return;
          markSequence(nameKey, idx, b.getAttribute('data-cell-mark'));
        });
      });
      const mediaEl = cell.querySelector('.cell__media');
      if (mediaEl) {
        mediaEl.title = '拖动可调整序列顺序';
        setupSequenceColumnDrag(mediaEl, idx);
      }
    }

    cell.addEventListener('mouseenter', () => {
      hoveredSequenceIndex = idx;
      lastHoveredSequenceIndex = idx;
      localStorage.setItem(LS_KEYS.hoveredSequenceIndex, String(idx));
      updateHoverPill();
      highlightHoveredCell();
      if (multi) updateSeqHeadActiveState();
      else updateMarkButtonUI();
    });
    cell.addEventListener('mouseleave', () => {
      hoveredSequenceIndex = null;
      updateHoverPill();
      highlightHoveredCell();
      if (multi) updateSeqHeadActiveState();
      else updateMarkButtonUI();
    });

    grid.appendChild(cell);
  });

  updateHoverPill();
  highlightHoveredCell();
  if (multi) updateSeqHeadActiveState();
}

function highlightHoveredCell() {
  const target = hoveredSequenceIndex != null ? hoveredSequenceIndex : null;
  grid.querySelectorAll('.cell').forEach((c) => c.classList.remove('cell--hovered'));
  if (target == null) return;
  const el = grid.querySelector(`.cell[data-seq-idx="${target}"]`);
  if (el) el.classList.add('cell--hovered');
}

function updateHoverPill() {
  // UI 已移除；保留 hoveredSequenceIndex/lastHoveredSequenceIndex 供键盘打标目标使用
}

function getTargetMarkStatus() {
  const item = imageData[currentIndex];
  if (!item) return 'pending';
  const seqIdx = getTargetSequenceIndex();
  if (seqIdx == null) return 'pending';
  const dimMap = activeStatusMap();
  return (dimMap[item.nameKey] || {})[String(seqIdx)] || 'pending';
}

function showCurrent() {
  if (!imageData.length) {
    currentTitle.textContent = '未加载文件';
    grid.innerHTML = '';
    statusToPill('pending');
    if (viewerHeadSingle) viewerHeadSingle.hidden = false;
    if (viewerHeadMulti) {
      viewerHeadMulti.hidden = true;
      viewerHeadMulti.innerHTML = '';
    }
    updateStats();
    updateMarkButtonUI();
    updateActionModeUI();
    return;
  }

  const item = imageData[currentIndex];
  renderGridForItem(item);
  renderViewerHead(item);
  updateStats();
  updateActionModeUI();
  updateMarkButtonUI();
}

function updateMarkButtonUI() {
  const item = imageData[currentIndex];
  const multi = folders.sequences.length > 1;

  if (multi && item) {
    renderViewerHead(item);
    [btnMarkApproved, btnMarkNeedsOpt, btnMarkRejected].forEach((b) => {
      if (b) b.classList.remove('btn--selected');
    });
    return;
  }

  const st = getTargetMarkStatus();
  const byStatus = {
    approved: btnMarkApproved,
    needs_optimization: btnMarkNeedsOpt,
    rejected: btnMarkRejected,
  };
  [btnMarkApproved, btnMarkNeedsOpt, btnMarkRejected].forEach((b) => {
    if (b) b.classList.remove('btn--selected');
  });
  if (isReviewedStatus(st) && byStatus[st]) {
    byStatus[st].classList.add('btn--selected');
  }
  statusToPill(st);
}

function updateActionModeUI() {
  const multi = folders.sequences.length > 1;
  document.querySelector('.viewer')?.classList.toggle('viewer--single', !multi);
  footCenter?.classList.toggle('is-hidden', multi);
  viewerFoot?.classList.toggle('viewer__foot--multi', multi);
  [btnMarkApproved, btnMarkNeedsOpt, btnMarkRejected].forEach((b) => {
    if (!b) return;
    b.disabled = multi;
    b.style.pointerEvents = multi ? 'none' : 'auto';
  });
}

function updateStats() {
  const multi = folders.sequences.length > 1;
  const dimMap = activeStatusMap();

  if (statsSingle) statsSingle.hidden = multi;
  if (statsMulti) statsMulti.hidden = !multi;

  let total = 0;
  let reviewed = 0;
  let approved = 0;
  for (const item of imageData) {
    const stMap = dimMap[item.nameKey] || {};
    for (let i = 0; i < item.sequences.length; i++) {
      const seq = item.sequences[i];
      if (!seq.file) continue;
      if (referenceSequences.has(i)) continue;
      total++;
      const st = stMap[String(i)] || 'pending';
      if (isReviewedStatus(st)) reviewed++;
      if (st === 'approved') approved++;
    }
  }

  if (multi) {
    const g = getAlignedGroupStats();
    if (statReviewedMulti) {
      const extra = g.remainder > 0 ? ` 余${g.remainder}` : '';
      statReviewedMulti.textContent = `已标 ${g.reviewed}/${g.paired}${extra}`;
    }
    return;
  }

  if (statPassRate) statPassRate.textContent = `合格率 ${approved}/${total}`;
  if (statReviewed) statReviewed.textContent = `已标 ${reviewed}/${total}`;
}

// --------- Export helpers ----------
function getFileExt(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function statusFolderName(status) {
  if (status === 'approved') return '合格';
  if (status === 'rejected') return '不合格';
  if (status === 'needs_optimization') return '待优化';
  return 'pending';
}

async function exportByStatus(status) {
  if (!imageData.length) return toast('无法导出', '还没加载文件');
  const zip = new JSZip();
  let count = 0;
  const dimMap = activeStatusMap();
  for (const item of imageData) {
    const stMap = dimMap[item.nameKey] || {};
    for (let i = 0; i < item.sequences.length; i++) {
      if (referenceSequences.has(i)) continue;
      const seq = item.sequences[i];
      if (!seq.file) continue;
      const st = stMap[String(i)] || 'pending';
      if (st !== status) continue;
      const folder = safeFolderName(folders.sequences[i].folderName);
      zip
        .folder(folder)
        .folder(statusFolderName(status))
        .file(seq.file.name, seq.file);
      count++;
    }
  }
  if (!count) return toast('无匹配', `没有 ${statusFolderName(status)} 文件`);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `导出_${statusFolderName(status)}_${Date.now()}.zip`);
  toast('导出完成', `${count} 个文件`);
}

async function exportSequenceByStatus(sequenceIndex, status) {
  if (!imageData.length) return toast('无法导出', '还没加载文件');
  if (!folders.sequences[sequenceIndex]) return;
  const zip = new JSZip();
  let count = 0;
  const seqName = safeFolderName(folders.sequences[sequenceIndex].folderName);
  const dimMap = activeStatusMap();
  for (const item of imageData) {
    const stMap = dimMap[item.nameKey] || {};
    const seq = item.sequences[sequenceIndex];
    if (!seq || !seq.file) continue;
    const st = stMap[String(sequenceIndex)] || 'pending';
    if (st !== status) continue;
    zip.folder(seqName).folder(statusFolderName(status)).file(seq.file.name, seq.file);
    count++;
  }
  if (!count) return toast('无匹配', `${seqName} 没有 ${statusFolderName(status)} 文件`);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${seqName}_${statusFolderName(status)}_${Date.now()}.zip`);
  toast('导出完成', `${seqName}: ${count} 个文件`);
}

async function exportAll() {
  if (!imageData.length) return toast('无法导出', '还没加载文件');
  const zip = new JSZip();
  let count = 0;
  const dimMap = activeStatusMap();
  for (let i = 0; i < folders.sequences.length; i++) {
    if (referenceSequences.has(i)) continue;
    const seqName = safeFolderName(folders.sequences[i].folderName);
    for (const item of imageData) {
      const seq = item.sequences[i];
      if (!seq || !seq.file) continue;
      const st = (dimMap[item.nameKey] || {})[String(i)] || 'pending';
      if (!isReviewedStatus(st)) continue; // skip pending
      zip.folder(seqName).folder(statusFolderName(st)).file(seq.file.name, seq.file);
      count++;
    }
  }
  if (!count) return toast('无可导出', '全部都是 pending（或全是参考列）');
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `导出_全部_${Date.now()}.zip`);
  toast('导出完成', `${count} 个文件`);
}

// --------- Backup (no files) ----------
function exportBackup() {
  const payload = {
    version: BACKUP_VERSION,
    timestamp: Date.now(),
    fileInfo: loadFileInfo(),
    sequenceStatusByDim,
    dimensions,
    currentDimId,
    currentIndex,
    referenceSequences: Array.from(referenceSequences),
    collapsedSequences: Array.from(collapsedSequences),
    hoveredSequenceIndex: lastHoveredSequenceIndex,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, `序列打标_备份_${Date.now()}.json`);
  toast('备份完成', '不包含文件，只含状态/配置');
}

async function importBackup(file) {
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    toast('导入失败', 'JSON 解析失败');
    return;
  }
  if (!data || typeof data !== 'object') {
    toast('导入失败', '无效备份');
    return;
  }
  const hasMultiDimStatus =
    data.sequenceStatusByDim && typeof data.sequenceStatusByDim === 'object';
  const hasLegacyStatus = data.sequenceStatus && typeof data.sequenceStatus === 'object';
  if ((!hasMultiDimStatus && !hasLegacyStatus) || !data.fileInfo) {
    toast('导入失败', '备份缺少打标状态或 fileInfo');
    return;
  }

  if (hasMultiDimStatus) {
    sequenceStatusByDim = normalizeSequenceStatusByDim(data.sequenceStatusByDim);
  } else {
    sequenceStatusByDim = {
      default: normalizeSequenceStatusKeys(data.sequenceStatus),
    };
  }

  if (Array.isArray(data.dimensions)) {
    dimensions = data.dimensions
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        id: String(item.id || ''),
        name: String(item.name || ''),
        desc: String(item.desc || ''),
      }))
      .filter((item) => item.id && item.name);
  } else {
    dimensions = [{ id: 'default', name: '无维度', desc: '' }];
  }
  currentDimId = String(data.currentDimId || 'default');
  ensureDefaultDimension();
  currentIndex = Number(data.currentIndex || 0) || 0;
  referenceSequences = new Set((data.referenceSequences || []).map((x) => Number(x)));
  collapsedSequences = new Set((data.collapsedSequences || []).map((x) => Number(x)));
  if (data.hoveredSequenceIndex != null) {
    lastHoveredSequenceIndex = Number(data.hoveredSequenceIndex);
  }

  // write back localStorage
  localStorage.setItem(
    LS_KEYS.sequenceStatusByDim,
    JSON.stringify(sequenceStatusByDim),
  );
  localStorage.setItem(LS_KEYS.dimensions, JSON.stringify(dimensions));
  localStorage.setItem(LS_KEYS.currentDimId, currentDimId);
  localStorage.setItem(LS_KEYS.currentIndex, String(currentIndex));
  localStorage.setItem(
    LS_KEYS.referenceSequences,
    JSON.stringify(Array.from(referenceSequences)),
  );
  localStorage.setItem(
    LS_KEYS.collapsedSequences,
    JSON.stringify(Array.from(collapsedSequences)),
  );
  localStorage.setItem(LS_KEYS.fileInfo, JSON.stringify(data.fileInfo));
  if (lastHoveredSequenceIndex != null) {
    localStorage.setItem(LS_KEYS.hoveredSequenceIndex, String(lastHoveredSequenceIndex));
  }

  if (imageData.length) {
    processImages(true);
    updateSequenceList();
    renderDimensionChips();
    showCurrent();
    toast('导入成功', '已套用到当前已加载文件');
  } else {
    toast('导入成功', '已写入状态；请先上传相同文件夹/或用 IndexedDB 恢复文件');
  }
}

// --------- Restore flow ----------
async function checkAndLoadPreviousFiles() {
  const info = loadFileInfo();
  const hasDB = await dbGet('sequenceCount');
  if (!info || !hasDB) return;
  const ok = window.confirm(
    `检测到上次文件（${info.sequences?.length || 0} 个序列）。要先恢复文件吗？（离线）`,
  );
  if (!ok) return;

  toast('恢复中', '正在从 IndexedDB 读取文件…');
  const loaded = await loadFilesFromDB();
  if (!loaded) {
    toast('恢复失败', 'IndexedDB 没读到文件');
    return;
  }
  updateSequenceList();
  processImages(true);
  showCurrent();

  const hasStatus =
    !!localStorage.getItem(LS_KEYS.sequenceStatusByDim) ||
    !!localStorage.getItem(LS_KEYS.sequenceStatus);
  if (hasStatus) {
    restoreText.textContent = '已恢复上次文件。是否再恢复上次状态/进度？';
    restoreBar.hidden = false;
  } else {
    toast('恢复完成', '已恢复文件（无状态）');
  }
}

function quickLoadStatus() {
  loadStatus();
  processImages(true);
  updateSequenceList();
  showCurrent();
  restoreBar.hidden = true;
  toast('已恢复', '状态/进度已恢复');
}

// --------- Clear all ----------
async function clearAll() {
  const ok = window.confirm('确认清空？会删除 IndexedDB 文件 + localStorage 状态。');
  if (!ok) return;
  folders = { sequences: [] };
  imageData = [];
  sequenceStatusByDim = {};
  dimensions = [{ id: 'default', name: '无维度', desc: '' }];
  currentDimId = 'default';
  currentIndex = 0;
  referenceSequences = new Set();
  collapsedSequences = new Set();
  hoveredSequenceIndex = null;
  lastHoveredSequenceIndex = null;
  restoreBar.hidden = true;
  localStorage.removeItem(LS_KEYS.fileInfo);
  clearStatusOnly();
  await dbClear();
  updateSequenceList();
  renderDimensionChips();
  showCurrent();
  toast('已清空', '文件和状态都删了');
}

// --------- Navigation ----------
function prev() {
  if (!imageData.length) return;
  currentIndex = (currentIndex - 1 + imageData.length) % imageData.length;
  resetMarkUIForNewItem();
  saveStatus();
  showCurrent();
}
function next() {
  if (!imageData.length) return;
  currentIndex = (currentIndex + 1) % imageData.length;
  resetMarkUIForNewItem();
  saveStatus();
  showCurrent();
}

// --------- Events ----------
inputFolder?.addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || !files.length) return;
  await handleFolderInput(files);
  inputFolder.value = '';
});

inputZip?.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  await handleZipFile(f);
  inputZip.value = '';
});

btnPrev?.addEventListener('click', prev);
btnNext?.addEventListener('click', next);
btnNextPending?.addEventListener('click', jumpToNextPending);
btnClearAll.addEventListener('click', clearAll);

function openImportChooser() {
  if (!inputFolder) return toast('无法导入', '找不到文件选择器');
  inputFolder.click();
}

btnImport?.addEventListener('click', openImportChooser);

// --------- LLM 结论（与其他模式共用同一份 API 配置） ----------
const STATUS_TEXT_MAP = {
  approved: '合格',
  rejected: '不合格',
  needs_optimization: '待优化',
  pending: '未标记',
};

function llmReportRows() {
  const dimMap = activeStatusMap();
  return imageData.map((item) => ({
    name: item.displayName,
    columns: item.sequences
      .map((seq, index) => ({ seq, index }))
      .filter(({ seq, index }) => seq.file && !referenceSequences.has(index))
      .map(({ seq, index }) => ({
        sequence: seq.folderName || folders.sequences[index]?.folderName || `#${index + 1}`,
        file: seq.file.name,
        status: STATUS_TEXT_MAP[(dimMap[item.nameKey] || {})[String(index)] || 'pending'],
      })),
  }));
}

function llmReport(mode) {
  const dimMap = activeStatusMap();
  const dimension = dimensions.find((item) => item.id === currentDimId);
  const perSequence = folders.sequences.map((sequence, index) => {
    const counts = { approved: 0, rejected: 0, needs_optimization: 0, pending: 0 };
    if (!referenceSequences.has(index)) {
      for (const item of imageData) {
        if (!item.sequences[index]?.file) continue;
        counts[(dimMap[item.nameKey] || {})[String(index)] || 'pending'] += 1;
      }
    }
    const judged = counts.approved + counts.rejected + counts.needs_optimization;
    return {
      sequence: sequence.folderName,
      isReference: referenceSequences.has(index),
      total: judged + counts.pending,
      approved: counts.approved,
      rejected: counts.rejected,
      needsOptimization: counts.needs_optimization,
      pending: counts.pending,
      passRate: judged ? counts.approved / judged : null,
    };
  });
  const totals = perSequence.reduce(
    (acc, item) => {
      if (item.isReference) return acc;
      acc.total += item.total;
      acc.approved += item.approved;
      acc.rejected += item.rejected;
      acc.needsOptimization += item.needsOptimization;
      acc.pending += item.pending;
      return acc;
    },
    { total: 0, approved: 0, rejected: 0, needsOptimization: 0, pending: 0 },
  );
  const report = {
    type: 'sequence-review-report',
    exportedAt: new Date().toISOString(),
    dimension: dimension ? { name: dimension.name, desc: dimension.desc } : null,
    summary: {
      ...totals,
      passRate: totals.total - totals.pending ? totals.approved / (totals.total - totals.pending) : null,
      images: imageData.length,
      sequences: folders.sequences.length,
    },
    bySequence: perSequence,
  };
  if (mode === 'full') report.rows = llmReportRows();
  return report;
}

function setupLlmPanel() {
  const LLM = window.PicLabelingLlm;
  const mount = $('reviewAiMount');
  if (!LLM || !mount) return;
  const dialog = LLM.createApiDialog({ toast, onChange: () => {} });
  LLM.createExportPanel({
    mount,
    dialog,
    toast,
    hasData: () => imageData.length > 0,
    fileName: () => `合格判定AI结论_${new Date().toISOString().slice(0, 10)}.txt`,
    contexts: [
      { value: 'summary', label: '统计摘要', build: () => llmReport('summary') },
      { value: 'full', label: '完整明细', build: () => llmReport('full') },
    ],
  });
}

setupLlmPanel();

function openExportModal() {
  if (!exportModal) return;
  updateExportSeqUI();
  exportModal.hidden = false;
}
function closeExportModal() {
  if (!exportModal) return;
  exportModal.hidden = true;
}

btnExport?.addEventListener('click', openExportModal);
btnCloseExportModal?.addEventListener('click', closeExportModal);
exportModal?.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-close') === '1') closeExportModal();
});

function updateExportSeqUI() {
  if (!exportSeqRow || !exportSeqSelect) return;
  exportSeqSelect.innerHTML = '';
  const n = folders.sequences.length;
  if (n <= 1) {
    exportSeqRow.hidden = true;
    return;
  }
  folders.sequences.forEach((s, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `#${idx + 1} ${s.folderName}`;
    exportSeqSelect.appendChild(opt);
  });
  exportSeqRow.hidden = false;
}

btnExportSeqApproved?.addEventListener('click', () => {
  const i = Number(exportSeqSelect?.value || '0');
  exportSequenceByStatus(i, 'approved');
});
btnExportSeqRejected?.addEventListener('click', () => {
  const i = Number(exportSeqSelect?.value || '0');
  exportSequenceByStatus(i, 'rejected');
});

function openDimensionModal() {
  if (!dimensionModal) return;
  dimensionModal.hidden = false;
}
function closeDimensionModal() {
  if (!dimensionModal) return;
  dimensionModal.hidden = true;
  editingDimId = null;
}

dimensionModal?.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.getAttribute && t.getAttribute('data-close') === '1') closeDimensionModal();
});

let editingDimId = null;

function newId() {
  return `dim_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function renderDimensionChips() {
  if (!dimensionChips) return;
  ensureDefaultDimension();

  const customDims = dimensions.filter((d) => d.id !== 'default');
  // 默认态：只显示 +维度（不显示删除、不显示“无维度”标签）
  if (!customDims.length) {
    dimensionChips.innerHTML = '';
    if (btnDimDelete) btnDimDelete.hidden = true;
    return;
  }

  if (btnDimDelete) btnDimDelete.hidden = false;

  const wrap = document.createElement('div');
  wrap.className = 'chips';

  for (const d of customDims) {
    const chip = document.createElement('div');
    chip.className = 'chip' + (d.id === currentDimId ? ' chip--active' : '');
    chip.textContent = d.name;
    chip.title = d.desc || d.name;

    chip.addEventListener('click', () => {
      currentDimId = d.id;
      localStorage.setItem(LS_KEYS.currentDimId, String(currentDimId));
      updateStats();
      showCurrent();
      renderDimensionChips();
    });

    chip.addEventListener('dblclick', () => {
      editingDimId = d.id;
      dimName.value = d.name;
      dimDesc.value = d.desc || '';
      openDimensionModal();
      dimName.focus();
    });

    wrap.appendChild(chip);
  }

  dimensionChips.innerHTML = '';
  dimensionChips.appendChild(wrap);
}

btnDimAdd?.addEventListener('click', () => {
  editingDimId = null;
  dimName.value = '';
  dimDesc.value = '';
  openDimensionModal();
  dimName.focus();
});

btnDimCancel?.addEventListener('click', closeDimensionModal);

btnDimSave?.addEventListener('click', () => {
  const name = String(dimName.value || '').trim();
  const desc = String(dimDesc.value || '').trim();
  if (!name) return toast('保存失败', '维度名称不能为空');

  if (editingDimId) {
    const t = dimensions.find((x) => x.id === editingDimId);
    if (t) {
      t.name = name;
      t.desc = desc;
    }
  } else {
    const id = newId();
    dimensions.push({ id, name, desc });
    if (!sequenceStatusByDim[id]) sequenceStatusByDim[id] = {};
    for (const item of imageData) ensureItemKeyInAllDims(item.nameKey);
    currentDimId = id;
    localStorage.setItem(LS_KEYS.currentDimId, String(currentDimId));
  }

  ensureDefaultDimension();
  saveStatus();
  closeDimensionModal();
  renderDimensionChips();
  updateStats();
  showCurrent();
});

btnDimDelete?.addEventListener('click', () => {
  if (currentDimId === 'default') return toast('不能删除', '“无维度”不可删除');
  const ok = window.confirm('确认删除当前维度？这会删除该维度下的全部打标结果。');
  if (!ok) return;
  dimensions = dimensions.filter((d) => d.id !== currentDimId);
  delete sequenceStatusByDim[currentDimId];
  const nextCustom = dimensions.find((d) => d.id !== 'default');
  currentDimId = nextCustom ? nextCustom.id : 'default';
  ensureDefaultDimension();
  saveStatus();
  renderDimensionChips();
  updateStats();
  showCurrent();
});

btnMarkApproved.addEventListener('click', () => {
  const item = imageData[currentIndex];
  if (!item) return;
  const idx = getTargetSequenceIndex();
  markSequence(item.nameKey, idx, 'approved');
});
btnMarkNeedsOpt.addEventListener('click', () => {
  const item = imageData[currentIndex];
  if (!item) return;
  const idx = getTargetSequenceIndex();
  markSequence(item.nameKey, idx, 'needs_optimization');
});
btnMarkRejected.addEventListener('click', () => {
  const item = imageData[currentIndex];
  if (!item) return;
  const idx = getTargetSequenceIndex();
  markSequence(item.nameKey, idx, 'rejected');
});
btnClearMark.addEventListener('click', () => {
  const item = imageData[currentIndex];
  if (!item) return;
  const idx = getTargetSequenceIndex();
  if (idx == null) return;
  clearMark(item.nameKey, idx);
});

btnExportApproved.addEventListener('click', () => exportByStatus('approved'));
btnExportRejected.addEventListener('click', () => exportByStatus('rejected'));
btnExportNeedsOpt.addEventListener('click', () => exportByStatus('needs_optimization'));
btnExportAll.addEventListener('click', exportAll);

btnExportBackup.addEventListener('click', exportBackup);
inputImportBackup.addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  await importBackup(f);
  inputImportBackup.value = '';
});

btnQuickLoad.addEventListener('click', quickLoadStatus);
btnDismissRestore.addEventListener('click', () => (restoreBar.hidden = true));

document.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const item = imageData[currentIndex];
  if (!item) return;

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    next();
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    jumpToNextPending();
    return;
  }

  const idx = getTargetSequenceIndex();
  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault();
    markSequence(item.nameKey, idx, 'approved');
  } else if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    markSequence(item.nameKey, idx, 'needs_optimization');
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    markSequence(item.nameKey, idx, 'rejected');
  }
});

// Drag & drop (files)
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (!dt) return;
  const files = Array.from(dt.files || []);
  if (!files.length) return;
  const zips = files.filter((f) => extLower(f.name) === '.zip');
  if (zips.length === 1 && files.length === 1) {
    await handleZipFile(zips[0]);
    return;
  }
  // folder drop usually comes as files with webkitRelativePath
  await handleFolderInput(files);
});

// --------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  // load status first (so referenceSequences affects processImages after file restore)
  loadStatus();
  renderDimensionChips();
  updateSequenceList();
  showCurrent();
  setTimeout(() => {
    checkAndLoadPreviousFiles().catch((err) => {
      console.error(err);
      toast('恢复失败', String(err?.message || err));
    });
  }, 450);
});


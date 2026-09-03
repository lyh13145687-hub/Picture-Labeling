/* global JSZip */

(() => {
  'use strict';

  const DB_NAME = 'taxonomyLabelingDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'project';
  const STATE_KEY = 'taxonomyLabeling_state_v1';
  const FILES_KEY = 'files';
  const VALIDATION_FILES_KEY = 'validationFiles';
  const PROJECT_VERSION = '1.0';
  const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.mov']);

  const $ = (id) => document.getElementById(id);
  const runtimeFiles = new Map();
  const runtimeValidationFiles = new Map();
  const selectedIds = new Set();
  let objectUrls = [];
  let reviewObjectUrls = [];
  let matchObjectUrls = [];
  let lastSelectedIndex = null;
  let pendingState = null;
  let editingImageId = null;
  let editingTargets = [];
  let detailObjectUrl = '';
  let detailScale = 1;
  let detailPanX = 0;
  let detailPanY = 0;
  let detailDrag = null;
  let labelPickerHandler = null;
  let gridObserver = null;
  let gridCursorIndex = 0;
  let undoTimer = null;
  let reviewCursorIndex = 0;
  let reviewRefs = null;
  let reviewNoteTimer = null;

  const dom = {
    stat: $('taxonomyStat'),
    selectedStat: $('taxonomySelectedStat'),
    axisChips: $('taxonomyAxisChips'),
    stageLabel: $('taxonomyStageLabel'),
    stageReview: $('taxonomyStageReview'),
    addAxis: $('taxonomyAddAxis'),
    importButton: $('taxonomyImport'),
    apiButton: $('taxonomyApi'),
    exportButton: $('taxonomyExport'),
    search: $('taxonomySearch'),
    filterToggle: $('taxonomyFilterToggle'),
    filterMenu: $('taxonomyFilterMenu'),
    nextIncomplete: $('taxonomyNextIncomplete'),
    nextDifference: $('taxonomyNextDifference'),
    grid: $('taxonomyGrid'),
    reviewGrid: $('taxonomyReviewGrid'),
    empty: $('taxonomyEmpty'),
    foot: document.querySelector('.taxonomyFoot'),
    reviewFoot: $('taxonomyReviewFoot'),
    reviewPrev: $('taxonomyReviewPrev'),
    reviewNext: $('taxonomyReviewNext'),
    reviewPos: $('taxonomyReviewPos'),
    addIssueTag: $('taxonomyAddIssueTag'),
    deleteValidation: $('taxonomyDeleteValidation'),
    deleteValidationModal: $('taxonomyDeleteValidationModal'),
    deleteValidationList: $('taxonomyDeleteValidationList'),
    matchModal: $('taxonomyMatchModal'),
    matchTitle: $('taxonomyMatchTitle'),
    matchList: $('taxonomyMatchList'),
    deleteValidationConflicts: $('taxonomyDeleteValidationConflicts'),
    deleteValidationExtras: $('taxonomyDeleteValidationExtras'),
    deleteValidationAll: $('taxonomyDeleteValidationAll'),
    emptyImport: $('taxonomyEmptyImport'),
    targetTag: $('taxonomyTargetTag'),
    applyTag: $('taxonomyApplyTag'),
    removeTag: $('taxonomyRemoveTag'),
    editImage: $('taxonomyEditImage'),
    selectAll: $('taxonomySelectAll'),
    clearSelection: $('taxonomyClearSelection'),
    deleteImages: $('taxonomyDeleteImages'),
    clearAll: $('taxonomyClearAll'),
    toastWrap: $('taxonomyToastWrap'),
    restoreBar: $('taxonomyRestoreBar'),
    restore: $('taxonomyRestore'),
    dismissRestore: $('taxonomyDismissRestore'),
    folderInput: $('taxonomyFolderInput'),
    zipInput: $('taxonomyZipInput'),
    jsonInput: $('taxonomyJsonInput'),
    validationFolderInput: $('taxonomyValidationFolderInput'),
    validationZipInput: $('taxonomyValidationZipInput'),
    validationJsonInput: $('taxonomyValidationJsonInput'),
    importModal: $('taxonomyImportModal'),
    chooseFolder: $('taxonomyChooseFolder'),
    chooseZip: $('taxonomyChooseZip'),
    tagsModal: $('taxonomyTagsModal'),
    categoryList: $('taxonomyCategoryList'),
    addCategoryFromList: $('taxonomyAddCategoryFromList'),
    editModal: $('taxonomyEditModal'),
    editTitle: $('taxonomyEditTitle'),
    detailMedia: $('taxonomyDetailMedia'),
    closeDetail: $('taxonomyCloseDetail'),
    targets: $('taxonomyTargets'),
    addTarget: $('taxonomyAddTarget'),
    note: $('taxonomyNote'),
    prevImage: $('taxonomyPrevImage'),
    nextImage: $('taxonomyNextImage'),
    labelPickerModal: $('taxonomyLabelPickerModal'),
    labelPickerTitle: $('taxonomyLabelPickerTitle'),
    labelPicker: $('taxonomyLabelPicker'),
    exportModal: $('taxonomyExportModal'),
    exportJson: $('taxonomyExportJson'),
    exportCsv: $('taxonomyExportCsv'),
    importJson: $('taxonomyImportJson'),
    exportReviewSummary: $('taxonomyExportReviewSummary'),
    apiModal: $('taxonomyApiModal'),
    apiQuick: $('taxonomyApiQuick'),
    apiTest: $('taxonomyApiTest'),
    apiStatus: $('taxonomyApiStatus'),
    apiEndpoint: $('taxonomyApiEndpoint'),
    apiModel: $('taxonomyApiModel'),
    apiKey: $('taxonomyApiKey'),
    apiSave: $('taxonomyApiSave'),
    apiClear: $('taxonomyApiClear'),
    aiContext: $('taxonomyAiContext'),
    aiPrompt: $('taxonomyAiPrompt'),
    aiSend: $('taxonomyAiSend'),
    aiStatus: $('taxonomyAiStatus'),
    aiResult: $('taxonomyAiResult'),
    aiDownload: $('taxonomyAiDownload'),
    validationImportModal: $('taxonomyValidationImportModal'),
    chooseValidationFolder: $('taxonomyChooseValidationFolder'),
    chooseValidationZip: $('taxonomyChooseValidationZip'),
    chooseValidationJson: $('taxonomyChooseValidationJson'),
  };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function defaultState() {
    return {
      version: PROJECT_VERSION,
      stage: 'label',
      axes: [{ id: 'axis_folder', name: '文件夹分类', tags: [] }],
      issueTags: [],
      images: [],
      validationImages: [],
      currentAxisId: 'axis_folder',
      selectedTagId: '',
      search: '',
      filterTagId: '',
      quickFilter: '',
      reviewSearch: '',
      differenceFilter: '',
      reviewIssueTagId: '',
      updatedAt: Date.now(),
    };
  }

  let state = defaultState();

  function extLower(name) {
    const index = String(name || '').lastIndexOf('.');
    return index >= 0 ? String(name).slice(index).toLowerCase() : '';
  }

  function isAllowedFile(file) {
    const type = String(file?.type || '').toLowerCase();
    return ALLOWED_EXT.has(extLower(file?.name)) || type.startsWith('image/') || type.startsWith('video/');
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
  }

  function stableId(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `img_${(hash >>> 0).toString(36)}`;
  }

  function currentAxis() {
    return state.axes.find((axis) => axis.id === state.currentAxisId) || state.axes[0] || null;
  }

  function findTagName(tagId) {
    for (const axis of state.axes) {
      const tag = axis.tags.find((item) => item.id === tagId);
      if (tag) return tag.name;
    }
    return '';
  }

  function normalizeIssueCounts(image) {
    const counts = {};
    if (image?.issueCounts && typeof image.issueCounts === 'object') {
      for (const [tagId, rawCount] of Object.entries(image.issueCounts)) {
        const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
        if (count > 0) counts[String(tagId)] = count;
      }
    }
    for (const tagId of Array.isArray(image?.issues) ? image.issues : []) {
      const id = String(tagId);
      if (!counts[id]) counts[id] = 1;
    }
    return counts;
  }

  function issueCount(image, tagId) {
    return Math.max(0, Math.trunc(Number(image?.issueCounts?.[tagId]) || 0));
  }

  function syncIssueIds(image) {
    image.issues = Object.entries(image.issueCounts || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([tagId]) => tagId);
  }

  function syncClassificationsFromTargets(image) {
    const next = {};
    for (const axis of state.axes) next[axis.id] = [];
    for (const target of image.targets) {
      for (const [axisId, tagId] of Object.entries(target.labelsByAxis || {})) {
        if (!next[axisId]) next[axisId] = [];
        if (!next[axisId].includes(tagId)) next[axisId].push(tagId);
      }
    }
    image.classifications = next;
  }

  function assignTagToTarget(image, axisId, tagId) {
    if (image.targets.some((target) => target.labelsByAxis?.[axisId] === tagId)) return;
    let target = image.targets.find((item) => !item.labelsByAxis?.[axisId]);
    if (!target) {
      target = { id: uid('target'), labelsByAxis: {}, count: 1 };
      image.targets.push(target);
    }
    target.labelsByAxis[axisId] = tagId;
  }

  function ensureTargetsForImage(image) {
    if (!Array.isArray(image.targets)) image.targets = [];
    const pending = [];
    for (const axis of state.axes) {
      for (const tagId of image.classifications?.[axis.id] || []) {
        if (!image.targets.some((target) => target.labelsByAxis?.[axis.id] === tagId)) {
          pending.push({ axisId: axis.id, tagId });
        }
      }
    }
    pending.forEach(({ axisId, tagId }) => assignTagToTarget(image, axisId, tagId));
    syncClassificationsFromTargets(image);
  }

  function removeTagFromTargets(image, axisId, tagId) {
    for (const target of image.targets) {
      if (target.labelsByAxis?.[axisId] === tagId) delete target.labelsByAxis[axisId];
    }
    image.targets = image.targets.filter((target) => Object.keys(target.labelsByAxis || {}).length);
    syncClassificationsFromTargets(image);
  }

  function normalizeState(value) {
    const next = defaultState();
    if (!value || typeof value !== 'object') return next;

    if (Array.isArray(value.axes)) {
      next.axes = value.axes
        .filter((axis) => axis && typeof axis === 'object')
        .map((axis) => ({
          id: String(axis.id || uid('axis')),
          name: String(axis.name || '未命名分类'),
          tags: Array.isArray(axis.tags)
            ? axis.tags
                .filter((tag) => tag && typeof tag === 'object')
                .map((tag) => ({
                  id: String(tag.id || uid('tag')),
                  name: String(tag.name || '未命名标签'),
                }))
            : [],
        }));
    }
    if (!next.axes.length) next.axes = defaultState().axes;

    if (Array.isArray(value.issueTags)) {
      next.issueTags = value.issueTags
        .filter((tag) => tag && typeof tag === 'object' && tag.name)
        .map((tag) => ({ id: String(tag.id || uid('issue')), name: String(tag.name) }));
    }

    if (Array.isArray(value.images)) {
      next.images = value.images
        .filter((image) => image && typeof image === 'object' && image.id && image.originalName)
        .map((image) => {
          const classifications = {};
          if (image.classifications && typeof image.classifications === 'object') {
            for (const [axisId, tagIds] of Object.entries(image.classifications)) {
              classifications[String(axisId)] = Array.isArray(tagIds)
                ? Array.from(new Set(tagIds.map(String)))
                : [];
            }
          }
          const targets = Array.isArray(image.targets)
            ? image.targets
                .filter((target) => target && typeof target === 'object')
                .map((target) => {
                  const labelsByAxis = {};
                  if (target.labelsByAxis && typeof target.labelsByAxis === 'object') {
                    for (const [axisId, tagId] of Object.entries(target.labelsByAxis)) {
                      if (tagId) labelsByAxis[String(axisId)] = String(tagId);
                    }
                  }
                  const rawCount = target.count;
                  return {
                    id: String(target.id || uid('target')),
                    labelsByAxis,
                    count:
                      rawCount === null || rawCount === '' || rawCount === undefined
                        ? null
                        : Math.max(0, Math.trunc(Number(rawCount) || 0)),
                  };
                })
            : [];
          return {
            id: String(image.id),
            fileKey: String(image.fileKey || `${image.sourceFolder || ''}/${image.originalName}`),
            originalName: String(image.originalName),
            sourceFolder: String(image.sourceFolder || ''),
            type: String(image.type || ''),
            classifications,
            targets,
            note: String(image.note || ''),
          };
        });
    }

    next.validationImages = Array.isArray(value.validationImages)
      ? value.validationImages
          .filter((image) => image && image.id && image.originalName)
          .map((image) => ({
            id: String(image.id),
            fileKey: String(image.fileKey || image.originalName),
            originalName: String(image.originalName),
            sourceFolder: String(image.sourceFolder || ''),
            validationColumnId: String(
              image.validationColumnId || image.sourceFolder || 'validation_default',
            ),
            validationColumnName: String(
              image.validationColumnName || image.sourceFolder || '验证集',
            ),
            manualSourceId: String(image.manualSourceId || ''),
            type: String(image.type || ''),
            targets: Array.isArray(image.targets)
              ? image.targets.map((target) => ({
                  id: String(target.id || uid('validation_target')),
                  labelsByAxis: { ...(target.labelsByAxis || {}) },
                  count:
                    target.count === null || target.count === undefined
                      ? null
                      : Math.max(0, Math.trunc(Number(target.count) || 0)),
                }))
              : [],
            verdicts:
              image.verdicts && typeof image.verdicts === 'object'
                ? Object.fromEntries(
                    Object.entries(image.verdicts)
                      .filter(([, verdict]) => verdict === 'pass' || verdict === 'fail')
                      .map(([key, verdict]) => [String(key), verdict]),
                  )
                : {},
            issueCounts: normalizeIssueCounts(image),
            issues: Object.keys(normalizeIssueCounts(image)),
            note: String(image.note || ''),
          }))
      : [];

    const requestedAxis = String(value.currentAxisId || '');
    next.currentAxisId = next.axes.some((axis) => axis.id === requestedAxis)
      ? requestedAxis
      : next.axes[0].id;
    const axis = next.axes.find((item) => item.id === next.currentAxisId);
    const requestedTag = String(value.selectedTagId || '');
    next.selectedTagId = axis?.tags.some((tag) => tag.id === requestedTag)
      ? requestedTag
      : axis?.tags[0]?.id || '';
    next.search = String(value.search || '');
    next.quickFilter = [
      'unclassified',
      'missingCount',
      'hasNote',
      'missingValidation',
    ].includes(value.quickFilter)
      ? value.quickFilter
      : '';
    next.stage = value.stage === 'review' ? 'review' : 'label';
    next.reviewSearch = String(value.reviewSearch || '');
    next.differenceFilter = [
      'fail',
      'pending',
      'missing',
      'extra',
      'conflict',
      'hasIssue',
      'hasNote',
    ].includes(value.differenceFilter)
      ? value.differenceFilter
      : '';
    const requestedIssueTag = String(value.reviewIssueTagId || '');
    next.reviewIssueTagId = next.issueTags.some((tag) => tag.id === requestedIssueTag)
      ? requestedIssueTag
      : '';
    next.filterTagId = axis?.tags.some((tag) => tag.id === value.filterTagId)
      ? String(value.filterTagId)
      : '';
    next.updatedAt = Number(value.updatedAt) || Date.now();
    return next;
  }

  function toast(title, message, ms = 2200, action = null) {
    const item = document.createElement('div');
    item.className = 'toast';
    item.innerHTML = '<div class="toast__k"></div><div class="toast__v"></div>';
    item.querySelector('.toast__k').textContent = title;
    item.querySelector('.toast__v').textContent = message;
    if (action?.label && typeof action.onClick === 'function') {
      const button = document.createElement('button');
      button.className = 'btn btn--chip toast__action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        action.onClick();
        item.remove();
      });
      item.appendChild(button);
    }
    dom.toastWrap.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(4px)';
    }, ms);
    setTimeout(() => item.remove(), ms + 350);
  }

  function snapshotState() {
    return JSON.parse(JSON.stringify(state));
  }

  function offerUndo(previousState, message) {
    if (undoTimer) clearTimeout(undoTimer);
    toast('已删除', message, 5000, {
      label: '撤销',
      onClick: () => {
        state = normalizeState(previousState);
        saveState();
        renderAll();
        if (!dom.tagsModal.hidden) renderCategoryList();
        toast('已撤销', '内容已恢复');
      },
    });
    undoTimer = setTimeout(() => {
      undoTimer = null;
    }, 5000);
  }

  function openModal(element) {
    if (element) element.hidden = false;
  }

  function closeModal(element) {
    if (element) element.hidden = true;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function saveState() {
    state.updatedAt = Date.now();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  async function saveFiles() {
    const packed = [];
    for (const image of state.images) {
      const file = runtimeFiles.get(image.id);
      if (!file) continue;
      packed.push({
        id: image.id,
        name: file.name,
        type: file.type || image.type || '',
        lastModified: file.lastModified || Date.now(),
        data: await file.arrayBuffer(),
      });
    }
    await dbPut(FILES_KEY, packed);
  }

  async function saveValidationFiles() {
    const packed = [];
    for (const image of state.validationImages) {
      const file = runtimeValidationFiles.get(image.id);
      if (!file) continue;
      packed.push({
        id: image.id,
        name: file.name,
        type: file.type || image.type || '',
        lastModified: file.lastModified || Date.now(),
        data: await file.arrayBuffer(),
      });
    }
    await dbPut(VALIDATION_FILES_KEY, packed);
  }

  async function loadFiles() {
    const packed = await dbGet(FILES_KEY);
    runtimeFiles.clear();
    for (const item of Array.isArray(packed) ? packed : []) {
      const blob = new Blob([item.data], { type: item.type || '' });
      const file = new File([blob], item.name, {
        type: item.type || '',
        lastModified: item.lastModified || Date.now(),
      });
      runtimeFiles.set(String(item.id), file);
    }
    return runtimeFiles.size > 0;
  }

  async function loadValidationFiles() {
    const packed = await dbGet(VALIDATION_FILES_KEY);
    runtimeValidationFiles.clear();
    for (const item of Array.isArray(packed) ? packed : []) {
      const blob = new Blob([item.data], { type: item.type || '' });
      runtimeValidationFiles.set(
        String(item.id),
        new File([blob], item.name, {
          type: item.type || '',
          lastModified: item.lastModified || Date.now(),
        }),
      );
    }
    return runtimeValidationFiles.size > 0;
  }

  function ensureFolderAxis() {
    let axis = state.axes.find((item) => item.id === 'axis_folder');
    if (!axis) {
      axis = { id: 'axis_folder', name: '文件夹分类', tags: [] };
      state.axes.unshift(axis);
    }
    return axis;
  }

  function ensureFilenameAxis() {
    let axis = state.axes.find((item) => item.id === 'axis_filename');
    if (!axis) {
      axis = { id: 'axis_filename', name: '文件名分类', tags: [] };
      const folderIndex = state.axes.findIndex((item) => item.id === 'axis_folder');
      state.axes.splice(folderIndex >= 0 ? folderIndex + 1 : state.axes.length, 0, axis);
    }
    return axis;
  }

  function filenameCategory(name) {
    const text = String(name || '');
    const extensionIndex = text.lastIndexOf('.');
    const stem = extensionIndex > 0 ? text.slice(0, extensionIndex) : text;
    const inferred = stem.replace(/[\s_-]*\d+$/u, '').trim();
    return inferred || stem.trim() || '未分类';
  }

  function ensureTag(axis, name) {
    let tag = axis.tags.find((item) => item.name === name);
    if (!tag) {
      tag = { id: uid('tag'), name };
      axis.tags.push(tag);
    }
    return tag;
  }

  function folderNameForPath(parts) {
    if (parts.length >= 3) return parts[1];
    return parts[0] || '未分类';
  }

  function groupFolderFiles(files) {
    const groups = new Map();
    for (const file of Array.from(files).filter(isAllowedFile)) {
      const relativePath = String(file.webkitRelativePath || file.name).replace(/\\/g, '/');
      const parts = relativePath.split('/').filter(Boolean);
      const folderName = folderNameForPath(parts);
      const fileKey = relativePath || `${folderName}/${file.name}`;
      if (!groups.has(folderName)) groups.set(folderName, []);
      groups.get(folderName).push({ file, fileKey });
    }
    return groups;
  }

  async function groupsFromZip(zipFile) {
    if (typeof JSZip === 'undefined') throw new Error('未加载本地 JSZip');
    const zip = await JSZip.loadAsync(zipFile);
    const groups = new Map();
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const parts = String(entry.name).split('/').filter(Boolean);
      const fileName = parts[parts.length - 1] || '';
      if (!ALLOWED_EXT.has(extLower(fileName))) continue;
      const folderName = folderNameForPath(parts);
      const blob = await entry.async('blob');
      const file = new File([blob], fileName, {
        type: blob.type || (extLower(fileName) === '.mp4' ? 'video/mp4' : ''),
        lastModified: Date.now(),
      });
      if (!groups.has(folderName)) groups.set(folderName, []);
      groups.get(folderName).push({ file, fileKey: entry.name });
    }
    return groups;
  }

  async function ingestGroups(groups) {
    if (!groups.size) {
      toast('导入失败', '没有找到支持的图片或视频');
      return;
    }

    const folderAxis = ensureFolderAxis();
    const filenameAxis = ensureFilenameAxis();
    const existingByKey = new Map(state.images.map((image) => [image.fileKey, image]));
    let added = 0;

    for (const [folderName, entries] of groups.entries()) {
      const folderTag = ensureTag(folderAxis, folderName);
      for (const { file, fileKey } of entries) {
        const filenameTag = ensureTag(filenameAxis, filenameCategory(file.name));
        let image = existingByKey.get(fileKey);
        if (!image) {
          let id = stableId(fileKey);
          while (state.images.some((item) => item.id === id && item.fileKey !== fileKey)) {
            id = uid('img');
          }
          image = {
            id,
            fileKey,
            originalName: file.name,
            sourceFolder: folderName,
            type: file.type || '',
            classifications: {},
            targets: [],
            note: '',
          };
          state.images.push(image);
          existingByKey.set(fileKey, image);
          added++;
        }
        if (!Array.isArray(image.classifications[folderAxis.id])) {
          image.classifications[folderAxis.id] = [];
        }
        if (!image.classifications[folderAxis.id].includes(folderTag.id)) {
          image.classifications[folderAxis.id].push(folderTag.id);
        }
        if (!Array.isArray(image.classifications[filenameAxis.id])) {
          image.classifications[filenameAxis.id] = [];
        }
        if (!image.classifications[filenameAxis.id].includes(filenameTag.id)) {
          image.classifications[filenameAxis.id].push(filenameTag.id);
        }
        ensureTargetsForImage(image);
        runtimeFiles.set(image.id, file);
      }
    }

    state.images.sort((a, b) => {
      const folderResult = naturalCompare(a.sourceFolder, b.sourceFolder);
      return folderResult || naturalCompare(a.originalName, b.originalName);
    });
    state.currentAxisId = folderAxis.id;
    if (!state.selectedTagId || !folderAxis.tags.some((tag) => tag.id === state.selectedTagId)) {
      state.selectedTagId = folderAxis.tags[0]?.id || '';
    }
    saveState();
    await saveFiles();
    renderAll();
    toast('导入完成', `新增 ${added} 张，当前共 ${state.images.length} 张`);
  }

  function selectedValidationImportMode() {
    return (
      document.querySelector('input[name="taxonomyValidationMode"]:checked')?.value || 'merge'
    );
  }

  function validationImportColumns(groups, mode) {
    if (mode === 'merge') {
      return [
        {
          id: 'validation_merged',
          name: '验证集',
          entries: Array.from(groups.entries()).flatMap(([sourceFolder, entries]) =>
            entries.map((entry) => ({ ...entry, sourceFolder })),
          ),
        },
      ];
    }
    return Array.from(groups.entries()).map(([folderName, entries]) => ({
      id: `validation_split_${stableId(folderName)}`,
      name: folderName,
      entries: entries.map((entry) => ({ ...entry, sourceFolder: folderName })),
    }));
  }

  async function ingestValidationGroups(groups, mode = selectedValidationImportMode()) {
    if (!groups.size) return toast('导入失败', '没有找到支持的验证集文件');
    const existingByKey = new Map();
    state.validationImages.forEach((image) => {
      const columnId = image.validationColumnId || image.sourceFolder || 'validation_default';
      existingByKey.set(`${columnId}::${image.sourceFolder}::${image.originalName}`, image);
      if (image.validationColumnName) {
        existingByKey.set(
          `${image.validationColumnName}::${image.sourceFolder}::${image.originalName}`,
          image,
        );
      }
    });
    let added = 0;
    let imported = 0;
    for (const column of validationImportColumns(groups, mode)) {
      const folderName = column.name;
      const entries = column.entries;
      for (const { file, fileKey, sourceFolder } of entries) {
        const matchFolder = sourceFolder || folderName;
        const identity = `${column.id}::${matchFolder}::${file.name}`;
        let image =
          existingByKey.get(identity) ||
          existingByKey.get(`${column.name}::${matchFolder}::${file.name}`);
        if (!image) {
          image = {
            id: `validation_${stableId(identity)}`,
            fileKey,
            originalName: file.name,
            sourceFolder: matchFolder,
            validationColumnId: column.id,
            validationColumnName: column.name,
            manualSourceId: '',
            type: file.type || '',
            targets: [],
            verdicts: {},
            issueCounts: {},
            issues: [],
            note: '',
          };
          state.validationImages.push(image);
          existingByKey.set(identity, image);
          added++;
        } else {
          image.fileKey = fileKey;
          image.sourceFolder = matchFolder;
          image.validationColumnId = column.id;
          image.validationColumnName = column.name;
          image.type = file.type || image.type || '';
        }
        runtimeValidationFiles.set(image.id, file);
        imported++;
      }
    }
    state.validationImages.sort((a, b) => naturalCompare(a.originalName, b.originalName));
    state.stage = 'review';
    reviewCursorIndex = 0;
    saveState();
    await saveValidationFiles();
    renderAll();
    closeModal(dom.validationImportModal);
    toast('验证集已导入', `导入 ${imported} 张，其中新增 ${added} 张`);
  }

  function resolveValidationLabels(labelsByAxis) {
    const resolved = {};
    if (!labelsByAxis || typeof labelsByAxis !== 'object') return resolved;
    for (const [rawAxis, rawTag] of Object.entries(labelsByAxis)) {
      if (!rawTag) continue;
      const axis =
        state.axes.find((item) => item.id === rawAxis) ||
        state.axes.find((item) => item.name === String(rawAxis));
      if (!axis) continue;
      const tag =
        axis.tags.find((item) => item.id === rawTag) ||
        axis.tags.find((item) => item.name === String(rawTag));
      if (!tag) continue;
      resolved[axis.id] = tag.id;
    }
    return resolved;
  }

  async function importValidationJson(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed.images) ? parsed.images : [];
      if (!incoming.length) throw new Error('JSON 中没有检测结果');
      const byName = new Map();
      incoming.forEach((image) => {
        const name = String(image.originalName || '');
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(image);
      });
      let applied = 0;
      for (const image of state.validationImages) {
        const candidates = byName.get(image.originalName) || [];
        const matched =
          candidates.find((item) => String(item.fileKey || '') === image.fileKey) ||
          (candidates.length === 1 ? candidates[0] : null);
        if (!matched) continue;
        image.targets = Array.isArray(matched.targets)
          ? matched.targets.map((target) => ({
              id: String(target.id || uid('validation_target')),
              labelsByAxis: resolveValidationLabels(target.labelsByAxis || {}),
              count:
                target.count === null || target.count === undefined
                  ? null
                  : Math.max(0, Math.trunc(Number(target.count) || 0)),
            }))
          : [];
        image.issueCounts = normalizeIssueCounts(matched);
        syncIssueIds(image);
        image.note = String(matched.note || '');
        const source = state.images.find((item) => item.originalName === image.originalName);
        if (source) image.verdicts = deriveVerdictsFromTargets(source, image);
        applied++;
      }
      if (!state.validationImages.length) {
        for (const [name, list] of byName.entries()) {
          list.forEach((matched, index) => {
            state.validationImages.push({
              id: `validation_${stableId(`${name}_${index}`)}`,
              fileKey: String(matched.fileKey || name),
              originalName: name,
              sourceFolder: String(matched.sourceFolder || ''),
              validationColumnId: String(
                matched.validationColumnId ||
                  matched.sourceFolder ||
                  'validation_merged',
              ),
              validationColumnName: String(
                matched.validationColumnName || matched.sourceFolder || '验证集',
              ),
              manualSourceId: String(matched.manualSourceId || ''),
              type: String(matched.type || ''),
              targets: Array.isArray(matched.targets)
                ? matched.targets.map((target) => ({
                    id: String(target.id || uid('validation_target')),
                    labelsByAxis: resolveValidationLabels(target.labelsByAxis || {}),
                    count:
                      target.count === null || target.count === undefined
                        ? null
                        : Math.max(0, Math.trunc(Number(target.count) || 0)),
                  }))
                : [],
              verdicts: {},
              issueCounts: normalizeIssueCounts(matched),
              issues: Object.keys(normalizeIssueCounts(matched)),
              note: String(matched.note || ''),
            });
            applied++;
          });
        }
        state.validationImages.sort((a, b) => naturalCompare(a.originalName, b.originalName));
        for (const image of state.validationImages) {
          const source = state.images.find((item) => item.originalName === image.originalName);
          if (source) image.verdicts = deriveVerdictsFromTargets(source, image);
        }
      }
      state.stage = 'review';
      reviewCursorIndex = 0;
      saveState();
      renderAll();
      closeModal(dom.validationImportModal);
      toast('检测结果已导入', `已匹配 ${applied} 张图片`);
    } catch (error) {
      toast('导入失败', String(error?.message || error));
    }
  }

  function releaseObjectUrls() {
    gridObserver?.disconnect();
    gridObserver = null;
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function loadThumbnail(media) {
    if (media.dataset.loaded === '1') return;
    media.dataset.loaded = '1';
    const image = state.images.find((item) => item.id === media.dataset.imageId);
    const file = image ? runtimeFiles.get(image.id) : null;
    if (!image || !file) {
      const empty = document.createElement('span');
      empty.className = 'cell__empty';
      empty.textContent = '文件未恢复';
      media.appendChild(empty);
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    if (String(file.type).startsWith('video/') || ['.mp4', '.mov'].includes(extLower(file.name))) {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      media.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = image.originalName;
      img.loading = 'lazy';
      media.appendChild(img);
    }
  }

  function imageIsIncomplete(image) {
    if (!image.targets.length) return true;
    return image.targets.some(
      (target) =>
        target.count === null ||
        state.axes.some((axis) => axis.tags.length && !target.labelsByAxis?.[axis.id]),
    );
  }

  function filteredImages() {
    const query = state.search.trim().toLocaleLowerCase('zh-CN');
    const missingValidationIds =
      state.quickFilter === 'missingValidation' ? collectMissingValidationSourceIds() : null;
    return state.images.filter((image) => {
      if (query && !image.originalName.toLocaleLowerCase('zh-CN').includes(query)) return false;
      if (state.filterTagId) {
        const tags = image.classifications[state.currentAxisId] || [];
        if (!tags.includes(state.filterTagId)) return false;
      }
      if (
        state.quickFilter === 'unclassified' &&
        Object.values(image.classifications).some((ids) => Array.isArray(ids) && ids.length)
      ) {
        return false;
      }
      if (
        state.quickFilter === 'missingCount' &&
        !image.targets.some((target) => target.count === null)
      ) {
        return false;
      }
      if (state.quickFilter === 'hasNote' && !image.note.trim()) return false;
      if (missingValidationIds && !missingValidationIds.has(image.id)) return false;
      return true;
    });
  }

  function collectMissingValidationSourceIds() {
    const ids = new Set();
    for (const row of buildReviewRows()) {
      if (!row.source) continue;
      if (!row.cells.some((cell) => cell.image)) ids.add(row.source.id);
    }
    return ids;
  }

  function targetKey(target) {
    return Object.entries(target.labelsByAxis || {})
      .filter(([, tagId]) => tagId)
      .sort(([axisA], [axisB]) => axisA.localeCompare(axisB))
      .map(([axisId, tagId]) => `${axisId}:${tagId}`)
      .join('|');
  }

  function targetLabel(target) {
    return state.axes
      .map((axis) => findTagName(target.labelsByAxis?.[axis.id]))
      .filter(Boolean)
      .join(' + ');
  }

  function targetCountMap(image) {
    const map = new Map();
    for (const target of image?.targets || []) {
      const key = targetKey(target);
      if (!key) continue;
      const current = map.get(key) || { count: 0, label: targetLabel(target) || key };
      current.count += Number(target.count) || 0;
      map.set(key, current);
    }
    return map;
  }

  function expectedInstances(source) {
    const instances = [];
    for (const target of source?.targets || []) {
      const count = Number.isInteger(target.count) ? target.count : 1;
      const label = targetLabel(target) || '未命名目标';
      const key = targetKey(target);
      for (let index = 0; index < count; index++) {
        instances.push({ id: `${target.id}#${index}`, label, key });
      }
    }
    return instances;
  }

  function deriveVerdictsFromTargets(source, validation) {
    const actual = targetCountMap(validation);
    const used = new Map();
    const verdicts = {};
    for (const instance of expectedInstances(source)) {
      const available = actual.get(instance.key)?.count || 0;
      const consumed = used.get(instance.key) || 0;
      verdicts[instance.id] = consumed < available ? 'pass' : 'fail';
      used.set(instance.key, consumed + 1);
    }
    return verdicts;
  }

  function compareReviewCell(source, validation, conflict = false) {
    if (conflict) return { status: 'conflict', instances: [], differences: [] };
    if (!source) return { status: 'extra', instances: [], differences: [] };
    if (!validation) return { status: 'missing', instances: [], differences: [] };

    const verdicts = validation.verdicts || {};
    const instances = expectedInstances(source).map((instance) => ({
      ...instance,
      verdict: verdicts[instance.id] || '',
    }));
    const differences = instances.map((instance) => ({
      key: instance.key,
      label: instance.label,
      expected: 1,
      actual: instance.verdict === 'pass' ? 1 : 0,
    }));

    let status = 'ok';
    if (instances.some((instance) => instance.verdict === 'fail')) status = 'fail';
    else if (instances.some((instance) => !instance.verdict)) status = 'pending';

    return { status, instances, differences };
  }

  function validationColumns() {
    const columns = [];
    for (const image of state.validationImages) {
      const id = image.validationColumnId || image.sourceFolder || 'validation_default';
      if (columns.some((column) => column.id === id)) continue;
      columns.push({
        id,
        name: image.validationColumnName || image.sourceFolder || '验证集',
      });
    }
    if (!columns.length) columns.push({ id: 'validation_default', name: '验证集' });
    return columns;
  }

  function renderDeleteValidationList() {
    dom.deleteValidationList.innerHTML = '';
    const columns = validationColumns().filter((column) =>
      state.validationImages.some(
        (image) =>
          (image.validationColumnId || image.sourceFolder || 'validation_default') === column.id,
      ),
    );
    columns.forEach((column) => {
      const count = state.validationImages.filter(
        (image) =>
          (image.validationColumnId || image.sourceFolder || 'validation_default') === column.id,
      ).length;
      const row = document.createElement('div');
      row.className = 'taxonomyDeleteValidationRow';
      const label = document.createElement('span');
      label.textContent = `${column.name}（${count} 张）`;
      const button = document.createElement('button');
      button.className = 'btn';
      button.textContent = '删除此列';
      button.addEventListener('click', () => deleteValidationColumn(column.id, column.name));
      row.append(label, button);
      dom.deleteValidationList.appendChild(row);
    });
    const conflictCount = collectConflictValidationIds().size;
    dom.deleteValidationConflicts.disabled = conflictCount === 0;
    dom.deleteValidationConflicts.textContent =
      conflictCount > 0 ? `删除全部冲突文件名（${conflictCount}）` : '删除全部冲突文件名';
    const extraCount = collectExtraValidationIds().size;
    dom.deleteValidationExtras.disabled = extraCount === 0;
    dom.deleteValidationExtras.textContent =
      extraCount > 0 ? `删除全部多出（${extraCount}）` : '删除全部多出';
  }

  function collectConflictValidationIds() {
    const ids = new Set();
    const columns = validationColumns();
    const sourcesByName = new Map();
    state.images.forEach((image) => {
      if (!sourcesByName.has(image.originalName)) sourcesByName.set(image.originalName, []);
      sourcesByName.get(image.originalName).push(image);
    });
    const perColumn = new Map(columns.map((column) => [column.id, new Map()]));
    state.validationImages.forEach((image) => {
      const requestedColumn = image.validationColumnId || image.sourceFolder || 'validation_default';
      const columnId = perColumn.has(requestedColumn) ? requestedColumn : columns[0].id;
      const bucket = perColumn.get(columnId);
      if (!bucket.has(image.originalName)) bucket.set(image.originalName, []);
      bucket.get(image.originalName).push(image);
    });

    for (const source of state.images) {
      const name = source.originalName;
      const sameNameSources = sourcesByName.get(name) || [];
      const sameFolderSourceCount = sameNameSources.filter(
        (item) => item.sourceFolder === source.sourceFolder,
      ).length;
      for (const column of columns) {
        const candidates = perColumn.get(column.id).get(name) || [];
        const sameFolder = candidates.filter(
          (image) => image.sourceFolder === source.sourceFolder,
        );
        if (sameFolder.length) {
          if (sameFolder.length > 1 || sameFolderSourceCount > 1) {
            sameFolder.forEach((image) => ids.add(image.id));
          }
        } else if (candidates.length > 1 || (candidates.length && sameNameSources.length > 1)) {
          candidates.forEach((image) => ids.add(image.id));
        }
      }
    }
    return ids;
  }

  function collectExtraValidationIds() {
    const ids = new Set();
    for (const row of buildReviewRows()) {
      if (row.source) continue;
      for (const cell of row.cells) {
        if (cell.image && (cell.status === 'extra' || !row.source)) ids.add(cell.image.id);
      }
    }
    return ids;
  }

  async function removeValidationByIds(removedIds, message) {
    if (!removedIds.size) return;
    state.validationImages = state.validationImages.filter((image) => !removedIds.has(image.id));
    removedIds.forEach((id) => runtimeValidationFiles.delete(id));
    reviewCursorIndex = 0;
    saveState();
    await saveValidationFiles();
    closeModal(dom.deleteValidationModal);
    renderAll();
    toast('已删除', message);
  }

  async function deleteValidationColumn(columnId, columnName) {
    if (!window.confirm(`删除验证列“${columnName}”？`)) return;
    const removedIds = new Set(
      state.validationImages
        .filter(
          (image) =>
            (image.validationColumnId || image.sourceFolder || 'validation_default') === columnId,
        )
        .map((image) => image.id),
    );
    await removeValidationByIds(removedIds, `验证列“${columnName}”已删除`);
  }

  async function deleteConflictValidation() {
    const removedIds = collectConflictValidationIds();
    if (!removedIds.size) {
      toast('无需删除', '当前没有冲突的验证集图片');
      return;
    }
    if (
      !window.confirm(
        `删除 ${removedIds.size} 张冲突文件名的验证集图片？对比集和其余验证集不会被删除。`,
      )
    ) {
      return;
    }
    await removeValidationByIds(removedIds, `已删除 ${removedIds.size} 张冲突验证图`);
  }

  async function deleteExtraValidation() {
    const removedIds = collectExtraValidationIds();
    if (!removedIds.size) {
      toast('无需删除', '当前没有多出的验证集图片');
      return;
    }
    if (
      !window.confirm(
        `删除 ${removedIds.size} 张多出的验证集图片？对比集和已对齐的验证图不会被删除。`,
      )
    ) {
      return;
    }
    await removeValidationByIds(removedIds, `已删除 ${removedIds.size} 张多出验证图`);
  }

  async function deleteAllValidation() {
    if (!state.validationImages.length) return;
    if (!window.confirm('删除全部验证集？对比集和打标内容不会被删除。')) return;
    state.validationImages = [];
    runtimeValidationFiles.clear();
    reviewCursorIndex = 0;
    saveState();
    await saveValidationFiles();
    closeModal(dom.deleteValidationModal);
    renderAll();
    toast('已删除', '全部验证集已删除');
  }

  const STATUS_PRIORITY = ['conflict', 'extra', 'missing', 'fail', 'pending', 'ok'];

  function aggregateStatus(statuses) {
    for (const status of STATUS_PRIORITY) {
      if (statuses.includes(status)) return status;
    }
    return 'ok';
  }

  function buildReviewRows() {
    const columns = validationColumns();
    const sourcesByName = new Map();
    state.images.forEach((image) => {
      if (!sourcesByName.has(image.originalName)) sourcesByName.set(image.originalName, []);
      sourcesByName.get(image.originalName).push(image);
    });

    const sourceIds = new Set(state.images.map((image) => image.id));
    const perColumn = new Map(columns.map((column) => [column.id, new Map()]));
    const manualByColumnSource = new Map();
    const manualIds = new Set();
    state.validationImages.forEach((image) => {
      const requestedColumn = image.validationColumnId || image.sourceFolder || 'validation_default';
      const columnId = perColumn.has(requestedColumn)
        ? requestedColumn
        : columns[0].id;
      const bucket = perColumn.get(columnId);
      if (!bucket.has(image.originalName)) bucket.set(image.originalName, []);
      bucket.get(image.originalName).push(image);
      if (image.manualSourceId && sourceIds.has(image.manualSourceId)) {
        const key = `${columnId}\u0000${image.manualSourceId}`;
        if (!manualByColumnSource.has(key)) manualByColumnSource.set(key, []);
        manualByColumnSource.get(key).push(image);
        manualIds.add(image.id);
      }
    });

    const usedByColumn = new Map(columns.map((column) => [column.id, new Set()]));
    const rows = [];
    for (const source of state.images) {
      const name = source.originalName;
      const sameNameSources = sourcesByName.get(name) || [];
      const sameFolderSourceCount = sameNameSources.filter(
        (item) => item.sourceFolder === source.sourceFolder,
      ).length;
      const cells = columns.map((column) => {
        const used = usedByColumn.get(column.id);
        const manual = (manualByColumnSource.get(`${column.id}\u0000${source.id}`) || []).find(
          (image) => !used.has(image.id),
        );
        if (manual) {
          used.add(manual.id);
          return {
            column,
            image: manual,
            conflict: false,
            manual: true,
            ...compareReviewCell(source, manual, false),
          };
        }
        const candidates = (perColumn.get(column.id).get(name) || []).filter(
          (image) => !used.has(image.id) && !manualIds.has(image.id),
        );
        const sameFolder = candidates.filter(
          (image) => image.sourceFolder === source.sourceFolder,
        );
        let image = null;
        let conflict = false;

        if (sameFolder.length) {
          image = sameFolder[0];
          conflict = sameFolder.length > 1 || sameFolderSourceCount > 1;
        } else if (candidates.length) {
          image = candidates[0];
          conflict = candidates.length > 1 || sameNameSources.length > 1;
        }
        if (image) used.add(image.id);
        return {
          column,
          image,
          conflict,
          manual: false,
          ...compareReviewCell(source, image, conflict),
        };
      });
      rows.push({
        name,
        source,
        columns,
        cells,
        status: aggregateStatus(cells.map((cell) => cell.status)),
      });
    }

    const extraKeys = [];
    for (const column of columns) {
      const used = usedByColumn.get(column.id);
      for (const images of perColumn.get(column.id).values()) {
        for (const image of images) {
          if (used.has(image.id)) continue;
          const key = `${image.sourceFolder}\u0000${image.originalName}`;
          if (!extraKeys.includes(key)) extraKeys.push(key);
        }
      }
    }
    extraKeys
      .sort((a, b) => naturalCompare(a, b))
      .forEach((key) => {
        const [sourceFolder, name] = key.split('\u0000');
        const cells = columns.map((column) => {
          const used = usedByColumn.get(column.id);
          const image =
            (perColumn.get(column.id).get(name) || []).find(
              (item) => !used.has(item.id) && item.sourceFolder === sourceFolder,
            ) || null;
          if (image) used.add(image.id);
          return { column, image, conflict: false, manual: false, ...compareReviewCell(null, image) };
        });
        rows.push({ name, source: null, columns, cells, status: 'extra' });
      });

    return rows;
  }

  function imageLabel(image) {
    return `${image.sourceFolder ? `${image.sourceFolder} / ` : ''}${image.originalName}`;
  }

  function unmatchedValidationCandidates(columnId) {
    const list = [];
    for (const row of buildReviewRows()) {
      if (row.source) continue;
      row.cells.forEach((cell) => {
        if (cell.image && cell.column.id === columnId) list.push(cell.image);
      });
    }
    return list;
  }

  function unmatchedSourceCandidates(row) {
    const columnIds = row.cells.filter((cell) => cell.image).map((cell) => cell.column.id);
    const list = [];
    for (const candidate of buildReviewRows()) {
      if (!candidate.source) continue;
      const free = columnIds.every((columnId) => {
        const cell = candidate.cells.find((item) => item.column.id === columnId);
        return cell && !cell.image;
      });
      if (free) list.push(candidate.source);
    }
    return list;
  }

  function releaseMatchUrls() {
    matchObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    matchObjectUrls = [];
  }

  function renderMatchThumb(container, file, altText) {
    if (!file) {
      const empty = document.createElement('span');
      empty.className = 'taxonomyMatchRow__missing';
      empty.textContent = '未恢复';
      container.appendChild(empty);
      return;
    }
    const url = URL.createObjectURL(file);
    matchObjectUrls.push(url);
    if (String(file.type).startsWith('video/') || ['.mp4', '.mov'].includes(extLower(file.name))) {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      container.appendChild(video);
      return;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = altText;
    img.loading = 'lazy';
    container.appendChild(img);
  }

  function openMatchPicker(title, options) {
    releaseMatchUrls();
    dom.matchTitle.textContent = title;
    dom.matchList.innerHTML = '';
    if (!options.length) {
      const empty = document.createElement('p');
      empty.className = 'taxonomyMatchEmpty';
      empty.textContent = '没有可匹配的图片';
      dom.matchList.appendChild(empty);
    }
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taxonomyMatchRow';
      const thumb = document.createElement('span');
      thumb.className = 'taxonomyMatchRow__thumb';
      renderMatchThumb(thumb, option.file, option.name);
      const text = document.createElement('span');
      text.className = 'taxonomyMatchRow__text';
      const name = document.createElement('span');
      name.className = 'taxonomyMatchRow__name';
      name.textContent = option.name;
      text.appendChild(name);
      if (option.meta) {
        const meta = document.createElement('span');
        meta.className = 'taxonomyMatchRow__meta';
        meta.textContent = option.meta;
        text.appendChild(meta);
      }
      button.append(thumb, text);
      button.addEventListener('click', option.onPick);
      dom.matchList.appendChild(button);
    });
    openModal(dom.matchModal);
  }

  function closeMatchPicker() {
    releaseMatchUrls();
    dom.matchList.innerHTML = '';
    closeModal(dom.matchModal);
  }

  function openValidationMatchPicker(row, column) {
    const candidates = unmatchedValidationCandidates(column.id);
    openMatchPicker(
      `为「${imageLabel(row.source)}」选择「${column.name}」中多出的验证图`,
      candidates.map((image) => ({
        name: image.originalName,
        meta: image.sourceFolder,
        file: runtimeValidationFiles.get(image.id),
        onPick: () => applyManualMatch([image], row.source.id),
      })),
    );
  }

  function openSourceMatchPicker(row) {
    const images = row.cells.filter((cell) => cell.image).map((cell) => cell.image);
    if (!images.length) return;
    const candidates = unmatchedSourceCandidates(row);
    openMatchPicker(
      `为多出的「${row.name}」选择缺失验证图的对比集`,
      candidates.map((source) => ({
        name: source.originalName,
        meta: source.sourceFolder,
        file: runtimeFiles.get(source.id),
        onPick: () => applyManualMatch(images, source.id),
      })),
    );
  }

  function applyManualMatch(images, sourceId) {
    images.forEach((image) => {
      image.manualSourceId = sourceId;
    });
    saveState();
    closeMatchPicker();
    const rows = filteredReviewRows();
    const index = rows.findIndex((item) => item.source?.id === sourceId);
    if (index >= 0) reviewCursorIndex = index;
    renderReview();
    toast('已匹配', '缺失与多出的图片已手动对应');
  }

  function clearManualMatch(images) {
    images.forEach((image) => {
      image.manualSourceId = '';
    });
    saveState();
    renderReview();
    toast('已解除', '该图恢复为按文件名匹配');
  }

  function filteredReviewRows() {
    const query = state.reviewSearch.trim().toLocaleLowerCase('zh-CN');
    return buildReviewRows().filter((row) => {
      if (query && !row.name.toLocaleLowerCase('zh-CN').includes(query)) return false;
      if (!state.differenceFilter) return true;
      if (state.differenceFilter === 'hasIssue') {
        if (state.reviewIssueTagId) {
          return row.cells.some(
            (cell) => issueCount(cell.image, state.reviewIssueTagId) > 0,
          );
        }
        return row.cells.some((cell) =>
          state.issueTags.some((tag) => issueCount(cell.image, tag.id) > 0),
        );
      }
      if (state.differenceFilter === 'hasNote') {
        return (
          Boolean(row.source?.note?.trim()) ||
          row.cells.some((cell) => cell.image?.note?.trim())
        );
      }
      return row.status === state.differenceFilter;
    });
  }

  function findIssueTag(tagId) {
    return state.issueTags.find((tag) => tag.id === tagId) || null;
  }

  function releaseReviewUrls() {
    reviewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    reviewObjectUrls = [];
  }

  function renderReviewMedia(container, image, isValidation) {
    if (!image) {
      const empty = document.createElement('span');
      empty.className = 'taxonomyReviewCell__empty';
      empty.textContent = isValidation ? '缺' : '多';
      container.appendChild(empty);
      return;
    }
    const file = isValidation
      ? runtimeValidationFiles.get(image.id)
      : runtimeFiles.get(image.id);
    if (!file) {
      const empty = document.createElement('span');
      empty.className = 'cell__empty';
      empty.textContent = '文件未恢复';
      container.appendChild(empty);
      return;
    }
    const url = URL.createObjectURL(file);
    reviewObjectUrls.push(url);
    const media = document.createElement(
      String(file.type).startsWith('video/') ? 'video' : 'img',
    );
    media.src = url;
    if (media.tagName === 'VIDEO') media.controls = true;
    else media.alt = image.originalName;
    container.appendChild(media);
  }

  const CELL_STATUS_TEXT = {
    ok: '通过',
    fail: '未通过',
    pending: '未验收',
    missing: '缺',
    extra: '多',
    conflict: '冲突',
  };

  function cellStatusTone(status, image) {
    if (status === 'fail' || status === 'missing' || status === 'conflict') return 'bad';
    if (image?.issues?.length) return 'warn';
    if (status === 'ok') return 'ok';
    return '';
  }

  function setVerdict(cellRef, instanceId, verdict) {
    const image = cellRef.cell.image;
    if (!image) return;
    if (!image.verdicts || typeof image.verdicts !== 'object') image.verdicts = {};
    if (image.verdicts[instanceId] === verdict) delete image.verdicts[instanceId];
    else image.verdicts[instanceId] = verdict;
    saveState();
    refreshReviewCell(cellRef);
  }

  function setAllVerdicts(cellRef, verdict) {
    const image = cellRef.cell.image;
    if (!image || !reviewRefs?.row?.source) return;
    image.verdicts = {};
    expectedInstances(reviewRefs.row.source).forEach((instance) => {
      image.verdicts[instance.id] = verdict;
    });
    saveState();
    refreshReviewCell(cellRef);
  }

  function setIssueCount(cellRef, tagId, rawCount) {
    const image = cellRef.cell.image;
    if (!image) return;
    if (!image.issueCounts || typeof image.issueCounts !== 'object') image.issueCounts = {};
    const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
    if (count > 0) image.issueCounts[tagId] = count;
    else delete image.issueCounts[tagId];
    syncIssueIds(image);
    saveState();
    refreshReviewCell(cellRef);
  }

  function toggleIssue(cellRef, tagId) {
    setIssueCount(cellRef, tagId, issueCount(cellRef.cell.image, tagId) > 0 ? 0 : 1);
  }

  function addIssueTagFromReview() {
    const name = String(window.prompt('新增问题标签名称') || '').trim();
    if (!name) return;
    if (state.issueTags.some((tag) => tag.name === name)) {
      toast('添加失败', '问题标签已存在');
      return;
    }
    state.issueTags.push({ id: uid('issue'), name });
    saveState();
    rebuildReviewMeta();
    if (!dom.tagsModal.hidden) renderCategoryList();
    toast('已添加', `问题标签“${name}”可在各验证列勾选`);
  }

  function refreshReviewCell(cellRef) {
    const row = reviewRefs?.row;
    if (!row) return;
    const fresh = compareReviewCell(row.source, cellRef.cell.image, cellRef.cell.conflict);
    cellRef.cell.status = fresh.status;
    cellRef.cell.instances = fresh.instances;
    cellRef.cell.differences = fresh.differences;
    fresh.instances.forEach((instance) => {
      const chip = cellRef.chips.get(instance.id);
      if (chip) chip.dataset.verdict = instance.verdict || '';
    });
    cellRef.issues.forEach((control, tagId) => {
      const count = issueCount(cellRef.cell.image, tagId);
      control.chip.dataset.active = count > 0 ? '1' : '';
      control.input.value = String(count);
    });
    if (cellRef.badge) {
      cellRef.badge.textContent = CELL_STATUS_TEXT[fresh.status] || '';
      cellRef.badge.dataset.tone = cellStatusTone(fresh.status, cellRef.cell.image);
    }
    updateReviewStats();
  }

  function rebuildReviewMeta() {
    if (!reviewRefs) return;
    renderSourceMeta(reviewRefs.sourceMeta, reviewRefs.row);
    reviewRefs.cells.forEach((cellRef) => renderValidationMeta(cellRef, reviewRefs.row));
    updateReviewStats();
  }

  function verdictChip(instance, index) {
    const chip = document.createElement('span');
    chip.className = 'taxonomyVerdictChip';
    chip.dataset.verdict = instance.verdict || '';
    const order = document.createElement('span');
    order.className = 'taxonomyVerdictChip__order';
    order.textContent = `目标${index + 1}`;
    const label = document.createElement('span');
    label.className = 'taxonomyVerdictChip__label';
    label.textContent = instance.label;
    chip.append(order, label);
    return chip;
  }

  function renderSourceMeta(container, row) {
    container.innerHTML = '';
    container.className = 'taxonomyReviewCell__meta';
    if (!row.source) {
      container.classList.add('taxonomyReviewDiff');
      container.textContent = '对比集中没有同名图片';
      return;
    }
    const instances = expectedInstances(row.source);
    if (!instances.length) {
      container.textContent = '对比集未打标';
    } else {
      const chips = document.createElement('div');
      chips.className = 'taxonomyChipRow';
      instances.forEach((instance, index) => chips.appendChild(verdictChip(instance, index)));
      container.appendChild(chips);
    }
    if (row.source.note) {
      const note = document.createElement('div');
      note.className = 'taxonomyReviewNote';
      note.textContent = `备注：${row.source.note}`;
      container.appendChild(note);
    }
  }

  function renderValidationMeta(cellRef, row) {
    const container = cellRef.meta;
    container.innerHTML = '';
    container.className = 'taxonomyReviewCell__meta';
    cellRef.chips = new Map();
    cellRef.issues = new Map();
    const image = cellRef.cell.image;

    if (cellRef.cell.status === 'conflict') {
      container.classList.add('taxonomyReviewDiff');
      container.textContent = '重名冲突：文件名和来源文件夹都无法唯一对应';
      return;
    }
    if (!image) {
      container.classList.add('taxonomyReviewDiff');
      container.textContent = '验证集缺失';
      return;
    }

    if (!row.source) {
      const hint = document.createElement('div');
      hint.className = 'taxonomyReviewDiff';
      hint.textContent = '对比集中没有同名图片';
      container.appendChild(hint);
    } else if (!cellRef.cell.instances.length) {
      const hint = document.createElement('div');
      hint.textContent = '对比集未打标，无需验收';
      container.appendChild(hint);
    } else {
      const chips = document.createElement('div');
      chips.className = 'taxonomyChipRow';
      cellRef.cell.instances.forEach((instance, index) => {
        const chip = verdictChip(instance, index);
        const pass = document.createElement('button');
        pass.className = 'taxonomyVerdictChip__btn taxonomyVerdictChip__btn--ok';
        pass.textContent = '✓';
        pass.title = '通过';
        pass.addEventListener('click', () => setVerdict(cellRef, instance.id, 'pass'));
        const fail = document.createElement('button');
        fail.className = 'taxonomyVerdictChip__btn taxonomyVerdictChip__btn--bad';
        fail.textContent = '✕';
        fail.title = '未通过';
        fail.addEventListener('click', () => setVerdict(cellRef, instance.id, 'fail'));
        chip.append(pass, fail);
        cellRef.chips.set(instance.id, chip);
        chips.appendChild(chip);
      });
      const allPass = document.createElement('button');
      allPass.className = 'taxonomyChipAction taxonomyChipAction--ok';
      allPass.textContent = '全部通过';
      allPass.addEventListener('click', () => setAllVerdicts(cellRef, 'pass'));
      const allFail = document.createElement('button');
      allFail.className = 'taxonomyChipAction taxonomyChipAction--bad';
      allFail.textContent = '全部未通过';
      allFail.addEventListener('click', () => setAllVerdicts(cellRef, 'fail'));
      chips.append(allPass, allFail);
      container.appendChild(chips);
    }

    const issueRow = document.createElement('div');
    issueRow.className = 'taxonomyChipRow taxonomyChipRow--issues';
    state.issueTags.forEach((tag) => {
      const control = document.createElement('span');
      control.className = 'taxonomyIssueCounter';
      const chip = document.createElement('button');
      chip.className = 'taxonomyIssueChip';
      const count = issueCount(image, tag.id);
      chip.dataset.active = count > 0 ? '1' : '';
      chip.textContent = tag.name;
      chip.addEventListener('click', () => toggleIssue(cellRef, tag.id));
      const input = document.createElement('input');
      input.className = 'taxonomyIssueCount';
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(count);
      input.title = `${tag.name}数量`;
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('change', () => setIssueCount(cellRef, tag.id, input.value));
      control.append(chip, input);
      cellRef.issues.set(tag.id, { chip, input });
      issueRow.appendChild(control);
    });
    const addIssue = document.createElement('button');
    addIssue.className = 'taxonomyIssueChip taxonomyIssueChip--add';
    addIssue.textContent = '＋问题标签';
    addIssue.title = '新增全局问题标签';
    addIssue.addEventListener('click', addIssueTagFromReview);
    issueRow.appendChild(addIssue);

    const noteChip = document.createElement('button');
    noteChip.className = 'taxonomyIssueChip taxonomyNoteChip';
    noteChip.textContent = '备注';
    noteChip.title = '填写备注';
    noteChip.dataset.filled = image.note ? '1' : '';
    issueRow.appendChild(noteChip);
    container.appendChild(issueRow);

    const note = document.createElement('input');
    note.className = 'taxonomyNoteInline';
    note.placeholder = '输入备注';
    note.value = image.note || '';
    note.hidden = !image.note;
    note.addEventListener('input', () => {
      image.note = note.value;
      noteChip.dataset.filled = note.value.trim() ? '1' : '';
      if (reviewNoteTimer) clearTimeout(reviewNoteTimer);
      reviewNoteTimer = setTimeout(saveState, 400);
    });
    note.addEventListener('blur', () => {
      if (reviewNoteTimer) clearTimeout(reviewNoteTimer);
      reviewNoteTimer = null;
      saveState();
      if (!note.value.trim()) note.hidden = true;
    });
    noteChip.addEventListener('click', () => {
      note.hidden = !note.hidden;
      if (!note.hidden) note.focus();
    });
    container.appendChild(note);
  }

  function reviewCell(title, image, isValidation, options = {}) {
    const cell = document.createElement('section');
    cell.className = 'taxonomyReviewCell';
    const head = document.createElement('div');
    head.className = 'taxonomyReviewCell__head';
    const name = document.createElement('span');
    name.className = 'taxonomyReviewCell__name';
    const fileLabel = image
      ? `${image.sourceFolder ? `${image.sourceFolder} / ` : ''}${image.originalName}`
      : isValidation
        ? '缺'
        : '多';
    name.textContent = `${title} · ${fileLabel}`;
    const badge = document.createElement('span');
    badge.className = 'taxonomyReviewBadge';
    head.append(name, badge);
    if (options.onUnmatch) {
      const unmatch = document.createElement('button');
      unmatch.type = 'button';
      unmatch.className = 'taxonomyMatchTag';
      unmatch.textContent = '手动匹配 ✕';
      unmatch.title = '解除手动匹配';
      unmatch.addEventListener('click', options.onUnmatch);
      head.appendChild(unmatch);
    }
    const media = document.createElement('div');
    media.className = 'taxonomyReviewCell__media';
    renderReviewMedia(media, image, isValidation);
    if (!image && options.onMatch) {
      const match = document.createElement('button');
      match.type = 'button';
      match.className = 'taxonomyMatchBtn';
      match.textContent = options.matchLabel || '选择匹配';
      match.addEventListener('click', options.onMatch);
      media.appendChild(match);
    }
    const meta = document.createElement('div');
    meta.className = 'taxonomyReviewCell__meta';
    cell.append(head, media, meta);
    return { cell, badge, meta };
  }

  function renderReview() {
    releaseReviewUrls();
    dom.reviewGrid.innerHTML = '';
    reviewRefs = null;
    const rows = filteredReviewRows();
    reviewCursorIndex = Math.max(0, Math.min(reviewCursorIndex, Math.max(0, rows.length - 1)));
    const row = rows[reviewCursorIndex];
    updateReviewFoot(rows.length);
    if (!row) {
      updateReviewStats();
      return;
    }

    const wrap = document.createElement('article');
    wrap.className = `taxonomyReviewRow${row.status === 'conflict' ? ' taxonomyReviewConflict' : ''}`;
    wrap.style.gridTemplateColumns = `repeat(${row.cells.length + 1}, minmax(0, 1fr))`;

    const sourceParts = reviewCell('对比集', row.source, false, {
      matchLabel: '匹配缺失的对比集',
      onMatch: () => openSourceMatchPicker(row),
    });
    sourceParts.badge.textContent = row.source ? `目标 ${expectedInstances(row.source).length}` : '多';
    wrap.appendChild(sourceParts.cell);

    const refs = { row, sourceMeta: sourceParts.meta, cells: [] };
    row.cells.forEach((cell) => {
      const parts = reviewCell(cell.column.name, cell.image, true, {
        matchLabel: '匹配多出的验证图',
        onMatch: row.source ? () => openValidationMatchPicker(row, cell.column) : null,
        onUnmatch: cell.manual ? () => clearManualMatch([cell.image]) : null,
      });
      parts.badge.textContent = CELL_STATUS_TEXT[cell.status] || '';
      parts.badge.dataset.tone = cellStatusTone(cell.status, cell.image);
      const cellRef = {
        cell,
        meta: parts.meta,
        badge: parts.badge,
        chips: new Map(),
        issues: new Map(),
      };
      refs.cells.push(cellRef);
      wrap.appendChild(parts.cell);
    });

    dom.reviewGrid.appendChild(wrap);
    reviewRefs = refs;
    renderSourceMeta(refs.sourceMeta, row);
    refs.cells.forEach((cellRef) => renderValidationMeta(cellRef, row));
    updateReviewStats();
  }

  function updateReviewFoot(total) {
    if (!dom.reviewFoot) return;
    dom.reviewPos.textContent = total ? `第 ${reviewCursorIndex + 1} / ${total} 组` : '暂无可验收图片';
    dom.reviewPrev.disabled = reviewCursorIndex <= 0;
    dom.reviewNext.disabled = !total || reviewCursorIndex >= total - 1;
  }

  function moveReviewCursor(step) {
    const total = filteredReviewRows().length;
    if (!total) return;
    const next = Math.max(0, Math.min(total - 1, reviewCursorIndex + step));
    if (next === reviewCursorIndex) return;
    reviewCursorIndex = next;
    renderReview();
  }

  function updateReviewStats() {
    const stats = buildReviewStats();
    dom.stat.textContent = `合格 ${stats.passedCount}/${stats.comparableCount}`;
    const parts = [`未验收 ${stats.pendingCount}`, `缺 ${stats.missingCount}`, `多 ${stats.extraCount}`];
    if (stats.conflictCount) parts.push(`冲突 ${stats.conflictCount}`);
    if (stats.issueStats.length) {
      parts.push(
        stats.issueStats
          .slice(0, 2)
          .map((item) => `${item.name} ${item.count}`)
          .join(' · '),
      );
    }
    dom.selectedStat.textContent = parts.join(' · ');
  }

  function buildReviewStats() {
    const rows = buildReviewRows();
    const cells = rows.flatMap((row) => row.cells);
    const comparable = cells.filter((cell) => ['ok', 'fail', 'pending'].includes(cell.status));
    const comboStats = new Map();
    const tagStats = new Map();
    const axisStats = new Map();
    const issueStats = new Map();
    const columnStats = new Map();

    for (const cell of cells) {
      const column = columnStats.get(cell.column.id) || {
        id: cell.column.id,
        name: cell.column.name,
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        missing: 0,
        extra: 0,
      };
      if (['ok', 'fail', 'pending'].includes(cell.status)) column.total += 1;
      if (cell.status === 'ok') column.passed += 1;
      if (cell.status === 'fail') column.failed += 1;
      if (cell.status === 'pending') column.pending += 1;
      if (cell.status === 'missing') column.missing += 1;
      if (cell.status === 'extra') column.extra += 1;
      columnStats.set(cell.column.id, column);

      for (const tagId of cell.image?.issues || []) {
        const issue = issueStats.get(tagId) || {
          id: tagId,
          name: findIssueTag(tagId)?.name || tagId,
          count: 0,
        };
        issue.count += issueCount(cell.image, tagId);
        issueStats.set(tagId, issue);
      }
    }

    for (const cell of comparable) {
      for (const difference of cell.differences) {
        const combo = comboStats.get(difference.key) || {
          key: difference.key,
          label: difference.label,
          total: 0,
          passed: 0,
        };
        combo.total += 1;
        if (difference.expected === difference.actual) combo.passed += 1;
        comboStats.set(difference.key, combo);

        for (const part of difference.key.split('|')) {
          const [axisId, tagId] = part.split(':');
          if (!axisId || !tagId) continue;
          const axis = axisStats.get(axisId) || {
            id: axisId,
            name: state.axes.find((item) => item.id === axisId)?.name || axisId,
            total: 0,
            passed: 0,
          };
          axis.total += 1;
          if (difference.expected === difference.actual) axis.passed += 1;
          axisStats.set(axisId, axis);

          const tag = tagStats.get(tagId) || {
            id: tagId,
            name: findTagName(tagId) || tagId,
            total: 0,
            passed: 0,
            comparisonCount: 0,
            validationCount: 0,
          };
          tag.total += 1;
          tag.comparisonCount += 1;
          if (difference.expected === difference.actual) {
            tag.passed += 1;
            tag.validationCount += 1;
          }
          tagStats.set(tagId, tag);
        }
      }
    }

    const instanceTotal = Array.from(comboStats.values()).reduce((sum, item) => sum + item.total, 0);
    const instancePassed = Array.from(comboStats.values()).reduce(
      (sum, item) => sum + item.passed,
      0,
    );
    const issueHitCount = Array.from(issueStats.values()).reduce(
      (sum, item) => sum + item.count,
      0,
    );

    return {
      rows,
      comparableCount: comparable.length,
      passedCount: comparable.filter((cell) => cell.status === 'ok').length,
      missingCount: cells.filter((cell) => cell.status === 'missing').length,
      extraCount: cells.filter((cell) => cell.status === 'extra' && cell.image).length,
      conflictCount: rows.filter((row) => row.status === 'conflict').length,
      mismatchCount: comparable.filter((cell) => cell.status === 'fail').length,
      pendingCount: comparable.filter((cell) => cell.status === 'pending').length,
      instanceTotal,
      instancePassed,
      issueHitCount,
      noteCount: cells.filter((cell) => cell.image?.note?.trim()).length,
      comboStats: Array.from(comboStats.values()),
      tagStats: Array.from(tagStats.values()),
      axisStats: Array.from(axisStats.values()),
      issueStats: Array.from(issueStats.values()).sort((a, b) => b.count - a.count),
      columnStats: Array.from(columnStats.values()),
    };
  }

  function projectForReviewExport() {
    const stats = buildReviewStats();
    return {
      type: 'taxonomy-review-report',
      version: PROJECT_VERSION,
      exportedAt: new Date().toISOString(),
      axes: state.axes,
      issueTags: state.issueTags,
      columns: validationColumns(),
      summary: {
        comparable: stats.comparableCount,
        passed: stats.passedCount,
        failed: stats.mismatchCount,
        pending: stats.pendingCount,
        missing: stats.missingCount,
        extra: stats.extraCount,
        conflict: stats.conflictCount,
        passRate:
          stats.comparableCount > 0
            ? Number((stats.passedCount / stats.comparableCount).toFixed(4))
            : null,
      },
      byAxis: stats.axisStats.map((item) => ({
        ...item,
        passRate: item.total ? Number((item.passed / item.total).toFixed(4)) : null,
      })),
      byTag: stats.tagStats.map((item) => ({
        ...item,
        passRate: item.total ? Number((item.passed / item.total).toFixed(4)) : null,
      })),
      byCombo: stats.comboStats.map((item) => ({
        ...item,
        passRate: item.total ? Number((item.passed / item.total).toFixed(4)) : null,
      })),
      byColumn: stats.columnStats.map((item) => ({
        ...item,
        passRate: item.total ? Number((item.passed / item.total).toFixed(4)) : null,
      })),
      byIssue: stats.issueStats,
      rows: stats.rows.map((row) => ({
        status: row.status,
        fileName: row.name,
        source: row.source
          ? {
              id: row.source.id,
              originalName: row.source.originalName,
              targets: row.source.targets,
              note: row.source.note || '',
            }
          : null,
        columns: row.cells.map((cell) => ({
          column: cell.column.name,
          status: cell.status,
          manualMatch: Boolean(cell.manual),
          validation: cell.image
            ? {
                id: cell.image.id,
                originalName: cell.image.originalName,
                targets: cell.image.targets,
                verdicts: cell.image.verdicts || {},
                issues: (cell.image.issues || []).map((tagId) => ({
                  id: tagId,
                  name: findIssueTag(tagId)?.name || tagId,
                  count: issueCount(cell.image, tagId),
                })),
                issueCounts: { ...(cell.image.issueCounts || {}) },
                note: cell.image.note || '',
              }
            : null,
          instances: cell.instances.map((instance, index) => ({
            order: index + 1,
            label: instance.label,
            verdict: instance.verdict || 'pending',
          })),
          differences: cell.differences,
        })),
      })),
    };
  }

  // 配置与调用统一走 llm.js，三个模式共用同一份 API 配置。
  const LLM = window.PicLabelingLlm;
  const COMPANY_LLM = LLM.COMPANY;
  const QUICK_API_SERVICES = LLM.QUICK_SERVICES;
  const defaultLlmConfig = LLM.defaultConfig;
  const normalizeEndpoint = LLM.normalizeEndpoint;
  const loadLlmConfig = LLM.load;

  function llmConfigFromForm() {
    return {
      endpoint: normalizeEndpoint(dom.apiEndpoint.value.trim()),
      model: dom.apiModel.value.trim(),
      apiKey: dom.apiKey.value.trim(),
    };
  }

  const resolveLlmConfig = LLM.resolve;
  const isLocalLlmEndpoint = LLM.isLocalEndpoint;
  const isLlmConfigured = LLM.isConfigured;

  function fillApiQuickService(service) {
    dom.apiEndpoint.value = service.endpoint;
    dom.apiModel.value = service.model;
    setApiStatus(`已填充「${service.name}」默认地址和模型，可继续修改`);
  }

  function renderApiQuickServices() {
    for (const service of QUICK_API_SERVICES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'taxonomyApiQuick__btn';
      btn.textContent = service.name;
      btn.addEventListener('click', () => fillApiQuickService(service));
      dom.apiQuick.appendChild(btn);
    }
  }

  function setApiStatus(text, tone = '') {
    dom.apiStatus.textContent = text;
    dom.apiStatus.dataset.tone = tone;
  }

  function updateApiButton() {
    const config = loadLlmConfig();
    const ready = isLlmConfigured(config);
    dom.apiButton.dataset.configured = ready ? '1' : '';
    dom.apiButton.title = ready ? 'API 已配置' : '配置 LLM API';
  }

  function openApiConfig() {
    const config = resolveLlmConfig(loadLlmConfig());
    dom.apiEndpoint.value = config.endpoint;
    dom.apiModel.value = config.model;
    dom.apiKey.value = config.apiKey;
    setApiStatus(
      config.apiKey
        ? '已保存，可点「测试连接」验证'
        : '填好三项后点保存，可先用「测试连接」验证',
    );
    openModal(dom.apiModal);
  }

  function saveLlmConfig() {
    const form = llmConfigFromForm();
    if (!form.endpoint) return toast('保存失败', '请填写请求地址（Base URL）');
    if (!form.model) return toast('保存失败', '请填写模型名称');
    if (!form.apiKey && !isLocalLlmEndpoint(form.endpoint)) {
      return toast('保存失败', '请填写 API Key');
    }
    const config = LLM.save(form);
    dom.apiEndpoint.value = config.endpoint;
    updateApiButton();
    closeModal(dom.apiModal);
    toast('已保存', 'API 配置已保存，所有打标模式共用');
  }

  function clearLlmConfig() {
    if (!window.confirm('清除当前浏览器保存的 API Key 和配置？所有模式都会失效。')) return;
    LLM.clear();
    const defaults = defaultLlmConfig();
    dom.apiEndpoint.value = defaults.endpoint;
    dom.apiModel.value = defaults.model;
    dom.apiKey.value = '';
    setApiStatus('配置已清除');
    updateApiButton();
    toast('已清除', '本地 API 配置已删除');
  }

  function buildLlmContext(mode) {
    const report = projectForReviewExport();
    if (mode === 'full') return report;
    const { rows: _rows, ...summaryReport } = report;
    return summaryReport;
  }

  const callLlm = LLM.call;

  async function testApiConnection() {
    const form = llmConfigFromForm();
    if (!form.apiKey && !isLocalLlmEndpoint(form.endpoint)) {
      setApiStatus('请先填写 API Key', 'bad');
      return;
    }
    const config = resolveLlmConfig(form);
    dom.apiEndpoint.value = config.endpoint;
    dom.apiTest.disabled = true;
    setApiStatus('正在测试连接…');
    try {
      const reply = await callLlm(config, {
        instruction: '连接测试，请只回复：OK',
        context: null,
        contextType: 'connection-test',
        maxTokens: 16,
      });
      setApiStatus(`连接成功，模型回复：${reply.slice(0, 30)}`, 'ok');
    } catch (error) {
      setApiStatus('连接失败', 'bad');
      const message = String(error?.message || error);
      const extra =
        config.endpoint === COMPANY_LLM.endpoint && /502|404|同域代理|上游/i.test(message)
          ? ' 请确认已用 node server.js 启动，或让运维设置 MODEL_ROUTER_UPSTREAM 环境变量。'
          : '';
      toast('连接失败', message + extra, 9000);
    } finally {
      dom.apiTest.disabled = false;
    }
  }

  async function generateAiConclusion() {
    const config = resolveLlmConfig(loadLlmConfig());
    if (!isLlmConfigured(config)) {
      openApiConfig();
      toast('尚未配置', '请先粘贴 API Key 并保存');
      return;
    }
    const instruction = dom.aiPrompt.value.trim();
    if (!instruction) return toast('无法发送', '请先输入希望 AI 完成的任务');
    if (!state.images.length && !state.validationImages.length) {
      return toast('无法发送', '当前没有可分析的打标或验收数据');
    }

    const mode = dom.aiContext.value === 'full' ? 'full' : 'summary';
    const context = buildLlmContext(mode);
    const sizeKb = Math.ceil(JSON.stringify(context).length / 1024);

    dom.aiSend.disabled = true;
    dom.aiResult.hidden = true;
    dom.aiDownload.hidden = true;
    dom.aiDownload.disabled = true;
    dom.aiStatus.dataset.tone = '';
    dom.aiStatus.textContent = `发送中 · ${mode === 'full' ? '完整明细' : '统计摘要'} ${sizeKb} KB`;
    try {
      const result = await callLlm(config, {
        instruction,
        context,
        contextType: mode === 'full' ? 'taxonomy-review-full' : 'taxonomy-review-summary',
      });
      dom.aiResult.value = result;
      dom.aiResult.hidden = false;
      dom.aiDownload.hidden = false;
      dom.aiDownload.disabled = false;
      dom.aiStatus.dataset.tone = 'ok';
      dom.aiStatus.textContent = '生成完成';
    } catch (error) {
      dom.aiStatus.dataset.tone = 'bad';
      dom.aiStatus.textContent = '生成失败';
      toast('API 调用失败', String(error?.message || error), 8000);
    } finally {
      dom.aiSend.disabled = false;
    }
  }

  function downloadAiConclusion() {
    const text = dom.aiResult.value.trim();
    if (!text) return;
    downloadBlob(
      new Blob([text], { type: 'text/plain;charset=utf-8' }),
      `AI验收结论_${new Date().toISOString().slice(0, 10)}.txt`,
    );
  }

  function exportReviewSummaryText() {
    if (!state.validationImages.length && !state.images.length) {
      toast('无法导出', '请先导入对比集和验证集');
      return;
    }
    const stats = buildReviewStats();
    const lines = [
      '分类打标验收摘要',
      `导出时间：${new Date().toLocaleString('zh-CN')}`,
      `图片合格：${stats.passedCount}/${stats.comparableCount}`,
      `存在未通过目标：${stats.mismatchCount}`,
      `未验收：${stats.pendingCount}`,
      `缺失：${stats.missingCount}`,
      `多出：${stats.extraCount}`,
      `重名冲突：${stats.conflictCount}`,
      '',
      '按验证列：',
      ...stats.columnStats.map(
        (item) =>
          `- ${item.name}: 通过 ${item.passed}/${item.total}，未通过 ${item.failed}，未验收 ${item.pending}，缺 ${item.missing}，多 ${item.extra}`,
      ),
      '',
      '按问题标签：',
      ...(stats.issueStats.length
        ? stats.issueStats.map((item) => `- ${item.name}: ${item.count}`)
        : ['- 暂无']),
      '',
      '按分类轴：',
      ...stats.axisStats.map((item) => `- ${item.name}: ${item.passed}/${item.total}`),
      '',
      '按标签：',
      ...stats.tagStats.map(
        (item) =>
          `- ${item.name}: ${item.passed}/${item.total}（验证 ${item.validationCount || 0}/对比 ${item.comparisonCount || 0}）`,
      ),
      '',
      '按标签组合：',
      ...stats.comboStats.map((item) => `- ${item.label}: ${item.passed}/${item.total}`),
    ];
    downloadBlob(
      new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }),
      `验收摘要_${new Date().toISOString().slice(0, 10)}.txt`,
    );
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function toCsv(rows) {
    return `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`;
  }

  function rateText(passed, total) {
    if (!total) return '0%';
    return `${((passed / total) * 100).toFixed(2)}%`;
  }

  function buildReviewSummaryCsvRows(stats) {
    const rows = [
      ['指标', '数值'],
      ['导出时间', new Date().toLocaleString('zh-CN')],
      ['图片总数（可比较）', stats.comparableCount],
      ['图片通过数', stats.passedCount],
      ['图片通过率', rateText(stats.passedCount, stats.comparableCount)],
      ['标签总数（目标标签）', stats.instanceTotal],
      ['标签通过数', stats.instancePassed],
      ['标签通过率', rateText(stats.instancePassed, stats.instanceTotal)],
      ['未通过图片数', stats.mismatchCount],
      ['未通过率', rateText(stats.mismatchCount, stats.comparableCount)],
      ['未验收数', stats.pendingCount],
      ['缺失数', stats.missingCount],
      ['多出数', stats.extraCount],
      ['重名冲突组数', stats.conflictCount],
      ['问题标签命中总数', stats.issueHitCount],
      ['有备注的验证图数', stats.noteCount],
      [],
      ['问题标签', '数量'],
      ...(stats.issueStats.length
        ? stats.issueStats.map((item) => [item.name, item.count])
        : [['暂无', 0]]),
      [],
      ['标签', '通过数', '总数', '标签通过率', '验证集数', '对比集数'],
      ...stats.tagStats.map((item) => [
        item.name,
        item.passed,
        item.total,
        rateText(item.passed, item.total),
        item.validationCount || 0,
        item.comparisonCount || 0,
      ]),
      [],
      ['标签组合', '通过数', '总数', '通过率'],
      ...stats.comboStats.map((item) => [
        item.label,
        item.passed,
        item.total,
        rateText(item.passed, item.total),
      ]),
      [],
      ['验证列', '通过', '可比较', '未通过', '未验收', '缺失', '多出', '通过率'],
      ...stats.columnStats.map((item) => [
        item.name,
        item.passed,
        item.total,
        item.failed,
        item.pending,
        item.missing,
        item.extra,
        rateText(item.passed, item.total),
      ]),
    ];
    return rows;
  }

  function buildReviewDetailCsvRows(stats) {
    const rows = [
      [
        '文件名',
        '对比集来源文件夹',
        '验证列',
        '验证集来源文件夹',
        '单元格状态',
        '目标序号',
        '目标标签',
        '判定',
        '问题标签',
        '验证备注',
        '对比集备注',
        '匹配方式',
      ],
    ];
    for (const row of stats.rows) {
      for (const cell of row.cells) {
        const issues = (cell.image?.issues || [])
          .map((id) => `${findIssueTag(id)?.name || id}×${issueCount(cell.image, id)}`)
          .join('；');
        const note = cell.image?.note || '';
        const sourceNote = row.source?.note || '';
        const sourceFolder = row.source?.sourceFolder || '';
        const validationFolder = cell.image?.sourceFolder || '';
        const matchMode = cell.manual ? '手动匹配' : '文件名匹配';
        if (cell.instances?.length) {
          cell.instances.forEach((instance, index) => {
            rows.push([
              row.name,
              sourceFolder,
              cell.column.name,
              validationFolder,
              CELL_STATUS_TEXT[cell.status] || cell.status,
              index + 1,
              instance.label,
              instance.verdict === 'pass'
                ? '通过'
                : instance.verdict === 'fail'
                  ? '未通过'
                  : '未验收',
              issues,
              note,
              sourceNote,
              matchMode,
            ]);
          });
        } else {
          rows.push([
            row.name,
            sourceFolder,
            cell.column.name,
            validationFolder,
            CELL_STATUS_TEXT[cell.status] || cell.status,
            '',
            '',
            '',
            issues,
            note,
            sourceNote,
            matchMode,
          ]);
        }
      }
    }
    return rows;
  }

  async function exportReviewCsv() {
    if (!state.validationImages.length && !state.images.length) {
      toast('无法导出', '请先导入对比集和验证集');
      return;
    }
    const stats = buildReviewStats();
    const stamp = new Date().toISOString().slice(0, 10);
    const summaryCsv = toCsv(buildReviewSummaryCsvRows(stats));
    const detailCsv = toCsv(buildReviewDetailCsvRows(stats));
    if (typeof JSZip === 'undefined') {
      downloadBlob(
        new Blob([summaryCsv, '\n\n', detailCsv], { type: 'text/csv;charset=utf-8' }),
        `验收报告_${stamp}.csv`,
      );
      return;
    }
    const zip = new JSZip();
    zip.file('摘要.csv', summaryCsv);
    zip.file('明细.csv', detailCsv);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `验收报告_${stamp}.zip`);
    toast('已导出', '含摘要与明细两份 CSV');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setStage(stage) {
    state.stage = stage === 'review' ? 'review' : 'label';
    saveState();
    renderAll();
  }

  function goToNextDifference() {
    const rows = filteredReviewRows();
    if (!rows.length) return;
    for (let offset = 1; offset <= rows.length; offset++) {
      const index = (reviewCursorIndex + offset) % rows.length;
      if (rows[index].status === 'ok') continue;
      reviewCursorIndex = index;
      renderReview();
      return;
    }
    toast('验收完成', '当前筛选结果中没有差异');
  }

  function imageSummary(image) {
    const names = [];
    for (const axis of state.axes) {
      const tagIds = image.classifications[axis.id] || [];
      for (const tagId of tagIds) {
        const name = findTagName(tagId);
        if (name) names.push(name);
      }
    }
    const knownCount = image.targets.reduce(
      (sum, target) => sum + (Number.isInteger(target.count) ? target.count : 0),
      0,
    );
    const countText = image.targets.length ? `目标 ${knownCount}` : '';
    const noteText = image.note ? '有备注' : '';
    return [...names.slice(0, 3), countText, noteText].filter(Boolean).join(' · ');
  }

  function renderGrid() {
    releaseObjectUrls();
    dom.grid.innerHTML = '';
    const images = filteredImages();
    gridCursorIndex = Math.max(0, Math.min(gridCursorIndex, Math.max(0, images.length - 1)));
    dom.empty.hidden = state.images.length > 0;

    if (state.images.length > 0 && images.length === 0) {
      dom.empty.hidden = false;
      dom.empty.querySelector('span').textContent = '没有符合当前筛选的图片';
      dom.emptyImport.hidden = true;
    } else {
      dom.empty.querySelector('span').textContent = '导入文件夹开始分类打标';
      dom.emptyImport.hidden = false;
    }

    if ('IntersectionObserver' in window) {
      gridObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            loadThumbnail(entry.target);
            gridObserver?.unobserve(entry.target);
          });
        },
        { root: dom.grid.parentElement, rootMargin: '240px' },
      );
    }

    images.forEach((image, index) => {
      const card = document.createElement('article');
      card.className = `taxonomyCard${selectedIds.has(image.id) ? ' taxonomyCard--selected' : ''}${
        index === gridCursorIndex ? ' taxonomyCard--cursor' : ''
      }`;
      card.dataset.imageId = image.id;
      card.title = image.originalName;

      const media = document.createElement('div');
      media.className = 'taxonomyCard__media';
      media.dataset.imageId = image.id;

      const body = document.createElement('div');
      body.className = 'taxonomyCard__body';
      const name = document.createElement('div');
      name.className = 'taxonomyCard__name';
      name.textContent = image.originalName;
      const meta = document.createElement('div');
      meta.className = 'taxonomyCard__meta';
      meta.textContent = imageSummary(image);
      body.append(name, meta);

      const check = document.createElement('span');
      check.className = 'taxonomyCard__check';
      check.textContent = '✓';
      card.append(media, body, check);
      card.addEventListener('click', () => openImageEditor(image.id));
      check.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSelection(image.id, index, event.shiftKey);
      });
      dom.grid.appendChild(card);
      if (gridObserver) gridObserver.observe(media);
      else loadThumbnail(media);
    });
  }

  function toggleSelection(imageId, index, withRange) {
    const images = filteredImages();
    if (withRange && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) selectedIds.add(images[i].id);
    } else if (selectedIds.has(imageId)) {
      selectedIds.delete(imageId);
    } else {
      selectedIds.add(imageId);
    }
    lastSelectedIndex = index;
    updateSelectionUI();
    updateStatsAndActions();
  }

  function updateSelectionUI() {
    dom.grid.querySelectorAll('.taxonomyCard').forEach((card) => {
      card.classList.toggle('taxonomyCard--selected', selectedIds.has(card.dataset.imageId));
    });
  }

  function updateGridCursor(scroll = true) {
    const cards = Array.from(dom.grid.querySelectorAll('.taxonomyCard'));
    cards.forEach((card, index) => {
      card.classList.toggle('taxonomyCard--cursor', index === gridCursorIndex);
    });
    if (scroll) cards[gridCursorIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function goToNextIncomplete() {
    const images = filteredImages();
    if (!images.length) return;
    const editingIndex = images.findIndex((image) => image.id === editingImageId);
    const start = editingIndex >= 0 ? editingIndex : gridCursorIndex - 1;
    for (let offset = 1; offset <= images.length; offset++) {
      const index = (start + offset) % images.length;
      if (!imageIsIncomplete(images[index])) continue;
      gridCursorIndex = index;
      updateGridCursor();
      openImageEditor(images[index].id);
      return;
    }
    toast('已完成', '当前筛选结果中没有未完成图片');
  }

  function renderAxes() {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    state.axes.forEach((axis) => {
      const chip = document.createElement('button');
      chip.className = `chip${axis.id === state.currentAxisId ? ' chip--active' : ''}`;
      chip.textContent = layerLabel(axis);
      chip.addEventListener('click', () => {
        state.currentAxisId = axis.id;
        state.filterTagId = '';
        if (!axis.tags.some((tag) => tag.id === state.selectedTagId)) {
          state.selectedTagId = axis.tags[0]?.id || '';
        }
        saveState();
        renderAll();
      });
      wrap.appendChild(chip);
    });
    dom.axisChips.innerHTML = '';
    dom.axisChips.appendChild(wrap);
  }

  function setOptions(select, options, selectedValue) {
    select.innerHTML = '';
    options.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === selectedValue;
      select.appendChild(option);
    });
  }

  function renderTagControls() {
    const axis = currentAxis();
    const tags = axis?.tags || [];
    setOptions(
      dom.targetTag,
      tags.length
        ? tags.map((tag) => ({ value: tag.id, label: tag.name }))
        : [{ value: '', label: '请先添加标签' }],
      state.selectedTagId,
    );
    dom.targetTag.disabled = tags.length === 0;
  }

  function updateStatsAndActions() {
    const classified = state.images.filter((image) =>
      Object.values(image.classifications).some((ids) => Array.isArray(ids) && ids.length),
    ).length;
    dom.stat.textContent = `已分类 ${classified}/${state.images.length}`;
    dom.selectedStat.textContent = `已选 ${selectedIds.size}`;
    const hasSelection = selectedIds.size > 0;
    const hasTag = Boolean(state.selectedTagId);
    dom.applyTag.disabled = !hasSelection || !hasTag;
    dom.removeTag.disabled = !hasSelection || !hasTag;
    dom.editImage.disabled = selectedIds.size !== 1;
    dom.selectAll.disabled = filteredImages().length === 0;
    dom.nextIncomplete.disabled = !filteredImages().some(imageIsIncomplete);
    dom.clearSelection.disabled = !hasSelection;
    dom.deleteImages.disabled = !hasSelection;
  }

  const QUICK_FILTER_OPTIONS = [
    { value: '', label: '全部图片' },
    { value: 'unclassified', label: '未分类' },
    { value: 'missingCount', label: '未填写数量' },
    { value: 'hasNote', label: '有备注' },
    { value: 'missingValidation', label: '缺失验证集的对比集' },
  ];

  const DIFFERENCE_FILTER_OPTIONS = [
    { value: '', label: '全部结果' },
    { value: 'fail', label: '未通过' },
    { value: 'pending', label: '未验收' },
    { value: 'missing', label: '缺失' },
    { value: 'extra', label: '多出' },
    { value: 'conflict', label: '重名冲突' },
    { value: 'hasIssue', label: '有问题标签' },
    { value: 'hasNote', label: '有备注' },
  ];

  function closeFilterMenu() {
    dom.filterMenu.hidden = true;
    dom.filterMenu
      .querySelectorAll('.taxonomyFilterGroup')
      .forEach((group) => group.classList.remove('taxonomyFilterGroup--open'));
  }

  function renderFilterMenu() {
    dom.filterMenu.innerHTML = '';
    const axis = currentAxis();
    const groups =
      state.stage === 'review'
        ? [
            {
              name: '结果',
              options: DIFFERENCE_FILTER_OPTIONS,
              current: state.differenceFilter,
              onPick: (value) => {
                state.differenceFilter = value;
                state.reviewIssueTagId = '';
                reviewCursorIndex = 0;
                saveState();
                renderReview();
              },
            },
            {
              name: '问题标签',
              options: [
                { value: '', label: '全部问题标签' },
                ...state.issueTags.map((tag) => ({ value: tag.id, label: tag.name })),
              ],
              current: state.reviewIssueTagId,
              onPick: (value) => {
                state.reviewIssueTagId = value;
                state.differenceFilter = 'hasIssue';
                reviewCursorIndex = 0;
                saveState();
                renderReview();
              },
            },
          ]
        : [
            {
              name: '标签',
              options: [
                { value: '', label: '全部标签' },
                ...(axis?.tags || []).map((tag) => ({ value: tag.id, label: tag.name })),
              ],
              current: state.filterTagId,
              onPick: (value) => {
                state.filterTagId = value;
                saveState();
                renderGrid();
                updateStatsAndActions();
              },
            },
            {
              name: '图片',
              options: QUICK_FILTER_OPTIONS,
              current: state.quickFilter,
              onPick: (value) => {
                state.quickFilter = value;
                gridCursorIndex = 0;
                saveState();
                renderGrid();
                updateStatsAndActions();
              },
            },
          ];

    groups.forEach((group) => {
      const block = document.createElement('div');
      block.className = 'taxonomyFilterGroup';
      const entry = document.createElement('button');
      entry.className = 'taxonomyFilterEntry';
      const activeOption = group.options.find((option) => option.value === group.current);
      entry.textContent = `${group.name}：${activeOption?.label || group.options[0].label}`;
      entry.addEventListener('click', () => {
        const open = block.classList.contains('taxonomyFilterGroup--open');
        dom.filterMenu
          .querySelectorAll('.taxonomyFilterGroup')
          .forEach((item) => item.classList.remove('taxonomyFilterGroup--open'));
        if (!open) block.classList.add('taxonomyFilterGroup--open');
      });

      const submenu = document.createElement('div');
      submenu.className = 'taxonomyFilterSubmenu';
      group.options.forEach((option) => {
        const item = document.createElement('button');
        item.className = `taxonomyFilterOption${
          option.value === group.current ? ' taxonomyFilterOption--active' : ''
        }`;
        item.textContent = option.label;
        item.addEventListener('click', () => {
          group.onPick(option.value);
          closeFilterMenu();
          renderFilterMenu();
        });
        submenu.appendChild(item);
      });

      block.append(entry, submenu);
      dom.filterMenu.appendChild(block);
    });
  }

  function renderAll() {
    const reviewing = state.stage === 'review';
    dom.search.value = reviewing ? state.reviewSearch : state.search;
    renderAxes();
    renderTagControls();
    closeFilterMenu();
    renderFilterMenu();
    dom.stageLabel.classList.toggle('chip--active', !reviewing);
    dom.stageReview.classList.toggle('chip--active', reviewing);
    dom.nextIncomplete.hidden = reviewing;
    dom.nextDifference.hidden = !reviewing;
    dom.grid.hidden = reviewing;
    dom.reviewGrid.hidden = !reviewing;
    dom.empty.hidden = reviewing || state.images.length > 0;
    dom.foot.hidden = reviewing;
    dom.reviewFoot.hidden = !reviewing;
    dom.deleteValidation.disabled = !state.validationImages.length;
    dom.importButton.textContent = reviewing ? '导入验证集' : '导入';
    if (reviewing) {
      releaseObjectUrls();
      if (!state.validationImages.length) {
        dom.empty.hidden = false;
        dom.empty.querySelector('span').textContent = state.images.length
          ? '导入验证集开始验收'
          : '请先导入对比集，再导入验证集';
        dom.emptyImport.hidden = false;
        dom.emptyImport.textContent = state.images.length ? '导入验证集' : '导入对比集';
        dom.reviewGrid.innerHTML = '';
        reviewRefs = null;
        updateReviewFoot(0);
        updateReviewStats();
      } else {
        dom.empty.hidden = true;
        dom.emptyImport.textContent = '导入';
        renderReview();
      }
    } else {
      releaseReviewUrls();
      dom.emptyImport.textContent = '导入';
      renderGrid();
      updateStatsAndActions();
    }
  }

  function applyCurrentTag(remove = false) {
    const axis = currentAxis();
    if (!axis || !state.selectedTagId || !selectedIds.size) return;
    const changedCount = selectedIds.size;
    for (const image of state.images) {
      if (!selectedIds.has(image.id)) continue;
      ensureTargetsForImage(image);
      if (remove) removeTagFromTargets(image, axis.id, state.selectedTagId);
      else {
        assignTagToTarget(image, axis.id, state.selectedTagId);
        syncClassificationsFromTargets(image);
      }
    }
    selectedIds.clear();
    lastSelectedIndex = null;
    saveState();
    renderAll();
    toast(remove ? '已移出' : '已加入', `${changedCount} 张图片`);
  }

  async function deleteSelectedImages() {
    if (!selectedIds.size) return;
    const count = selectedIds.size;
    if (!window.confirm(`删除所选 ${count} 张图片？验证集中的同名验收记录会保留。`)) return;
    const previousState = snapshotState();
    const removed = state.images.filter((image) => selectedIds.has(image.id));
    state.images = state.images.filter((image) => !selectedIds.has(image.id));
    state.validationImages.forEach((image) => {
      if (image.manualSourceId && selectedIds.has(image.manualSourceId)) image.manualSourceId = '';
    });
    selectedIds.clear();
    lastSelectedIndex = null;
    gridCursorIndex = 0;
    if (editingImageId && removed.some((image) => image.id === editingImageId)) {
      closeImageEditor();
    }
    saveState();
    await saveFiles();
    renderAll();
    toast('已删除', `${count} 张图片已删除`, 5000, {
      label: '撤销',
      onClick: async () => {
        state = normalizeState(previousState);
        state.images.forEach(ensureTargetsForImage);
        saveState();
        await saveFiles();
        renderAll();
        toast('已撤销', '图片已恢复');
      },
    });
  }

  function editNameInline(element, initialValue, onSave) {
    const input = document.createElement('input');
    input.className = 'textInput taxonomyCategoryTagInput';
    input.value = initialValue;
    element.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onSave(input.value.trim());
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        input.value = initialValue;
        input.blur();
      }
    });
  }

  function layerLabel(axis) {
    const index = state.axes.findIndex((item) => item.id === axis.id);
    return `层级 ${Math.max(0, index) + 1}`;
  }

  function createLayer() {
    let number = 1;
    while (state.axes.some((axis) => axis.name === `自定义层级 ${number}`)) number++;
    const axis = {
      id: uid('axis'),
      name: `自定义层级 ${number}`,
      tags: [],
    };
    state.axes.push(axis);
    state.currentAxisId = axis.id;
    state.selectedTagId = '';
    state.filterTagId = '';
    saveState();
    renderAll();
    renderCategoryList();
    dom.categoryList.querySelector(`[data-axis-id="${axis.id}"] input`)?.focus();
  }

  function moveTagBetweenAxes(tagId, fromAxisId, toAxisId) {
    if (!tagId || fromAxisId === toAxisId) return;
    const fromAxis = state.axes.find((axis) => axis.id === fromAxisId);
    const toAxis = state.axes.find((axis) => axis.id === toAxisId);
    const tag = fromAxis?.tags.find((item) => item.id === tagId);
    if (!fromAxis || !toAxis || !tag) return;
    if (toAxis.tags.some((item) => item.name === tag.name)) {
      toast('无法移动', `“${tag.name}”在${layerLabel(toAxis)}中已存在`);
      return;
    }

    const allImages = [...state.images, ...state.validationImages];
    const conflicts = allImages.reduce(
      (count, image) =>
        count +
        (image.targets || []).filter(
          (target) =>
            target.labelsByAxis?.[fromAxisId] === tagId &&
            target.labelsByAxis?.[toAxisId] &&
            target.labelsByAxis[toAxisId] !== tagId,
        ).length,
      0,
    );
    if (conflicts) {
      toast('无法移动', `${conflicts} 个目标在${layerLabel(toAxis)}中已有其他标签，请先调整目标`);
      return;
    }

    fromAxis.tags = fromAxis.tags.filter((item) => item.id !== tagId);
    toAxis.tags.push(tag);
    allImages.forEach((image) => {
      (image.targets || []).forEach((target) => {
        if (target.labelsByAxis?.[fromAxisId] !== tagId) return;
        delete target.labelsByAxis[fromAxisId];
        target.labelsByAxis[toAxisId] = tagId;
      });
      if (state.images.includes(image)) syncClassificationsFromTargets(image);
    });
    if (state.selectedTagId === tagId) state.currentAxisId = toAxisId;
    saveState();
    renderAll();
    renderCategoryList();
    toast('已移动', `“${tag.name}”已移至${layerLabel(toAxis)}`);
  }

  function renderCategoryList() {
    dom.categoryList.innerHTML = '';
    state.axes.forEach((axis) => {
      const block = document.createElement('section');
      block.className = 'taxonomyCategoryBlock';
      block.dataset.axisId = axis.id;
      block.addEventListener('dragover', (event) => {
        if (!event.dataTransfer?.types.includes('application/x-taxonomy-tag')) return;
        event.preventDefault();
        block.classList.add('taxonomyCategoryBlock--dragover');
      });
      block.addEventListener('dragleave', (event) => {
        if (!block.contains(event.relatedTarget)) {
          block.classList.remove('taxonomyCategoryBlock--dragover');
        }
      });
      block.addEventListener('drop', (event) => {
        event.preventDefault();
        block.classList.remove('taxonomyCategoryBlock--dragover');
        try {
          const payload = JSON.parse(
            event.dataTransfer?.getData('application/x-taxonomy-tag') || '{}',
          );
          moveTagBetweenAxes(payload.tagId, payload.axisId, axis.id);
        } catch {
          toast('移动失败', '无法读取拖动的标签');
        }
      });
      const head = document.createElement('div');
      head.className = 'taxonomyCategoryBlock__head';
      const name = document.createElement('span');
      name.className = 'taxonomyCategoryBlock__name';
      name.textContent = layerLabel(axis);
      const hint = document.createElement('span');
      hint.className = 'taxonomyCategoryBlock__hint';
      hint.textContent = '每个目标选 1 个';
      const removeAxis = document.createElement('button');
      removeAxis.className = 'btn btn--chip';
      removeAxis.textContent = '删除层级';
      removeAxis.disabled = state.axes.length <= 1;
      removeAxis.addEventListener('click', () => deleteAxis(axis.id));
      const heading = document.createElement('div');
      heading.className = 'taxonomyCategoryBlock__heading';
      heading.append(name, hint);
      head.append(heading, removeAxis);

      const tags = document.createElement('div');
      tags.className = 'taxonomyCategoryBlock__tags';
      if (!axis.tags.length) {
        const empty = document.createElement('span');
        empty.className = 'row--hint';
        empty.textContent = '暂无标签';
        tags.appendChild(empty);
      }
      axis.tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'taxonomyCategoryTag';
        chip.title = '拖到其他行可更改层级；双击文字可改名';
        chip.draggable = true;
        chip.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData(
            'application/x-taxonomy-tag',
            JSON.stringify({ tagId: tag.id, axisId: axis.id }),
          );
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          chip.classList.add('taxonomyCategoryTag--dragging');
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('taxonomyCategoryTag--dragging');
          dom.categoryList
            .querySelectorAll('.taxonomyCategoryBlock--dragover')
            .forEach((item) => item.classList.remove('taxonomyCategoryBlock--dragover'));
        });
        const text = document.createElement('span');
        text.textContent = tag.name;
        text.addEventListener('dblclick', () => {
          editNameInline(text, tag.name, (nextName) => {
            if (
              nextName &&
              !axis.tags.some((item) => item.id !== tag.id && item.name === nextName)
            ) {
              tag.name = nextName;
              saveState();
              renderAll();
            }
            renderCategoryList();
          });
        });
        const remove = document.createElement('button');
        remove.className = 'taxonomyCategoryTag__delete';
        remove.textContent = '×';
        remove.title = '删除标签';
        remove.addEventListener('click', () => deleteTag(axis.id, tag.id));
        chip.append(text, remove);
        tags.appendChild(chip);
      });

      const addRow = document.createElement('div');
      addRow.className = 'taxonomyCategoryBlock__add';
      const input = document.createElement('input');
      input.className = 'textInput';
      input.placeholder = `在${layerLabel(axis)}新增标签`;
      const add = document.createElement('button');
      add.className = 'btn';
      add.textContent = '添加';
      const addTag = () => {
        const tagName = input.value.trim();
        if (!tagName) return;
        if (axis.tags.some((tag) => tag.name === tagName)) {
          toast('添加失败', '标签名称已存在');
          return;
        }
        axis.tags.push({ id: uid('tag'), name: tagName });
        input.value = '';
        saveState();
        renderAll();
        renderCategoryList();
      };
      add.addEventListener('click', addTag);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') addTag();
      });
      addRow.append(input, add);
      block.append(head, tags, addRow);
      dom.categoryList.appendChild(block);
    });
    dom.categoryList.appendChild(issueTagBlock());
  }

  function issueTagBlock() {
    const block = document.createElement('section');
    block.className = 'taxonomyCategoryBlock';
    const head = document.createElement('div');
    head.className = 'taxonomyCategoryBlock__head';
    const name = document.createElement('span');
    name.className = 'taxonomyCategoryBlock__name';
    name.textContent = '问题标签';
    const hint = document.createElement('span');
    hint.className = 'row--hint';
    hint.textContent = '验收时可勾选';
    head.append(name, hint);

    const tags = document.createElement('div');
    tags.className = 'taxonomyCategoryBlock__tags';
    if (!state.issueTags.length) {
      const empty = document.createElement('span');
      empty.className = 'row--hint';
      empty.textContent = '暂无问题标签';
      tags.appendChild(empty);
    }
    state.issueTags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'taxonomyCategoryTag';
      chip.title = '双击编辑标签名称';
      const text = document.createElement('span');
      text.textContent = tag.name;
      text.addEventListener('dblclick', () => {
        editNameInline(text, tag.name, (nextName) => {
          if (
            nextName &&
            !state.issueTags.some((item) => item.id !== tag.id && item.name === nextName)
          ) {
            tag.name = nextName;
            saveState();
            if (state.stage === 'review') rebuildReviewMeta();
          }
          renderCategoryList();
        });
      });
      const remove = document.createElement('button');
      remove.className = 'taxonomyCategoryTag__delete';
      remove.textContent = '×';
      remove.title = '删除问题标签';
      remove.addEventListener('click', () => deleteIssueTag(tag.id));
      chip.append(text, remove);
      tags.appendChild(chip);
    });

    const addRow = document.createElement('div');
    addRow.className = 'taxonomyCategoryBlock__add';
    const input = document.createElement('input');
    input.className = 'textInput';
    input.placeholder = '新增问题标签';
    const add = document.createElement('button');
    add.className = 'btn';
    add.textContent = '添加';
    const addIssue = () => {
      const tagName = input.value.trim();
      if (!tagName) return;
      if (state.issueTags.some((tag) => tag.name === tagName)) {
        toast('添加失败', '问题标签已存在');
        return;
      }
      state.issueTags.push({ id: uid('issue'), name: tagName });
      input.value = '';
      saveState();
      if (state.stage === 'review') rebuildReviewMeta();
      renderCategoryList();
    };
    add.addEventListener('click', addIssue);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addIssue();
    });
    addRow.append(input, add);
    block.append(head, tags, addRow);
    return block;
  }

  function deleteIssueTag(tagId) {
    const tag = findIssueTag(tagId);
    if (!tag) return;
    if (!window.confirm(`删除问题标签“${tag.name}”？已勾选的记录会同步移除。`)) return;
    const previousState = snapshotState();
    state.issueTags = state.issueTags.filter((item) => item.id !== tagId);
    state.validationImages.forEach((image) => {
      if (image.issueCounts) delete image.issueCounts[tagId];
      image.issues = (image.issues || []).filter((id) => id !== tagId);
    });
    if (state.reviewIssueTagId === tagId) state.reviewIssueTagId = '';
    saveState();
    renderCategoryList();
    if (state.stage === 'review') rebuildReviewMeta();
    offerUndo(previousState, `问题标签“${tag.name}”已删除`);
  }

  function deleteTag(axisId, tagId) {
    const axis = state.axes.find((item) => item.id === axisId);
    const tag = axis?.tags.find((item) => item.id === tagId);
    if (!axis || !tag) return;
    if (!window.confirm(`删除标签“${tag.name}”？相关图片分类和目标记录会同步移除。`)) return;
    const previousState = snapshotState();
    axis.tags = axis.tags.filter((item) => item.id !== tagId);
    for (const image of state.images) {
      image.classifications[axisId] = (image.classifications[axisId] || []).filter(
        (id) => id !== tagId,
      );
      image.targets = image.targets
        .map((target) => {
          if (target.labelsByAxis[axisId] === tagId) delete target.labelsByAxis[axisId];
          return target;
        })
        .filter((target) => Object.keys(target.labelsByAxis).length > 0);
    }
    for (const image of state.validationImages) {
      image.targets = (image.targets || [])
        .map((target) => {
          if (target.labelsByAxis?.[axisId] === tagId) delete target.labelsByAxis[axisId];
          return target;
        })
        .filter((target) => Object.keys(target.labelsByAxis || {}).length > 0);
    }
    if (state.selectedTagId === tagId) state.selectedTagId = axis.tags[0]?.id || '';
    if (state.filterTagId === tagId) state.filterTagId = '';
    saveState();
    renderCategoryList();
    renderAll();
    offerUndo(previousState, `标签“${tag.name}”已删除`);
  }

  function deleteAxis(axisId) {
    const axis = state.axes.find((item) => item.id === axisId);
    if (!axis || state.axes.length <= 1) return;
    if (!window.confirm(`删除${layerLabel(axis)}？该层级的目标标签会同步移除。`)) return;
    const previousState = snapshotState();
    const deletedLabel = layerLabel(axis);
    state.axes = state.axes.filter((item) => item.id !== axis.id);
    for (const image of state.images) {
      delete image.classifications[axis.id];
      image.targets = image.targets
        .map((target) => {
          delete target.labelsByAxis[axis.id];
          return target;
        })
        .filter((target) => Object.keys(target.labelsByAxis).length);
      syncClassificationsFromTargets(image);
    }
    for (const image of state.validationImages) {
      image.targets = (image.targets || [])
        .map((target) => {
          delete target.labelsByAxis?.[axis.id];
          return target;
        })
        .filter((target) => Object.keys(target.labelsByAxis || {}).length);
    }
    if (state.currentAxisId === axis.id) state.currentAxisId = state.axes[0].id;
    const active = currentAxis();
    state.selectedTagId = active?.tags[0]?.id || '';
    state.filterTagId = '';
    saveState();
    renderAll();
    renderCategoryList();
    offerUndo(previousState, `${deletedLabel}已删除`);
  }

  function releaseDetailUrl() {
    if (detailObjectUrl) URL.revokeObjectURL(detailObjectUrl);
    detailObjectUrl = '';
  }

  function applyDetailTransform() {
    const media = dom.detailMedia.querySelector('img,video');
    if (!media) return;
    media.style.transform = `translate(${detailPanX}px, ${detailPanY}px) scale(${detailScale})`;
    dom.detailMedia.style.cursor = detailScale > 1 ? 'grab' : 'zoom-in';
  }

  function renderDetailMedia(image) {
    releaseDetailUrl();
    detailScale = 1;
    detailPanX = 0;
    detailPanY = 0;
    detailDrag = null;
    dom.detailMedia.innerHTML = '';
    const file = runtimeFiles.get(image.id);
    if (!file) {
      const empty = document.createElement('span');
      empty.className = 'cell__empty';
      empty.textContent = '文件未恢复';
      dom.detailMedia.appendChild(empty);
      return;
    }
    detailObjectUrl = URL.createObjectURL(file);
    const isVideo =
      String(file.type).startsWith('video/') || ['.mp4', '.mov'].includes(extLower(file.name));
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.src = detailObjectUrl;
    if (isVideo) media.controls = true;
    else media.alt = image.originalName;
    media.style.transformOrigin = 'center center';
    dom.detailMedia.appendChild(media);
  }

  function persistDetailChanges() {
    const image = state.images.find((item) => item.id === editingImageId);
    if (!image) return;
    image.targets = editingTargets
      .filter((target) => Object.keys(target.labelsByAxis || {}).length)
      .map((target) => ({
        id: target.id || uid('target'),
        labelsByAxis: { ...target.labelsByAxis },
        count:
          target.count === null || target.count === ''
            ? null
            : Math.max(0, Math.trunc(Number(target.count) || 0)),
      }));
    image.note = dom.note.value.trim();
    syncClassificationsFromTargets(image);
    saveState();
  }

  function openImageEditor(imageId) {
    if (!imageId && selectedIds.size === 1) imageId = Array.from(selectedIds)[0];
    if (!imageId) return;
    if (editingImageId && !dom.editModal.hidden) persistDetailChanges();
    editingImageId = imageId;
    const image = state.images.find((item) => item.id === editingImageId);
    if (!image) return;
    ensureTargetsForImage(image);
    editingTargets = image.targets.map((target) => ({
      id: target.id,
      labelsByAxis: { ...target.labelsByAxis },
      count: target.count === null ? 1 : target.count,
    }));
    dom.note.value = image.note || '';
    dom.editTitle.textContent = image.originalName;
    renderDetailMedia(image);
    renderTargetRows();
    openModal(dom.editModal);
  }

  function openLabelPicker(axes, title, handler) {
    labelPickerHandler = handler;
    dom.labelPickerTitle.textContent = title;
    dom.labelPicker.innerHTML = '';
    axes.forEach((axis) => {
      const group = document.createElement('section');
      group.className = 'taxonomyLabelPickerGroup';
      const name = document.createElement('div');
      name.className = 'taxonomyLabelPickerGroup__name';
      name.textContent = layerLabel(axis);
      const tags = document.createElement('div');
      tags.className = 'taxonomyLabelPickerGroup__tags';
      axis.tags.forEach((tag) => {
        const button = document.createElement('button');
        button.className = 'btn btn--chip';
        button.textContent = tag.name;
        button.addEventListener('click', () => {
          labelPickerHandler?.(axis.id, tag.id);
          labelPickerHandler = null;
          closeModal(dom.labelPickerModal);
        });
        tags.appendChild(button);
      });
      group.append(name, tags);
      dom.labelPicker.appendChild(group);
    });
    openModal(dom.labelPickerModal);
  }

  function openCompleteLabelPicker(axes, title, onComplete) {
    const selections = {};
    dom.labelPickerTitle.textContent = title;
    dom.labelPicker.innerHTML = '';
    axes.forEach((axis) => {
      const group = document.createElement('section');
      group.className = 'taxonomyLabelPickerGroup';
      const name = document.createElement('div');
      name.className = 'taxonomyLabelPickerGroup__name';
      name.textContent = `${layerLabel(axis)} · 必选`;
      const tags = document.createElement('div');
      tags.className = 'taxonomyLabelPickerGroup__tags';
      axis.tags.forEach((tag) => {
        const button = document.createElement('button');
        button.className = 'btn btn--chip';
        button.textContent = tag.name;
        button.addEventListener('click', () => {
          selections[axis.id] = tag.id;
          tags.querySelectorAll('.btn').forEach((item) => {
            item.classList.toggle('btn--selected', item === button);
          });
          if (axes.every((item) => selections[item.id])) {
            closeModal(dom.labelPickerModal);
            onComplete({ ...selections });
          }
        });
        tags.appendChild(button);
      });
      group.append(name, tags);
      dom.labelPicker.appendChild(group);
    });
    openModal(dom.labelPickerModal);
  }

  function renderTargetRows() {
    dom.targets.innerHTML = '';
    dom.addTarget.disabled =
      !state.axes.length || state.axes.some((axis) => axis.tags.length === 0);
    dom.addTarget.title = dom.addTarget.disabled ? '请先为每个分类添加标签' : '';
    if (!editingTargets.length) {
      const empty = document.createElement('div');
      empty.className = 'row--hint';
      empty.textContent = '尚未添加目标';
      dom.targets.appendChild(empty);
      return;
    }

    editingTargets.forEach((target, targetIndex) => {
      const row = document.createElement('div');
      row.className = 'taxonomyObjectRow';
      const top = document.createElement('div');
      top.className = 'taxonomyObjectRow__top';
      const name = document.createElement('span');
      name.className = 'taxonomyObjectRow__name';
      name.textContent = `目标${targetIndex + 1}:`;
      const labels = document.createElement('div');
      labels.className = 'taxonomyObjectRow__labels';

      state.axes.forEach((axis) => {
        const tagId = target.labelsByAxis[axis.id];
        if (!tagId) return;
        const chip = document.createElement('span');
        chip.className = 'taxonomyObjectLabel';
        chip.title = `点击更换${layerLabel(axis)}标签`;
        const text = document.createElement('span');
        text.textContent = findTagName(tagId);
        text.addEventListener('click', () => {
          openLabelPicker([axis], `更换${layerLabel(axis)}标签`, (_, nextTagId) => {
            target.labelsByAxis[axis.id] = nextTagId;
            renderTargetRows();
            persistDetailChanges();
          });
        });
        const remove = document.createElement('button');
        remove.className = 'taxonomyObjectLabel__remove';
        remove.textContent = '×';
        remove.title = '删除标签';
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          delete target.labelsByAxis[axis.id];
          renderTargetRows();
          persistDetailChanges();
        });
        chip.append(text, remove);
        labels.appendChild(chip);
      });

      const missingAxes = state.axes.filter((axis) => !target.labelsByAxis[axis.id]);
      if (missingAxes.length) {
        const add = document.createElement('button');
        add.className = 'btn taxonomyObjectAdd';
        add.textContent = '+';
        add.disabled = missingAxes.some((axis) => axis.tags.length === 0);
        add.title = add.disabled ? '请先为缺少的分类添加标签' : '补充目标标签';
        add.addEventListener('click', () => {
          openCompleteLabelPicker(missingAxes, '补充目标标签', (selections) => {
            Object.assign(target.labelsByAxis, selections);
            renderTargetRows();
            persistDetailChanges();
          });
        });
        labels.appendChild(add);
      }

      const countWrap = document.createElement('label');
      countWrap.className = 'taxonomyObjectCount';
      countWrap.append('数量');
      const count = document.createElement('input');
      count.className = 'textInput';
      count.type = 'number';
      count.min = '0';
      count.step = '1';
      count.value = String(target.count ?? 1);
      count.addEventListener('change', () => {
        target.count = Math.max(0, Math.trunc(Number(count.value) || 0));
        count.value = String(target.count);
        persistDetailChanges();
      });
      countWrap.appendChild(count);
      top.append(name, labels, countWrap);
      row.appendChild(top);
      dom.targets.appendChild(row);
    });
  }

  function closeImageEditor() {
    if (dom.editModal.hidden) return;
    persistDetailChanges();
    closeModal(dom.editModal);
    editingImageId = null;
    editingTargets = [];
    releaseDetailUrl();
    renderAll();
  }

  function switchDetailImage(offset) {
    const images = filteredImages();
    const currentIndex = images.findIndex((image) => image.id === editingImageId);
    if (currentIndex < 0 || !images.length) return;
    persistDetailChanges();
    const nextIndex = (currentIndex + offset + images.length) % images.length;
    openImageEditor(images[nextIndex].id);
  }

  function projectForExport() {
    return {
      type: 'taxonomy-labeling-project',
      version: PROJECT_VERSION,
      exportedAt: new Date().toISOString(),
      axes: state.axes,
      issueTags: state.issueTags,
      images: state.images,
    };
  }

  function downloadJson(data, filename) {
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      filename,
    );
  }

  async function importJson(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const next = normalizeState({
        ...parsed,
        currentAxisId: parsed.currentAxisId || parsed.axes?.[0]?.id,
      });
      if (!next.axes.length || !next.images.length) throw new Error('JSON 中没有有效标注数据');
      state = next;
      state.images.forEach(ensureTargetsForImage);
      selectedIds.clear();
      saveState();
      renderAll();
      closeModal(dom.exportModal);
      toast('导入完成', '如图片未显示，请重新导入同一批文件夹');
    } catch (error) {
      toast('导入失败', String(error?.message || error));
    }
  }

  async function restoreProject() {
    try {
      state = normalizeState(pendingState);
      state.images.forEach(ensureTargetsForImage);
      const loaded = await loadFiles();
      const validationLoaded = await loadValidationFiles();
      dom.restoreBar.hidden = true;
      renderAll();
      toast(
        '恢复完成',
        loaded
          ? `已恢复 ${runtimeFiles.size} 个对比文件${
              validationLoaded ? `，${runtimeValidationFiles.size} 个验证文件` : ''
            }`
          : '已恢复标注，文件需重新导入',
      );
    } catch (error) {
      toast('恢复失败', String(error?.message || error));
    }
  }

  function bindModalDismiss() {
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (event) => {
        if (event.target?.getAttribute?.('data-close') !== '1') return;
        if (modal === dom.editModal) closeImageEditor();
        else if (modal === dom.matchModal) closeMatchPicker();
        else closeModal(modal);
      });
    });
    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => {
        const modal = $(button.dataset.closeModal);
        if (modal === dom.editModal) closeImageEditor();
        else if (modal === dom.matchModal) closeMatchPicker();
        else closeModal(modal);
      });
    });
  }

  function bindEvents() {
    bindModalDismiss();
    dom.stageLabel.addEventListener('click', () => setStage('label'));
    dom.stageReview.addEventListener('click', () => setStage('review'));
    dom.importButton.addEventListener('click', () => {
      openModal(state.stage === 'review' ? dom.validationImportModal : dom.importModal);
    });
    dom.emptyImport.addEventListener('click', () => {
      openModal(state.stage === 'review' ? dom.validationImportModal : dom.importModal);
    });
    dom.chooseFolder.addEventListener('click', () => {
      closeModal(dom.importModal);
      dom.folderInput.click();
    });
    dom.chooseZip.addEventListener('click', () => {
      closeModal(dom.importModal);
      dom.zipInput.click();
    });
    dom.folderInput.addEventListener('change', async () => {
      try {
        await ingestGroups(groupFolderFiles(dom.folderInput.files || []));
      } catch (error) {
        toast('导入失败', String(error?.message || error));
      }
      dom.folderInput.value = '';
    });
    dom.zipInput.addEventListener('change', async () => {
      const file = dom.zipInput.files?.[0];
      if (file) {
        try {
          await ingestGroups(await groupsFromZip(file));
        } catch (error) {
          toast('导入失败', String(error?.message || error));
        }
      }
      dom.zipInput.value = '';
    });
    dom.chooseValidationFolder.addEventListener('click', () => {
      closeModal(dom.validationImportModal);
      dom.validationFolderInput.click();
    });
    dom.chooseValidationZip.addEventListener('click', () => {
      closeModal(dom.validationImportModal);
      dom.validationZipInput.click();
    });
    dom.chooseValidationJson.addEventListener('click', () => {
      dom.validationJsonInput.click();
    });
    dom.validationFolderInput.addEventListener('change', async () => {
      try {
        await ingestValidationGroups(groupFolderFiles(dom.validationFolderInput.files || []));
      } catch (error) {
        toast('导入失败', String(error?.message || error));
      }
      dom.validationFolderInput.value = '';
    });
    dom.validationZipInput.addEventListener('change', async () => {
      const file = dom.validationZipInput.files?.[0];
      if (file) {
        try {
          await ingestValidationGroups(await groupsFromZip(file));
        } catch (error) {
          toast('导入失败', String(error?.message || error));
        }
      }
      dom.validationZipInput.value = '';
    });
    dom.validationJsonInput.addEventListener('change', async () => {
      const file = dom.validationJsonInput.files?.[0];
      if (file) await importValidationJson(file);
      dom.validationJsonInput.value = '';
    });

    dom.search.addEventListener('input', () => {
      if (state.stage === 'review') {
        state.reviewSearch = dom.search.value;
        reviewCursorIndex = 0;
        saveState();
        renderReview();
        return;
      }
      state.search = dom.search.value;
      saveState();
      renderGrid();
      updateStatsAndActions();
    });
    dom.filterToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dom.filterMenu.hidden) {
        renderFilterMenu();
        dom.filterMenu.hidden = false;
      } else {
        closeFilterMenu();
      }
    });
    dom.filterMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => {
      if (!dom.filterMenu.hidden) closeFilterMenu();
    });
    dom.nextIncomplete.addEventListener('click', goToNextIncomplete);
    dom.nextDifference.addEventListener('click', goToNextDifference);
    dom.reviewPrev.addEventListener('click', () => moveReviewCursor(-1));
    dom.reviewNext.addEventListener('click', () => moveReviewCursor(1));
    dom.addIssueTag.addEventListener('click', addIssueTagFromReview);
    dom.deleteValidation.addEventListener('click', () => {
      renderDeleteValidationList();
      openModal(dom.deleteValidationModal);
    });
    dom.deleteValidationAll.addEventListener('click', deleteAllValidation);
    dom.deleteValidationConflicts.addEventListener('click', deleteConflictValidation);
    dom.deleteValidationExtras.addEventListener('click', deleteExtraValidation);
    dom.targetTag.addEventListener('change', () => {
      state.selectedTagId = dom.targetTag.value;
      saveState();
      updateStatsAndActions();
    });
    dom.applyTag.addEventListener('click', () => applyCurrentTag(false));
    dom.removeTag.addEventListener('click', () => applyCurrentTag(true));
    dom.selectAll.addEventListener('click', () => {
      filteredImages().forEach((image) => selectedIds.add(image.id));
      updateSelectionUI();
      updateStatsAndActions();
    });
    dom.clearSelection.addEventListener('click', () => {
      selectedIds.clear();
      lastSelectedIndex = null;
      updateSelectionUI();
      updateStatsAndActions();
    });
    dom.editImage.addEventListener('click', () => openImageEditor());
    dom.deleteImages.addEventListener('click', deleteSelectedImages);

    dom.addAxis.addEventListener('click', () => {
      renderCategoryList();
      openModal(dom.tagsModal);
    });
    dom.addCategoryFromList.addEventListener('click', createLayer);

    dom.addTarget.addEventListener('click', () => {
      openCompleteLabelPicker(
        state.axes,
        '添加目标标签：每个层级选择一个',
        (labelsByAxis) => {
          const target = {
            id: uid('target'),
            labelsByAxis,
            count: 1,
          };
          editingTargets.push(target);
          renderTargetRows();
          persistDetailChanges();
        },
      );
    });
    dom.closeDetail.addEventListener('click', closeImageEditor);
    dom.prevImage.addEventListener('click', () => switchDetailImage(-1));
    dom.nextImage.addEventListener('click', () => switchDetailImage(1));
    dom.note.addEventListener('input', () => {
      const image = state.images.find((item) => item.id === editingImageId);
      if (image) {
        image.note = dom.note.value;
        saveState();
      }
    });
    dom.detailMedia.addEventListener(
      'wheel',
      (event) => {
        const media = dom.detailMedia.querySelector('img,video');
        if (!media) return;
        event.preventDefault();
        const rect = dom.detailMedia.getBoundingClientRect();
        const originX = ((event.clientX - rect.left) / rect.width) * 100;
        const originY = ((event.clientY - rect.top) / rect.height) * 100;
        media.style.transformOrigin = `${originX}% ${originY}%`;
        detailScale = Math.min(6, Math.max(1, detailScale + (event.deltaY < 0 ? 0.25 : -0.25)));
        if (detailScale === 1) {
          detailPanX = 0;
          detailPanY = 0;
          media.style.transformOrigin = 'center center';
        }
        applyDetailTransform();
      },
      { passive: false },
    );
    dom.detailMedia.addEventListener('dblclick', () => {
      const media = dom.detailMedia.querySelector('img,video');
      if (!media) return;
      detailScale = 1;
      detailPanX = 0;
      detailPanY = 0;
      media.style.transformOrigin = 'center center';
      applyDetailTransform();
    });
    dom.detailMedia.addEventListener('pointerdown', (event) => {
      if (detailScale <= 1 || event.button !== 0) return;
      event.preventDefault();
      detailDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        panX: detailPanX,
        panY: detailPanY,
      };
      dom.detailMedia.setPointerCapture(event.pointerId);
      dom.detailMedia.style.cursor = 'grabbing';
    });
    dom.detailMedia.addEventListener('pointermove', (event) => {
      if (!detailDrag || detailDrag.pointerId !== event.pointerId) return;
      detailPanX = detailDrag.panX + event.clientX - detailDrag.startX;
      detailPanY = detailDrag.panY + event.clientY - detailDrag.startY;
      applyDetailTransform();
      dom.detailMedia.style.cursor = 'grabbing';
    });
    const stopDetailDrag = (event) => {
      if (!detailDrag || detailDrag.pointerId !== event.pointerId) return;
      detailDrag = null;
      applyDetailTransform();
    };
    dom.detailMedia.addEventListener('pointerup', stopDetailDrag);
    dom.detailMedia.addEventListener('pointercancel', stopDetailDrag);
    dom.detailMedia.addEventListener('dragstart', (event) => {
      event.preventDefault();
    });
    document.addEventListener('keydown', (event) => {
      if (!dom.editModal.hidden) {
        if (!dom.labelPickerModal.hidden) {
          if (event.key === 'Escape') closeModal(dom.labelPickerModal);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeImageEditor();
          return;
        }
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          switchDetailImage(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          switchDetailImage(1);
        }
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
      const openedModal = document.querySelector('.modal:not([hidden])');
      if (openedModal) {
        if (event.key === 'Escape') {
          if (openedModal === dom.matchModal) closeMatchPicker();
          else closeModal(openedModal);
        }
        return;
      }

      if (state.stage === 'review') {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          moveReviewCursor(1);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          moveReviewCursor(-1);
        } else if (event.key === ']') {
          event.preventDefault();
          goToNextDifference();
        } else if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault();
          reviewRefs?.cells.forEach((cellRef) => setAllVerdicts(cellRef, 'pass'));
        } else if (event.key === 'n' || event.key === 'N') {
          event.preventDefault();
          reviewRefs?.cells.forEach((cellRef) => setAllVerdicts(cellRef, 'fail'));
        }
        return;
      }

      const images = filteredImages();
      if (!images.length) return;
      const cards = Array.from(dom.grid.querySelectorAll('.taxonomyCard'));
      const columnCount = cards.length
        ? Math.max(1, Math.round(dom.grid.clientWidth / cards[0].getBoundingClientRect().width))
        : 1;
      let nextIndex = gridCursorIndex;
      if (event.key === 'ArrowLeft') nextIndex--;
      else if (event.key === 'ArrowRight') nextIndex++;
      else if (event.key === 'ArrowUp') nextIndex -= columnCount;
      else if (event.key === 'ArrowDown') nextIndex += columnCount;
      else if (event.key === ' ') {
        event.preventDefault();
        toggleSelection(images[gridCursorIndex].id, gridCursorIndex, event.shiftKey);
        return;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openImageEditor(images[gridCursorIndex].id);
        return;
      } else if (event.key === ']') {
        event.preventDefault();
        goToNextIncomplete();
        return;
      } else {
        return;
      }
      event.preventDefault();
      if (event.shiftKey && lastSelectedIndex === null) lastSelectedIndex = gridCursorIndex;
      gridCursorIndex = Math.max(0, Math.min(images.length - 1, nextIndex));
      if (event.shiftKey) toggleSelection(images[gridCursorIndex].id, gridCursorIndex, true);
      else updateGridCursor();
    });

    dom.apiButton.addEventListener('click', openApiConfig);
    renderApiQuickServices();
    dom.apiTest.addEventListener('click', () => {
      testApiConnection().catch((error) => toast('连接失败', String(error?.message || error)));
    });
    dom.apiSave.addEventListener('click', saveLlmConfig);
    dom.apiClear.addEventListener('click', clearLlmConfig);
    dom.exportButton.addEventListener('click', () => {
      dom.aiStatus.textContent = '';
      dom.aiStatus.dataset.tone = '';
      openModal(dom.exportModal);
    });
    dom.exportJson.addEventListener('click', () => {
      if (state.stage === 'review') {
        downloadJson(
          projectForReviewExport(),
          `验收报告_${new Date().toISOString().slice(0, 10)}.json`,
        );
      } else {
        downloadJson(projectForExport(), `分类标注_${new Date().toISOString().slice(0, 10)}.json`);
      }
    });
    dom.exportCsv.addEventListener('click', () => {
      exportReviewCsv().catch((error) => toast('导出失败', String(error?.message || error)));
    });
    dom.exportReviewSummary.addEventListener('click', exportReviewSummaryText);
    dom.aiSend.addEventListener('click', generateAiConclusion);
    dom.aiDownload.addEventListener('click', downloadAiConclusion);
    dom.importJson.addEventListener('click', () => dom.jsonInput.click());
    dom.jsonInput.addEventListener('change', async () => {
      const file = dom.jsonInput.files?.[0];
      if (file) await importJson(file);
      dom.jsonInput.value = '';
    });

    dom.restore.addEventListener('click', restoreProject);
    dom.dismissRestore.addEventListener('click', () => {
      dom.restoreBar.hidden = true;
      pendingState = null;
    });
    dom.clearAll.addEventListener('click', async () => {
      if (!window.confirm('确认清空分类打标的文件和状态？合格判定模式不会受影响。')) return;
      state = defaultState();
      pendingState = null;
      runtimeFiles.clear();
      runtimeValidationFiles.clear();
      selectedIds.clear();
      releaseObjectUrls();
      releaseReviewUrls();
      localStorage.removeItem(STATE_KEY);
      await dbClear();
      dom.restoreBar.hidden = true;
      renderAll();
      toast('已清空', '分类打标数据已删除');
    });
  }

  async function boot() {
    bindEvents();
    updateApiButton();
    renderAll();
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    try {
      pendingState = JSON.parse(raw);
      if (Array.isArray(pendingState.images) && pendingState.images.length) {
        dom.restoreBar.hidden = false;
      }
    } catch {
      pendingState = null;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((error) => toast('启动失败', String(error?.message || error)));
  });
})();

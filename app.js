const MM_PER_INCH = 25.4;
const EXPORT_DPI = 300;
const A4 = {
  portrait: { width: 210, height: 297 },
  landscape: { width: 297, height: 210 },
};

const state = {
  photos: [],
  margin: 10,
  gap: 5,
  orientation: "portrait",
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  uploadButton: document.querySelector("#uploadButton"),
  emptyUploadButton: document.querySelector("#emptyUploadButton"),
  dropZone: document.querySelector("#dropZone"),
  photoList: document.querySelector("#photoList"),
  marginInput: document.querySelector("#marginInput"),
  gapInput: document.querySelector("#gapInput"),
  orientationSelect: document.querySelector("#orientationSelect"),
  clearButton: document.querySelector("#clearButton"),
  exportButton: document.querySelector("#exportButton"),
  exportDialog: document.querySelector("#exportDialog"),
  closeExportButton: document.querySelector("#closeExportButton"),
  saveAlbumButton: document.querySelector("#saveAlbumButton"),
  saveImageButton: document.querySelector("#saveImageButton"),
  savePdfButton: document.querySelector("#savePdfButton"),
  confirmSaveButton: document.querySelector("#confirmSaveButton"),
  printButton: document.querySelector("#printButton"),
  exportStatus: document.querySelector("#exportStatus"),
  pageCountLabel: document.querySelector("#pageCountLabel"),
  previewSummary: document.querySelector("#previewSummary"),
  pages: document.querySelector("#pages"),
  toast: document.querySelector("#toast"),
};

let toastTimer;
let exportRunning = false;
let pendingExport = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPhotoSize(photo) {
  const ratio = photo.naturalWidth / photo.naturalHeight;
  if (photo.mode === "width") {
    return { width: photo.cm * 10, height: (photo.cm * 10) / ratio };
  }
  return { width: photo.cm * 10 * ratio, height: photo.cm * 10 };
}

function getDpi(photo) {
  const size = getPhotoSize(photo);
  const dpiX = photo.naturalWidth / (size.width / MM_PER_INCH);
  const dpiY = photo.naturalHeight / (size.height / MM_PER_INCH);
  return Math.round(Math.min(dpiX, dpiY));
}

function getDpiLabel(dpi) {
  if (dpi >= 300) return { className: "good", text: `${dpi} DPI · 清晰` };
  if (dpi >= 180) return { className: "warn", text: `${dpi} DPI · 基本够用` };
  return { className: "low", text: `${dpi} DPI · 可能模糊` };
}

function loadImageFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const ratio = image.naturalWidth / image.naturalHeight;
      resolve({
        ok: true,
        photo: {
          id: crypto.randomUUID(),
          name: file.name,
          url,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          image,
          mode: ratio >= 1 ? "width" : "height",
          cm: 6,
        },
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, name: file.name });
    };
    image.src = url;
  });
}

async function addFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    showToast("请选择图片文件");
    return;
  }

  const results = await Promise.all(files.map(loadImageFile));
  const loaded = results.filter((result) => result.ok).map((result) => result.photo);
  const failed = results.filter((result) => !result.ok);
  state.photos.push(...loaded);
  render();

  if (failed.length) {
    showToast(`${failed.length} 张图片无法读取，可能是浏览器不支持该格式`);
  } else {
    showToast(`已添加 ${loaded.length} 张原图，未进行压缩`);
  }
  elements.fileInput.value = "";
}

function removePhoto(id) {
  const index = state.photos.findIndex((photo) => photo.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(state.photos[index].url);
  state.photos.splice(index, 1);
  render();
}

function clearPhotos() {
  state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
  state.photos = [];
  render();
}

function updatePhotoMode(id, mode) {
  const photo = state.photos.find((item) => item.id === id);
  if (!photo || photo.mode === mode) return;
  const currentSize = getPhotoSize(photo);
  photo.mode = mode;
  photo.cm = Number(((mode === "width" ? currentSize.width : currentSize.height) / 10).toFixed(2));
  render();
}

function updatePhotoSize(id, value) {
  const photo = state.photos.find((item) => item.id === id);
  if (!photo) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  photo.cm = clamp(numeric, 0.5, 60);
  renderPhotoList();
  renderPages();
}

function packPhotos() {
  const paper = A4[state.orientation];
  const contentWidth = paper.width - state.margin * 2;
  const contentHeight = paper.height - state.margin * 2;
  const pages = [];

  function newPage() {
    return { items: [], x: state.margin, y: state.margin, rowHeight: 0, oversized: [] };
  }

  let page = newPage();

  for (const photo of state.photos) {
    const size = getPhotoSize(photo);
    const tooLarge = size.width > contentWidth + 0.01 || size.height > contentHeight + 0.01;
    if (tooLarge) {
      if (page.items.length || page.oversized.length) pages.push(page);
      page = newPage();
      page.oversized.push({ photo, size });
      pages.push(page);
      page = newPage();
      continue;
    }

    if (page.x > state.margin && page.x + size.width > paper.width - state.margin + 0.01) {
      page.x = state.margin;
      page.y += page.rowHeight + state.gap;
      page.rowHeight = 0;
    }

    if (page.y + size.height > paper.height - state.margin + 0.01) {
      pages.push(page);
      page = newPage();
    }

    page.items.push({ photo, size, x: page.x, y: page.y });
    page.x += size.width + state.gap;
    page.rowHeight = Math.max(page.rowHeight, size.height);
  }

  if (page.items.length || page.oversized.length) pages.push(page);
  return pages;
}

function renderPhotoList() {
  if (!state.photos.length) {
    elements.photoList.innerHTML = `
      <div class="list-empty">
        <span>暂无照片</span>
        <p>添加后可逐张设置实际打印尺寸</p>
      </div>`;
    elements.clearButton.hidden = true;
    return;
  }

  elements.clearButton.hidden = false;
  elements.photoList.innerHTML = state.photos
    .map((photo) => {
      const size = getPhotoSize(photo);
      const dpi = getDpi(photo);
      const dpiLabel = getDpiLabel(dpi);
      return `
        <article class="photo-card" data-id="${photo.id}">
          <img class="photo-thumb" src="${photo.url}" alt="" />
          <div class="photo-controls">
            <span class="photo-name" title="${escapeHtml(photo.name)}">${escapeHtml(photo.name)}</span>
            <div class="size-row">
              <div class="size-mode" aria-label="锁定的尺寸">
                <button type="button" data-mode="width" class="${photo.mode === "width" ? "is-active" : ""}" aria-pressed="${photo.mode === "width"}">宽</button>
                <button type="button" data-mode="height" class="${photo.mode === "height" ? "is-active" : ""}" aria-pressed="${photo.mode === "height"}">高</button>
              </div>
              <label class="size-input-wrap">
                <input data-size type="number" min="0.5" max="60" step="0.1" value="${Number(photo.cm.toFixed(2))}" aria-label="${photo.mode === "width" ? "宽度" : "高度"}，单位厘米" />
                <span>cm</span>
              </label>
            </div>
            <div class="photo-meta ${dpiLabel.className}">${(size.width / 10).toFixed(1)} × ${(size.height / 10).toFixed(1)} cm · ${dpiLabel.text}</div>
          </div>
          <button class="remove-button" data-remove type="button" aria-label="移除 ${escapeHtml(photo.name)}">×</button>
        </article>`;
    })
    .join("");
}

function renderPages() {
  if (!state.photos.length) {
    elements.pages.innerHTML = `
      <div class="empty-state">
        <div class="empty-sheet" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        <h2>把照片放进 A4 纸里</h2>
        <p>每张照片都可以锁定宽度或高度，另一边会按原图比例自动计算。</p>
        <button class="button button-secondary" id="emptyUploadButton" type="button">选择照片</button>
      </div>`;
    document.querySelector("#emptyUploadButton").addEventListener("click", () => elements.fileInput.click());
    elements.pageCountLabel.textContent = "0 页";
    elements.previewSummary.textContent = "添加照片后自动排版";
    elements.exportButton.disabled = true;
    elements.saveAlbumButton.disabled = true;
    elements.saveImageButton.disabled = true;
    elements.savePdfButton.disabled = true;
    elements.printButton.disabled = true;
    return;
  }

  const pages = packPhotos();
  const oversizedCount = pages.reduce((count, page) => count + page.oversized.length, 0);
  elements.pages.innerHTML = pages
    .map((page, index) => {
      const photos = page.items
        .map(
          ({ photo, size, x, y }) =>
            `<img class="sheet-photo" src="${photo.url}" alt="${escapeHtml(photo.name)}" style="left:${x}mm;top:${y}mm;width:${size.width}mm;height:${size.height}mm" />`,
        )
        .join("");
      const warning = page.oversized.length
        ? `<div class="sheet-warning">“${escapeHtml(page.oversized[0].photo.name)}” 的设置尺寸超过当前可打印区域，请调小照片尺寸或页边距。</div>`
        : "";
      return `
        <div class="page-wrap">
          <div class="sheet ${state.orientation === "landscape" ? "landscape" : ""}">${photos}${warning}</div>
          <span class="page-label">第 ${index + 1} 页</span>
        </div>`;
    })
    .join("");

  document.body.classList.toggle("print-landscape", state.orientation === "landscape");
  elements.pageCountLabel.textContent = `${pages.length} 页`;
  elements.previewSummary.textContent = `${state.photos.length} 张照片 · ${pages.length} 页 A4${oversizedCount ? ` · ${oversizedCount} 张尺寸过大` : ""}`;
  elements.exportButton.disabled = oversizedCount > 0;
  elements.saveAlbumButton.disabled = oversizedCount > 0;
  elements.saveImageButton.disabled = oversizedCount > 0;
  elements.savePdfButton.disabled = oversizedCount > 0;
  elements.printButton.disabled = oversizedCount > 0;
}

function setExportBusy(isBusy, message = "") {
  exportRunning = isBusy;
  elements.exportDialog.setAttribute("aria-busy", String(isBusy));
  elements.closeExportButton.disabled = isBusy;
  elements.saveAlbumButton.disabled = isBusy;
  elements.saveImageButton.disabled = isBusy;
  elements.savePdfButton.disabled = isBusy;
  elements.printButton.disabled = isBusy;
  elements.confirmSaveButton.disabled = isBusy;
  elements.exportStatus.textContent = message;

  if (!isBusy) {
    const hasOversizedPhoto = packPhotos().some((page) => page.oversized.length);
    elements.saveAlbumButton.disabled = hasOversizedPhoto;
    elements.saveImageButton.disabled = hasOversizedPhoto;
    elements.savePdfButton.disabled = hasOversizedPhoto;
    elements.printButton.disabled = hasOversizedPhoto;
  }
}

function openExportDialog() {
  pendingExport = null;
  elements.confirmSaveButton.hidden = true;
  elements.confirmSaveButton.textContent = "打开系统保存";
  elements.exportStatus.textContent = "";
  if (typeof elements.exportDialog.showModal === "function") {
    elements.exportDialog.showModal();
  } else {
    elements.exportDialog.setAttribute("open", "");
  }
}

function closeExportDialog(force = false) {
  if (exportRunning && !force) return;
  if (typeof elements.exportDialog.close === "function") {
    elements.exportDialog.close();
  } else {
    elements.exportDialog.removeAttribute("open");
  }
  pendingExport = null;
  elements.confirmSaveButton.hidden = true;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成导出文件"));
    }, type, quality);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canShareFiles(files) {
  if (!navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

async function shareOrDownload(files, title, mode = "auto") {
  if (mode !== "download" && canShareFiles(files)) {
    try {
      await navigator.share({ files, title });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }

  files.forEach((file, index) => {
    window.setTimeout(() => downloadBlob(file, file.name), index * 180);
  });
  return mode === "album" ? "album-fallback" : "downloaded";
}

async function renderPageCanvas(page) {
  const paper = A4[state.orientation];
  const scale = EXPORT_DPI / MM_PER_INCH;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(paper.width * scale);
  canvas.height = Math.round(paper.height * scale);
  const context = canvas.getContext("2d", { alpha: false });

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (const { photo, size, x, y } of page.items) {
    if (!photo.image.complete) await photo.image.decode();
    context.drawImage(
      photo.image,
      Math.round(x * scale),
      Math.round(y * scale),
      Math.round(size.width * scale),
      Math.round(size.height * scale),
    );
  }

  return canvas;
}

async function saveAsImages(destination = "download") {
  if (exportRunning) return;
  const pages = packPhotos();
  setExportBusy(true, `正在生成第 1 / ${pages.length} 页图片…`);

  try {
    const files = [];
    for (let index = 0; index < pages.length; index += 1) {
      elements.exportStatus.textContent = `正在生成第 ${index + 1} / ${pages.length} 页图片…`;
      await nextPaint();
      const canvas = await renderPageCanvas(pages[index]);
      const blob = await canvasToBlob(canvas, "image/png");
      files.push(new File([blob], `寸纸-A4-第${index + 1}页.png`, { type: "image/png" }));
      canvas.width = 1;
      canvas.height = 1;
    }

    const toAlbum = destination === "album";
    setExportBusy(
      false,
      toAlbum
        ? `${files.length} 张图片已生成，请点击下方按钮打开相册保存`
        : `${files.length} 张图片已生成，请点击下方按钮下载`,
    );
    pendingExport = {
      files,
      title: "寸纸 A4 照片排版",
      mode: destination,
      sharedMessage: "已打开系统面板，请选择“存储图像”或相册应用",
      downloadedMessage: `已下载 ${files.length} 张 A4 图片`,
      fallbackMessage: "当前浏览器不能直接打开相册，PNG 已下载，可从文件中存入相册",
    };
    elements.confirmSaveButton.textContent = toAlbum ? "打开相册保存" : "下载 PNG 文件";
    elements.confirmSaveButton.hidden = false;
    return;
  } catch (error) {
    console.error(error);
    elements.exportStatus.textContent = "图片生成失败，请调整后重试";
    showToast("图片生成失败，请减少单次照片数量后重试");
  } finally {
    if (exportRunning) setExportBusy(false, elements.exportStatus.textContent);
  }
}

async function saveAsPdf() {
  if (exportRunning) return;
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) {
    showToast("PDF 组件加载失败，请刷新页面后重试");
    return;
  }

  const pages = packPhotos();
  const paper = A4[state.orientation];
  setExportBusy(true, `正在生成第 1 / ${pages.length} 页 PDF…`);

  try {
    const pdf = new JsPdf({
      orientation: state.orientation,
      unit: "mm",
      format: "a4",
      compress: true,
    });

    for (let index = 0; index < pages.length; index += 1) {
      elements.exportStatus.textContent = `正在生成第 ${index + 1} / ${pages.length} 页 PDF…`;
      await nextPaint();
      const canvas = await renderPageCanvas(pages[index]);
      if (index > 0) pdf.addPage("a4", state.orientation);
      pdf.addImage(canvas, "JPEG", 0, 0, paper.width, paper.height, undefined, "SLOW");
      canvas.width = 1;
      canvas.height = 1;
    }

    const blob = pdf.output("blob");
    const file = new File([blob], "寸纸-A4照片排版.pdf", { type: "application/pdf" });
    setExportBusy(false, "PDF 已生成，请点击下方按钮保存");
    pendingExport = {
      files: [file],
      title: "寸纸 A4 照片排版 PDF",
      mode: "auto",
      sharedMessage: "PDF 已交给系统保存或分享",
      downloadedMessage: "PDF 已下载",
    };
    elements.confirmSaveButton.textContent = "打开系统保存";
    elements.confirmSaveButton.hidden = false;
    return;
  } catch (error) {
    console.error(error);
    elements.exportStatus.textContent = "PDF 生成失败，请调整后重试";
    showToast("PDF 生成失败，请减少单次照片数量后重试");
  } finally {
    if (exportRunning) setExportBusy(false, elements.exportStatus.textContent);
  }
}

async function deliverPendingExport() {
  if (!pendingExport || exportRunning) return;
  const currentExport = pendingExport;
  setExportBusy(true, "正在打开系统保存选项…");

  try {
    const result = await shareOrDownload(currentExport.files, currentExport.title, currentExport.mode);
    if (result === "shared") showToast(currentExport.sharedMessage);
    if (result === "downloaded") showToast(currentExport.downloadedMessage);
    if (result === "album-fallback") showToast(currentExport.fallbackMessage);
    if (result === "cancelled") {
      showToast("已取消保存，可以再次点击保存");
      elements.exportStatus.textContent = "文件仍已准备好，可以再次保存";
      return;
    }
    closeExportDialog(true);
  } catch (error) {
    console.error(error);
    showToast("无法打开保存选项，请重试");
  } finally {
    setExportBusy(false, elements.exportStatus.textContent);
  }
}

function render() {
  renderPhotoList();
  renderPages();
}

function handleSettingInput(input, key, min, max) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  state[key] = clamp(value, min, max);
  input.value = state[key];
  renderPages();
}

elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
elements.emptyUploadButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("is-dragging");
});

elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
  addFiles(event.dataTransfer.files);
});

elements.marginInput.addEventListener("change", () => handleSettingInput(elements.marginInput, "margin", 0, 30));
elements.gapInput.addEventListener("change", () => handleSettingInput(elements.gapInput, "gap", 0, 30));
elements.orientationSelect.addEventListener("change", (event) => {
  state.orientation = event.target.value;
  renderPages();
});

elements.photoList.addEventListener("click", (event) => {
  const card = event.target.closest(".photo-card");
  if (!card) return;
  if (event.target.matches("[data-remove]")) removePhoto(card.dataset.id);
  if (event.target.matches("[data-mode]")) updatePhotoMode(card.dataset.id, event.target.dataset.mode);
});

elements.photoList.addEventListener("change", (event) => {
  if (!event.target.matches("[data-size]")) return;
  const card = event.target.closest(".photo-card");
  updatePhotoSize(card.dataset.id, event.target.value);
});

elements.clearButton.addEventListener("click", clearPhotos);
elements.exportButton.addEventListener("click", openExportDialog);
elements.closeExportButton.addEventListener("click", closeExportDialog);
elements.exportDialog.addEventListener("click", (event) => {
  if (event.target === elements.exportDialog) closeExportDialog();
});
elements.exportDialog.addEventListener("cancel", (event) => {
  if (exportRunning) event.preventDefault();
});
elements.saveAlbumButton.addEventListener("click", () => saveAsImages("album"));
elements.saveImageButton.addEventListener("click", () => saveAsImages("download"));
elements.savePdfButton.addEventListener("click", saveAsPdf);
elements.confirmSaveButton.addEventListener("click", deliverPendingExport);
elements.printButton.addEventListener("click", () => {
  closeExportDialog();
  showToast("打印设置请选择 100% 比例、无边距，并关闭页眉页脚");
  window.setTimeout(() => window.print(), 250);
});

render();

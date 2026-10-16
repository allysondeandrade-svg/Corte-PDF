// Configure PDF.js worker via CDN
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const state = {
  pdfBytes: null,
  fileName: '',
  pdfDoc: null,         // PDFLib instance
  pdfjsDoc: null,       // PDF.js instance
  currentPage: 1,
  numPages: 0,
  pageDimensions: [],   // { width, height }
  detectedLabels: [],   // Array of arrays per page: [ [ {x, y, w, h} ] ]
  showOverlay: true,
  scale: 1.0,
  isProcessing: false,
  options: {
    detectionMode: 'auto', // 'auto' | 'grid'
    outputMode: 'exact',    // 'exact' | 'grid'
    padding: 1.0,           // points
    skipEmpty: true
  }
};

// DOM Elements
const elements = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  fileLoadedCard: document.getElementById('fileLoadedCard'),
  loadedFileName: document.getElementById('loadedFileName'),
  loadedFileMeta: document.getElementById('loadedFileMeta'),
  btnRemoveFile: document.getElementById('btnRemoveFile'),
  
  detectionModeInputs: document.querySelectorAll('input[name="detectionMode"]'),
  outputModeInputs: document.querySelectorAll('input[name="outputMode"]'),
  paddingRange: document.getElementById('paddingRange'),
  paddingValueDisplay: document.getElementById('paddingValueDisplay'),
  skipEmptyToggle: document.getElementById('skipEmptyToggle'),
  
  btnProcessPdf: document.getElementById('btnProcessPdf'),
  btnProcessText: document.getElementById('btnProcessText'),
  btnProcessSpinner: document.getElementById('btnProcessSpinner'),
  
  statLabelsTotal: document.getElementById('statLabelsTotal'),
  statPagesIn: document.getElementById('statPagesIn'),
  statAvgDim: document.getElementById('statAvgDim'),
  
  previewStageWrapper: document.getElementById('previewStageWrapper'),
  emptyPreviewState: document.getElementById('emptyPreviewState'),
  canvasContainer: document.getElementById('canvasContainer'),
  previewCanvas: document.getElementById('previewCanvas'),
  overlayCanvas: document.getElementById('overlayCanvas'),
  
  pageLabel: document.getElementById('pageLabel'),
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),
  toggleOverlayBtn: document.getElementById('toggleOverlayBtn'),
  btnSample: document.getElementById('btnSample'),
  
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toastMessage'),
  
  modalBackdrop: document.getElementById('modalBackdrop'),
  btnOpenGuide: document.getElementById('btnOpenGuide'),
  btnCloseModal: document.getElementById('btnCloseModal')
};

// Initialize listeners
function init() {
  setupUpload();
  setupOptions();
  setupPreviewControls();
  setupModal();
}

// Upload & Drag-and-drop
function setupUpload() {
  const { dropzone, fileInput, btnRemoveFile, btnSample } = elements;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  btnRemoveFile.addEventListener('click', resetApp);

  if (btnSample) {
    btnSample.addEventListener('click', loadSamplePdf);
  }
}

// Load sample PDF for instant test
async function loadSamplePdf() {
  try {
    showToast('Carregando arquivo de exemplo...');
    const response = await fetch('sample_input.pdf');
    if (!response.ok) throw new Error('Exemplo não encontrado localmente.');
    const blob = await response.blob();
    const file = new File([blob], 'Exemplo_Etiquetas_A4.pdf', { type: 'application/pdf' });
    handleFile(file);
  } catch (err) {
    showToast('Carregue um arquivo PDF do seu computador.');
  }
}

// Handle uploaded file
async function handleFile(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Por favor, selecione um arquivo no formato PDF.');
    return;
  }

  try {
    showToast('Analisando documento...');
    state.fileName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    state.pdfBytes = new Uint8Array(arrayBuffer);

    // Load in PDFLib
    state.pdfDoc = await PDFLib.PDFDocument.load(state.pdfBytes);
    // Load in PDF.js
    state.pdfjsDoc = await pdfjsLib.getDocument({ data: state.pdfBytes }).promise;
    
    state.numPages = state.pdfDoc.getPageCount();
    state.currentPage = 1;

    // Read dimensions
    state.pageDimensions = state.pdfDoc.getPages().map(p => p.getSize());

    // Update UI for loaded file
    elements.dropzone.style.display = 'none';
    elements.fileLoadedCard.style.display = 'block';
    elements.loadedFileName.textContent = file.name;
    const sizeKb = (file.size / 1024).toFixed(1);
    elements.loadedFileMeta.textContent = `${state.numPages} ${state.numPages === 1 ? 'página' : 'páginas'} • ${sizeKb} KB`;

    // Run Detection
    await runDetection();

    // Render Preview
    elements.emptyPreviewState.style.display = 'none';
    elements.canvasContainer.style.display = 'block';
    await renderCurrentPage();

    elements.btnProcessPdf.disabled = false;
    showToast('PDF carregado com sucesso!');
  } catch (err) {
    console.error('Erro ao abrir PDF:', err);
    alert('Erro ao carregar o arquivo PDF: ' + err.message);
  }
}

// Automatic Edge & Label Detection
async function runDetection() {
  state.detectedLabels = [];
  const pages = state.pdfDoc.getPages();
  let totalLabels = 0;
  let sampleW = 0, sampleH = 0;

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const page = pages[pIdx];
    const { width, height } = state.pageDimensions[pIdx];
    let pageLabels = [];

    if (state.options.detectionMode === 'auto') {
      pageLabels = await detectVectorRectangles(page, width, height);
    }

    // If auto detected nothing or grid mode selected, fallback to Grid A4
    if (pageLabels.length === 0 || state.options.detectionMode === 'grid') {
      pageLabels = await detectA4GridCells(pIdx, width, height);
    }

    // Sort labels top-to-bottom, left-to-right
    pageLabels.sort((a, b) => {
      // In PDF coordinates, y=0 is bottom. Convert to top-down for sorting:
      const topA = height - (a.y + a.h);
      const topB = height - (b.y + b.h);
      const rowA = Math.round(topA / 25);
      const rowB = Math.round(topB / 25);
      if (rowA !== rowB) return rowA - rowB;
      return a.x - b.x;
    });

    state.detectedLabels.push(pageLabels);
    totalLabels += pageLabels.length;

    if (pageLabels.length > 0 && sampleW === 0) {
      sampleW = pageLabels[0].w;
      sampleH = pageLabels[0].h;
    }
  }

  // Update Stats UI
  elements.statLabelsTotal.textContent = totalLabels;
  elements.statPagesIn.textContent = state.numPages;
  if (sampleW > 0 && sampleH > 0) {
    // 1 pt = 25.4 / 72 mm = 0.352778 mm
    const mmW = Math.round(sampleW * 0.352778);
    const mmH = Math.round(sampleH * 0.352778);
    elements.statAvgDim.textContent = `${mmW}×${mmH} mm`;
  } else {
    elements.statAvgDim.textContent = '--';
  }
}

// Vector Detection via decompressed 're' operators
async function detectVectorRectangles(page, width, height) {
  const rects = [];
  try {
    const contents = page.node.Contents();
    if (!contents) return rects;

    let streamBytes = null;
    if (contents.asUint8Array) {
      streamBytes = contents.asUint8Array();
    }

    if (!streamBytes) return rects;

    let text = '';
    // Try native DecompressionStream if available
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(streamBytes);
        writer.close();
        
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
        let offset = 0;
        for (const c of chunks) {
          total.set(c, offset);
          offset += c.length;
        }
        text = new TextDecoder('latin1').decode(total);
      } catch (e) {
        // Fallback to raw text if not compressed
        text = new TextDecoder('latin1').decode(streamBytes);
      }
    } else {
      text = new TextDecoder('latin1').decode(streamBytes);
    }

    // Regex for 're' (rectangle) operator: x y w h re
    const reRegex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+re/g;
    let match;
    while ((match = reRegex.exec(text)) !== null) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      const w = parseFloat(match[3]);
      const h = parseFloat(match[4]);

      // Filter out whole-page borders or tiny elements like barcode lines
      if (w > 80 && h > 80 && w < (width - 10) && h < (height - 10)) {
        // Group duplicates if very close (inner vs outer border stroke)
        const isDuplicate = rects.some(r => Math.abs(r.x - x) < 4 && Math.abs(r.y - y) < 4);
        if (!isDuplicate) {
          rects.push({ x, y, w, h });
        }
      }
    }
  } catch (err) {
    console.warn('Erro na detecção vetorial:', err);
  }
  return rects;
}

// Grid Detection (A4 Standard 2x5 or dynamic grid)
async function detectA4GridCells(pageIndex, pageWidth, pageHeight) {
  const xDivs = [0.0, pageWidth * (271.3 / 595.28), pageWidth];
  const yRatios = [0.0, 159.79, 314.36, 468.93, 623.50, 841.89].map(y => y / 841.89);
  const yDivs = yRatios.map(r => r * pageHeight);

  const rects = [];

  // Check for text content to skip empty slots
  let textItems = [];
  if (state.options.skipEmpty && state.pdfjsDoc) {
    try {
      const jsPage = await state.pdfjsDoc.getPage(pageIndex + 1);
      const textContent = await jsPage.getTextContent();
      textItems = textContent.items;
    } catch (e) {
      textItems = [];
    }
  }

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      const x0 = xDivs[col];
      const x1 = xDivs[col + 1];
      // Note: in top-down PDF canvas
      const topY = yDivs[row];
      const bottomY = yDivs[row + 1];

      // In PDF coordinates (0,0 is bottom-left):
      const pdfY = pageHeight - bottomY;
      const w = x1 - x0;
      const h = bottomY - topY;

      if (state.options.skipEmpty && textItems.length > 0) {
        // Check if any text item falls inside this cell
        const hasText = textItems.some(item => {
          const itemX = item.transform[4];
          const itemY = item.transform[5];
          return itemX >= x0 && itemX <= x1 && itemY >= pdfY && itemY <= (pdfY + h);
        });

        if (!hasText) continue;
      }

      rects.push({ x: x0, y: pdfY, w, h });
    }
  }

  return rects;
}

// Render Preview of Current Page
async function renderCurrentPage() {
  if (!state.pdfjsDoc) return;

  const page = await state.pdfjsDoc.getPage(state.currentPage);
  const viewport = page.getViewport({ scale: 1.5 });

  const canvas = elements.previewCanvas;
  const overlay = elements.overlayCanvas;
  const ctx = canvas.getContext('2d');

  canvas.width = viewport.width;
  canvas.height = viewport.height;
  overlay.width = viewport.width;
  overlay.height = viewport.height;

  // Render PDF page to canvas
  const renderContext = {
    canvasContext: ctx,
    viewport: viewport
  };

  await page.render(renderContext).promise;

  // Render Overlays
  drawOverlays(viewport);

  // Update page indicator
  elements.pageLabel.textContent = `${state.currentPage} / ${state.numPages}`;
  elements.btnPrevPage.disabled = state.currentPage <= 1;
  elements.btnNextPage.disabled = state.currentPage >= state.numPages;
}

// Draw Neon Bounding Boxes and Badges on Overlay Canvas
function drawOverlays(viewport) {
  const overlay = elements.overlayCanvas;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (!state.showOverlay) return;

  const pageLabels = state.detectedLabels[state.currentPage - 1] || [];
  const { height: pageHeight } = state.pageDimensions[state.currentPage - 1];

  pageLabels.forEach((label, idx) => {
    // Convert PDF coordinates (origin bottom-left) to Viewport coordinates (origin top-left)
    // viewport.convertToViewportPoint(x, y)
    const [vx0, vy0] = viewport.convertToViewportPoint(label.x, label.y + label.h);
    const [vx1, vy1] = viewport.convertToViewportPoint(label.x + label.w, label.y);

    const bx = Math.min(vx0, vx1);
    const by = Math.min(vy0, vy1);
    const bw = Math.abs(vx1 - vx0);
    const bh = Math.abs(vy1 - vy0);

    // Box glow and border
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
    
    // Draw box
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();

    // Draw badge tag (#1, #2, etc.)
    const tagText = `#${idx + 1}`;
    ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
    const textWidth = ctx.measureText(tagText).width;
    const badgeW = textWidth + 14;
    const badgeH = 22;

    ctx.fillStyle = '#0891b2';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx + 4, by + 4, badgeW, badgeH, 4) : ctx.rect(bx + 4, by + 4, badgeW, badgeH);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, bx + 11, by + 4 + badgeH / 2);

    ctx.restore();
  });
}

// Process and Generate Cut PDF
async function processAndDownloadPdf() {
  if (!state.pdfDoc || state.isProcessing) return;

  try {
    state.isProcessing = true;
    elements.btnProcessPdf.disabled = true;
    elements.btnProcessSpinner.style.display = 'inline-block';
    elements.btnProcessText.textContent = 'Processando e Recortando...';

    const outDoc = await PDFLib.PDFDocument.create();
    const pages = state.pdfDoc.getPages();
    const padding = parseFloat(state.options.padding) || 0;

    let totalCut = 0;

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const srcPage = pages[pIdx];
      const { height: pageHeight } = state.pageDimensions[pIdx];
      const pageLabels = state.detectedLabels[pIdx] || [];

      for (const label of pageLabels) {
        totalCut++;

        // Add padding
        const clipBox = {
          left: Math.max(0, label.x - padding),
          bottom: Math.max(0, label.y - padding),
          right: label.x + label.w + padding,
          top: label.y + label.h + padding
        };

        const clipWidth = clipBox.right - clipBox.left;
        const clipHeight = clipBox.top - clipBox.bottom;

        // Embed the page sub-region
        const [embeddedPage] = await outDoc.embedPages([srcPage], [clipBox]);

        // Create new page with exact label dimensions
        const newPage = outDoc.addPage([clipWidth, clipHeight]);
        newPage.drawPage(embeddedPage, {
          x: 0,
          y: 0,
          width: clipWidth,
          height: clipHeight
        });
      }
    }

    if (totalCut === 0) {
      alert('Nenhuma etiqueta encontrada para recorte.');
      return;
    }

    // Save and download PDF
    const pdfBytes = await outDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const baseName = state.fileName.replace(/\.[^/.]+$/, '');
    a.href = downloadUrl;
    a.download = `${baseName}_Etiquetas_Cortadas.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    showToast(`Sucesso! ${totalCut} etiquetas salvas.`);
  } catch (err) {
    console.error('Erro ao recortar PDF:', err);
    alert('Erro ao processar o recorte do PDF: ' + err.message);
  } finally {
    state.isProcessing = false;
    elements.btnProcessPdf.disabled = false;
    elements.btnProcessSpinner.style.display = 'none';
    elements.btnProcessText.textContent = 'Baixar PDF das Etiquetas Recortadas';
  }
}

// UI Controls & Options
function setupOptions() {
  // Detection mode
  elements.detectionModeInputs.forEach(input => {
    input.addEventListener('change', async (e) => {
      state.options.detectionMode = e.target.value;
      if (state.pdfDoc) {
        await runDetection();
        await renderCurrentPage();
      }
    });
  });

  // Output mode
  elements.outputModeInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      state.options.outputMode = e.target.value;
    });
  });

  // Padding
  elements.paddingRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value).toFixed(1);
    state.options.padding = parseFloat(val);
    elements.paddingValueDisplay.textContent = `${val} pt`;
  });

  // Skip empty
  elements.skipEmptyToggle.addEventListener('change', async (e) => {
    state.options.skipEmpty = e.target.checked;
    if (state.pdfDoc) {
      await runDetection();
      await renderCurrentPage();
    }
  });

  // Process button
  elements.btnProcessPdf.addEventListener('click', processAndDownloadPdf);
}

// Preview navigation
function setupPreviewControls() {
  elements.btnPrevPage.addEventListener('click', async () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      await renderCurrentPage();
    }
  });

  elements.btnNextPage.addEventListener('click', async () => {
    if (state.currentPage < state.numPages) {
      state.currentPage++;
      await renderCurrentPage();
    }
  });

  elements.toggleOverlayBtn.addEventListener('click', () => {
    state.showOverlay = !state.showOverlay;
    elements.toggleOverlayBtn.style.opacity = state.showOverlay ? '1' : '0.5';
    if (state.pdfjsDoc) {
      const page = state.pdfjsDoc.getPage(state.currentPage).then(p => {
        const viewport = p.getViewport({ scale: 1.5 });
        drawOverlays(viewport);
      });
    }
  });
}

// Reset app
function resetApp() {
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.pdfjsDoc = null;
  state.currentPage = 1;
  state.numPages = 0;
  state.detectedLabels = [];

  elements.dropzone.style.display = 'block';
  elements.fileLoadedCard.style.display = 'none';
  elements.fileInput.value = '';

  elements.canvasContainer.style.display = 'none';
  elements.emptyPreviewState.style.display = 'block';

  elements.btnProcessPdf.disabled = true;
  elements.statLabelsTotal.textContent = '0';
  elements.statPagesIn.textContent = '0';
  elements.statAvgDim.textContent = '--';
}

// Toast message
function showToast(msg) {
  elements.toastMessage.textContent = msg;
  elements.toast.classList.add('show');
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 3200);
}

// Modal Setup
function setupModal() {
  elements.btnOpenGuide.addEventListener('click', () => {
    elements.modalBackdrop.classList.add('open');
  });

  elements.btnCloseModal.addEventListener('click', () => {
    elements.modalBackdrop.classList.remove('open');
  });

  elements.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === elements.modalBackdrop) {
      elements.modalBackdrop.classList.remove('open');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalBackdrop.classList.contains('open')) {
      elements.modalBackdrop.classList.remove('open');
    }
  });
}

// Boot
window.addEventListener('DOMContentLoaded', init);

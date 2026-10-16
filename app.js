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
}// Automatic Edge & Label Detection
async function runDetection() {
  state.detectedLabels = [];
  const pages = state.pdfDoc.getPages();
  let totalLabels = 0;
  let sampleW = 0, sampleH = 0;

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const { width, height } = state.pageDimensions[pIdx];
    let pageLabels = [];

    if (state.options.detectionMode === 'auto') {
      // 1. Vector rectangle detection (exact border paths from PDF)
      pageLabels = await detectVectorRectangles(pIdx, width, height);

      // 2. Fallback to visual canvas border detection (if vectors didn't find any borders)
      if (pageLabels.length === 0) {
        pageLabels = await detectCanvasBorders(pIdx, width, height);
      }
    }

    // 3. Fallback to dynamic orientation-aware grid if still empty or in grid mode
    if (pageLabels.length === 0 || state.options.detectionMode === 'grid') {
      pageLabels = await detectDynamicGrid(pIdx, width, height);
    }

    // Sort labels in natural reading order: top-to-bottom, left-to-right
    pageLabels.sort((a, b) => {
      // In PDF coordinates, y=0 is bottom. Distance from top:
      const topA = height - (a.y + a.h);
      const topB = height - (b.y + b.h);
      const rowA = Math.round(topA / 20);
      const rowB = Math.round(topB / 20);
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

// 1. High-accuracy Vector Detection using PDF.js Operator List
async function detectVectorRectangles(pageIndex, pageWidth, pageHeight) {
  if (!state.pdfjsDoc) return [];
  const rects = [];
  const hLines = [];
  const vLines = [];

  try {
    const jsPage = await state.pdfjsDoc.getPage(pageIndex + 1);
    const ops = await jsPage.getOperatorList();
    const pdfjs = window.pdfjsLib;
    const RECT_OP = pdfjs.OPS.rectangle;
    const CONSTRUCT_PATH = pdfjs.OPS.constructPath;
    const TRANSFORM_OP = pdfjs.OPS.transform;
    const SAVE_OP = pdfjs.OPS.save;
    const RESTORE_OP = pdfjs.OPS.restore;

    // Track transformation matrix stack
    let matrixStack = [[1, 0, 0, 1, 0, 0]];
    function multiplyMatrix(m1, m2) {
      return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
      ];
    }
    function applyTransform(x, y, m) {
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      let curM = matrixStack[matrixStack.length - 1];

      if (fn === SAVE_OP) {
        matrixStack.push([...curM]);
      } else if (fn === RESTORE_OP) {
        if (matrixStack.length > 1) matrixStack.pop();
      } else if (fn === TRANSFORM_OP) {
        matrixStack[matrixStack.length - 1] = multiplyMatrix(curM, args);
      } else if (fn === RECT_OP) {
        const [rx, ry, rw, rh] = args;
        const [x1, y1] = applyTransform(rx, ry, curM);
        const [x2, y2] = applyTransform(rx + rw, ry + rh, curM);
        rects.push({
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1)
        });
      } else if (fn === CONSTRUCT_PATH) {
        const pathOps = args[0];
        const pathArgs = args[1];
        let argIdx = 0;
        let poly = [];

        for (const pOp of pathOps) {
          if (pOp === RECT_OP) {
            const rx = pathArgs[argIdx];
            const ry = pathArgs[argIdx + 1];
            const rw = pathArgs[argIdx + 2];
            const rh = pathArgs[argIdx + 3];
            const [x1, y1] = applyTransform(rx, ry, curM);
            const [x2, y2] = applyTransform(rx + rw, ry + rh, curM);
            rects.push({
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              w: Math.abs(x2 - x1),
              h: Math.abs(y2 - y1)
            });
            argIdx += 4;
          } else if (pOp === 13) { // moveTo
            const [px, py] = applyTransform(pathArgs[argIdx], pathArgs[argIdx + 1], curM);
            poly = [[px, py]];
            argIdx += 2;
          } else if (pOp === 14) { // lineTo
            const [px, py] = applyTransform(pathArgs[argIdx], pathArgs[argIdx + 1], curM);
            if (poly.length > 0) {
              const prev = poly[poly.length - 1];
              if (Math.abs(prev[1] - py) < 1.5 && Math.abs(prev[0] - px) > 40) {
                hLines.push({ y: (prev[1] + py) / 2, x0: Math.min(prev[0], px), x1: Math.max(prev[0], px) });
              } else if (Math.abs(prev[0] - px) < 1.5 && Math.abs(prev[1] - py) > 40) {
                vLines.push({ x: (prev[0] + px) / 2, y0: Math.min(prev[1], py), y1: Math.max(prev[1], py) });
              }
            }
            poly.push([px, py]);
            argIdx += 2;
          } else if (pOp === 18) { // closePath
            if (poly.length >= 4 && poly.length <= 6) {
              const xs = poly.map(pt => pt[0]);
              const ys = poly.map(pt => pt[1]);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
            }
            poly = [];
          } else if (pOp === 15) {
            argIdx += 6;
          } else if (pOp === 16 || pOp === 17) {
            argIdx += 4;
          }
        }
      }
    }

    // Also check if intersecting line strokes form rectangles (e.g. grid outlines)
    if (rects.length === 0 && hLines.length >= 2 && vLines.length >= 2) {
      const yCoords = Array.from(new Set(hLines.map(l => Math.round(l.y)))).sort((a, b) => a - b);
      const xCoords = Array.from(new Set(vLines.map(l => Math.round(l.x)))).sort((a, b) => a - b);
      for (let i = 0; i < xCoords.length - 1; i++) {
        for (let j = 0; j < yCoords.length - 1; j++) {
          const w = xCoords[i + 1] - xCoords[i];
          const h = yCoords[j + 1] - yCoords[j];
          if (w >= 60 && h >= 50) {
            rects.push({ x: xCoords[i], y: yCoords[j], w, h });
          }
        }
      }
    }

    // Filter rects according to label size criteria (not tiny icons, not full page)
    let candidates = rects.filter(r => 
      r.w >= 60 && 
      r.h >= 50 && 
      r.w <= (pageWidth - 8) && 
      r.h <= (pageHeight - 8)
    );

    // Deduplicate close concentric or twin stroke paths
    const unique = [];
    for (const c of candidates) {
      if (!unique.some(u => 
        Math.abs(u.x - c.x) < 7 && 
        Math.abs(u.y - c.y) < 7 && 
        Math.abs(u.w - c.w) < 7 && 
        Math.abs(u.h - c.h) < 7
      )) {
        unique.push(c);
      }
    }

    // Keep outermost borders (discard inner sections/barcodes enclosed inside a larger label)
    const outermost = unique.filter(c => {
      return !unique.some(other => 
        other !== c &&
        c.x >= other.x - 3 &&
        c.y >= other.y - 3 &&
        (c.x + c.w) <= (other.x + other.w + 3) &&
        (c.y + c.h) <= (other.y + other.h + 3) &&
        (other.w * other.h) > (c.w * c.h * 1.15)
      );
    });

    return outermost;
  } catch (err) {
    console.warn('Erro na detecção vetorial:', err);
    return [];
  }
}

// 2. Visual Canvas Border Detection (Fallback for raster or embedded label borders)
async function detectCanvasBorders(pageIndex, pageWidth, pageHeight) {
  try {
    const jsPage = await state.pdfjsDoc.getPage(pageIndex + 1);
    const scale = 1.0;
    const vp = jsPage.getViewport({ scale });
    const offCanvas = document.createElement('canvas');
    offCanvas.width = vp.width;
    offCanvas.height = vp.height;
    const ctx = offCanvas.getContext('2d', { willReadFrequently: true });
    
    await jsPage.render({ canvasContext: ctx, viewport: vp }).promise;
    
    const imgData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    const data = imgData.data;
    const w = offCanvas.width;
    const h = offCanvas.height;

    const isDark = (x, y) => {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      return a > 120 && (r * 0.299 + g * 0.587 + b * 0.114) < 130;
    };

    const minLen = 50;
    const hSegs = [];
    const vSegs = [];

    // Horizontal scan
    for (let y = 10; y < h - 10; y += 3) {
      let run = -1;
      for (let x = 10; x < w - 10; x++) {
        if (isDark(x, y)) {
          if (run === -1) run = x;
        } else {
          if (run !== -1) {
            if ((x - run) >= minLen) hSegs.push({ y, x0: run, x1: x });
            run = -1;
          }
        }
      }
      if (run !== -1 && (w - 10 - run) >= minLen) hSegs.push({ y, x0: run, x1: w - 10 });
    }

    // Vertical scan
    for (let x = 10; x < w - 10; x += 3) {
      let run = -1;
      for (let y = 10; y < h - 10; y++) {
        if (isDark(x, y)) {
          if (run === -1) run = y;
        } else {
          if (run !== -1) {
            if ((y - run) >= minLen) vSegs.push({ x, y0: run, y1: y });
            run = -1;
          }
        }
      }
      if (run !== -1 && (h - 10 - run) >= minLen) vSegs.push({ x, y0: run, y1: h - 10 });
    }

    const detected = [];
    const tol = 8;
    for (let i = 0; i < hSegs.length; i++) {
      const top = hSegs[i];
      for (let j = i + 1; j < hSegs.length; j++) {
        const bottom = hSegs[j];
        const bh = bottom.y - top.y;
        if (bh < minLen) continue;
        if (Math.abs(top.x0 - bottom.x0) > tol || Math.abs(top.x1 - bottom.x1) > tol) continue;

        const leftX = (top.x0 + bottom.x0) / 2;
        const rightX = (top.x1 + bottom.x1) / 2;
        const topY = top.y;
        const bottomY = bottom.y;

        const hasLeft = vSegs.some(v => Math.abs(v.x - leftX) <= tol && v.y0 <= topY + tol && v.y1 >= bottomY - tol);
        const hasRight = vSegs.some(v => Math.abs(v.x - rightX) <= tol && v.y0 <= topY + tol && v.y1 >= bottomY - tol);

        if (hasLeft && hasRight) {
          const pdfX = leftX;
          const pdfW = rightX - leftX;
          const pdfH = bottomY - topY;
          const pdfY = pageHeight - bottomY;

          if (pdfW >= 60 && pdfH >= 50 && pdfW < pageWidth - 10 && pdfH < pageHeight - 10) {
            detected.push({ x: pdfX, y: pdfY, w: pdfW, h: pdfH });
          }
        }
      }
    }

    const unique = [];
    for (const d of detected) {
      if (!unique.some(u => Math.abs(u.x - d.x) < 8 && Math.abs(u.y - d.y) < 8 && Math.abs(u.w - d.w) < 8 && Math.abs(u.h - d.h) < 8)) {
        unique.push(d);
      }
    }
    return unique;
  } catch (e) {
    console.warn('Erro na detecção visual:', e);
    return [];
  }
}

// 3. Dynamic Orientation-Aware Grid (Pimaco / Custom sheets)
async function detectDynamicGrid(pageIndex, pageWidth, pageHeight) {
  let textItems = [];
  if (state.pdfjsDoc) {
    try {
      const jsPage = await state.pdfjsDoc.getPage(pageIndex + 1);
      const textContent = await jsPage.getTextContent();
      textItems = (textContent.items || []).filter(it => it.str && it.str.trim().length > 0);
    } catch (e) {
      textItems = [];
    }
  }

  // If text items exist, group into cluster boxes
  if (textItems.length >= 4) {
    const clusters = clusterTextItems(textItems, pageWidth, pageHeight);
    if (clusters.length > 0) return clusters;
  }

  // Fallback to orientation-aware grid (adapts automatically to landscape vs portrait)
  const isLandscape = pageWidth > pageHeight;
  const cols = isLandscape ? 3 : 2;
  const rows = isLandscape ? 3 : 5;
  const colW = pageWidth / cols;
  const rowH = pageHeight / rows;

  const rects = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * colW;
      const pdfY = (rows - 1 - r) * rowH;

      if (state.options.skipEmpty && textItems.length > 0) {
        const hasText = textItems.some(item => {
          const itemX = item.transform[4];
          const itemY = item.transform[5];
          return itemX >= x0 && itemX <= (x0 + colW) && itemY >= pdfY && itemY <= (pdfY + rowH);
        });
        if (!hasText) continue;
      }

      rects.push({ x: x0, y: pdfY, w: colW, h: rowH });
    }
  }

  return rects;
}

// Cluster nearby text bounding boxes into discrete labels
function clusterTextItems(textItems, pageWidth, pageHeight) {
  const boxes = textItems.map(it => {
    const x = it.transform[4];
    const y = it.transform[5];
    const w = Math.max(12, it.width || 25);
    const h = Math.max(8, Math.abs(it.transform[0]) || 12);
    return { x, y, w, h };
  });

  const dist = (b1, b2) => {
    const dx = Math.max(0, Math.max(b1.x - (b2.x + b2.w), b2.x - (b1.x + b1.w)));
    const dy = Math.max(0, Math.max(b1.y - (b2.y + b2.h), b2.y - (b1.y + b1.h)));
    return Math.sqrt(dx * dx + dy * dy);
  };

  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < boxes.length; i++) {
    if (visited.has(i)) continue;
    const cluster = [boxes[i]];
    visited.add(i);
    const queue = [boxes[i]];

    while (queue.length > 0) {
      const curr = queue.shift();
      for (let j = 0; j < boxes.length; j++) {
        if (!visited.has(j) && dist(curr, boxes[j]) < 28) {
          visited.add(j);
          cluster.push(boxes[j]);
          queue.push(boxes[j]);
        }
      }
    }

    if (cluster.length >= 2) {
      const minX = Math.min(...cluster.map(b => b.x));
      const maxX = Math.max(...cluster.map(b => b.x + b.w));
      const minY = Math.min(...cluster.map(b => b.y));
      const maxY = Math.max(...cluster.map(b => b.y + b.h));
      const cw = maxX - minX;
      const ch = maxY - minY;

      if (cw >= 60 && ch >= 50 && cw < pageWidth - 10 && ch < pageHeight - 10) {
        const pad = 8;
        clusters.push({
          x: Math.max(0, minX - pad),
          y: Math.max(0, minY - pad),
          w: Math.min(pageWidth - minX, cw + pad * 2),
          h: Math.min(pageHeight - minY, ch + pad * 2)
        });
      }
    }
  }

  return clusters;
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

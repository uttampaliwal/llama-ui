import { $ } from './utils.js';

const viewer = {
  overlay: null as HTMLElement | null,
  img: null as HTMLImageElement | null,
  container: null as HTMLElement | null,
  caption: null as HTMLElement | null,
  zoom: 1,
  panX: 0,
  panY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  currentSrc: '',
};

function init(): void {
  viewer.overlay = $('imageViewer');
  viewer.img = $('imageViewerImg') as HTMLImageElement;
  viewer.container = $('imageViewerContainer');
  viewer.caption = $('imageViewerCaption');

  if (!viewer.overlay || !viewer.img || !viewer.container) return;

  // Button handlers
  $('imageViewerZoomIn')?.addEventListener('click', () => setZoom(viewer.zoom * 1.25));
  $('imageViewerZoomOut')?.addEventListener('click', () => setZoom(viewer.zoom / 1.25));
  $('imageViewerReset')?.addEventListener('click', resetView);
  $('imageViewerDownload')?.addEventListener('click', downloadImage);
  $('imageViewerOpenOriginal')?.addEventListener('click', openOriginal);
  $('imageViewerClose')?.addEventListener('click', close);

  // Close on overlay click
  viewer.overlay.addEventListener('click', (e) => {
    if (e.target === viewer.overlay) close();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewer.overlay?.style.display !== 'none') {
      close();
    }
    if (e.key === '+' || e.key === '=') setZoom(viewer.zoom * 1.1);
    if (e.key === '-') setZoom(viewer.zoom / 1.1);
    if (e.key === '0') resetView();
  });

  // Mouse wheel zoom
  viewer.container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(viewer.zoom * delta);
  }, { passive: false });

  // Pan with mouse drag
  viewer.container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    viewer.isDragging = true;
    viewer.startX = e.clientX - viewer.panX;
    viewer.startY = e.clientY - viewer.panY;
    viewer.container?.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!viewer.isDragging) return;
    viewer.panX = e.clientX - viewer.startX;
    viewer.panY = e.clientY - viewer.startY;
    updateTransform();
  });

  document.addEventListener('mouseup', () => {
    viewer.isDragging = false;
    viewer.container?.classList.remove('dragging');
  });

  // Touch support
  let lastTouchDist = 0;
  viewer.container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      viewer.isDragging = true;
      viewer.startX = e.touches[0].clientX - viewer.panX;
      viewer.startY = e.touches[0].clientY - viewer.panY;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  }, { passive: true });

  viewer.container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && viewer.isDragging) {
      viewer.panX = e.touches[0].clientX - viewer.startX;
      viewer.panY = e.touches[0].clientY - viewer.startY;
      updateTransform();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (lastTouchDist > 0) {
        setZoom(viewer.zoom * (dist / lastTouchDist));
      }
      lastTouchDist = dist;
    }
  }, { passive: true });

  viewer.container.addEventListener('touchend', () => {
    viewer.isDragging = false;
    lastTouchDist = 0;
  });

  // Double-click to reset
  viewer.container.addEventListener('dblclick', () => {
    if (viewer.zoom === 1) {
      setZoom(2);
    } else {
      resetView();
    }
  });

  // Listen for image clicks in messages
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && (target.classList.contains('message-image') || target.classList.contains('user-attached-img'))) {
      e.preventDefault();
      open((target as HTMLImageElement).src, target.getAttribute('alt') || '');
    }
  });
}

function open(src: string, alt: string): void {
  if (!viewer.overlay || !viewer.img) return;
  viewer.currentSrc = src;
  viewer.img.src = src;
  viewer.img.alt = alt;
  if (viewer.caption) viewer.caption.textContent = alt;
  viewer.overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  resetView();
}

function close(): void {
  if (!viewer.overlay) return;
  viewer.overlay.style.display = 'none';
  document.body.style.overflow = '';
}

function setZoom(z: number): void {
  viewer.zoom = Math.max(0.1, Math.min(10, z));
  updateTransform();
}

function resetView(): void {
  viewer.zoom = 1;
  viewer.panX = 0;
  viewer.panY = 0;
  updateTransform();
}

function updateTransform(): void {
  if (!viewer.img) return;
  viewer.img.style.transform = `translate(${viewer.panX}px, ${viewer.panY}px) scale(${viewer.zoom})`;
}

function downloadImage(): void {
  if (!viewer.currentSrc) return;
  const a = document.createElement('a');
  a.href = viewer.currentSrc;
  a.download = viewer.currentSrc.split('/').pop() || 'image.png';
  a.target = '_blank';
  a.click();
}

function openOriginal(): void {
  if (!viewer.currentSrc) return;
  window.open(viewer.currentSrc, '_blank');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { open, close };

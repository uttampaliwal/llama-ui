import { logError, logWarn } from './logger.js';

let mathjaxLoading: Promise<void> | null = null;

function setMathJaxConfig(): void {
  (window as any).MathJax = {
    loader: { paths: { mathjax: '/vendor/mathjax/es5' } },
    tex: {
      inlineMath: [['\\(', '\\)'], ['$', '$']],
      displayMath: [['\\[', '\\]'], ['$$', '$$']],
    },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
  };
}

function ensureMathJax(): Promise<void> {
  const w = window as unknown as { MathJax?: { typesetPromise?: (e?: Element[]) => Promise<void> } };
  if (w.MathJax && w.MathJax.typesetPromise) return Promise.resolve();
  if (mathjaxLoading) return mathjaxLoading;
  mathjaxLoading = new Promise<void>((resolve) => {
    setMathJaxConfig();
    const s = document.createElement('script');
    s.src = '/vendor/mathjax/es5/tex-mml-chtml.js';
    s.id = 'MathJax-script';
    s.onload = () => {
      const check = () => {
        const mj = (window as unknown as { MathJax?: { typesetPromise?: () => Promise<void> } }).MathJax;
        if (mj && mj.typesetPromise) resolve();
        else setTimeout(check, 50);
      };
      check();
    };
    s.onerror = () => {
      logWarn('MathJax', 'Failed to load vendor script, math rendering disabled');
      resolve();
    };
    document.head.appendChild(s);
  });
  return mathjaxLoading;
}

export function renderMath(element: Element): void {
  ensureMathJax()
    .then(() => {
      const mj = (window as unknown as {
        MathJax?: { typesetPromise?: (e: Element[]) => Promise<void> };
      }).MathJax;
      if (mj && typeof mj.typesetPromise === 'function') {
        mj.typesetPromise([element]).catch((e) => logError('MathJax typeset', e));
      }
    })
    .catch((e) => logError('MathJax ensure', e));
}

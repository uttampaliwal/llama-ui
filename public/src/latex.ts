export function renderMath(element: Element): void {
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    window.MathJax.typesetPromise([element]).catch(() => {});
  }
}

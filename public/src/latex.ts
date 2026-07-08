export function renderMath(element: Element): void {
  if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
    window.MathJax.typesetPromise([element]).catch(() => {});
  }
}

export function highlightCodeBlocks(root?: Element | Document): void {
  const hl = hljs;
  if (typeof hl !== 'undefined') {
    (root ?? document)
      .querySelectorAll('pre code')
      .forEach((node) => {
        try {
          hl.highlightElement(node);
        } catch (e) {}
      });
  }
}

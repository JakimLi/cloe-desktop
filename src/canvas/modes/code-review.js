/**
 * Code Review Mode
 *
 * When active:
 *   - Pasted code elements automatically get line numbers
 *   - getCloeContext() formats all code content for LLM review
 *   - Annotations from Hermes link to specific lines
 */

/**
 * Detect if an element is a code element.
 * Code elements are text-type elements with the 'code-block' CSS class
 * or whose content looks like code.
 * @param {object} el
 * @returns {boolean}
 */
function isCodeElement(el) {
  if (el.type !== 'text') return false;
  // Check for code-like content patterns
  const content = el.content || '';
  if (!content.trim()) return false;

  const codeIndicators = [
    /^function\s/,
    /^const\s/,
    /^let\s/,
    /^var\s/,
    /^import\s/,
    /^export\s/,
    /^class\s/,
    /^def\s/,
    /^from\s/,
    /^\s*(function|const|let|var|return|import|export|class|if|else|for|while|switch|try|catch|async|await)\b/m,
  ];

  return codeIndicators.some(pattern => pattern.test(content));
}

/**
 * Count lines in a string.
 * @param {string} text
 * @returns {number}
 */
function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Format text with line numbers (for display).
 * @param {string} text
 * @returns {string}
 */
function addLineNumbers(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const maxLineNum = lines.length;
  const padWidth = String(maxLineNum).length;
  return lines
    .map((line, i) => {
      const lineNum = String(i + 1).padStart(padWidth, ' ');
      return `${lineNum} │ ${line}`;
    })
    .join('\n');
}

/**
 * Code Review mode implementation.
 */
const codeReviewMode = {
  name: 'code-review',

  inputs: ['text', 'image'],

  tools: ['annotate', 'suggest', 'approve'],

  /**
   * Called when new elements are added to the canvas.
   * For code elements, marks them for line-number rendering.
   * @param {object[]} elements
   */
  onInput(elements) {
    if (!Array.isArray(elements)) return;

    for (const el of elements) {
      if (isCodeElement(el)) {
        el._codeReview = true;
        console.log(`[CodeReview] Detected code element: ${el.id} (${countLines(el.content)} lines)`);
      }
    }
  },

  /**
   * Format all code elements on the canvas into an LLM-readable context.
   * @param {Iterable<object>} elements - all elements on canvas
   * @returns {string} - formatted context for code review
   */
  getCloeContext(elements) {
    const codeElements = [...elements].filter(isCodeElement);

    if (codeElements.length === 0) {
      return '[Code Review Mode] No code elements found on canvas.';
    }

    let context = '=== CODE REVIEW CONTEXT ===\n\n';

    for (const el of codeElements) {
      const lines = (el.content || '').split('\n');
      context += `--- File: element_${el.id} (${lines.length} lines) ---\n`;
      lines.forEach((line, i) => {
        context += `${i + 1}: ${line}\n`;
      });
      context += '\n';
    }

    context += '=== END CODE REVIEW CONTEXT ===\n';
    context += `\nTotal code blocks: ${codeElements.length}\n`;
    context += 'Please review the code above and provide annotations (line-level comments, suggestions, issues).\n';
    context += 'Respond with annotations in JSON format: { annotations: [{ line, type, message }] }\n';
    context += '  - type: "warning" | "error" | "suggestion" | "info"\n';

    return context;
  },
};

export default codeReviewMode;
export { isCodeElement, addLineNumbers, countLines };

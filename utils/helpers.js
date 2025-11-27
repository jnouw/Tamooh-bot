import { CONFIG } from '../config.js';

/**
 * Validate line number input
 */
export function validateLineNumber(input, maxLines) {
  const trimmed = input.trim();
  
  if (trimmed === '') {
    return { valid: false, error: 'Line number cannot be empty' };
  }

  const num = parseInt(trimmed, 10);
  
  if (Number.isNaN(num)) {
    return { valid: false, error: 'Please enter a valid number' };
  }

  if (num < 1) {
    return { valid: false, error: 'Line number must be at least 1' };
  }

  if (num > maxLines) {
    return { valid: false, error: `Line number cannot exceed ${maxLines}` };
  }

  if (num > CONFIG.MAX_LINE_NUMBER) {
    return { valid: false, error: 'Line number is unreasonably large' };
  }

  return { valid: true, value: num };
}

/**
 * Validate output submission
 */
export function validateOutput(output) {
  if (typeof output !== 'string') {
    return { valid: false, error: 'Output must be text' };
  }

  if (output.length === 0) {
    return { valid: false, error: 'Output cannot be empty (if nothing prints, write "no output")' };
  }

  if (output.length > CONFIG.MAX_OUTPUT_LENGTH) {
    return { valid: false, error: `Output too long (max ${CONFIG.MAX_OUTPUT_LENGTH} characters)` };
  }

  return { valid: true };
}

/**
 * Normalize output for comparison
 */
export function normalizeOutput(str) {
  return String(str)
    .trim()
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+$/g, '');
}

/**
 * Format code with line numbers
 */
export function codeWithLineNumbers(lines) {
  const maxDigits = String(lines.length).length;
  
  return [
    '```',
    ...lines.map((line, i) => {
      const lineNum = String(i + 1).padStart(maxDigits, ' ');
      return `${lineNum} | ${line}`;
    }),
    '```'
  ].join('\n');
}

/**
 * Convert index to letter (A, B, C, D)
 */
export function letter(index) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  return letters[index] ?? '?';
}

/**
 * Sanitize user input for logging
 */
export function sanitizeForLog(input, maxLength = 100) {
  if (typeof input !== 'string') return String(input);
  
  const sanitized = input
    .replace(/[\r\n\t]/g, ' ')
    .substring(0, maxLength);
  
  return sanitized.length < input.length ? sanitized + '...' : sanitized;
}
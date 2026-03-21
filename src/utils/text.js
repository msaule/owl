export function truncate(value, maxLength = 200) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s@.:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean);
}

export function jaccardSimilarity(left, right) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));

  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

export function sentenceCase(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return text;
  }

  return text[0].toUpperCase() + text.slice(1);
}

export function looksLikeTextFile(filePath) {
  return /\.(md|txt|csv|json|ya?ml|js|mjs|cjs|ts|tsx|jsx|html|css)$/i.test(filePath);
}

export function inferDomainCompany(domain) {
  const base = String(domain ?? '')
    .split('.')
    .slice(0, -1)
    .join(' ')
    .replace(/[-_]/g, ' ')
    .trim();

  if (!base) {
    return '';
  }

  return base
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

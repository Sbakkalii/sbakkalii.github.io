// Turn the plain-text notation used in _data (E_t, P_cont(k), D_k+1,
// S_k^clean, (1 − p)^k …) into HTML with real sub- and superscripts.
// Mirrors _includes/math.html. Only call it on notation, never on prose.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function mathHTML(text) {
  return escapeHTML(text)
    .replace(/_([\p{L}\p{N}]+(?:\+1)?)/gu, '<sub>$1</sub>')
    .replace(/\^([\p{L}\p{N}]+)/gu, '<sup>$1</sup>');
}

/** Element with notation rendered, e.g. math('span', 'S_t', {class: 'sym'}). */
export function math(tag, text, attrs = {}) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = mathHTML(text);
  return el;
}

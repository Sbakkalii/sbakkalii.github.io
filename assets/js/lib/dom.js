// Small DOM helpers shared by the components. No dependencies.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** h('button', {class: 'btn', onClick}, 'Label') → HTMLElement */
export function h(tag, attrs, ...children) {
  return append(apply(document.createElement(tag), attrs), children);
}

/** s('rect', {x: 0, y: 0}) → SVGElement */
export function s(tag, attrs, ...children) {
  return append(apply(document.createElementNS(SVG_NS, tag), attrs), children);
}

export const $ = (sel, scope = document) => scope.querySelector(sel);
export const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let counter = 0;
export const uid = (prefix = 'c') => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

/** Replace an element's children. */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Format a number with a fixed number of significant decimals. */
export function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return '∞';
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Run fn on the next frame unless reduced motion is requested. */
export function nextFrame(fn) {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(fn && fn())));
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Roving-tabindex keyboard handling for a set of buttons (tabs, segmented). */
export function roving(buttons, { orientation = 'horizontal', onSelect } = {}) {
  const keysNext = orientation === 'vertical' ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  const keysPrev = orientation === 'vertical' ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  buttons.forEach((btn, i) => {
    btn.addEventListener('keydown', (e) => {
      let next = null;
      if (keysNext.includes(e.key)) next = (i + 1) % buttons.length;
      else if (keysPrev.includes(e.key)) next = (i - 1 + buttons.length) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next === null) return;
      e.preventDefault();
      buttons[next].focus();
      if (onSelect) onSelect(next, buttons[next]);
    });
  });
}

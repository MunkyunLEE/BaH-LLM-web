import { EN } from './i18n_en.js';

const KEY = 'bah-lang';

function detect() {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ko' || s === 'en') return s;
  } catch (e) {}
  const l = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language]).find(Boolean)) || 'en';
  return /^ko/i.test(l) ? 'ko' : 'en';
}

let lang = detect();
const listeners = [];
const missing = new Set();
if (typeof window !== 'undefined') window.__i18nMissing = missing;

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = l === 'ko' ? 'ko' : 'en';
  try {
    localStorage.setItem(KEY, lang);
  } catch (e) {}
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const f of listeners) f(lang);
}

export function onLang(f) {
  listeners.push(f);
}

function fill(s, v) {
  return v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? v[k] : m)) : s;
}

export function t(ko, v) {
  if (lang === 'ko') return fill(ko, v);
  const e = EN[ko];
  if (e === undefined) {
    missing.add(ko);
    return fill(ko, v);
  }
  return fill(e, v);
}

export function missingKeys() {
  return [...missing];
}

const HANGUL = /[가-힣]/;
const nodes = [];
const attrs = [];

export function scanDom(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = n.nodeValue;
    if (HANGUL.test(s)) nodes.push([n, s.trim(), s]);
  }
  for (const el of root.querySelectorAll('[title],[placeholder]')) {
    for (const a of ['title', 'placeholder']) {
      const s = el.getAttribute(a);
      if (s && HANGUL.test(s)) attrs.push([el, a, s]);
    }
  }
}

export function applyDom() {
  for (const [n, key, orig] of nodes) n.nodeValue = lang === 'ko' ? orig : orig.replace(key, t(key));
  for (const [el, a, s] of attrs) el.setAttribute(a, t(s));
}

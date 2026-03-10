/**
 * ESM re-export wrapper for autofill.js functions (test-only).
 *
 * autofill.js is a classic content script. This wrapper evaluates just the
 * pure functions (normalizeText, matchScore, etc.) in a sandbox so tests
 * can import them without Chrome extension APIs.
 *
 * ⚠️  This file is NOT shipped to the extension — only used by test runners.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const src = readFileSync(join(__dirname, 'autofill.js'), 'utf8');

// Minimal sandbox — autofill.js needs many browser globals.  We stub them
// so the module-level code (addEventListener, etc.) doesn't crash.
const noop = () => {};
const sandbox = {
  globalThis: {},
  window: {
    addEventListener: noop,
    location: { hostname: 'test', href: 'http://test' },
    scrollTo: noop,
    history: { replaceState: noop, state: {} },
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      id: '', type: '', textContent: '', style: {},
      addEventListener: noop, appendChild: noop,
    }),
    addEventListener: noop,
    body: {
      appendChild: noop,
      querySelectorAll: () => [],
      observe: noop,
    },
    documentElement: { appendChild: noop },
    activeElement: null,
  },
  Event: class Event { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  KeyboardEvent: class KeyboardEvent { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  MouseEvent: class MouseEvent { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
  MutationObserver: class MutationObserver { constructor() {} observe() {} },
  HTMLSelectElement: class HTMLSelectElement {},
  HTMLTextAreaElement: class HTMLTextAreaElement {},
  HTMLInputElement: class HTMLInputElement {},
  WeakSet: WeakSet,
  CSS: { escape: (s) => s },
  Element: class Element {},
  DataTransfer: class DataTransfer { constructor() { this.items = { add: noop }; } },
  File: class File { constructor() {} },
  chrome: {
    runtime: { getURL: noop, onMessage: { addListener: noop }, sendMessage: noop },
    storage: { local: { get: noop, set: noop }, sync: { get: noop, set: noop } },
  },
  atob: globalThis.atob || ((b) => Buffer.from(b, 'base64').toString('binary')),
  console,
  setTimeout,
  clearTimeout: globalThis.clearTimeout,
  Date,
  Intl,
  Array,
  Object,
  Set,
  Map,
  Math,
  Number,
  String,
  RegExp,
  JSON,
  Promise,
  parseInt,
  parseFloat,
  isNaN,
  fetch: noop,
  alert: noop,
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

try {
  vm.runInContext(src, sandbox);
} catch (e) {
  // Some Chrome-only APIs may fail — that's fine for pure-function extraction
  if (!sandbox.normalizeText) {
    throw new Error('Failed to evaluate autofill.js: ' + e.message);
  }
}

export const normalizeText = sandbox.normalizeText;
export const matchScore = sandbox.matchScore;

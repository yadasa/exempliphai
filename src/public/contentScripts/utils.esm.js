/**
 * ESM re-export wrapper for Node.js tests.
 *
 * The real utils.js is a classic (non-module) script loaded by Chrome content_scripts.
 * It uses top-level const/function declarations without import/export.
 * This wrapper executes it in the current scope and re-exports the symbols that
 * tests need.
 *
 * ⚠️  This file is NOT shipped to the extension — only used by test runners.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const src = readFileSync(join(__dirname, 'utils.js'), 'utf8');

// Create a minimal sandbox with browser-like stubs so utils.js can evaluate.
const sandbox = {
  globalThis: {},
  window: {},
  Event: class Event { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  KeyboardEvent: class KeyboardEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  MouseEvent: class MouseEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  HTMLSelectElement: class HTMLSelectElement {},
  HTMLTextAreaElement: class HTMLTextAreaElement {},
  HTMLInputElement: class HTMLInputElement {},
  atob: globalThis.atob || ((b) => Buffer.from(b, 'base64').toString('binary')),
  console,
  setTimeout,
  Date,
  Intl,
};
// Make window === globalThis for the sandbox
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(src, sandbox);

// Re-export everything tests need
export const fields = sandbox.fields;
export const sleep = sandbox.sleep;
export const delays = sandbox.delays;
export const setNativeValue = sandbox.setNativeValue;
export const setContentEditableValue = sandbox.setContentEditableValue;
export const splitDateParts = sandbox.splitDateParts;
export const parseToISODate = sandbox.parseToISODate;
export const formatForNativeDateInput = sandbox.formatForNativeDateInput;
export const widgetAdapters = sandbox.widgetAdapters;
export const getWidgetAdapter = sandbox.getWidgetAdapter;
export const trySetValueWithAdapter = sandbox.trySetValueWithAdapter;
export const monthToNumber = sandbox.monthToNumber;
export const curDateStr = sandbox.curDateStr;
export const base64ToArrayBuffer = sandbox.base64ToArrayBuffer;
export const getTimeElapsed = sandbox.getTimeElapsed;
export const getStorageDataLocal = sandbox.getStorageDataLocal;
export const getStorageDataSync = sandbox.getStorageDataSync;
export const makeInputLikeEvent = sandbox.makeInputLikeEvent;
export const createTabKeyDown = sandbox.createTabKeyDown;
export const createTabKeyUp = sandbox.createTabKeyUp;
export const pad2 = sandbox.pad2;

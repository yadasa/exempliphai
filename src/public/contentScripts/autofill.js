/* globals keyDownEvent, keyUpEvent, mouseUpEvent, changeEvent, inputEvent,
          createShiftEnterKeyDown, createShiftEnterKeyUp,
          createArrowRightKeyDown, createArrowRightKeyUp,
          createArrowDownKeyDown, createArrowUpKeyDown,
          createEnterKeyDown, createEnterKeyUp,
          createEscapeKeyDown,
          createTabKeyDown, createTabKeyUp,
          sleep, curDateStr, base64ToArrayBuffer, getTimeElapsed, delays,
          getStorageDataLocal, getStorageDataSync, setNativeValue, fields,
          workDayAutofill */

let initTime;

// In some DOM test environments (e.g., linkedom), document.activeElement is not updated by .focus().
// Install a best-effort polyfill without impacting real browsers.
let _smartApplyLastFocusedEl = null;
try {
  const doc = globalThis.document;
  const needsPolyfill = doc && !('activeElement' in doc);
  if (needsPolyfill) {
    const view = (doc && doc.defaultView) || globalThis;
    const proto = view.HTMLElement && view.HTMLElement.prototype;
    if (proto && !proto.__smartApplyFocusPatched) {
      const origFocus = proto.focus;
      proto.focus = function (...args) {
        try {
          _smartApplyLastFocusedEl = this;
        } catch (_) {}
        try {
          if (this && this.ownerDocument) this.ownerDocument.activeElement = this;
        } catch (_) {}
        try {
          return origFocus ? origFocus.apply(this, args) : undefined;
        } catch (_) {
          return undefined;
        }
      };
      proto.__smartApplyFocusPatched = true;
    }
  }
} catch (_) {}

// ─────────────────────────────────────────────────────────────────────────────
// AI Answer (right-click → "AI Answer Last Right-Click Field")
//
// Historically this was installed only during resume-upload handling in
// processFields(), which meant it often never ran (or ran too late), breaking:
// - AI Answer Last Right-Click Field
// - Generate All Pending (last3Questions)
//
// Install once per tab, as early as possible.
let _saAiHandlersInstalled = false;
let _saAiAnswerState = {
  el: null,
  question: '',
  capturedAt: 0,
};
let _saAiBatchQueue = Promise.resolve();

// ─────────────────────────────────────────────────────────────────────────────
// AI Usage Logging (local only)
//
// Stores a rolling log in chrome.storage.local.aiUsageLog (last 1000 entries):
// { date, question, tokensIn, tokensOut, costCents }
//
// NOTE: Cost is an estimate based on Gemini 1.5 Flash public rates.
let _saAiUsageLogQueue = Promise.resolve();

// Gemini 1.5 Flash pricing (USD per 1M tokens)
const _SA_GEMINI_15_FLASH_USD_PER_1M_INPUT = 0.35;
const _SA_GEMINI_15_FLASH_USD_PER_1M_OUTPUT = 0.53;

function _saEstimateGemini15FlashCostCents(tokensIn, tokensOut) {
  try {
    const tin = Number(tokensIn);
    const tout = Number(tokensOut);
    const inTok = Number.isFinite(tin) && tin > 0 ? tin : 0;
    const outTok = Number.isFinite(tout) && tout > 0 ? tout : 0;

    const usd =
      (inTok * _SA_GEMINI_15_FLASH_USD_PER_1M_INPUT + outTok * _SA_GEMINI_15_FLASH_USD_PER_1M_OUTPUT) /
      1_000_000;

    // Keep 4 decimals of cents precision (token-level costs are tiny)
    const cents = usd * 100;
    return Math.round(cents * 10000) / 10000;
  } catch (_) {
    return 0;
  }
}

function _saAppendAiUsageLog(entry) {
  _saAiUsageLogQueue = _saAiUsageLogQueue
    .then(async () => {
      try {
        if (!entry || !chrome?.storage?.local) return;

        const res = await new Promise((resolve) => chrome.storage.local.get(['aiUsageLog'], (r) => resolve(r || {})));
        const cur = Array.isArray(res.aiUsageLog) ? res.aiUsageLog : [];
        const next = cur.concat([entry]).slice(-1000);

        await new Promise((resolve) => chrome.storage.local.set({ aiUsageLog: next }, () => resolve(true)));
      } catch (e) {
        console.warn('exempliphai: failed to write aiUsageLog', e);
      }
    })
    .catch((e) => {
      console.warn('exempliphai: aiUsageLog queue failed', e);
    });

  return _saAiUsageLogQueue;
}

function _saIsAiFillableElement(el) {
  try {
    if (!el || !el.tagName) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = String(el.getAttribute?.('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'file' || type === 'submit' || type === 'button') return false;
      return true;
    }
    if (el.isContentEditable) return true;
    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    if (role === 'textbox' || role === 'combobox') return true;
    return false;
  } catch (_) {
    return false;
  }
}

function _saFindAiAnswerTargetElement(rawTarget) {
  try {
    const t = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
    if (!t) return null;
    if (_saIsAiFillableElement(t)) return t;

    const closest = t.closest?.('textarea, input, select, [contenteditable="true"], [role="textbox"], [role="combobox"]');
    if (closest && _saIsAiFillableElement(closest)) return closest;

    // Fallback: keep original target (question extraction can still work)
    return t;
  } catch (_) {
    return null;
  }
}

function _saGetQuestionFromElement(element) {
  try {
    if (!element) return '';

    let question = element.getAttribute?.('aria-label') || element.getAttribute?.('placeholder') || '';
    if (!question) {
      const id = element.id;
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) question = label.innerText;
      }
    }
    if (!question) {
      // Try to find closest text
      let parent = element.parentElement;
      while (parent && !question && parent.tagName !== 'FORM') {
        if (parent.innerText.length > 5 && parent.innerText.length < 200) {
          question = parent.innerText;
        }
        parent = parent.parentElement;
      }
    }

    return String(question || '').trim();
  } catch (_) {
    return '';
  }
}

function _saCleanJobTitleCandidate(raw) {
  try {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';

    // Common application-page prefixes
    t = t.replace(/^apply\s+(for|to)\s+/i, '');
    t = t.replace(/^application\s+(for|to)\s+/i, '');

    // Common suffixes in <title>
    t = t.replace(/\s*[\-|\|]\s*greenhouse(\.io)?\s*$/i, '');
    t = t.replace(/\s*[\-|\|]\s*lever\s*$/i, '');

    // Strip very long titles (likely full sentence)
    if (t.length > 140) t = t.slice(0, 140).trimEnd() + '…';
    return t;
  } catch (_) {
    return '';
  }
}

function _saGuessJobTitleFromPage() {
  try {
    // 1) explicit globals (if other modules set them)
    const g = globalThis.__SmartApply || {};
    const direct = g.jobTitle || g.job_title || g?.currentJob?.title || g?.currentJob?.jobTitle;
    const cleanedDirect = _saCleanJobTitleCandidate(direct);
    if (cleanedDirect) return cleanedDirect;

    // 2) OpenGraph / Twitter titles
    const meta = document.querySelector?.('meta[property="og:title"], meta[name="twitter:title"]');
    const metaTitle = _saCleanJobTitleCandidate(meta?.getAttribute?.('content'));
    if (metaTitle) return metaTitle;

    // 3) Visible H1 (often the job title)
    const h1s = Array.from(document.querySelectorAll?.('h1') || []);
    for (const h1 of h1s) {
      const txt = _saCleanJobTitleCandidate(h1?.textContent);
      if (txt && txt.length >= 3 && txt.length <= 120) return txt;
    }

    // 4) Document title heuristic
    const dt = String(document.title || '').trim();
    if (dt) {
      // Greenhouse commonly: "Job Application for X at Y" or similar
      const m = dt.match(/(?:job\s+application\s+for\s+)(.+?)(?:\s+at\s+.+)?$/i);
      if (m && m[1]) {
        const t = _saCleanJobTitleCandidate(m[1]);
        if (t) return t;
      }

      const split = dt.split(/\s*[\-|\|]\s*/).map((x) => x.trim()).filter(Boolean);
      if (split.length) {
        const t = _saCleanJobTitleCandidate(split[0]);
        if (t) return t;
      }
    }
  } catch (_) {}
  return '';
}

function _saGetJobTitleForAi(opts = {}) {
  try {
    const fromOpts =
      opts?.jobTitle ||
      opts?.job_title ||
      opts?.snapshot?.jobTitle ||
      opts?.snapshot?.job_title ||
      opts?.formData?.jobTitle ||
      opts?.formData?.job_title;
    const cleaned = _saCleanJobTitleCandidate(fromOpts);
    if (cleaned) return cleaned;

    const guessed = _saGuessJobTitleFromPage();
    if (guessed) return guessed;
  } catch (_) {}
  return '';
}

function _saDropdownTargetElement(rawEl) {
  try {
    const el = rawEl instanceof Element ? rawEl : null;
    if (!el) return null;

    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'select') return el;

    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    if (role === 'combobox') {
      // Prefer the actual input when possible.
      if (tag === 'input') return el;
      const inner = el.querySelector?.('input[role="combobox"], input');
      return inner || el;
    }

    // If the clicked target was inside a combobox shell, prefer the inner input.
    const closestCombo = el.closest?.('[role="combobox"]');
    if (closestCombo) {
      const inner = closestCombo.querySelector?.('input[role="combobox"], input');
      return inner || closestCombo;
    }

    return null;
  } catch (_) {
    return null;
  }
}

function _saIsDropdownLike(el) {
  try {
    return !!_saDropdownTargetElement(el);
  } catch (_) {
    return false;
  }
}

function _saMakeKeyEvent(type, init) {
  try {
    return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  } catch (_) {
    return null;
  }
}

async function _saOpenComboboxMenu(inputEl) {
  try {
    if (!inputEl) return;
    inputEl.focus?.();
  } catch (_) {}

  await sleep(60);

  // Keyboard triggers are more consistent on react-select (Greenhouse).
  try {
    const ev1 = typeof createArrowRightKeyDown === 'function'
      ? createArrowRightKeyDown()
      : _saMakeKeyEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    const ev2 = typeof createArrowRightKeyUp === 'function'
      ? createArrowRightKeyUp()
      : _saMakeKeyEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    if (ev1) inputEl.dispatchEvent(ev1);
    if (ev2) inputEl.dispatchEvent(ev2);
  } catch (_) {}

  await sleep(80);

  try {
    const ev1 = typeof createShiftEnterKeyDown === 'function'
      ? createShiftEnterKeyDown()
      : _saMakeKeyEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true });
    const ev2 = typeof createShiftEnterKeyUp === 'function'
      ? createShiftEnterKeyUp()
      : _saMakeKeyEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true });
    if (ev1) inputEl.dispatchEvent(ev1);
    if (ev2) inputEl.dispatchEvent(ev2);
  } catch (_) {}

  // Fallback: click an obvious control/indicator.
  try {
    const shell = inputEl.closest?.('.select-shell, .select__container, [class*="select__"], [class*="react-select"], [class*="css"]') || inputEl.parentElement;
    const indicator = shell?.querySelector?.(
      '.select__indicators button, [class*="indicatorContainer"], [class*="IndicatorsContainer"] button, .select__dropdown-indicator'
    );
    const control = shell?.querySelector?.('.select__control, [class*="control"], [class*="Control"]');

    if (indicator) {
      try {
        indicator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { indicator.click?.(); } catch (_) {}
      }
    } else if (control) {
      try {
        control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { control.click?.(); } catch (_) {}
      }
    }
  } catch (_) {}

  // Some combos open on ArrowDown.
  try {
    const ev = typeof createArrowDownKeyDown === 'function'
      ? createArrowDownKeyDown()
      : _saMakeKeyEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    if (ev) inputEl.dispatchEvent(ev);
  } catch (_) {}

  await sleep(120);
}

function _saFindListboxForComboboxInput(inputEl) {
  try {
    if (!inputEl) return null;

    const controlsId = inputEl.getAttribute?.('aria-controls') || inputEl.getAttribute?.('aria-owns');
    if (controlsId) {
      const byId = document.getElementById(controlsId);
      if (byId) return byId;
    }

    // Look near the shell
    const shell = inputEl.closest?.('.select-shell, .select__container, [class*="select__"], [class*="react-select"], [class*="css"]') || inputEl.parentElement;
    const near = shell?.querySelector?.('[role="listbox"]');
    if (near) return near;

    // Portals / global listboxes: pick first visible.
    const all = Array.from(document.querySelectorAll?.('[role="listbox"]') || []);
    if (all.length === 1) return all[0];
    for (const lb of all) {
      const h = lb.getBoundingClientRect?.().height || lb.offsetHeight || 0;
      if (h > 0) return lb;
    }
  } catch (_) {}
  return null;
}

async function _saGetDropdownOptionTexts(rawEl, { timeoutMs = 2500 } = {}) {
  try {
    const el = _saDropdownTargetElement(rawEl);
    if (!el) return [];

    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'select') {
      const opts = Array.from(el.options || []);
      const texts = opts
        .map((o) => String(o?.textContent || o?.label || o?.value || '').trim())
        .filter(Boolean);
      return Array.from(new Set(texts)).slice(0, 80);
    }

    // Combobox: open and scrape visible options.
    await _saOpenComboboxMenu(el);

    const start = Date.now();
    let lb = null;
    let optionEls = [];

    while (Date.now() - start < timeoutMs) {
      lb = _saFindListboxForComboboxInput(el);
      if (lb) {
        optionEls = Array.from(lb.querySelectorAll?.('[role="option"], .select__option, [class*="option"]') || [])
          .filter((o) => String(o?.textContent || '').trim().length > 0);
        if (optionEls.length) break;
      }
      await sleep(100);
    }

    const texts = optionEls
      .map((o) => String(o?.textContent || '').trim())
      .filter(Boolean);

    // Close menu (best-effort)
    try {
      const ev = typeof createEscapeKeyDown === 'function'
        ? createEscapeKeyDown()
        : _saMakeKeyEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
      if (ev) el.dispatchEvent(ev);
    } catch (_) {}

    return Array.from(new Set(texts)).slice(0, 80);
  } catch (_) {
    return [];
  }
}

async function _saSelectDropdownOptionByText(rawEl, desiredText, { timeoutMs = 3000 } = {}) {
  try {
    const el = _saDropdownTargetElement(rawEl);
    const want = String(desiredText || '').trim();
    if (!el || !want) return false;

    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'select') {
      const opts = Array.from(el.options || []);
      const exact = opts.find((o) => String(o?.textContent || o?.label || '').trim() === want);
      let best = exact;

      if (!best) {
        let bestScore = 0;
        for (const o of opts) {
          const t = String(o?.textContent || o?.label || '').trim();
          const s = matchScore(want, t);
          if (s > bestScore) {
            bestScore = s;
            best = o;
          }
        }
        if (!best || bestScore < 55) return false;
      }

      try {
        el.value = best.value;
      } catch (_) {
        try { setNativeValue(el, best.value); } catch (_) {}
      }

      dispatchInputAndChange(el);
      return true;
    }

    // Combobox (react-select etc)
    await _saOpenComboboxMenu(el);

    const start = Date.now();
    let lb = null;
    let optionEls = [];
    while (Date.now() - start < timeoutMs) {
      lb = _saFindListboxForComboboxInput(el);
      if (lb) {
        optionEls = Array.from(lb.querySelectorAll?.('[role="option"], .select__option, [class*="option"]') || [])
          .filter((o) => String(o?.textContent || '').trim().length > 0);
        if (optionEls.length) break;
      }
      await sleep(100);
    }

    if (!optionEls.length) return false;

    const exact = optionEls.find((o) => String(o.textContent || '').trim() === want);
    let bestEl = exact;
    if (!bestEl) {
      let bestScore = 0;
      for (const o of optionEls) {
        const t = String(o.textContent || '').trim();
        const s = matchScore(want, t);
        if (s > bestScore) {
          bestScore = s;
          bestEl = o;
        }
      }
      if (!bestEl || bestScore < 55) return false;
    }

    try { bestEl.click?.(); } catch (_) {
      try { bestEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (_) {}
      try { bestEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); } catch (_) {}
      try { bestEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (_) {}
    }

    await sleep(120);
    return true;
  } catch (_) {
    return false;
  }
}

async function _saGenerateAiAnswer(element, opts = {}) {
  const noAlert = opts && opts.noAlert === true;
  const quiet = opts && opts.quiet === true;
  if (!element) return;

  // Show loading state (simple cursor)
  const originalCursor = element?.style?.cursor;
  try {
    if (element?.style) element.style.cursor = 'wait';
  } catch (_) {}

  try {
    // 1) Context (Label/Question)
    const question = _saGetQuestionFromElement(element);

    const pageUrl = String(window.location?.href || '');
    let domain = '';
    try { domain = pageUrl ? new URL(pageUrl).hostname : ''; } catch (_) {}

    // 2) User Data
    const fullSync = await getStorageDataSync();

    const localData = await getStorageDataLocal(["Resume", "LinkedIn PDF", "Resume_details"]);
    const resumeDetails = localData.Resume_details || {};
    const resumeBase64 = localData.Resume;
    const linkedinBase64 = localData["LinkedIn PDF"];

    // PRIVACY: do NOT send full sync storage to the model.
    // Build a minimal, relevant subset for common application questions.
    const pick = (obj, keys) => {
      try {
        for (const k of keys) {
          if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && String(obj[k]).trim() !== '') {
            return obj[k];
          }
        }
      } catch (_) {}
      return undefined;
    };

    const profileSubset = {
      first_name: pick(fullSync, ['first_name', 'First Name', 'firstName']),
      last_name: pick(fullSync, ['last_name', 'Last Name', 'lastName']),
      email: pick(fullSync, ['email', 'Email']),
      phone: pick(fullSync, ['phone', 'Phone', 'phone_number', 'Phone Number']),
      city: pick(fullSync, ['city', 'Location (City)']),
      state: pick(fullSync, ['state', 'Location (State/Region)']),
      country: pick(fullSync, ['country', 'Location (Country)']),
      postal_code: pick(fullSync, ['postal_code', 'Zip', 'zip', 'Postal Code']),
      linkedin: pick(fullSync, ['linkedin', 'LinkedIn']),
      github: pick(fullSync, ['github', 'GitHub']),
      portfolio: pick(fullSync, ['portfolio', 'Portfolio', 'website', 'Website']),
      work_auth_us: pick(fullSync, ['work_auth_us', 'Work Authorization', 'work_authorization_us']),
      sponsorship: pick(fullSync, ['sponsorship', 'Sponsorship', 'requires_sponsorship']),
    };

    // If the question looks like it needs specific user-provided numbers/details
    // (salary range, dates, etc.), we still generate a best-effort answer but we
    // mark it for on-screen review.
    const _saInferNeedsUserInput = (q, profile) => {
      try {
        const t = normalizeText(q);
        if (!t) return false;
        const salaryHints = ['salary', 'compensation', 'expected salary', 'desired salary', 'salary expectations', 'base salary', 'total compensation', 'tc', 'ote', 'pay'];
        const dateHints = ['start date', 'available', 'notice period', 'when can you start'];
        const authHints = ['authorized', 'authorization', 'work authorization', 'sponsorship', 'visa'];

        // Salary: if profile doesn't include a salary expectation key, flag review.
        if (salaryHints.some((h) => t.includes(h))) {
          const hasSalary = Object.keys(profile || {}).some((k) => normalizeText(k).includes('salary') || normalizeText(k).includes('comp'));
          return !hasSalary;
        }

        // Start date / notice period: flag if profile is missing any relevant hints
        if (dateHints.some((h) => t.includes(h))) {
          const has = Object.keys(profile || {}).some((k) => {
            const nk = normalizeText(k);
            return nk.includes('notice') || nk.includes('start') || nk.includes('available');
          });
          return !has;
        }

        // Work auth questions are often sensitive, but when they're asked as text we answer.
        if (authHints.some((h) => t.includes(h))) {
          const has = Object.keys(profile || {}).some((k) => {
            const nk = normalizeText(k);
            return nk.includes('auth') || nk.includes('sponsor') || nk.includes('visa');
          });
          return !has;
        }

        // Generic: if resume details are empty and it's narrative, flag review.
        if (_saLooksLikeNarrativeQuestionLabel(q)) {
          return !(resumeDetailsMin && resumeDetailsMin !== '(none)');
        }

        return false;
      } catch (_) {
        return false;
      }
    };

    // Remove empty keys
    for (const k of Object.keys(profileSubset)) {
      if (profileSubset[k] == null || String(profileSubset[k]).trim() === '') delete profileSubset[k];
    }

    // Tight summary of resume details (structured extraction only)
    const resumeDetailsMin = (() => {
      try {
        const d = resumeDetails && typeof resumeDetails === 'object' ? resumeDetails : {};
        const out = {};

        if (Array.isArray(d.experiences) && d.experiences.length) {
          out.experiences = d.experiences.slice(0, 6).map((x) => {
            const e = x && typeof x === 'object' ? x : {};
            return {
              title: e.title || e.role || e.position || undefined,
              company: e.company || e.employer || undefined,
              start: e.start || e.start_date || e.startDate || undefined,
              end: e.end || e.end_date || e.endDate || undefined,
              highlights: Array.isArray(e.highlights) ? e.highlights.slice(0, 3) : undefined,
            };
          });
        }

        if (Array.isArray(d.skills) && d.skills.length) out.skills = d.skills.slice(0, 50);
        if (Array.isArray(d.certifications) && d.certifications.length) out.certifications = d.certifications.slice(0, 12);

        return JSON.stringify(out, null, 2);
      } catch (_) {
        return '';
      }
    })();

    let sitePrompt = '';
    const host = window.location.hostname.toLowerCase();
    if (host.includes('lever') || host.includes('greenhouse')) sitePrompt = 'Keep under 200 words.';

    const synonyms = {
      'Veteran Status:Decline': 'Prefer not to say',
    };
    const normalizedSynonyms = Object.fromEntries(
      Object.entries(synonyms).map(([k, v]) => [normalizeText(k), v])
    );
    const synonymHint = normalizedSynonyms[normalizeText(question)] || '';

    // Job title context (best-effort) — included in prompts to tailor tone/details.
    const jobTitle = _saGetJobTitleForAi(opts);
    const jobTitleForPrompt = jobTitle ? jobTitle : '(unknown)';

    // Optional: attach PDFs only if they look valid; otherwise skip.
    // This prevents Gemini errors like "The document has no pages" when stored data is empty/invalid.
    const sanitizePdfBase64 = (b64) => {
      try {
        const s = String(b64 || '').trim();
        if (!s) return null;
        const stripped = s.startsWith('data:') ? s.slice(s.indexOf('base64,') + 7) : s;
        if (!stripped || stripped.length < 64) return null;

        // Quick header check: decoded bytes should start with %PDF
        const head = atob(stripped.slice(0, 64));
        if (!head || !head.startsWith('%PDF')) return null;
        return stripped;
      } catch (_) {
        return null;
      }
    };

    const resumePdf = sanitizePdfBase64(resumeBase64);
    const linkedinPdf = sanitizePdfBase64(linkedinBase64);

    const buildTextPart = () => ({
      text: `You write concise, professional job-application answers in first person.
Return ONLY the answer text.
Do not include placeholders like [Company] or [Your Name].
Do NOT include bracketed placeholders or TODOs (no [..], (..), <..> placeholders). If details are missing, write a truthful best-effort answer that is still usable and sounds professional.

${sitePrompt ? `Site guidance: ${sitePrompt}\n\n` : ''}${synonymHint ? `Synonym hint: ${synonymHint}\n\n` : ''}Job title:
${jobTitleForPrompt}

Profile facts (minimal):
${Object.keys(profileSubset).length ? JSON.stringify(profileSubset, null, 2) : '(none)'}

Resume details (structured):
${resumeDetailsMin || '(none)'}

Question:
${question}`
    });

    const callGemini = async (parts, { temperature = 0.2 } = {}) => {
      const input = {
        contents: [{ parts }],
        generationConfig: { temperature: Number.isFinite(temperature) ? temperature : 0.2 },
      };

      const resp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: 'AI_PROXY',
            aiAction: 'aiAnswer',
            model: 'gemini-3-flash-preview',
            input,
          },
          (r) => {
            const err = chrome.runtime.lastError;
            if (err) return reject(new Error(String(err.message || err)));
            resolve(r);
          }
        );
      });

      const json = resp || {};
      if (json?.ok === false) {
        const msg = String(json?.error || 'AI proxy error');
        if (msg === 'low_balance' || msg === 'insufficient_balance') {
          throw new Error('Insufficient ExempliPhai token balance. Please top up to continue.');
        }
        throw new Error(msg);
      }

      const answerText = json?.result?.text;
      if (!answerText) throw new Error('AI response missing text');

      // Best-effort token/cost logging (Gemini returns usageMetadata for many models/tiers)
      try {
        const usage = json?.usage || {};
        const tokensIn = Number(
          usage.promptTokenCount ?? usage.prompt_tokens ?? usage.inputTokenCount ?? usage.input_tokens ?? 0
        );
        const tokensOut = Number(
          usage.candidatesTokenCount ??
            usage.candidates_tokens ??
            usage.outputTokenCount ??
            usage.output_tokens ??
            usage.completionTokenCount ??
            0
        );

        const entry = {
          date: new Date().toISOString(),
          question: String(question || '').trim().slice(0, 800),
          tokensIn: Number.isFinite(tokensIn) ? tokensIn : 0,
          tokensOut: Number.isFinite(tokensOut) ? tokensOut : 0,
          costCents: _saEstimateGemini15FlashCostCents(tokensIn, tokensOut),
        };

        await _saAppendAiUsageLog(entry);
      } catch (_) {}

      return String(answerText).trim();
    };

    // Dropdown / combobox: constrain answer to ONE exact visible option.
    // This helps on Greenhouse/react-select EEO-like dropdowns and other constrained fields.
    try {
      if (_saIsDropdownLike(element)) {
        const optionTexts = await _saGetDropdownOptionTexts(element, { timeoutMs: 3000 });
        const cleanOptions = Array.from(
          new Set(
            (Array.isArray(optionTexts) ? optionTexts : [])
              .map((t) => String(t || '').trim())
              .filter(Boolean)
              .slice(0, 60)
          )
        );

        if (cleanOptions.length) {
          const dropdownPrompt = `Pick the single best option EXACTLY from the list below.
Return ONLY the option text exactly as it appears in the list. No quotes. No explanation.

Q: ${String(question || '').trim()}
job: ${jobTitleForPrompt}

profile (minimal facts):
${Object.keys(profileSubset).length ? JSON.stringify(profileSubset, null, 2) : '(none)'}

resume (structured):
${resumeDetailsMin || '(none)'}

options:
- ${cleanOptions.join('\n- ')}`;

          const pickedRaw = await callGemini([{ text: dropdownPrompt }], { temperature: 0.0 });
          const picked = String(pickedRaw || '').trim();

          // Prefer exact match; else fuzzy match to the closest visible option.
          let chosen = cleanOptions.find((o) => o === picked);
          if (!chosen && picked) {
            let best = { t: null, score: 0 };
            for (const o of cleanOptions) {
              const sc = matchScore(picked, o);
              if (sc > best.score) best = { t: o, score: sc };
            }
            if (best.t && best.score >= 55) chosen = best.t;
          }

          if (chosen) {
            const ok = await _saSelectDropdownOptionByText(element, chosen, { timeoutMs: 3500 });
            if (ok) {
              try {
                if (chrome?.runtime?.sendMessage) {
                  chrome.runtime.sendMessage({
                    action: 'TRACK_CUSTOM_ANSWER',
                    kind: 'dropdown',
                    prompt: String(question || '').trim(),
                    answer: String(chosen || '').trim(),
                    url: pageUrl,
                    domain,
                    ts: Date.now(),
                    source: 'ai_answer',
                  });
                }
              } catch (_) {}
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('exempliphai: AI dropdown/combobox constrain failed; falling back to free-text answer', e);
    }

    // Default: text-only (most reliable). Attach PDFs only when valid.
    const parts = [buildTextPart()];
    const hadPdf = !!(resumePdf || linkedinPdf);
    if (resumePdf) parts.push({ inline_data: { data: resumePdf, mime_type: 'application/pdf' } });
    if (linkedinPdf) parts.push({ inline_data: { data: linkedinPdf, mime_type: 'application/pdf' } });

    let answer = '';
    try {
      answer = await callGemini(parts);
    } catch (e) {
      const msg = String(e?.message || e || '').toLowerCase();
      // Graceful fallback: retry without PDFs when Gemini cannot parse the document.
      if (hadPdf && (msg.includes('no pages') || msg.includes('document has no pages'))) {
        console.warn('exempliphai: Gemini PDF parse failed; retrying text-only');
        answer = await callGemini([buildTextPart()]);
      } else {
        throw e;
      }
    }

    const needsUserInput = _saInferNeedsUserInput(question, profileSubset);

    // Insert Answer + dispatch events (best-effort)
    if (answer) {
      try {
        setNativeValue(element, answer);
      } catch (_) {
        // Fallback for contenteditable
        try {
          if (element.isContentEditable) element.textContent = answer;
        } catch (_) {}
      }
      try {
        if (typeof dispatchInputAndChange === 'function') dispatchInputAndChange(element);
      } catch (_) {}

      // Overlay is user-only, does not affect form content.
      try {
        if (needsUserInput) {
          _saAttachOverlayBadge(element, {
            text: 'Needs your input',
            title: 'This answer was generated best-effort and may need your specifics (range, dates, details).',
          });
        } else {
          _saRemoveOverlayBadge(element);
        }
      } catch (_) {}

      // Metrics hook (Firebase): store the full answer
      try {
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'TRACK_CUSTOM_ANSWER',
            kind: 'text',
            prompt: String(question || '').trim(),
            answer: String(answer || '').trim(),
            url: pageUrl,
            domain,
            ts: Date.now(),
            source: 'ai_answer',
          });
        }
      } catch (_) {}
    }
  } catch (error) {
    console.error('AI Generation Error', error);
    if (!noAlert) alert(`Failed to generate answer: ${error.message}`);

    // On failure, mark field with invisible fallback char + overlay (user-only)
    try {
      if (element && (typeof isEmptyForAi !== 'function' || isEmptyForAi(element))) {
        const did = _saInsertInvisibleFallbackChar(element);
        if (did) _saAttachOverlayBadge(element, { text: 'Needs your input', title: 'AI could not answer this field automatically.' });
      }
    } catch (_) {}
  } finally {
    try {
      if (element?.style) element.style.cursor = originalCursor;
    } catch (_) {}
  }
}


function _saEnqueueAiBatchTask(fn) {
  _saAiBatchQueue = _saAiBatchQueue
    .then(() => fn())
    .catch((e) => {
      console.warn('exempliphai: AI batch task failed', e);
      return { ok: false, error: String(e?.message || e) };
    });
  return _saAiBatchQueue;
}

let _saToastEl = null;
let _saToastTimer = null;

function _saShowToast(message, { timeoutMs = 1800 } = {}) {
  try {
    const doc = document;
    if (!doc || !doc.createElement) return;

    if (!_saToastEl) {
      const el = doc.createElement('div');
      el.id = 'smartapply-toast';
      el.style.position = 'fixed';
      el.style.zIndex = '2147483647';
      el.style.right = '14px';
      el.style.bottom = '14px';
      el.style.maxWidth = '360px';
      el.style.padding = '10px 12px';
      el.style.borderRadius = '10px';
      el.style.background = 'rgba(17, 24, 39, 0.92)';
      el.style.color = '#fff';
      el.style.fontSize = '13px';
      el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      el.style.boxShadow = '0 12px 30px rgba(0,0,0,0.25)';
      el.style.backdropFilter = 'blur(6px)';
      el.style.pointerEvents = 'none';
      el.style.whiteSpace = 'pre-wrap';
      el.style.opacity = '0';
      el.style.transition = 'opacity 140ms ease-in-out';
      doc.documentElement.appendChild(el);
      _saToastEl = el;
    }

    _saToastEl.textContent = String(message || '').slice(0, 500);
    _saToastEl.style.opacity = '1';

    if (_saToastTimer) clearTimeout(_saToastTimer);
    _saToastTimer = setTimeout(() => {
      try {
        if (_saToastEl) _saToastEl.style.opacity = '0';
      } catch (_) {}
    }, Math.max(400, Number(timeoutMs || 1800)));
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Autofill UX helpers
// - Overlay badges are visible only to the user (DOM only, not form content)
// - Invisible fallback char marks "intentionally left for user" without adding
//   visible text
// ─────────────────────────────────────────────────────────────────────────────

const _saOverlayClass = 'smartapply-ai-overlay-badge';
const _saOverlayStyleId = 'smartapply-ai-overlay-style';

function _saEnsureOverlayStyles() {
  try {
    const doc = document;
    if (!doc?.getElementById || doc.getElementById(_saOverlayStyleId)) return;
    const style = doc.createElement('style');
    style.id = _saOverlayStyleId;
    style.textContent = `
.${_saOverlayClass} {
  position: absolute;
  z-index: 2147483647;
  top: -8px;
  right: 0;
  transform: translateY(-100%);
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.2;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background: rgba(245, 158, 11, 0.95);
  color: #111827;
  box-shadow: 0 10px 24px rgba(0,0,0,0.18);
  pointer-events: auto;
}
@media (prefers-color-scheme: dark) {
  .${_saOverlayClass} { color: #111827; }
}
`;
    doc.documentElement.appendChild(style);
  } catch (_) {}
}

function _saAttachOverlayBadge(el, { text = 'Needs your input', title = '' } = {}) {
  try {
    if (!el || !el.ownerDocument) return;
    _saEnsureOverlayStyles();

    // Remove existing badge to keep idempotent.
    try {
      const prev = el.ownerDocument.querySelector(`.${_saOverlayClass}[data-for-id="${CSS.escape(el.id || '')}"]`);
      if (prev) prev.remove();
    } catch (_) {}

    // Prefer anchoring inside a positioned wrapper. If not possible, fall back to a fixed badge.
    const doc = el.ownerDocument;

    const badge = doc.createElement('div');
    badge.className = _saOverlayClass;
    badge.textContent = String(text || 'Needs your input').slice(0, 60);
    if (title) badge.title = String(title).slice(0, 240);

    // Try to anchor to closest reasonably-contained block.
    let anchor = null;
    try {
      anchor = el.closest('label, .field, .form-field, .form-group, [role="group"], [data-test], [data-testid]') || el.parentElement;
    } catch (_) {
      anchor = el.parentElement;
    }

    if (anchor && anchor.appendChild) {
      const cs = doc.defaultView?.getComputedStyle(anchor);
      if (cs && cs.position === 'static') anchor.style.position = 'relative';
      badge.style.pointerEvents = 'none';
      anchor.appendChild(badge);
      return;
    }

    // Fallback: fixed badge near element
    const r = el.getBoundingClientRect?.();
    if (r) {
      badge.style.position = 'fixed';
      badge.style.top = Math.max(6, r.top - 10) + 'px';
      badge.style.left = Math.min(window.innerWidth - 160, Math.max(6, r.right - 140)) + 'px';
      badge.style.transform = 'translateY(-100%)';
      badge.style.pointerEvents = 'none';
      doc.documentElement.appendChild(badge);
    }
  } catch (_) {}
}

function _saRemoveOverlayBadge(el) {
  try {
    if (!el?.ownerDocument) return;
    const doc = el.ownerDocument;
    const nodes = Array.from(doc.querySelectorAll(`.${_saOverlayClass}`));
    for (const n of nodes) {
      // Best-effort: remove badges that are near this element by DOM containment.
      if (n && (el.contains?.(n) || n.parentElement?.contains?.(el))) {
        try { n.remove(); } catch (_) {}
      }
    }
  } catch (_) {}
}

function _saInsertInvisibleFallbackChar(el, { force = false } = {}) {
  try {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return false;

    const type = String(el.getAttribute?.('type') || 'text').toLowerCase();
    if (tag === 'input' && ['hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'date', 'time', 'datetime-local', 'number', 'email', 'tel', 'url', 'password'].includes(type)) {
      return false;
    }

    const v = String(el.value || '');
    if (!force && v.trim().length > 0) return false;

    const invisible = '‎ ';
    try {
      setNativeValue(el, invisible);
    } catch (_) {
      el.value = invisible;
    }
    try {
      if (typeof dispatchInputAndChange === 'function') dispatchInputAndChange(el);
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function _saLooksLikeBasicProfileFieldLabel(label) {
  const t = normalizeText(label);
  if (!t) return false;
  const basics = [
    'first name',
    'last name',
    'full name',
    'email',
    'phone',
    'mobile',
    'city',
    'state',
    'country',
    'zip',
    'postal',
    'address',
    'linkedin',
    'github',
    'website',
    'portfolio',
  ];
  return basics.some((b) => t === b || t.includes(b + ":") || t.includes(b));
}

function _saLooksLikeNarrativeQuestionLabel(label) {
  const t = normalizeText(label);
  if (!t) return false;

  // Keep payload small and avoid obvious non-questions.
  if (t.length < 12) return false;
  if (t.length > 320) return false;

  // Avoid EEO/sensitive prompts (usually not free-text, but be safe).
  const sensitive = [
    'gender',
    'race',
    'ethnicity',
    'disability',
    'veteran',
    'sexual orientation',
    'equal employment',
    'eeo',
  ];
  if (sensitive.some((s) => t.includes(s))) return false;

  // Salary/compensation questions are explicitly allowed even when not phrased
  // as a narrative question.
  const salaryHints = [
    'salary',
    'compensation',
    'pay',
    'expected salary',
    'desired salary',
    'salary expectations',
    'base salary',
    'total compensation',
    'tc',
    'ote',
  ];
  if (salaryHints.some((s) => t.includes(s))) return true;

  if (_saLooksLikeBasicProfileFieldLabel(t)) return false;

  if (t.includes('?')) return true;

  const hints = [
    'tell us',
    'describe',
    'why',
    'how',
    'what',
    'explain',
    'elaborate',
    'motivat',
    'interested in',
    'fit for',
    'background',
    'experience',
    'cover letter',
    'additional information',
    'anything else',
  ];
  return hints.some((h) => t.includes(h));
}

function _saFindPendingAiAnswerElements({ limit = 8 } = {}) {
  try {
    const out = [];
    const roots = typeof _saCollectQueryRoots === 'function' ? _saCollectQueryRoots(document) : [document];

    const selector = 'textarea, input, [contenteditable="true"], [role="textbox"]';

    for (const r of roots) {
      if (!r || !r.querySelectorAll) continue;
      const nodes = Array.from(r.querySelectorAll(selector));

      for (const el of nodes) {
        if (!el) continue;

        const tag = String(el.tagName || '').toLowerCase();
        if (tag === 'input') {
          const type = String(el.getAttribute?.('type') || '').toLowerCase();
          if (['hidden', 'file', 'checkbox', 'radio', 'submit', 'button'].includes(type)) continue;
        }

        if (!_saIsAiFillableElement(el)) continue;
        if (typeof _saIsElementVisible === 'function' && !_saIsElementVisible(el)) continue;
        if (typeof _saIsElementEnabled === 'function' && !_saIsElementEnabled(el)) continue;
        if (typeof isEmptyForAi === 'function' && !isEmptyForAi(el)) continue;

        const label = _saGetQuestionFromElement(el);
        if (!_saLooksLikeNarrativeQuestionLabel(label)) {
          // Avoid filling basic single-line inputs unless the label looks like a question.
          // Exception: salary/comp fields are allowed (handled in _saLooksLikeNarrativeQuestionLabel).
          if (tag !== 'textarea') continue;
        }

        out.push(el);
        const lim = Number.isFinite(limit) ? limit : 8;
        if (out.length >= lim) return out;
      }
    }

    return out;
  } catch (_) {
    return [];
  }
}

async function _saGenerateAllPendingAiAnswers({ limit = 8, source = 'manual' } = {}) {
  return _saEnqueueAiBatchTask(async () => {
    const targets = _saFindPendingAiAnswerElements({ limit });
    if (!targets.length) {
      _saShowToast('AI: no pending custom fields found.');
      return { ok: true, total: 0, filled: 0, source };
    }

    _saShowToast('AI: answering ' + targets.length + ' field(s)…', { timeoutMs: 1600 });

    let filled = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      _saShowToast('AI: answering ' + (i + 1) + '/' + targets.length + '…', { timeoutMs: 1200 });

      try {
        await _saGenerateAiAnswer(el, { noAlert: true, quiet: true });
      } catch (_) {}

      // If still empty after attempting AI, mark field with an invisible character
      // so the user can spot unfilled fields via overlays and the extension can
      // avoid reprocessing loops.
      try {
        if (typeof isEmptyForAi === 'function' && isEmptyForAi(el)) {
          const did = _saInsertInvisibleFallbackChar(el);
          if (did) _saAttachOverlayBadge(el, { text: 'Needs your input', title: 'Exempliphai could not confidently answer this field.' });
        } else {
          _saRemoveOverlayBadge(el);
        }
      } catch (_) {}

      // Best-effort success detection
      try {
        if (typeof isEmptyForAi === 'function' && isEmptyForAi(el)) failed += 1;
        else filled += 1;
      } catch (_) {
        filled += 1;
      }

      await _saSleep(250);
    }

    if (failed) _saShowToast('AI: done (' + filled + ' ok, ' + failed + ' failed)', { timeoutMs: 2200 });
    else _saShowToast('AI: done (' + filled + ')', { timeoutMs: 2000 });

    return { ok: true, total: targets.length, filled, failed, source };
  });
}
function _saInstallAiAnswerHandlers() {
  try {
    if (_saAiHandlersInstalled) return;
    _saAiHandlersInstalled = true;

    // Track last focused element (fallback if the user uses the keyboard shortcut / toolbar click).
    document.addEventListener(
      'focusin',
      (event) => {
        try {
          const el = _saFindAiAnswerTargetElement(event?.target);
          if (el && _saIsAiFillableElement(el)) _smartApplyLastFocusedEl = el;
        } catch (_) {}
      },
      true
    );

    // Context menu: remember last right-clicked field and store question in background.
    document.addEventListener(
      'contextmenu',
      (event) => {
        const el = _saFindAiAnswerTargetElement(event?.target);
        const q = _saGetQuestionFromElement(el);
        _saAiAnswerState = {
          el: el || null,
          question: q || '',
          capturedAt: Date.now(),
        };

        try {
          const chromeApi = globalThis.chrome;
          if (q && chromeApi?.runtime?.sendMessage) {
            chromeApi.runtime.sendMessage({ action: 'STORE_LAST_QUESTION', question: q });
          }
        } catch (_) {}
      },
      true
    );

    const chromeApi = globalThis.chrome;
    if (chromeApi?.runtime?.onMessage?.addListener) {
      chromeApi.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request?.action === 'EXTRACT_JOB_CONTEXT') {
          try {
            sendResponse(extractJobContextFromDocument(document));
          } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
          }
          return true;
        }

        if (request?.action === 'TRIGGER_AI_REPLY') {
          const fallback = _saFindAiAnswerTargetElement(document.activeElement || _smartApplyLastFocusedEl);
          const target = _saAiAnswerState?.el || fallback;
          if (!target) {
            _saShowToast('AI: right-click a field (or focus it) first.');
            return false;
          }
          _saGenerateAiAnswer(target);
          return false;
        }

        if (request?.action === 'TRIGGER_AI_REPLY_ALL') {
          _saGenerateAllPendingAiAnswers({ limit: 8, source: 'manual' });
          return false;
        }

        return false;
      });
    }
  } catch (_) {
    // swallow
  }
}
// Install immediately as well as on window load (idempotent).
try {
  _saInstallAiAnswerHandlers();
} catch (_) {}

window.addEventListener("load", async (_) => {
  console.log("exempliphai: found job page.");

  // Detect ATS using packaged URL patterns (best-effort)
  // Robustness: prefer a detailed detector w/ confidence when available.
  try {
    const det2 = globalThis.__SmartApply?.atsConfig?.detectATSForUrlDetailed;
    if (typeof det2 === 'function') {
      const info = await det2(window.location.href);
      if (info?.key) {
        console.log(
          'exempliphai: detected ATS',
          info.key,
          `(confidence ${Number(info.confidence || 0).toFixed(2)})`,
          info.source || '',
        );
      }
    } else {
      const det = globalThis.__SmartApply?.atsConfig?.detectATSKeyForUrl;
      if (typeof det === 'function') {
        const atsKey = await det(window.location.href);
        if (atsKey) console.log('exempliphai: detected ATS', atsKey);
      }
    }
  } catch (e) {
    console.warn('exempliphai: ATS detection failed', e);
  }

  // Console-friendly, AI-prompt-ready form snapshot
  try {
    const form = findBestForm();
    const fs = globalThis.__SmartApply?.formSnapshot;
    if (form && fs?.findControls) {
      const snapshot = fs.findControls(form);
      console.log('exempliphai: Form Snapshot JSON:', JSON.stringify(snapshot, null, 2));
    }
  } catch (e) {
    console.warn('exempliphai: Form snapshot failed', e);
  }

  initTime = new Date().getTime();
  setupLongTextareaHints();
  _saInstallAiAnswerHandlers();
  injectAutofillNowButton();
  awaitForm();
});
const applicationFormQuery = "#application-form, #application_form, #applicationform";


const AUTOFILL_NOW_BUTTON_ID = "smartapply-autofill-now";
let smartApplyAutofillLock = false;
let smartApplyLastAutofillAt = 0;
let smartApplyMutationDebounce = null;
let smartApplyLastRunForced = false;

// Page-scoped pause flag for this tab/page only.
// Does not affect other tabs running in parallel.
let _smartApplyPaused = false;
let _smartApplyResumeRequested = false;
let _smartApplyAutofillBtn = null;

let _filledElements = new WeakSet();

// Track elements that were recently attempted but had no matching option (e.g.,
// React-Select with no dropdown or no good match).  Maps Element → timestamp.
// Entries expire after 5 seconds so the same field isn't retried in a tight loop
// by multiple fuzzy-matching param names (e.g. "experience years" / "total experience").
let _recentlySkipped = new Map();

function isRecentlySkipped(el) {
  if (!_recentlySkipped.has(el)) return false;
  const ts = _recentlySkipped.get(el);
  if (Date.now() - ts > 5000) {
    _recentlySkipped.delete(el);
    return false;
  }
  return true;
}

function markRecentlySkipped(el) {
  _recentlySkipped.set(el, Date.now());
}

function detectJobFormKey() {
  try {
    const host = (window.location.hostname || "").toLowerCase();
    for (const k of Object.keys(fields || {})) {
      if (k === "generic") continue;
      if (host.includes(k)) return k;
    }
  } catch (_) {}
  return null;
}

function isGreenhouse(hostname = null) {
  try {
    const host = (hostname ?? window.location.hostname ?? "").toLowerCase();
    return host.includes('greenhouse.io');
  } catch (_) {}
  return false;
}

function _isUsableFormControl(el) {
  try {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;

    const type = String(el.getAttribute?.('type') || '').toLowerCase();
    if (type === 'hidden') return false;

    if (el.disabled) return false;
    const tabIndexAttr = el.getAttribute?.('tabindex');
    if (tabIndexAttr === '-1') return false;

    const ariaHidden = String(el.getAttribute?.('aria-hidden') || '').toLowerCase();
    if (ariaHidden === 'true') return false;

    return true;
  } catch (_) {}
  return false;
}

function _findFirstInputLike(root, doc) {
  try {
    const scope = root && root.querySelectorAll ? root : doc;
    const nodes = Array.from(scope.querySelectorAll('input, select, textarea'));
    for (const el of nodes) {
      if (_isUsableFormControl(el)) return el;
    }
  } catch (_) {}
  return null;
}

async function tabToFirstInput(opts = {}) {
  const doc = opts.document || document;
  const root = opts.root || doc;
  const delayMs = Number.isFinite(opts.delayMs) ? opts.delayMs : 100;
  const tabCount = Number.isFinite(opts.tabCount)
    ? opts.tabCount
    : (6 + Math.floor(Math.random() * 2)); // 6–7
  const quiet = opts.quiet === true;

  const _sleep =
    opts.sleep ||
    (typeof sleep === 'function'
      ? sleep
      : (ms) => new Promise((r) => setTimeout(r, ms)));

  const first = _findFirstInputLike(root, doc);
  if (!first) return null;

  if (!quiet) console.log(`exempliphai: Tabbing to first field (Tab x${tabCount})`);

  // Prefer the utils.js factories when present, else create a best-effort event
  // using the element's realm.
  const makeTabKey = (type) => {
    try {
      const view = first?.ownerDocument?.defaultView || doc?.defaultView || globalThis;
      const K = view?.KeyboardEvent || KeyboardEvent;
      return new K(type, {
        bubbles: true,
        cancelable: true,
        key: 'Tab',
        code: 'Tab',
        keyCode: 9,
        which: 9,
      });
    } catch (_) {
      return null;
    }
  };

  const tabDown = typeof createTabKeyDown === 'function'
    ? createTabKeyDown
    : () => makeTabKey('keydown');
  const tabUp = typeof createTabKeyUp === 'function'
    ? createTabKeyUp
    : () => makeTabKey('keyup');

  // Ensure a predictable target for key events.
  try {
    (doc.body || doc.documentElement || first).focus?.();
  } catch (_) {}

  for (let i = 0; i < tabCount; i++) {
    const target = doc.activeElement || doc.body || first;

    try {
      const ev = tabDown();
      if (ev) target.dispatchEvent(ev);
    } catch (_) {}

    try {
      const ev = tabUp();
      if (ev) target.dispatchEvent(ev);
    } catch (_) {}

    // Also dispatch on the document in case the page listens globally.
    try {
      const ev = tabDown();
      if (ev && doc.dispatchEvent) doc.dispatchEvent(ev);
    } catch (_) {}

    try {
      const ev = tabUp();
      if (ev && doc.dispatchEvent) doc.dispatchEvent(ev);
    } catch (_) {}

    await _sleep(delayMs);
  }

  try {
    first.focus?.();
  } catch (_) {}

  return first;
}

function isLikelyApplicationPage() {
  try {
    if (document.querySelector(applicationFormQuery)) return true;
    // Resume uploaders are a strong signal.
    if (document.querySelector('input[type="file"]')) return true;
    // Common ATS markers
    if (document.querySelector('[id*="application" i], [class*="application" i]')) return true;
    if (document.querySelector('[name*="resume" i], [id*="resume" i], [name*="cover" i], [id*="cover" i]')) return true;
  } catch (_) {}
  return false;
}

function findBestForm() {
  try {
    // 1) Explicit application selectors
    const direct = document.querySelector(applicationFormQuery);
    if (direct) return direct;

    // 2) Prefer the active element's form (multi-step pages / language pickers)
    const active = document.activeElement;
    if (active && active.form) return active.form;

    // 3) Score all forms and pick the densest
    const forms = Array.from(document.querySelectorAll('form'));
    if (forms.length) {
      let best = { el: null, score: 0 };
      for (const f of forms) {
        const fieldsCount = f.querySelectorAll('input, select, textarea').length;
        const fileCount = f.querySelectorAll('input[type="file"]').length;
        const score = fieldsCount + fileCount * 5;
        if (score > best.score) best = { el: f, score };
      }
      if (best.el && best.score > 0) return best.el;
    }

    // 4) Some apps don't wrap content in a <form>
    const main = document.querySelector('#mainContent');
    if (main) return main;
  } catch (_) {}
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATS selector-driven autofill (selector config)
//
// Uses config/simplify_ats.json loaded by contentScripts/atsConfig.js.
// Executes sequential actions using containerPath + inputSelectors.
// Values come from LOCAL_PROFILE (chrome.storage.local), local-only.
// ─────────────────────────────────────────────────────────────────────────────

const _SA_XLATE_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const _SA_XLATE_LOWER = 'abcdefghijklmnopqrstuvwxyz';

function _saIsProbablyXPath(sel) {
  const s = String(sel || '').trim();
  return s.startsWith('/') || s.startsWith('.//') || s.startsWith('..//') || s.startsWith('//');
}

function _saEvalXPathAll(xpath, root = document) {
  try {
    const doc = root?.ownerDocument || document;
    const res = doc.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < res.snapshotLength; i++) out.push(res.snapshotItem(i));
    return out;
  } catch (_) {
    return [];
  }
}

function _saEvalXPathOne(xpath, root = document) {
  const all = _saEvalXPathAll(xpath, root);
  return all && all.length ? all[0] : null;
}

function _saQueryAll(css, root = document) {
  try {
    const scope = root && root.querySelectorAll ? root : document;
    return Array.from(scope.querySelectorAll(css));
  } catch (_) {
    return [];
  }
}

function _saWithValue(sel, value) {
  if (sel == null) return sel;
  if (Array.isArray(sel)) return sel.map((s) => _saWithValue(s, value));
  if (typeof sel !== 'string') return sel;
  return _saSubstitutePlaceholders(sel, { value });
}

function _saFindAll(sel, root = document) {
  if (!sel) return [];
  if (Array.isArray(sel)) {
    const out = [];
    for (const s of sel) out.push(..._saFindAll(s, root));
    return out;
  }
  return _saIsProbablyXPath(sel) ? _saEvalXPathAll(String(sel), root) : _saQueryAll(String(sel), root);
}

function _saFindOne(sel, root = document) {
  const all = _saFindAll(sel, root);
  return all && all.length ? all[0] : null;
}

async function _saSleep(ms) {
  try {
    if (typeof sleep === 'function') return await sleep(ms);
  } catch (_) {}
  return await new Promise((r) => setTimeout(r, ms));
}

async function _saWaitFor({
  sel,
  root = document,
  present = true,
  timeoutMs = 4000,
  pollMs = 100,
} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = _saFindOne(sel, root);
    if (present && el) return el;
    if (!present && !el) return true;
    await _saSleep(pollMs);
  }
  return present ? null : false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-submit (opt-in)
//
// Controlled by chrome.storage.sync → { autoSubmitEnabled: boolean }
// Default: false
//
// After a successful autofill run, if enabled, we try to find a visible/enabled
// "Submit" / "Apply" / "Next" / "Continue" button and click it.
// Rate-limited + de-duped to avoid infinite loops on SPA/mutation reruns.
// ─────────────────────────────────────────────────────────────────────────────

function _saAutoSubmitStateHost() {
  try {
    // If we can access same-origin top, store state there to dedupe across frames.
    return window.top || window;
  } catch (_) {
    return window;
  }
}

function _saGetAutoSubmitState() {
  const host = _saAutoSubmitStateHost();
  host.__SmartApplyAutoSubmitState = host.__SmartApplyAutoSubmitState || {
    lastUrl: '',
    clicks: 0,
    lastAttemptAt: 0,
    lastClickedSig: '',
    aiCustomsAttemptedAt: 0,
  };

  const st = host.__SmartApplyAutoSubmitState;
  const url = String(window.location?.href || '');
  if (st.lastUrl !== url) {
    st.lastUrl = url;
    st.clicks = 0;
    st.lastAttemptAt = 0;
    st.lastClickedSig = '';
    st.aiCustomsAttemptedAt = 0;
  }
  return st;
}

async function _saIsAutoSubmitEnabled() {
  try {
    if (typeof getStorageDataSync !== 'function') return false;
    const got = await getStorageDataSync(['autoSubmitEnabled']);
    return !!(got && (got.autoSubmitEnabled === true));
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-tailor resume (opt-in)
// Controlled by chrome.storage.sync → { autoTailorEnabled: boolean }
// Stores tailored resume in chrome.storage.local under:
//   Resume_tailored_text, Resume_tailored_pdf, Resume_tailored_name, Resume_tailored_meta
// ─────────────────────────────────────────────────────────────────────────────

async function _saIsAutoTailorEnabled() {
  try {
    if (typeof getStorageDataSync !== 'function') return false;
    const got = await getStorageDataSync(['autoTailorEnabled']);
    return !!(got && got.autoTailorEnabled === true);
  } catch (_) {
    return false;
  }
}

function _saPageKey(url) {
  try {
    const u = new URL(String(url || window.location?.href || ''));
    return `${u.origin}${u.pathname}`;
  } catch (_) {
    return String(url || window.location?.href || '');
  }
}

function _saPdfAsciiSafe(s) {
  return String(s || '').replace(/[\u0080-\uFFFF]/g, ' ');
}

function _saPdfEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function _saSimplePdfBytesFromText(text, { maxLines = 58 } = {}) {
  const raw = _saPdfAsciiSafe(text || '');
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => String(l || '').trimEnd())
    .slice(0, maxLines);

  const fontSize = 10;
  const left = 54;
  const top = 760;
  const leading = 12;

  let stream = 'BT\n';
  stream += `/F1 ${fontSize} Tf\n`;
  stream += `${left} ${top} Td\n`;
  for (let i = 0; i < lines.length; i++) {
    stream += `(${_saPdfEscape(lines[i] || '')}) Tj\n`;
    if (i !== lines.length - 1) stream += `0 -${leading} Td\n`;
  }
  stream += '\nET\n';

  const header = '%PDF-1.3\n';
  const objs = [];
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objs.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  objs.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objs.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);

  const offsets = [0];
  let body = '';
  let pos = header.length;
  for (const o of objs) {
    offsets.push(pos);
    body += o;
    pos += o.length;
  }
  const xrefStart = header.length + body.length;

  let xref = 'xref\n0 6\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  const pdf = header + body + xref + trailer;

  // ASCII-only => UTF-8 encoding is stable.
  return new TextEncoder().encode(pdf);
}

function _saUint8ToBase64(bytes) {
  try {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch (_) {
    return '';
  }
}

function _saTryGetTopHostForAutoTailor() {
  try {
    return window.top || window;
  } catch (_) {
    return window;
  }
}

async function _saMaybeAutoTailorBeforeAutofill({ source = 'autofill' } = {}) {
  const enabled = await _saIsAutoTailorEnabled();
  if (!enabled) return { ok: false, reason: 'disabled' };

  // Avoid multiple frames doing the same work.
  const host = _saTryGetTopHostForAutoTailor();
  host.__SmartApplyAutoTailorState = host.__SmartApplyAutoTailorState || { inFlight: false, lastPageKey: '', lastAt: 0 };
  const st = host.__SmartApplyAutoTailorState;

  const pageKey = _saPageKey(window.location.href);
  if (st.inFlight) return { ok: false, reason: 'in_flight' };
  if (st.lastPageKey === pageKey && Date.now() - (st.lastAt || 0) < 30_000) return { ok: false, reason: 'recent' };

  // Need a resume

  const local = (typeof getStorageDataLocal === 'function') ? await getStorageDataLocal(['Resume', 'Resume_tailored_meta', 'Resume_tailored_pdf']) : {};
  const resumeB64 = String(local?.Resume || '').trim();
  if (!resumeB64) return { ok: false, reason: 'missing_resume' };

  const ctx = extractJobContextFromDocument(document);
  const title = String(ctx?.title || '').trim();
  const company = String(ctx?.company || '').trim();
  const jd = String(ctx?.description || '').trim();

  if (!title && jd.length < 250) return { ok: false, reason: 'missing_job_context' };

  // Cache check
  try {
    const meta = local?.Resume_tailored_meta;
    if (local?.Resume_tailored_pdf && meta && _saPageKey(meta.pageUrl || '') === pageKey) {
      const when = Date.parse(meta.updatedAt || meta.createdAt || '') || 0;
      if (when && Date.now() - when < 6 * 60 * 60 * 1000) {
        return { ok: true, reason: 'cached' };
      }
    }
  } catch (_) {}

  st.inFlight = true;
  st.lastPageKey = pageKey;
  st.lastAt = Date.now();

  try {
    _saShowToast('Auto-tailor: tailoring resume…');

    const jdClip = jd.length > 12000 ? jd.slice(0, 12000) : jd;

    const prompt = `You are an expert resume writer.\n\nRewrite the attached resume PDF to match the job description while staying 100% truthful.\nDo NOT invent employers, degrees, certifications, job titles, dates, or technologies not present in the resume.\n\nReturn ONLY valid JSON:\n{\n  \"version\": \"0.1\",\n  \"job_title\": \"\",\n  \"company\": \"\",\n  \"tailored_resume_text\": \"\"\n}\n\nFormatting constraints:\n- Plain text, ATS-friendly\n- 1 page maximum (roughly <= 58 lines)\n- Use clear sections and concise bullet points\n\nJob title: ${title || '(unknown)'}\nCompany: ${company || '(unknown)'}\nPage URL: ${window.location.href}\n\nJob description:\n${jdClip || '(not found)'}\n`;

    const input = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, { inline_data: { data: resumeB64, mime_type: 'application/pdf' } }],
        },
      ],
      generationConfig: { temperature: 1.0, responseMimeType: 'application/json' },
    };

    const proxyResp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'AI_PROXY',
          aiAction: 'resumeTailor',
          model: 'gemini-3-pro-preview',
          input,
        },
        (r) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(String(err.message || err)));
          resolve(r);
        }
      );
    });

    const json = proxyResp || {};
    if (json?.ok === false) {
      const msg = String(json?.error || 'AI proxy error');
      if (msg === 'low_balance' || msg === 'insufficient_balance') {
        throw new Error('Insufficient ExempliPhai token balance. Please top up to continue.');
      }
      throw new Error(msg);
    }

    const outText = json?.result?.text;
    if (!outText) throw new Error('AI response missing text');

    const s = String(outText);
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    const jsonText = first !== -1 && last !== -1 && last > first ? s.slice(first, last + 1) : s;
    const out = JSON.parse(jsonText);

    const tailored = String(out?.tailored_resume_text || '').trim();
    if (!tailored) throw new Error('No tailored_resume_text returned');

    const pdfBytes = _saSimplePdfBytesFromText(tailored);
    const pdfB64 = _saUint8ToBase64(pdfBytes);

    const nowIso = new Date().toISOString();
    const meta = {
      createdAt: nowIso,
      updatedAt: nowIso,
      pageUrl: String(window.location.href),
      pageKey,
      jobTitle: String(out?.job_title || title || ''),
      company: String(out?.company || company || ''),
      source,
    };

    if (chrome?.storage?.local?.set) {
      chrome.storage.local.set(
        {
          Resume_tailored_text: tailored,
          Resume_tailored_pdf: pdfB64,
          Resume_tailored_name: 'resume-tailored.pdf',
          Resume_tailored_meta: meta,
        },
        () => {}
      );
    }

    _saShowToast('Auto-tailor: saved tailored resume');
    return { ok: true, reason: 'tailored' };
  } catch (e) {
    console.warn('exempliphai: auto-tailor failed', e);
    try { _saShowToast('Auto-tailor failed (see console)'); } catch (_) {}
    return { ok: false, reason: 'exception', error: String(e?.message || e) };
  } finally {
    st.inFlight = false;
  }
}

function _saIsElementVisible(el) {
  try {
    if (!el) return false;
    if (el.closest && el.closest(`#${AUTOFILL_NOW_BUTTON_ID}`)) return false;
    if (el.id === AUTOFILL_NOW_BUTTON_ID) return false;

    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (style) {
      const op = parseFloat(String(style.opacity || ''));
      if (style.display === 'none' || style.visibility === 'hidden' || (Number.isFinite(op) && op <= 0.05)) return false;
    }

    // Hidden attribute
    if (el.hasAttribute?.('hidden')) return false;

    const rect = el.getBoundingClientRect?.();
    if (!rect) return false;
    if (rect.width < 2 || rect.height < 2) return false;
    if (!el.getClientRects || el.getClientRects().length === 0) return false;

    return true;
  } catch (_) {
    return false;
  }
}

function _saIsElementEnabled(el) {
  try {
    if (!el) return false;
    if (el.disabled) return false;
    const ariaDisabled = (el.getAttribute?.('aria-disabled') || '').toLowerCase();
    if (ariaDisabled === 'true') return false;
    return true;
  } catch (_) {
    return false;
  }
}

function _saGetActionText(el) {
  if (!el) return '';
  try {
    const tag = (el.tagName || '').toLowerCase();
    const aria = el.getAttribute?.('aria-label') || '';
    const title = el.getAttribute?.('title') || '';

    if (tag === 'input') {
      const v = el.getAttribute?.('value') || el.value || '';
      return String(v || aria || title || '').trim();
    }

    const txt = (el.innerText || el.textContent || '').trim();
    return String(txt || aria || title || '').trim();
  } catch (_) {
    return '';
  }
}

function _saElementSig(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const id = el.id || '';
    const cls = (typeof el.className === 'string' ? el.className : '') || '';
    const txt = _saGetActionText(el).slice(0, 80);
    return `${tag}#${id}.${cls}::${txt}`.toLowerCase();
  } catch (_) {
    return '';
  }
}

function _saScoreSubmitCandidate(el) {
  if (!_saIsElementVisible(el) || !_saIsElementEnabled(el)) return -1e9;

  const tag = (el.tagName || '').toLowerCase();
  const type = (el.getAttribute?.('type') || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  const name = (el.getAttribute?.('name') || '').toLowerCase();
  const dataTest = (el.getAttribute?.('data-testid') || el.getAttribute?.('data-test') || '').toLowerCase();

  const txtRaw = _saGetActionText(el);
  const txt = String(txtRaw || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Hard exclusions
  if (!txt && tag !== 'input') {
    // allow type=submit buttons with no text, but mostly skip empty
    if (type !== 'submit') return -100;
  }

  const neg = ['cancel', 'back', 'previous', 'prev', 'close', 'delete', 'remove', 'logout', 'sign out'];
  for (const w of neg) {
    if (txt.includes(w)) return -200;
  }

  let score = 0;

  // Strong signals
  if (type === 'submit') score += 90;
  if (id === 'submit' || name === 'submit') score += 35;

  const attrHay = `${id} ${cls} ${name} ${dataTest}`;
  if (attrHay.includes('submit')) score += 40;
  if (attrHay.includes('apply')) score += 24;
  if (attrHay.includes('continue')) score += 18;
  if (attrHay.includes('next')) score += 14;

  // Text signals
  if (txt.includes('submit')) score += 70;
  if (txt.includes('apply')) score += 55;
  if (txt.includes('continue')) score += 40;
  if (txt === 'next' || txt.includes(' next')) score += 30;
  if (txt.includes('finish')) score += 28;
  if (txt.includes('complete')) score += 22;
  if (txt.includes('review')) score += 16;
  if (txt.includes('save and continue') || txt.includes('save & continue')) score += 35;

  // Mild preference for likely final action
  if (tag === 'button' || tag === 'input' || el.getAttribute?.('role') === 'button') score += 6;

  // Prefer lower-on-page controls (common for submit)
  try {
    const rect = el.getBoundingClientRect();
    const y = rect.top + (window.scrollY || 0);
    const docH = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
    if (docH > 0) {
      const frac = y / docH;
      if (frac > 0.66) score += 10;
      else if (frac > 0.5) score += 6;
    }
  } catch (_) {}

  return score;
}

function _saCollectQueryRoots(doc = document) {
  const roots = [doc];
  const MAX_SHADOW_ROOTS = 40;
  const MAX_IFRAMES = 10;

  // Shadow roots (best-effort)
  try {
    let added = 0;
    const walker = doc.createTreeWalker(doc.documentElement || doc.body || doc, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el && el.shadowRoot && !roots.includes(el.shadowRoot)) {
        roots.push(el.shadowRoot);
        added++;
        if (added >= MAX_SHADOW_ROOTS) break;
      }
    }
  } catch (_) {}

  // Same-origin iframes (best-effort)
  try {
    const iframes = Array.from(doc.querySelectorAll('iframe')).slice(0, MAX_IFRAMES);
    for (const f of iframes) {
      try {
        const d = f.contentDocument;
        if (d && !roots.includes(d)) roots.push(d);
      } catch (_) {}
    }
  } catch (_) {}

  return roots;
}

function _saFindSubmitCandidate({ submitButtonPaths = [] } = {}) {
  // 1) Prefer ATS-provided selectors (if any)
  try {
    const paths = Array.isArray(submitButtonPaths) ? submitButtonPaths : [];
    for (const p of paths) {
      const el = _saFindOne(p, document);
      if (el && _saIsElementVisible(el) && _saIsElementEnabled(el)) return { el, score: 999, why: 'ats.submitButtonPaths' };
    }
  } catch (_) {}

  // 2) Robust default selectors
  const selectors = [
    // type-based
    'button[type="submit"]',
    'input[type="submit"]',
    '[type="submit"]',

    // common ids/classes
    '#submit',
    '.submit-button',
    '.submitButton',
    '.btn-submit',
    '.button-submit',

    // test ids
    'button[data-testid*="submit" i]',
    'button[data-test*="submit" i]',

    // aria/title
    'button[aria-label*="submit" i]',
    'button[title*="submit" i]',
    '[role="button"][aria-label*="submit" i]',

    // next/continue/apply signals
    'button[class*="apply" i], button[id*="apply" i]',
    'button[class*="continue" i], button[id*="continue" i]',
    'button[class*="next" i], button[id*="next" i]',
  ];

  const roots = _saCollectQueryRoots(document);
  const candidates = [];

  for (const r of roots) {
    for (const sel of selectors) {
      for (const el of _saQueryAll(sel, r)) candidates.push(el);
    }

    // Also consider all buttons/role=button for text matches (covers :contains("Submit")-style intent)
    for (const el of _saQueryAll('button, input[type="submit"], input[type="button"], [role="button"], a[role="button"]', r)) {
      const t = _saGetActionText(el).toLowerCase();
      if (t.includes('submit') || t.includes('apply') || t.includes('continue') || t.trim() === 'next' || t.includes('next ')) {
        candidates.push(el);
      }
    }
  }

  // De-dupe
  const uniq = [];
  const seen = new Set();
  for (const el of candidates) {
    const sig = _saElementSig(el);
    if (!sig) continue;
    if (seen.has(sig)) continue;
    seen.add(sig);
    uniq.push(el);
  }

  let best = null;
  for (const el of uniq) {
    const score = _saScoreSubmitCandidate(el);
    if (best == null || score > best.score) best = { el, score, why: 'heuristic' };
  }

  return best && best.el ? best : null;
}

function _saClickSafely(el) {
  try {
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
  } catch (_) {}
  try {
    el.focus?.({ preventScroll: true });
  } catch (_) {
    try { el.focus?.(); } catch (_) {}
  }

  try {
    el.click?.();
    return true;
  } catch (_) {}

  try {
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    el.dispatchEvent(evt);
    return true;
  } catch (_) {}

  return false;
}

function _saClassifyAutoSubmitIntent(text) {
  try {
    const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return 'none';

    // Terminal-ish actions
    if (t.includes('submit')) return 'terminal';
    if (t.includes('apply')) return 'terminal';
    if (t.includes('finish')) return 'terminal';
    if (t.includes('complete')) return 'terminal';
    if (t.includes('send application')) return 'terminal';

    // Progress actions
    if (t === 'next' || t.includes(' next')) return 'progress';
    if (t.includes('continue')) return 'progress';
    if (t.includes('review')) return 'progress';
    if (t.includes('save and continue') || t.includes('save & continue')) return 'progress';

    return 'progress';
  } catch (_) {
    return 'none';
  }
}

async function _saMaybeAutoSubmitAfterAutofill({ submitButtonPaths = [], source = 'unknown' } = {}) {
  const enabled = await _saIsAutoSubmitEnabled();
  if (!enabled) {
    return {
      enabled: false,
      attempted: false,
      clicked: false,
      intent: 'none',
      clickedText: '',
      why: '',
      score: 0,
      source,
      reason: 'disabled',
    };
  }

  const st = _saGetAutoSubmitState();
  const MAX_CLICKS_PER_URL = 4;
  const COOLDOWN_MS = 2200;

  const now = Date.now();
  if (st.clicks >= MAX_CLICKS_PER_URL) {
    console.log('exempliphai: Auto-submit enabled, but max clicks reached for this URL');
    return {
      enabled: true,
      attempted: true,
      clicked: false,
      intent: 'none',
      clickedText: '',
      why: '',
      score: 0,
      source,
      reason: 'max_clicks',
    };
  }
  if (now - (st.lastAttemptAt || 0) < COOLDOWN_MS) {
    return {
      enabled: true,
      attempted: true,
      clicked: false,
      intent: 'none',
      clickedText: '',
      why: '',
      score: 0,
      source,
      reason: 'cooldown',
    };
  }

  st.lastAttemptAt = now;

  // Give client-side validation a moment to settle after autofill.
  await _saSleep(450);

  // If free-text custom questions are still empty, try to answer them before clicking submit.
  try {
    st.aiCustomsAttemptedAt = Number.isFinite(st.aiCustomsAttemptedAt) ? st.aiCustomsAttemptedAt : 0;

    const pending = _saFindPendingAiAnswerElements({ limit: 9 }).length;
    const shouldAttempt = pending > 0 && (Date.now() - st.aiCustomsAttemptedAt > 2500);

    if (shouldAttempt) {
      st.aiCustomsAttemptedAt = Date.now();

      _saShowToast('AI: answering pending custom fields before submit…', { timeoutMs: 1800 });
      await _saGenerateAllPendingAiAnswers({ limit: 8, source: 'auto_submit' });

      const startWait = Date.now();
      while (Date.now() - startWait < 30000) {
        const left = _saFindPendingAiAnswerElements({ limit: 1 }).length;
        if (!left) break;
        await _saSleep(650);
      }

      const still = _saFindPendingAiAnswerElements({ limit: 1 }).length;
      if (still) {
        console.log('exempliphai: Auto-submit: custom questions still pending; skipping submit');
        _saShowToast('Auto-submit paused: custom questions still pending.', { timeoutMs: 2200 });

        return {
          enabled: true,
          attempted: true,
          clicked: false,
          intent: 'progress',
          clickedText: '',
          why: '',
          score: 0,
          source,
          reason: 'customs_pending_timeout',
        };
      }
    }
  } catch (e) {
    console.warn('exempliphai: Auto-submit: AI-customs step failed', e);
  }


  const found = _saFindSubmitCandidate({ submitButtonPaths });
  if (!found?.el) {
    console.log(`exempliphai: Auto-submit enabled, but no submit/next button found (${source})`);
    return {
      enabled: true,
      attempted: true,
      clicked: false,
      intent: 'none',
      clickedText: '',
      why: '',
      score: 0,
      source,
      reason: 'no_candidate',
    };
  }

  const clickedText = _saGetActionText(found.el);
  const sig = _saElementSig(found.el);
  if (sig && sig === st.lastClickedSig) {
    console.log('exempliphai: Auto-submit: refusing to click same element twice');
    return {
      enabled: true,
      attempted: true,
      clicked: false,
      intent: 'none',
      clickedText,
      why: found.why,
      score: found.score || 0,
      source,
      reason: 'dedupe',
    };
  }

  // Require at least a modest confidence score for heuristic-based picks.
  if (found.why !== 'ats.submitButtonPaths' && (found.score || 0) < 55) {
    console.log('exempliphai: Auto-submit: best candidate score too low — skipping', { score: found.score, text: clickedText });
    return {
      enabled: true,
      attempted: true,
      clicked: false,
      intent: 'none',
      clickedText,
      why: found.why,
      score: found.score || 0,
      source,
      reason: 'low_score',
    };
  }

  console.log('exempliphai: Auto-submit enabled — clicking', {
    source,
    why: found.why,
    score: found.score,
    text: clickedText,
  });

  const ok = _saClickSafely(found.el);
  if (ok) {
    st.clicks += 1;
    st.lastClickedSig = sig || st.lastClickedSig;
    await _saSleep(200);

    const intent = _saClassifyAutoSubmitIntent(clickedText);

    return {
      enabled: true,
      attempted: true,
      clicked: true,
      intent,
      clickedText,
      why: found.why,
      score: found.score || 0,
      source,
      reason: 'clicked',
    };
  }

  return {
    enabled: true,
    attempted: true,
    clicked: false,
    intent: 'none',
    clickedText,
    why: found.why,
    score: found.score || 0,
    source,
    reason: 'click_failed',
  };
}

async function _saLoadLocalProfile() {
  try {
    const got = await chrome.storage.local.get(['LOCAL_PROFILE', 'EXEMPLIPHAI_LOCAL_PROFILE']);
    return got.LOCAL_PROFILE || got.EXEMPLIPHAI_LOCAL_PROFILE || null;
  } catch (_) {
    return null;
  }
}

function _saNormalize(v) {
  return (v ?? '')
    .toString()
    .trim();
}

function _saDigitsOnly(v) {
  const s = _saNormalize(v);
  const d = s.replace(/\D+/g, '');
  return d;
}

function _saResolveProfileValue(profile, key) {
  if (!profile || !key) return undefined;
  if (key in profile) return profile[key];

  // Nested LOCAL_PROFILE shapes (older builds)
  // - basics.firstName / basics.lastName / basics.email / basics.phone
  // - links.linkedin / links.github / links.portfolio
  try {
    if (profile.basics && typeof profile.basics === 'object') {
      const b = profile.basics;
      if (key === 'first_name' && b.firstName) return b.firstName;
      if (key === 'last_name' && b.lastName) return b.lastName;
      if (key === 'email' && b.email) return b.email;
      if (key === 'phone' && b.phone) return b.phone;
      if (key === 'location' && b.location) return b.location;
      if (key === 'city' && b.city) return b.city;
      if (key === 'state' && (b.state || b.region)) return b.state || b.region;
      if (key === 'country' && b.country) return b.country;
      if (key === 'postal_code' && (b.postalCode || b.zip)) return b.postalCode || b.zip;
    }
    if (profile.links && typeof profile.links === 'object') {
      const l = profile.links;
      if (key === 'linkedin' && l.linkedin) return l.linkedin;
      if (key === 'github' && l.github) return l.github;
      if (key === 'portfolio' && l.portfolio) return l.portfolio;
      if (key === 'additional_url' && (l.website || l.url)) return l.website || l.url;
    }
  } catch (_) {}

  // Best-effort common aliases
  const aliases = {
    first_name: ['First Name', 'firstName', 'first_name'],
    last_name: ['Last Name', 'lastName', 'last_name'],
    email: ['Email', 'email'],
    phone: ['Phone', 'phone', 'phone_number'],
    phone_stripped: ['phone_stripped', 'phoneStripped'],
    city: ['city', 'Location (City)'],
    state: ['state', 'Location (State/Region)'],
    country: ['country', 'Location (Country)'],
    postal_code: ['postal_code', 'zip', 'Zip', 'Postal Code'],
    linkedin: ['LinkedIn', 'linkedin', 'linkedIn'],
    github: ['GitHub', 'github'],
    portfolio: ['Portfolio', 'portfolio', 'website'],
  };
  const list = aliases[key];
  if (Array.isArray(list)) {
    for (const k of list) if (k in profile) return profile[k];
  }

  return undefined;
}

function _saCoerceValueForKey(key, raw) {
  if (raw == null) return raw;
  if (key === 'phone_stripped') return _saDigitsOnly(raw);
  return raw;
}

function _saPickCanonicalKeyFromValuesMap(valuesMap, fillValue) {
  // valuesMap: { canonicalKey: string|[string]|... }
  const valNorm = normalizeText(fillValue);
  if (!valNorm) return null;

  for (const [canonical, candidates] of Object.entries(valuesMap || {})) {
    if (Array.isArray(candidates)) {
      for (const c of candidates) {
        if (normalizeText(c) === valNorm) return canonical;
      }
    } else {
      if (normalizeText(candidates) === valNorm) return canonical;
    }

    // also accept canonical itself
    if (normalizeText(canonical) === valNorm) return canonical;
  }

  // fallback: if valuesMap has keys 'true'/'false'/'' and fillValue looks boolean
  const booly = ['yes', 'true', '1'];
  const falsy = ['no', 'false', '0'];
  if (Object.prototype.hasOwnProperty.call(valuesMap || {}, 'true') && booly.some(b => valNorm === b)) return 'true';
  if (Object.prototype.hasOwnProperty.call(valuesMap || {}, '') && falsy.some(f => valNorm === f)) return '';

  return null;
}

function _saSubstitutePlaceholders(str, { value } = {}) {
  const s = String(str || '');
  const v = _saNormalize(value);
  // NOTE: Some XPaths use translate(., "%UPPERVALUE%", "%LOWERVALUE%")
  // where %UPPERVALUE%/%LOWERVALUE% are alphabet maps, not the user's value.
  return s
    .replaceAll('%VALUE%', v)
    .replaceAll('%UPPERVALUE%', _SA_XLATE_UPPER)
    .replaceAll('%LOWERVALUE%', _SA_XLATE_LOWER);
}

function _saSetInputValue(el, value) {
  try {
    setNativeValue(el, value);
  } catch (_) {
    try { el.value = value; } catch (_) {}
  }
  dispatchInputAndChange(el);
}

async function _saDijitSelect(el, fillValue) {
  if (!el) return false;
  try { el.scrollIntoView?.({ block: 'center' }); } catch (_) {}
  try { el.click?.(); } catch (_) {}
  await _saSleep(150);

  // Dijit menus are usually rendered in a popup div with visible style.
  const opts = _saFindAll(
    "//div[contains(@class, 'dijitPopup') and contains(@class, 'dijitMenuPopup')][contains(@style, 'visibility') and contains(@style, 'visible')]//td[contains(@class, 'dijitMenuItemLabel')]",
    document
  );

  if (!opts.length) return false;

  let best = { el: null, score: 0 };
  for (const o of opts) {
    const t = (o.textContent || '').trim();
    const s = matchScore(fillValue, t);
    if (s > best.score) best = { el: o, score: s };
  }

  if (!best.el || best.score < 40) return false;

  try { best.el.click?.(); } catch (_) {}
  await _saSleep(120);
  return true;
}

async function _saUploadFromLocalBase64(fileInputEl, base64, filename, mimeType) {
  if (!fileInputEl || !base64) return false;
  try {
    const dt = new DataTransfer();
    const arrBfr = base64ToArrayBuffer(base64);
    dt.items.add(new File([arrBfr], filename || 'document.pdf', { type: mimeType || 'application/pdf' }));
    fileInputEl.files = dt.files;
    try { fileInputEl.dispatchEvent(changeEvent); } catch (_) { dispatchInputAndChange(fileInputEl); }
    return true;
  } catch (e) {
    console.warn('exempliphai: file upload failed', e);
    return false;
  }
}

async function _saExecuteActions(actions = [], ctx = {}) {
  const root = ctx.root || document;
  const value = ctx.value;
  for (const action of actions || []) {
    if (!action || typeof action !== 'object') continue;

    if (Number.isFinite(action.time)) {
      await _saSleep(action.time);
      continue;
    }

    // Wait until a path is removed
    if (action.path && action.removed) {
      const sel = _saWithValue(action.path, value);
      const ok = await _saWaitFor({ sel, root, present: false, timeoutMs: action.time || 4000 });
      if (!ok) console.log('exempliphai: wait-for-removed timed out', action.path);
      continue;
    }

    const method = String(action.method || '').toLowerCase();
    if (method === 'click') {
      const sel = _saWithValue(action.path, value);
      const target = _saFindOne(sel, root);
      try { target?.click?.(); } catch (_) {}
      await _saSleep(100);
      continue;
    }

    // Unhandled action method — keep going.
  }
}

async function _saApplySelectorEntry(entry, { root, key, fillValue, profile } = {}) {
  // entry: string XPath/CSS OR object {path, method, actions, values, valuePathMap, value}
  if (!entry) return false;

  if (typeof entry === 'string' || Array.isArray(entry)) {
    const el = _saFindOne(entry, root);
    if (!el) return false;

    // Default: fill into controls, click for buttons.
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = String(fillValue ?? '');
      _saSetInputValue(el, v);
      // Robustness: verify the value stuck (framework rerenders can revert).
      await _saSleep(30);
      if (!_saVerifyFilled(el, v)) {
        try { el.focus?.(); } catch (_) {}
        _saSetInputValue(el, v);
        await _saSleep(60);
      }
      return _saVerifyFilled(el, v);
    }
    try { el.click?.(); } catch (_) {}
    return true;
  }

  if (typeof entry !== 'object') return false;

  // Pick the first matching element from path list.
  let effectiveValue = fillValue;
  if (entry.value != null) effectiveValue = entry.value;

  const path = _saWithValue(entry.path, effectiveValue);
  const el = _saFindOne(path, root);
  if (!el) return false;

  // Pre-actions (wait/click sequences)
  if (Array.isArray(entry.actions) && entry.actions.length) {
    await _saExecuteActions(entry.actions, { root, value: effectiveValue });
  }

  const method = String(entry.method || '').toLowerCase();

  // Resolve value mapping

  // value map: translate fillValue into canonical keys for valuePathMap / template substitutions
  let canonicalKey = null;
  if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
    canonicalKey = _saPickCanonicalKeyFromValuesMap(entry.values, fillValue);
    if (canonicalKey != null) {
      // If valuesMap maps canonical->value strings (e.g. ids), treat canonicalKey as the intended value
      // OR if it maps canonical->synonyms, use canonicalKey in valuePathMap.
      const mapped = entry.values[canonicalKey];
      if (typeof mapped === 'string' && mapped && !Array.isArray(mapped)) {
        // Often dijit expects internal codes; use mapped string as effectiveValue
        effectiveValue = mapped;
      } else {
        effectiveValue = canonicalKey;
      }
    }
  }

  // valuePathMap: click a specific element path based on canonical/effective value
  if (entry.valuePathMap && typeof entry.valuePathMap === 'object') {
    const mapKey = canonicalKey != null ? canonicalKey : String(effectiveValue ?? '');
    const mappedPath = entry.valuePathMap[mapKey];
    if (mappedPath) {
      const sel = _saWithValue(mappedPath, effectiveValue);
      const target = _saFindOne(sel, root);
      if (target) {
        try { target.click?.(); } catch (_) {}
        await _saSleep(100);
        return true;
      }
    }
  }

  if (method === 'click') {
    try { el.click?.(); } catch (_) {}
    await _saSleep(100);
    return true;
  }

  if (method === 'dijit') {
    const ok = await _saDijitSelect(el, String(effectiveValue ?? ''));
    if (ok) return true;
    // fallthrough to default fill/click
  }

  if (method === 'uploadresume' || method === 'uploadcoverletter') {
    const localData = await getStorageDataLocal();
    if (method === 'uploadresume') {
      let b64 = localData.Resume;
      let name = localData.Resume_name || 'resume.pdf';

      // Prefer tailored resume if it matches this page.
      try {
        const meta = localData.Resume_tailored_meta;
        const pageKey = _saPageKey(window.location.href);
        const metaKey = meta?.pageKey || _saPageKey(meta?.pageUrl || '');
        if (localData.Resume_tailored_pdf && metaKey && metaKey === pageKey) {
          b64 = localData.Resume_tailored_pdf;
          name = localData.Resume_tailored_name || 'resume-tailored.pdf';
        }
      } catch (_) {}

      return await _saUploadFromLocalBase64(el, b64, name, 'application/pdf');
    }
    if (method === 'uploadcoverletter') {
      return await _saUploadFromLocalBase64(el, localData['Cover Letter'], localData['Cover Letter_name'] || 'coverletter.pdf', 'application/pdf');
    }
  }

  // Default fill if it's an input-like element
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const v = String(effectiveValue ?? '');
    _saSetInputValue(el, v);
    await _saSleep(30);
    if (!_saVerifyFilled(el, v)) {
      try { el.focus?.(); } catch (_) {}
      _saSetInputValue(el, v);
      await _saSleep(60);
    }
    return _saVerifyFilled(el, v);
  }

  // As a last resort, attempt click.
  try { el.click?.(); } catch (_) {}
  return true;
}

function _saLooksEmpty(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      if (type === 'checkbox' || type === 'radio' || type === 'file') return false;
      return String(el.value || '').trim() === '';
    }
    if (tag === 'select') {
      const v = String(el.value || '').trim();
      return v === '' || v === '0';
    }
  } catch (_) {}
  return false;
}

function _saVerifyFilled(el, expected) {
  try {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();

    if (tag === 'input' || tag === 'textarea') {
      if (type === 'checkbox' || type === 'radio' || type === 'file') return true;
      const cur = String(el.value ?? '').trim();
      const exp = String(expected ?? '').trim();
      // For text inputs, require non-empty + exact match when expected provided.
      if (!cur) return false;
      if (exp && cur !== exp) return false;
      return true;
    }

    if (tag === 'select') {
      const cur = String(el.value ?? '').trim();
      const exp = String(expected ?? '').trim();
      if (!cur) return false;
      if (exp && cur !== exp) {
        // Allow matches by visible text too.
        const opt = Array.from(el.options || []).find((o) => String(o?.value || '').trim() === cur);
        const txt = String(opt?.textContent || '').trim();
        if (txt && txt.toLowerCase() === exp.toLowerCase()) return true;
        return false;
      }
      return true;
    }

    return true;
  } catch (_) {
    return true;
  }
}

function _saTextFromFirstPath(paths, root) {
  try {
    const list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    for (const p of list) {
      const n = _saFindOne(p, root);
      const t = (n?.textContent || n?.nodeValue || '').toString().trim();
      if (t) return t;
    }
  } catch (_) {}
  return '';
}

function _saBuildProfileKeyCandidates(profile) {
  const keys = Object.keys(profile || {}).filter(Boolean);

  // Common synonyms (minimal + local-only) — keeps fuzzy mapping stable.
  const synonyms = {
    first_name: ['first name', 'given name'],
    last_name: ['last name', 'surname', 'family name'],
    email: ['email', 'e-mail'],
    phone: ['phone', 'phone number', 'mobile'],
    location: ['location', 'current location'],
    address: ['address', 'street address'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region'],
    country: ['country', 'country / region'],
    postal_code: ['zip', 'zipcode', 'postal code'],
    linkedin: ['linkedin', 'linked in'],
    github: ['github'],
    portfolio: ['portfolio', 'personal website'],
    additional_url: ['website', 'url', 'personal site'],
    work_auth_us: ['work authorization (us)', 'authorized to work in the united states'],
    sponsorship: ['sponsorship', 'visa sponsorship', 'require sponsorship'],
  };

  const out = [];
  for (const k of keys) {
    const variants = new Set();
    variants.add(k);
    variants.add(k.replace(/_/g, ' '));
    variants.add(k.replace(/_/g, ''));
    const s = synonyms[k];
    if (Array.isArray(s)) for (const v of s) variants.add(v);
    out.push({ key: k, variants: Array.from(variants) });
  }
  return out;
}

function _saPickBestProfileKey(label, candidates) {
  try {
    const labelNorm = normalizeText(label);
    if (!labelNorm) return { key: null, score: 0 };

    let best = { key: null, score: 0 };
    for (const c of candidates) {
      for (const v of c.variants) {
        const sc = matchScore(normalizeText(v), labelNorm);
        if (sc > best.score) best = { key: c.key, score: sc };
      }
    }

    return best;
  } catch (_) {
    return { key: null, score: 0 };
  }
}

function _saOptionText(optEl, optTextPaths) {
  try {
    const fromPath = _saTextFromFirstPath(optTextPaths, optEl);
    if (fromPath) return fromPath;
    const t = (optEl?.textContent || '').toString().trim();
    return t;
  } catch (_) {}
  return '';
}

function _saCoerceToYesNo(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  const t = normalizeText(v);
  if (t === 'true' || t === '1' || t === 'y' || t === 'yes') return 'yes';
  if (t === 'false' || t === '0' || t === 'n' || t === 'no') return 'no';
  return null;
}

async function _saAutofillTrackedInputs({ ats, root, profile, force = false } = {}) {
  if (!ats || !root || !profile) return { ok: false, reason: 'missing' };
  const selectors = Array.isArray(ats.trackedInputSelectors) ? ats.trackedInputSelectors : [];
  if (!selectors.length) return { ok: false, reason: 'no_tracked_selectors' };

  // Conservative default: only run on explicit user action OR when user opts-in.
  const optedIn = profile.trackedInputsFuzzy === true || profile.tracked_inputs_fuzzy === true;
  if (!force && !optedIn) return { ok: false, reason: 'not_forced' };

  const candidates = _saBuildProfileKeyCandidates(profile);
  if (!candidates.length) return { ok: false, reason: 'no_profile_keys' };

  let filled = 0;
  let considered = 0;

  for (const sel of selectors) {
    const fieldPaths = Array.isArray(sel.fieldPath) ? sel.fieldPath : [];
    if (!fieldPaths.length) continue;

    const fieldNodes = _saFindAll(fieldPaths, root);
    for (const fieldNode of fieldNodes) {
      try {
        const label = _saTextFromFirstPath(sel.labelPath, fieldNode);
        const labelNorm = normalizeText(label);
        if (!labelNorm || labelNorm.length < 4) continue;
        if (labelNorm.includes('password')) continue;

        // Input-like
        const inputEl = sel.inputPath ? _saFindOne(sel.inputPath, fieldNode) : null;
        const optionEls = sel.optionsPath ? _saFindAll(sel.optionsPath, fieldNode) : [];

        if (!inputEl && !optionEls.length) continue;

        // Skip already filled unless forced
        if (!force && inputEl && !_saLooksEmpty(inputEl)) continue;

        const best = _saPickBestProfileKey(label, candidates);
        considered++;

        // Tight threshold; avoids filling the wrong custom question.
        if (!best.key || best.score < 72) continue;

        let value = _saResolveProfileValue(profile, best.key);
        value = _saCoerceValueForKey(best.key, value);
        if (value == null || String(value).trim() === '') continue;

        // Radio/checkbox style
        if (!inputEl && optionEls.length) {
          const yesNo = _saCoerceToYesNo(value);
          const want = yesNo || String(value);

          let bestOpt = { el: null, score: 0, txt: '' };
          for (const optEl of optionEls) {
            const txt = _saOptionText(optEl, sel.optionsTextPath);
            const sc = matchScore(normalizeText(want), txt);
            if (sc > bestOpt.score) bestOpt = { el: optEl, score: sc, txt };
          }

          if (bestOpt.el && bestOpt.score >= 55) {
            // Click the actual input if possible
            try {
              bestOpt.el.click?.();
            } catch (_) {
              try { bestOpt.el.dispatchEvent?.(new Event('click', { bubbles: true })); } catch (_) {}
            }
            filled++;
            await _saSleep(80);
            continue;
          }

          continue;
        }

        // Standard inputs/selects/buttons
        if (inputEl) {
          const tag = (inputEl.tagName || '').toLowerCase();

          if (tag === 'select') {
            // Try exact-ish option match
            const opts = Array.from(inputEl.options || []);
            let bestOpt = { v: null, score: 0 };
            for (const o of opts) {
              const txt = (o.textContent || o.value || '').toString();
              const sc = matchScore(normalizeText(value), txt);
              if (sc > bestOpt.score) bestOpt = { v: o.value, score: sc };
            }

            if (bestOpt.v != null && bestOpt.score >= 55) {
              inputEl.value = bestOpt.v;
              try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
              try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
              filled++;
              await _saSleep(80);
              continue;
            }

            // AI fallback for tracked inputs (serialized queue): label + profile keys + options only.
            try {
              const aiEnabled = profile?.aiMappingEnabled === true;
              const apiKey = profile?.['API Key'];
              if (aiEnabled && apiKey) {
                const picked = await _saAiPickBestDropdownOptionText({
                  apiKey,
                  label,
                  allowedProfileKeys: _saAllowedProfileKeys(profile),
                  options: opts.map((o) => (o.textContent || o.value || '').toString().trim()).filter(Boolean),
                  timeoutMs: 8000,
                });

                if (picked) {
                  let bestAi = { v: null, score: 0 };
                  for (const o of opts) {
                    const txt = (o.textContent || o.value || '').toString();
                    const sc = matchScore(picked, txt);
                    if (sc > bestAi.score) bestAi = { v: o.value, score: sc };
                  }

                  if (bestAi.v != null && bestAi.score >= 55) {
                    inputEl.value = bestAi.v;
                    try { inputEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
                    try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                    filled++;
                    await _saSleep(80);
                  }
                }
              }
            } catch (_) {}

            continue;
          }

          // Combobox-like button: use the ATS-provided fillActions if present.
          const role = (inputEl.getAttribute?.('role') || '').toLowerCase();
          const isComboBtn = tag === 'button' || role === 'combobox';
          if (isComboBtn && Array.isArray(sel.fillActions) && sel.fillActions.length) {
            await _saExecuteActions(sel.fillActions, { root: fieldNode, value: String(value) });
            filled++;
            await _saSleep(80);
            continue;
          }

          // Default input fill
          _saSetInputValue(inputEl, String(value));
          filled++;
          await _saSleep(60);
        }
      } catch (_) {}

      // Minimize risk and runtime.
      if (filled >= 8) break;
    }
    if (filled >= 8) break;
  }

  if (filled) {
    console.log('exempliphai: tracked inputs fuzzy-fill', { filled, considered });
  }

  return { ok: true, filled, considered };
}

async function tryAutofillUsingAtsConfig({ url, force = false } = {}) {
  try {
    const det = globalThis.__SmartApply?.atsConfig?.detectATSKeyForUrl;
    const det2 = globalThis.__SmartApply?.atsConfig?.detectATSForUrlDetailed;
    const getCfg = globalThis.__SmartApply?.atsConfig?.getATSConfig;
    if (typeof getCfg !== 'function') return { ok: false, reason: 'no_ats_config' };

    let atsKey = null;
    let atsConfidence = 0;
    if (typeof det2 === 'function') {
      const info = await det2(url || window.location.href);
      atsKey = info?.key || null;
      atsConfidence = Number(info?.confidence || 0);
      // If confidence is too low, skip config-driven fill (avoid wrong ATS).
      if (atsKey && atsConfidence && atsConfidence < 0.45) {
        return { ok: false, reason: 'low_confidence_match', atsKey, atsConfidence };
      }
    } else if (typeof det === 'function') {
      atsKey = await det(url || window.location.href);
      atsConfidence = atsKey ? 0.9 : 0;
    }

    if (!atsKey) return { ok: false, reason: 'no_match' };

    const fullCfg = await getCfg();
    const ats = fullCfg?.ATS?.[atsKey] || null;
    if (!ats || !Array.isArray(ats.inputSelectors)) return { ok: false, reason: 'missing_selectors', atsKey };

    const profile = await _saLoadLocalProfile();
    if (!profile) return { ok: false, reason: 'no_local_profile', atsKey };

    // Find container root
    let root = document;
    if (Array.isArray(ats.containerPath) && ats.containerPath.length) {
      for (const p of ats.containerPath) {
        const found = _saFindOne(p, document);
        if (found) { root = found; break; }
      }
    }

    console.log('exempliphai: ATS config match', atsKey, 'root=', root === document ? 'document' : root);

    // Apply selectors sequentially
    for (const row of ats.inputSelectors) {
      try {
        if (!Array.isArray(row) || row.length < 2) continue;
        const key = row[0];
        const selectorEntries = row[1];

        let fillValue = _saResolveProfileValue(profile, key);
        fillValue = _saCoerceValueForKey(key, fillValue);

        // Skip when no value, except for upload methods where resume exists.
        if (fillValue == null || String(fillValue).trim() === '') {
          // allow resume/cover letter uploads to proceed even without profile value
          const isUploadField = String(key).toLowerCase().includes('resume') || String(key).toLowerCase().includes('cover');
          if (!isUploadField) continue;
        }

        let applied = false;
        const candidates = Array.isArray(selectorEntries) ? selectorEntries : [selectorEntries];
        for (const entry of candidates) {
          applied = await _saApplySelectorEntry(entry, { root, key, fillValue, profile });
          if (applied) break;
        }

        if (applied) {
          await _saSleep(120);
        }
      } catch (e) {
        console.warn('exempliphai: ATS selector row failed', row?.[0], e);
      }
    }

    // Pass 2: tracked inputs (custom questions)
    // Many ATS configs include trackedInputSelectors which describe how to discover
    // arbitrary form fields and their labels. We use this to fill "custom" questions
    // via fuzzy label→profile-key matching (local-only) and, optionally, AI.
    try {
      await _saAutofillTrackedInputs({ ats, root, profile, force });
    } catch (e) {
      console.warn('exempliphai: tracked inputs autofill failed', e);
    }

    // Optional AI mapping for remaining custom questions (explicit user-triggered runs only).
    if (force) {
      try {
        const res = await getStorageDataSync();
        await tryHybridAiMapping(root, res);
      } catch (e) {
        console.warn('exempliphai: ATS-mode AI mapping skipped/failed', e);
      }
    }

    // Auto-submit (if enabled) is handled post-autofill in tryAutofillNow().
    // Return ATS-specific submit selectors so we can prefer them there.
    return {
      ok: true,
      atsKey,
      submitButtonPaths: Array.isArray(ats.submitButtonPaths) ? ats.submitButtonPaths : [],
    };
  } catch (e) {
    console.warn('exempliphai: ATS config autofill failed', e);
    return { ok: false, reason: 'exception', error: String(e) };
  }
}

function _saSendListModeAutofillResult(payload = {}) {
  try {
    if (!chrome?.runtime?.sendMessage) return;

    const finalUrl = String(window.location?.href || '');
    let domain = '';
    try { domain = finalUrl ? new URL(finalUrl).hostname : ''; } catch (_) {}

    // Filled-fields report (best-effort)
    const rep = globalThis.__SmartApplyLastAutofillReport || {};
    const fieldsFilled = Array.isArray(rep.fieldsFilled) ? rep.fieldsFilled : [];
    const filledCount = Number.isFinite(rep.filledCount) ? rep.filledCount : fieldsFilled.length;

    const base = {
      finalUrl,
      domain,
      fieldsFilled,
      filledCount,
      ts: Date.now(),
      ...payload,
    };

    // Existing list-mode hook
    chrome.runtime.sendMessage({
      action: 'LIST_MODE_AUTOFILL_RESULT',
      ...base,
    });

    // Metrics hook (Firebase): count successful autofills
    if (false && base.ok === true) {
      chrome.runtime.sendMessage({
        action: 'TRACK_AUTOFILL',
        url: finalUrl,
        domain,
        filledCount,
        source: String(base.source || ''),
        reason: String(base.reason || ''),
        ts: Number(base.ts || Date.now()),
      });
    }
  } catch (_) {}
}

async function tryAutofillNow({ force = false, reason = "auto" } = {}) {
  if (smartApplyAutofillLock) return false;

  // Greenhouse pages are keyboard/focus sensitive and often require focus to be
  // inside the form. We allow auto-runs, but may send a few *optional* Tabs to
  // establish focus before filling.

  const now = Date.now();
  if (!force && now - smartApplyLastAutofillAt < 1500) return false;

  // Optional: auto-tailor resume before autofill (opt-in)
  try {
    await _saMaybeAutoTailorBeforeAutofill({ source: reason || 'autofill' });
  } catch (_) {}

  // Prefer selector config when available.
  // This supports many ATS domains beyond our legacy hostname heuristics.
  try {
    const atsAttempt = await tryAutofillUsingAtsConfig({ url: window.location.href, force });
    if (atsAttempt?.ok) {
      console.log('exempliphai: ATS-config autofill complete', atsAttempt.atsKey);

      let autoSubmitInfo = null;
      try {
        autoSubmitInfo = await _saMaybeAutoSubmitAfterAutofill({
          source: 'ats-config',
          submitButtonPaths: Array.isArray(atsAttempt.submitButtonPaths) ? atsAttempt.submitButtonPaths : [],
        });
      } catch (e) {
        console.warn('exempliphai: auto-submit skipped/failed (ats-config)', e);
        autoSubmitInfo = {
          enabled: false,
          attempted: false,
          clicked: false,
          intent: 'none',
          clickedText: '',
          why: '',
          score: 0,
          source: 'ats-config',
          reason: 'exception',
        };
      }

      // Rate-limit + mutation de-dupe for ATS-config mode too.
      smartApplyLastAutofillAt = now;

      // Track Applied Job (ATS-config mode)
      try {
        let company = window.location.hostname.replace('www.', '').split('.')[0];
        company = company.charAt(0).toUpperCase() + company.slice(1);

        const jobEntry = {
          company: company,
          role: document.title.split('-')[0].trim() || "Unknown Role",
          date: new Date().toISOString(),
          url: window.location.href,
        };

        chrome.storage.local.get(['AppliedJobs'], (result) => {
          const jobs = Array.isArray(result.AppliedJobs) ? result.AppliedJobs : [];
          const today = new Date().toDateString();
          const alreadyTracked = jobs.some((j) => j.url === jobEntry.url && new Date(j.date).toDateString() === today);
          if (!alreadyTracked) {
            jobs.unshift(jobEntry);
            chrome.storage.local.set({ AppliedJobs: jobs });
            try { chrome.runtime?.sendMessage?.({ action: 'TRACK_APPLIED_JOB', job: jobEntry }); } catch (_) {}
          }
        });
      } catch (_) {}

      _saSendListModeAutofillResult({
        ok: true,
        source: 'ats-config',
        autoSubmit: autoSubmitInfo,
        reason,
      });

      return true;
    }
  } catch (_) {}

  const detected = detectJobFormKey();
  if (!detected && !force && !isLikelyApplicationPage()) return false;

  const isWorkday = (window.location.hostname || "").includes('workday');
  let form = null;
  if (!isWorkday) {
    form = findBestForm();
    if (!form) return false;
  }

  smartApplyAutofillLock = true;
  smartApplyLastAutofillAt = now;

  try {
    smartApplyLastRunForced = !!force;

    // Greenhouse: if focus isn't inside a usable control yet, sending a few
    // Tabs helps React-Select and other controls reliably accept input.
    if (isGreenhouse()) {
      try {
        const root = form || document;
        const active = document.activeElement;

        // In some DOM test environments, document.activeElement is not updated by .focus().
        const focusEl = _isUsableFormControl(active)
          ? active
          : (_isUsableFormControl(_smartApplyLastFocusedEl) ? _smartApplyLastFocusedEl : active);

        const activeOk = _isUsableFormControl(focusEl) && (!root?.contains || root.contains(focusEl));
        if (!activeOk) {
          const tabCount = 6 + Math.floor(Math.random() * 2); // 6–7
          console.log(`exempliphai: Optional tabs (x${tabCount}) → Starting autofill`);
          await tabToFirstInput({
            root,
            document,
            tabCount,
            delayMs: 100,
            sleep: typeof sleep === 'function' ? sleep : undefined,
            quiet: true,
          });
        }
      } catch (_) {}
    }

    await autofill(form);

    let autoSubmitInfo = null;
    try {
      autoSubmitInfo = await _saMaybeAutoSubmitAfterAutofill({ source: 'legacy' });
    } catch (e) {
      console.warn('exempliphai: auto-submit skipped/failed (legacy)', e);
      autoSubmitInfo = {
        enabled: false,
        attempted: false,
        clicked: false,
        intent: 'none',
        clickedText: '',
        why: '',
        score: 0,
        source: 'legacy',
        reason: 'exception',
      };
    }

    _saSendListModeAutofillResult({
      ok: true,
      source: 'legacy',
      autoSubmit: autoSubmitInfo,
      reason,
    });

    return true;
  } catch (e) {
    console.error('exempliphai: Autofill failed', { reason, e });

    _saSendListModeAutofillResult({
      ok: false,
      source: 'legacy',
      error: String(e?.message || e),
      reason,
    });

    return false;
  } finally {
    smartApplyAutofillLock = false;
  }
}

function injectAutofillNowButton() {
  try {
    if (document.getElementById(AUTOFILL_NOW_BUTTON_ID)) return;

    // Keep the button scoped to ATS-like pages only (manifest matches are broad).
    // But also retry — on Greenhouse React pages the form may not be in the DOM yet.
    const detected = detectJobFormKey();
    if (!detected && !isLikelyApplicationPage()) {
      // Retry after a delay — Greenhouse forms render asynchronously
      setTimeout(() => injectAutofillNowButton(), 2000);
      return;
    }

    const btn = document.createElement('button');
    btn.id = AUTOFILL_NOW_BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '🚀 AUTOFILL NOW';

    btn.style.position = 'fixed';
    btn.style.top = '12px';
    btn.style.right = '12px';
    btn.style.zIndex = '2147483647';
    btn.style.background = '#4f46e5';
    btn.style.color = '#ffffff';
    btn.style.border = '0';
    btn.style.borderRadius = '999px';
    btn.style.padding = '10px 12px';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '700';
    btn.style.letterSpacing = '0.4px';
    btn.style.boxShadow = '0 10px 25px rgba(0,0,0,0.18)';
    btn.style.cursor = 'pointer';

    _smartApplyAutofillBtn = btn;

    btn.addEventListener('click', async () => {
      // If we're actively autofilling, this button becomes a pause/resume toggle.
      if (smartApplyAutofillLock) {
        _smartApplyPaused = !_smartApplyPaused;
        if (!_smartApplyPaused) _smartApplyResumeRequested = true;
        _saUpdateAutofillButtonUI({ running: true });
        return;
      }

      _smartApplyPaused = false;
      _smartApplyResumeRequested = false;

      const prev = btn.textContent;
      btn.textContent = 'FILLING…';
      btn.disabled = true;
      btn.style.opacity = '0.85';
      try {
        // Reset filled elements and skip cooldowns so button always forces a full re-fill
        _filledElements = new WeakSet();
        _recentlySkipped = new Map();

        await tryAutofillNow({ force: true, reason: 'button' });
      } finally {
        // If autofill finished normally, restore default UI.
        btn.textContent = prev;
        btn.disabled = false;
        btn.style.opacity = '1';
        _saUpdateAutofillButtonUI({ running: false });
      }
    });

    (document.body || document.documentElement).appendChild(btn);
  } catch (_) {}
}

function setupLongTextareaHints() {
  try {
    const applyHint = (el) => {
      if (!(el instanceof HTMLTextAreaElement)) return;
      if (el.dataset?.aiHintApplied === '1') return;
      const h = el.getBoundingClientRect?.().height || 0;
      if (h <= 100) return;

      el.dataset.aiHintApplied = '1';
      el.style.outline = '2px solid rgba(99, 102, 241, 0.45)';
      el.style.outlineOffset = '2px';
      el.setAttribute('title', 'Right-click for AI?');
    };

    const scan = (root) => {
      const scopeRoot = root && root.querySelectorAll ? root : document;
      const textareas = Array.from(scopeRoot.querySelectorAll('textarea'));
      for (const ta of textareas) applyHint(ta);
    };

    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (!(node instanceof Element)) continue;
          if (node.tagName === 'TEXTAREA') applyHint(node);
          scan(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  } catch (_) {}
}

function extractJobContextFromDocument(doc) {
  try {
    const d = doc && doc.querySelector ? doc : document;

    const pickText = (v) => String(v || '').replace(/\s+/g, ' ').trim();

    // Title
    const titleCandidates = [
      pickText(d.querySelector('[data-testid*="job-title" i]')?.textContent),
      pickText(d.querySelector('.job__title h1')?.textContent),
      pickText(d.querySelector('h1')?.textContent),
      pickText(d.querySelector('meta[property="og:title"]')?.getAttribute?.('content')),
      pickText(d.title),
    ].filter(Boolean);

    const title = titleCandidates[0] ? String(titleCandidates[0]).slice(0, 160) : '';

    // Company
    const companyCandidates = [
      pickText(d.querySelector('meta[property="og:site_name"]')?.getAttribute?.('content')),
      pickText(d.querySelector('meta[name="application-name"]')?.getAttribute?.('content')),
      pickText(d.querySelector('[data-testid*="company" i]')?.textContent),
    ].filter(Boolean);
    const company = companyCandidates[0] ? String(companyCandidates[0]).slice(0, 120) : '';

    // Description (best-effort)
    const selectors = [
      '.job__description',
      '.job__body',
      '.posting',
      'main',
      'article',
      '[class*="description" i]',
      '[id*="description" i]',
    ];

    const nodes = [];
    for (const sel of selectors) {
      try {
        nodes.push(...Array.from(d.querySelectorAll(sel) || []));
      } catch (_) {}
    }

    const scoreText = (t) => {
      const s = String(t || '');
      const len = s.length;
      if (!len) return 0;
      let score = len;
      const lc = s.toLowerCase();
      if (lc.includes('responsibil')) score += 500;
      if (lc.includes('qualification')) score += 500;
      if (lc.includes('requirements')) score += 300;
      if (lc.includes('about the role') || lc.includes('about the job')) score += 300;
      return score;
    };

    let best = { text: '', score: 0 };
    for (const el of nodes.slice(0, 80)) {
      const t = pickText(el?.innerText || el?.textContent);
      // Avoid very short blurbs / nav.
      if (t.length < 200) continue;
      if (t.length > 40000) continue;
      const s = scoreText(t);
      if (s > best.score) best = { text: t, score: s };
    }

    const description = best.text ? best.text.slice(0, 20000) : '';

    return {
      ok: true,
      title,
      company,
      description,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function normalizeText(str) {
  return (str ?? "")
    .toString()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchScore(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;

  const aTokens = new Set(na.split(" "));
  const bTokens = new Set(nb.split(" "));
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const union = aTokens.size + bTokens.size - inter;
  const jaccard = union ? inter / union : 0;
  // Base score from token overlap, with a small bump for multiple shared tokens.
  let score = Math.round(60 * jaccard);
  if (inter >= 2) score += 10;
  return score;
}

function dispatchInputAndChange(el) {
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (_) {}
  try {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Greenhouse React-Select: keyboard-first fill helper
//
// Some Greenhouse/Remix builds do not reliably open react-select menus via
// .click() on the indicator/control.  Keyboard triggers (ArrowRight or
// Shift+Enter) are more consistent on these pages.
//
// Returns true when a visible single-value selection is present.
// ─────────────────────────────────────────────────────────────────────────────

async function fillReactSelectKeyboard(inputElement, fillValue, jobParam, ctx = {}) {
  const TAG = ctx.tag || `exempliphai: React-Select "${jobParam}"`;
  const timeoutMs = ctx.timeoutMs ?? 3000;
  const minScore = ctx.minScore ?? 40;
  const settleMs = ctx.settleMs ?? 500;

  const makeKey = (type, init) => {
    try {
      return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    } catch (_) {
      return null;
    }
  };

  const k = {
    shiftEnterDown: typeof createShiftEnterKeyDown === 'function'
      ? createShiftEnterKeyDown
      : () => makeKey('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true }),
    shiftEnterUp: typeof createShiftEnterKeyUp === 'function'
      ? createShiftEnterKeyUp
      : () => makeKey('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true }),
    arrowRightDown: typeof createArrowRightKeyDown === 'function'
      ? createArrowRightKeyDown
      : () => makeKey('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 }),
    arrowRightUp: typeof createArrowRightKeyUp === 'function'
      ? createArrowRightKeyUp
      : () => makeKey('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 }),
    arrowDown: typeof createArrowDownKeyDown === 'function'
      ? createArrowDownKeyDown
      : () => makeKey('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }),
    arrowUp: typeof createArrowUpKeyDown === 'function'
      ? createArrowUpKeyDown
      : () => makeKey('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 }),
    enterDown: typeof createEnterKeyDown === 'function'
      ? createEnterKeyDown
      : () => makeKey('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
    enterUp: typeof createEnterKeyUp === 'function'
      ? createEnterKeyUp
      : () => makeKey('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
    escapeDown: typeof createEscapeKeyDown === 'function'
      ? createEscapeKeyDown
      : () => makeKey('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 }),
  };

  const selectShell = ctx.selectShell ||
    inputElement.closest?.('.select-shell, .select__container, [class*="select__"], [class*="css"]') ||
    inputElement.parentElement?.parentElement;

  const verifyShell = () => inputElement.closest?.('.select-shell, .select__container') || selectShell;

  const getVisibleSelectionText = () => {
    const shell = verifyShell();
    const singleValue = shell?.querySelector?.('[class*="singleValue"], [class*="single-value"], .select__single-value');
    const t = (singleValue?.textContent || '').trim();
    return t || '';
  };

  const clearTypedText = async () => {
    try {
      setNativeValue(inputElement, '');
      inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
    await sleep(50);
  };

  // Step 0: focus + clear
  inputElement.focus();
  await sleep(50);
  await clearTypedText();

  // Step 1: OPEN (keyboard-first)
  // Focus → ArrowRight → Shift+Enter, with a small settle time.
  try {
    const ev1 = k.arrowRightDown();
    const ev2 = k.arrowRightUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  await sleep(80);

  try {
    const ev1 = k.shiftEnterDown();
    const ev2 = k.shiftEnterUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  // Fallback: click/mousedown indicator/control
  try {
    const indicator = selectShell?.querySelector?.(
      '.select__indicators button, [class*="indicatorContainer"], [class*="IndicatorsContainer"] button, .select__dropdown-indicator'
    );
    const control = selectShell?.querySelector?.('.select__control, [class*="control"]');
    if (indicator) {
      try {
        indicator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { indicator.click?.(); } catch (_) {}
      }
    } else if (control) {
      try {
        control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      } catch (_) {
        try { control.click?.(); } catch (_) {}
      }
    }
  } catch (_) {}

  await sleep(settleMs);

  // Step 2: TYPE/FILTER
  try {
    setNativeValue(inputElement, String(fillValue ?? ''));
  } catch (_) {
    try { inputElement.value = String(fillValue ?? ''); } catch (_) {}
  }
  dispatchInputAndChange(inputElement);

  // Step 3: Robust poll (up to 3s) for listbox/menu + options
  const start = Date.now();
  let menu = null;
  let options = [];

  const findMenu = () => {
    const controlsId = inputElement.getAttribute?.('aria-controls') || inputElement.getAttribute?.('aria-owns');
    if (controlsId) {
      const byId = document.getElementById(controlsId);
      if (byId) return byId;
    }

    const near = selectShell?.querySelector?.('[role="listbox"], .select__menu-list, [class*="menu-list"], [class*="MenuList"]');
    if (near) return near;

    // Portals: search globally, prefer one that matches the input id
    const listboxes = Array.from(document.querySelectorAll('[role="listbox"], .select__menu-list, [class*="menu-list"], [class*="MenuList"]'));
    if (listboxes.length === 1) return listboxes[0];

    const idHint = String(inputElement.id || '');
    if (idHint) {
      const best = listboxes.find(lb => String(lb.id || '').includes(idHint));
      if (best) return best;
    }

    // If aria-expanded is true but we still can't find a good match, just pick the first visible listbox.
    const expanded = String(inputElement.getAttribute?.('aria-expanded') || '') === 'true';
    if (expanded) {
      for (const lb of listboxes) {
        const h = lb.getBoundingClientRect?.().height || lb.offsetHeight || 0;
        if (h > 0) return lb;
      }
    }

    return null;
  };

  while (Date.now() - start < timeoutMs) {
    menu = findMenu();
    if (menu) {
      options = Array.from(menu.querySelectorAll('[role="option"], .select__option, [class*="option"]'))
        .filter(o => (o.textContent || '').trim().length > 0);
      if (options.length) break;
    }
    await sleep(100);
  }

  if (!menu) {
    console.log(`${TAG} — dropdown menu not found after ${timeoutMs}ms for "${fillValue}"`);

    // Retry once with a more direct open sequence. Greenhouse can be finicky and
    // sometimes ignores the first keyboard open attempt.
    try {
      const control = selectShell?.querySelector?.('.select__control, [class*="control"], [class*="Control"]');
      if (control) {
        try { control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (_) {}
        try { control.click?.(); } catch (_) {}
      }
    } catch (_) {}

    await sleep(220);

    // Re-poll briefly
    const retryStart = Date.now();
    while (Date.now() - retryStart < Math.min(1200, timeoutMs)) {
      menu = findMenu();
      if (menu) {
        options = Array.from(menu.querySelectorAll('[role="option"], .select__option, [class*="option"]'))
          .filter(o => (o.textContent || '').trim().length > 0);
        if (options.length) break;
      }
      await sleep(100);
    }

    if (!menu) {
      try {
        const ev = k.escapeDown();
        if (ev) inputElement.dispatchEvent(ev);
      } catch (_) {}
      await clearTypedText();
      return false;
    }
  }

  if (!options.length) {
    console.log(`${TAG} — dropdown appeared but has 0 options for "${fillValue}"`);
    try {
      const ev = k.escapeDown();
      if (ev) inputElement.dispatchEvent(ev);
    } catch (_) {}
    await clearTypedText();
    return false;
  }

  // Step 4: Find best match
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < options.length; i++) {
    const t = options[i].textContent || '';
    const s = matchScore(fillValue, t);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < minScore) {
    const bestText = bestIndex >= 0 ? (options[bestIndex].textContent || '').trim() : '';
    console.log(`${TAG} — no good option match for "${fillValue}" (best score: ${bestScore}${bestText ? `, "${bestText}"` : ''}, ${options.length} options)`);

    // AI fallback (privacy-preserving): ask the provider to pick the best option
    // based on label + allowed profile KEYS + visible options (never values).
    try {
      const ai = ctx?.ai;
      const canUseAi = !!(ai?.enabled && ai?.apiKey);
      if (canUseAi) {
        const optionTexts = options.map((o) => (o.textContent || '').trim()).filter(Boolean);
        const picked = await _saAiPickBestDropdownOptionText({
          apiKey: ai.apiKey,
          label: jobParam,
          allowedProfileKeys: Array.isArray(ai.allowedProfileKeys) ? ai.allowedProfileKeys : [],
          options: optionTexts,
          model: ai.model,
          timeoutMs: ai.timeoutMs ?? 8000,
        });

        if (picked) {
          console.log(`${TAG} — AI picked option text "${picked}"; retrying react-select filter`);

          await clearTypedText();
          try {
            setNativeValue(inputElement, String(picked));
          } catch (_) {
            try { inputElement.value = String(picked); } catch (_) {}
          }
          dispatchInputAndChange(inputElement);
          await sleep(120);

          // Re-read menu/options after filtering.
          menu = findMenu();
          if (menu) {
            options = Array.from(menu.querySelectorAll('[role="option"], .select__option, [class*="option"]'))
              .filter(o => (o.textContent || '').trim().length > 0);
          }

          if (options && options.length) {
            let aiBestIndex = -1;
            let aiBestScore = 0;
            for (let i = 0; i < options.length; i++) {
              const t = options[i].textContent || '';
              const s = matchScore(picked, t);
              if (s > aiBestScore) {
                aiBestScore = s;
                aiBestIndex = i;
              }
            }

            if (aiBestIndex >= 0 && aiBestScore >= 50) {
              bestIndex = aiBestIndex;
              bestScore = aiBestScore;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`${TAG} — AI fallback failed`, e);
    }

    // If AI didn't help, bail.
    if (bestIndex < 0 || bestScore < minScore) {
      try {
        const ev = k.escapeDown();
        if (ev) inputElement.dispatchEvent(ev);
      } catch (_) {}
      await clearTypedText();
      return false;
    }
  }

  const bestText = (options[bestIndex].textContent || '').trim();

  // Step 5: Select (keyboard ArrowDown/Up → Enter)
  const actId = String(inputElement.getAttribute?.('aria-activedescendant') || '');
  let focusedIndex = -1;
  if (actId) focusedIndex = options.findIndex(o => String(o.id || '') === actId);
  if (focusedIndex < 0) {
    focusedIndex = options.findIndex(o => String(o.getAttribute?.('aria-selected') || '') === 'true');
  }
  if (focusedIndex < 0) {
    focusedIndex = options.findIndex(o => String(o.className || '').includes('is-focused') || String(o.className || '').includes('isFocused'));
  }

  const press = async (evFactory, n) => {
    for (let i = 0; i < n; i++) {
      try {
        const ev = evFactory();
        if (ev) inputElement.dispatchEvent(ev);
      } catch (_) {}
      await sleep(30);
    }
  };

  if (focusedIndex < 0) {
    // No focused option yet: first ArrowDown moves to index 0.
    await press(k.arrowDown, bestIndex + 1);
  } else if (bestIndex > focusedIndex) {
    await press(k.arrowDown, bestIndex - focusedIndex);
  } else if (bestIndex < focusedIndex) {
    await press(k.arrowUp, focusedIndex - bestIndex);
  }

  try {
    const ev1 = k.enterDown();
    const ev2 = k.enterUp();
    if (ev1) inputElement.dispatchEvent(ev1);
    if (ev2) inputElement.dispatchEvent(ev2);
  } catch (_) {}

  await sleep(200);

  // Fallback: click the best option if keyboard didn't stick
  if (!getVisibleSelectionText()) {
    try { options[bestIndex].click?.(); } catch (_) {}
    await sleep(200);
  }

  const selected = getVisibleSelectionText();
  if (selected) {
    console.log(`${TAG} → Selected "${selected || bestText}" (score ${bestScore})`);
    return true;
  }

  // React-Select verification can be flaky on Greenhouse due to async re-renders
  // and portal-based menus. Crucially: do NOT clear the input on verify failure,
  // because that can wipe a correct selection and cause later "flip" behavior.
  //
  // Secondary verify: check the surrounding shell text for the option we attempted.
  try {
    const shell = verifyShell();
    const shellText = normalizeText(shell?.textContent || '');
    const want = normalizeText(bestText || fillValue || '');
    if (shellText && want && shellText.includes(want)) {
      console.log(`${TAG} → Selected (secondary verify) "${bestText}" (score ${bestScore})`);
      return true;
    }
  } catch (_) {}

  console.log(`${TAG} — post-fill verify failed; leaving value as-is (no clear)`);

  // Close menu best-effort, but do not clear typed text.
  try {
    const ev = k.escapeDown();
    if (ev) inputElement.dispatchEvent(ev);
  } catch (_) {}

  // Avoid thrashing this element in MutationObserver reruns.
  try { markRecentlySkipped(inputElement); } catch (_) {}

  return false;
}

async function setBestSelectOption(selectEl, fillValue, ctx = {}) {
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return false;

  const fillNorm = normalizeText(fillValue);

  // --- Country dropdown detection & mapping ---
  // If this is a country <select> (class="candidate-location" or many options with 2-letter codes),
  // map location strings like "United States of America", "houston, tx", "US" → country code.
  const isCountrySelect = selectEl.classList.contains('candidate-location') ||
    (options.length > 100 && options.filter(o => /^[A-Z]{2}$/.test(o.value)).length > 50);

  if (isCountrySelect) {
    const countryCode = resolveCountryCode(fillValue);
    if (countryCode) {
      const match = options.find(o => o.value === countryCode);
      if (match) {
        console.log(`exempliphai: Country select "${fillValue}" → "${match.textContent.trim()}" (code ${countryCode})`);
        selectEl.value = match.value;
        match.selected = true;
        dispatchInputAndChange(selectEl);
        return true;
      }
    }
  }

  const yesSynonyms = ['yes', 'true', '1'];
  const noSynonyms = ['no', 'false', '0', 'decline', 'prefer not', 'not', 'none'];
  const isYes = yesSynonyms.some(s => fillNorm.includes(s));
  const isNo = noSynonyms.some(s => fillNorm.includes(s));

  let best = { opt: null, score: 0 };
  for (const opt of options) {
    if (opt.disabled) continue;
    let score = Math.max(
      matchScore(fillValue, opt.textContent),
      matchScore(fillValue, opt.value)
    );

    // Boolean synonym boosts (fixes "No" → "I am not a veteran"/"Decline")
    const optNorm = normalizeText(opt.textContent || opt.value);
    if (isNo && noSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 90);
    } else if (isYes && yesSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 90);
    }

    // Legacy veteran boost (if fillValue mentions 'veteran')
    if (fillNorm.includes('veteran') && noSynonyms.some(s => optNorm.includes(s))) {
      score = Math.max(score, 85);
    }

    if (score > best.score) best = { opt, score };
  }

  if (!best.opt) return false;
  if (best.score < 50) {
    console.log(`exempliphai: SKIP select option — best score ${best.score} < 50 for "${fillValue}" (best option: "${best.opt?.textContent?.trim()}")`);

    // AI fallback (privacy-preserving): let the provider pick among visible options
    // based on label + allowed profile KEY NAMES.
    try {
      const ai = ctx?.ai;
      const label = ctx?.label || ctx?.jobParam || '';
      const canUseAi = !!(ai?.enabled && ai?.apiKey && label);
      if (canUseAi) {
        const optionTexts = options.map((o) => (o.textContent || o.value || '').toString().trim()).filter(Boolean);
        const picked = await _saAiPickBestDropdownOptionText({
          apiKey: ai.apiKey,
          label,
          allowedProfileKeys: Array.isArray(ai.allowedProfileKeys) ? ai.allowedProfileKeys : [],
          options: optionTexts,
          model: ai.model,
          timeoutMs: ai.timeoutMs ?? 8000,
        });

        if (picked) {
          let bestAi = { opt: null, score: 0 };
          for (const opt of options) {
            if (opt.disabled) continue;
            const sc = Math.max(matchScore(picked, opt.textContent), matchScore(picked, opt.value));
            if (sc > bestAi.score) bestAi = { opt, score: sc };
          }

          if (bestAi.opt && bestAi.score >= 55) {
            console.log(`exempliphai: AI Select "${label}" → "${bestAi.opt.textContent.trim() || bestAi.opt.value}" (score ${bestAi.score})`);
            selectEl.value = bestAi.opt.value;
            bestAi.opt.selected = true;
            dispatchInputAndChange(selectEl);
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('exempliphai: AI select fallback failed', e);
    }

    return false;
  }

  console.log(`exempliphai: Select "${fillValue}" → "${best.opt.textContent.trim() || best.opt.value}" (score ${best.score})`);

  selectEl.value = best.opt.value;
  best.opt.selected = true;
  dispatchInputAndChange(selectEl);
  return true;
}

/**
 * Resolve a location string or country name to an ISO 3166-1 alpha-2 code.
 * Handles: "United States of America", "United States", "US", "houston, tx", etc.
 */
function resolveCountryCode(locationStr) {
  if (!locationStr) return null;
  const norm = normalizeText(locationStr);

  // Direct 2-letter code
  if (/^[a-z]{2}$/.test(norm)) return norm.toUpperCase();

  // Common country name → code mappings (extend as needed)
  const countryMap = {
    'united states of america': 'US', 'united states': 'US', 'usa': 'US', 'u s a': 'US', 'america': 'US',
    'united kingdom': 'GB', 'great britain': 'GB', 'england': 'GB', 'uk': 'GB',
    'canada': 'CA', 'australia': 'AU', 'germany': 'DE', 'france': 'FR',
    'india': 'IN', 'china': 'CN', 'japan': 'JP', 'brazil': 'BR',
    'mexico': 'MX', 'spain': 'ES', 'italy': 'IT', 'netherlands': 'NL',
    'south korea': 'KR', 'singapore': 'SG', 'ireland': 'IE', 'israel': 'IL',
    'sweden': 'SE', 'switzerland': 'CH', 'new zealand': 'NZ', 'poland': 'PL',
    'portugal': 'PT', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
    'austria': 'AT', 'belgium': 'BE', 'czech republic': 'CZ', 'romania': 'RO',
    'philippines': 'PH', 'pakistan': 'PK', 'nigeria': 'NG', 'colombia': 'CO',
    'argentina': 'AR', 'chile': 'CL', 'peru': 'PE', 'south africa': 'ZA',
    'egypt': 'EG', 'turkey': 'TR', 'indonesia': 'ID', 'malaysia': 'MY',
    'thailand': 'TH', 'vietnam': 'VN', 'taiwan': 'TW', 'hong kong': 'HK',
    'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
    'russia': 'RU', 'ukraine': 'UA',
  };

  // Exact country name match
  for (const [name, code] of Object.entries(countryMap)) {
    if (norm === name || norm.includes(name)) return code;
  }

  // US state abbreviations / city patterns → US
  const usStateAbbrs = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia',
    'ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd',
    'oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc','pr'];
  // Pattern: "city, ST" where ST is a US state abbreviation
  const cityStateMatch = norm.match(/,\s*([a-z]{2})\s*$/);
  if (cityStateMatch && usStateAbbrs.includes(cityStateMatch[1])) return 'US';

  return null;
}

function getRadioLabelText(radio) {
  if (!radio) return "";
  const aria = radio.getAttribute?.("aria-label");
  if (aria) return aria;
  const id = radio.id;
  if (id) {
    const lbl = document.querySelector(`label[for="${CSS?.escape ? CSS.escape(id) : id}"]`);
    if (lbl) return lbl.textContent || "";
  }
  // Common patterns: wrapped in <label>...</label>
  const parentLabel = radio.closest?.("label");
  if (parentLabel) return parentLabel.textContent || "";
  return "";
}

function clickBestRadioInGroup(radioEl, fillValue, root) {
  if (!radioEl || radioEl.type !== "radio") return false;
  const name = radioEl.name;
  if (!name) return false;

  // Lever: Some custom questions surface via a hidden/base template control, and the
  // deterministic mapping can end up targeting the wrong element. If the question text
  // indicates visa sponsorship, force-click the "No" option inside the same question.
  // This avoids false "already has No" states on template controls.
  try {
    const qc = radioEl.closest?.('.application-question, .custom-question, li');
    const qText = normalizeText(qc?.textContent || '');
    if (qText && qText.includes('visa sponsorship') && qText.includes('united states')) {
      const scope = qc || root || radioEl.form || document;
      const escName = CSS?.escape ? CSS.escape(name) : name.replace(/[^a-zA-Z0-9_\-\[\]]/g, "\\$&");
      const noRadio = scope.querySelector?.(`input[type="radio"][name="${escName}"][value="No"]`);
      if (noRadio && !noRadio.checked) {
        noRadio.click();
        dispatchInputAndChange(noRadio);
        console.log('exempliphai: Lever visa sponsorship forced → clicked "No"');
        return true;
      }
    }
  } catch (_) {}

  const esc = (val) =>
    CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  const scope = root || radioEl.form || document;
  const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${esc(name)}"]`));
  if (!radios.length) return false;

  // --- Smart override for work authorization & sponsorship questions ---
  // Look at the question text surrounding this radio group to detect specific patterns.
  const overrideValue = getWorkAuthOverride(radioEl, fillValue);
  const effectiveFillValue = overrideValue !== null ? overrideValue : fillValue;

  let best = { el: null, score: 0 };
  for (const radio of radios) {
    const labelText = getRadioLabelText(radio);
    const score = Math.max(matchScore(effectiveFillValue, radio.value), matchScore(effectiveFillValue, labelText));
    if (score > best.score) best = { el: radio, score };
  }

  if (!best.el) return false;
  if (best.score < 40) return false;

  if (!best.el.checked) {
    best.el.click();
    dispatchInputAndChange(best.el);
  }
  return true;
}

/**
 * Handle checkbox groups (e.g., Lever's multi-select "Yes"/"No" checkboxes for sponsorship).
 * Finds the best-matching checkbox in the same name group and clicks it.
 */
function clickBestCheckboxInGroup(checkboxEl, fillValue, root) {
  if (!checkboxEl || checkboxEl.type !== "checkbox") return false;
  const name = checkboxEl.name;
  if (!name) return false;

  const esc = (val) =>
    CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  const scope = root || checkboxEl.form || document;
  const checkboxes = Array.from(scope.querySelectorAll(`input[type="checkbox"][name="${esc(name)}"]`));
  if (!checkboxes.length) return false;

  // Smart override for sponsorship/authorization checkbox questions
  const overrideValue = getWorkAuthOverride(checkboxEl, fillValue);
  const effectiveFillValue = overrideValue !== null ? overrideValue : fillValue;

  let best = { el: null, score: 0 };
  for (const cb of checkboxes) {
    const labelText = getRadioLabelText(cb); // Reuse — works for checkboxes too
    const score = Math.max(matchScore(effectiveFillValue, cb.value), matchScore(effectiveFillValue, labelText));
    if (score > best.score) best = { el: cb, score };
  }

  if (!best.el) return false;
  if (best.score < 40) return false;

  if (!best.el.checked) {
    best.el.click();
    dispatchInputAndChange(best.el);
  }
  return true;
}

/**
 * Detect if a radio group question is about US work authorization or sponsorship,
 * and return the correct override value based on the actual question text.
 *
 * Problem: User stores "Legally Authorized to Work" = "no" (generic answer to a
 * different field like "Legally Authorized to Work (generic)"), but a Lever form
 * asks "Are you legally authorized to work in the United States for [Company]?"
 * which is a US-specific question — the answer should typically be "yes".
 *
 * Similarly, "Will you now or in the future require sponsorship..." should be "no".
 */
function getWorkAuthOverride(radioEl, currentFillValue) {
  try {
    // Get the question text from surrounding labels/containers
    const questionContainer = radioEl.closest('.application-question, .custom-question, li');
    if (!questionContainer) return null;
    const questionText = normalizeText(questionContainer.textContent);

    // Pattern 1: "are you legally authorized to work in the united states" → "yes"
    if (questionText.includes('authorized to work') && questionText.includes('united states')) {
      console.log(`exempliphai: Work auth override — question asks about US authorization → "yes"`);
      return 'yes';
    }

    // Pattern 2: "will you now or in the future require sponsorship" → "no"
    if ((questionText.includes('require sponsorship') || questionText.includes('require visa') ||
         questionText.includes('need sponsorship') || questionText.includes('employment visa')) &&
        (questionText.includes('will you') || questionText.includes('do you'))) {
      console.log(`exempliphai: Sponsorship override — question asks about future sponsorship → "no"`);
      return 'no';
    }
  } catch (_) {}
  return null;
}

function getLabelText(node) {
  const texts = [];
  if (!node) return texts;

  const doc = node.ownerDocument || document;

  // 1. <label for="id">
  const id = node.id;
  if (id) {
    const escId = CSS?.escape ? CSS.escape(id) : id;
    const lbl = doc.querySelector(`label[for="${escId}"]`);
    if (lbl) texts.push(lbl.textContent);
  }

  // 2. Wrapping <label>
  const parentLabel = node.closest?.("label");
  if (parentLabel) texts.push(parentLabel.textContent);

  // 3. aria-labelledby → resolve ID refs to text
  const labelledBy = node.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const refTexts = labelledBy
      .split(/\s+/)
      .map((refId) => doc.getElementById(refId)?.textContent || "")
      .filter(Boolean);
    if (refTexts.length) texts.push(refTexts.join(" "));
  }

  // 4. Closest container text (fieldset legend, .field wrapper, etc.)
  // Walk up max 3 levels looking for short-ish text.
  let parent = node.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    if (parent.tagName === "FORM") break;

    if (parent.tagName === "FIELDSET") {
      const legend = parent.querySelector("legend");
      if (legend) texts.push(legend.textContent);
    }

    const directText = parent.textContent || "";
    if (directText.length > 3 && directText.length < 300) {
      texts.push(directText);
      break;
    }
  }

  return texts.filter(Boolean);
}

function inputQuery(jobParam, form) {
  const normalizedParam = normalizeText(jobParam);
  const nodes = Array.from(form.querySelectorAll("input, select, textarea"));

  // Pass 0: Exact ID match (highest priority — Greenhouse uses stable IDs like "first_name", "gender", "veteran_status")
  let el = nodes.find((node) => {
    const id = normalizeText(node.id);
    return id && id === normalizedParam;
  });
  if (el) return el;

  // Pass 1: match on element attributes.
  el = nodes.find((node) => {
    const attributes = [
      node.id,
      node.name,
      node.placeholder,
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("aria-labelledby"),
      node.getAttribute?.("aria-describedby"),
      node.getAttribute?.("data-qa"),
      node.getAttribute?.("data-automation-id"),
      node.getAttribute?.("data-automation-label"),
      node.getAttribute?.("autocomplete"),
    ];

    for (const rawAttr of attributes) {
      const attr = normalizeText(rawAttr);
      if (!attr) continue;
      if (attr.includes(normalizedParam)) {
        // Optimization: If searching for "address", ignore if it also contains "email"
        // to avoid false positive with "Email Address".
        if (normalizedParam === "address" && attr.includes("email")) continue;
        return true;
      }
    }
    return false;
  });
  if (el) return el;

  // Pass 1.5: match on associated label/question text.
  el = nodes.find((node) => {
    const labelTexts = getLabelText(node);
    return labelTexts.some((txt) => {
      const norm = normalizeText(txt);
      if (!norm) return false;
      if (norm.includes(normalizedParam)) {
        if (normalizedParam === "address" && norm.includes("email")) return false;
        return true;
      }
      return false;
    });
  });
  if (el) return el;

  // Pass 2: for <select>, match on option text/value.
  el = nodes.find((node) => {
    if (!(node instanceof HTMLSelectElement)) return false;
    const options = Array.from(node.options || []);
    return options.some((opt) => {
      const t = normalizeText(opt.textContent);
      const v = normalizeText(opt.value);
      return (t && t.includes(normalizedParam)) || (v && v.includes(normalizedParam));
    });
  });
  if (el) return el;

  // Pass 3: fuzzy match on label text using matchScore().
  let bestMatch = { el: null, score: 0 };
  for (const node of nodes) {
    const labelTexts = getLabelText(node);
    for (const txt of labelTexts) {
      const score = matchScore(normalizedParam, txt);
      if (score > bestMatch.score) bestMatch = { el: node, score };
    }
  }

  if (bestMatch.el && bestMatch.score >= 50) {
    console.log(`exempliphai: Fuzzy match "${jobParam}" → "${bestMatch.el.id || bestMatch.el.name || bestMatch.el.type}" (score ${bestMatch.score})`);
    return bestMatch.el;
  }
  if (bestMatch.el && bestMatch.score > 0) {
    console.log(`exempliphai: SKIP fuzzy match "${jobParam}" — best score ${bestMatch.score} < 50 (element: ${bestMatch.el.id || bestMatch.el.name || '?'})`);
  }
  return null;
}

function formatCityStateCountry(data, param) {
  let formattedStr = `${data[param] != undefined ? `${data[param]},` : ""} ${data["Location (State/Region)"] != undefined
    ? `${data["Location (State/Region)"]},`
    : ""
    }`;
  if (formattedStr[formattedStr.length - 1] == ",")
    formattedStr = formattedStr.slice(0, formattedStr.length - 1);
  return formattedStr;
}

async function awaitForm() {
  // Avoid doing work on non-ATS pages (manifest matches are intentionally broad).
  const detected = detectJobFormKey();
  if (!detected && !isLikelyApplicationPage()) return;

  // Greenhouse: allow auto-trigger (tryAutofillNow handles optional focus tabs).

  // Try once immediately (some pages render the form before our MutationObserver sees any changes).
  await tryAutofillNow({ force: false, reason: 'initial' });

  // Keep watching for multi-step flows (e.g., language pickers) that reveal the form later.
  // Use a longer debounce to prevent aggressive re-fills that override manual edits.
  let mutationRunCount = 0;
  const MAX_MUTATION_RUNS = 3; // Only auto-fill a few times via mutation, then stop

  const observer = new MutationObserver(() => {
    if (mutationRunCount >= MAX_MUTATION_RUNS) return; // Stop re-running after initial fills
    if (smartApplyMutationDebounce) clearTimeout(smartApplyMutationDebounce);
    smartApplyMutationDebounce = setTimeout(() => {
      mutationRunCount++;
      tryAutofillNow({ force: false, reason: 'mutation' });
    }, 400); // Balanced: 400ms debounce (was 800ms — too slow for multi-step forms)
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function _saUpdateAutofillButtonUI(state = {}) {
  try {
    const btn = _smartApplyAutofillBtn || document.getElementById(AUTOFILL_NOW_BUTTON_ID);
    if (!btn) return;

    const running = state.running === true;
    const paused = _smartApplyPaused === true;

    if (running) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.background = paused ? '#f59e0b' : '#ef4444';
      btn.textContent = paused ? '▶ RESUME AUTOFILL' : '⏸ PAUSE AUTOFILL';
      return;
    }

    // Not running
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.background = '#4f46e5';
    btn.textContent = '🚀 AUTOFILL NOW';
  } catch (_) {}
}

async function _saPausePoint() {
  // Cooperative pause: wait here until resumed.
  try {
    while (_smartApplyPaused) {
      _saUpdateAutofillButtonUI({ running: true });
      await sleep(150);
    }
  } catch (_) {}
}

async function autofill(form) {
  console.log("exempliphai: Starting autofill.");
  _saUpdateAutofillButtonUI({ running: true });
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  await sleep(delays.initial);

  const genericExtras = fields?.generic
    ? Object.fromEntries(
        Object.entries(fields.generic).filter(([_, p]) => p && p !== "Resume")
      )
    : null;

  let matchFound = false;
  for (let jobForm in fields) {
    if (window.location.hostname.includes(jobForm) && jobForm !== 'generic') {
      matchFound = true;
      if (jobForm == "workday") {
        workDayAutofill(res);
        return;
      }

      await processFields(jobForm, fields[jobForm], form, res);

      // Important: Greenhouse/Lever/etc. often include *custom questions* whose labels do not
      // match the platform's standard IDs. A second "generic" pass catches these safely.
      if (genericExtras) {
        await processFields('generic', genericExtras, form, res);
      }

      break;
    }
  }

  if (!matchFound && fields.generic) {
    console.log("exempliphai: No specific config found, using generic.");
    await processFields('generic', fields.generic, form, res);
  }

  // Phase 2 (opt-in): run AI mapping for unresolved custom fields.
  // To avoid repeated network calls from MutationObserver re-runs, only do this
  // on explicit user-triggered runs (the 🚀 button / force=true).
  if (smartApplyLastRunForced) {
    try {
      await tryHybridAiMapping(form, res);
    } catch (e) {
      console.warn('exempliphai: Hybrid AI mapping skipped/failed', e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Hybrid AI mapping (opt-in)
//
// This is additive. Deterministic autofill stays as-is.
// The AI mapping layer only runs on explicit user-triggered runs and only sends
// minimal field descriptors + allowed profile KEY NAMES (never values).
// ─────────────────────────────────────────────────────────────────────────────

let _smartApplyHybridLastRunAt = 0;
let _smartApplyAiDepsLoaded = false;

async function ensureAiDepsLoaded() {
  if (_smartApplyAiDepsLoaded) return true;

  // If a provider is already attached (e.g., preloaded in-page or in tests),
  // don't attempt dynamic imports.
  if (globalThis.__SmartApplyProviders?.gemini) {
    _smartApplyAiDepsLoaded = true;
    return true;
  }

  if (!chrome?.runtime?.getURL) return false;

  // Load the ESM validator + provider so they attach to globals:
  // - __SmartApplyFillPlan
  // - __SmartApplyProviders.gemini
  try {
    await import(chrome.runtime.getURL('contentScripts/fillPlanValidator.js'));
  } catch (e) {
    console.warn('exempliphai: Failed to load fillPlanValidator', e);
    return false;
  }

  try {
    await import(chrome.runtime.getURL('contentScripts/providers/gemini.js'));
  } catch (e) {
    console.warn('exempliphai: Failed to load gemini provider', e);
    return false;
  }

  _smartApplyAiDepsLoaded = true;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-assisted dropdown option picking (privacy-preserving)
//
// When we cannot confidently fuzzy-match a dropdown option (native <select> or
// react-select combobox), we can ask the AI provider to choose the best option
// *from the visible option list* given only:
// - the field label
// - allowed profile KEY NAMES (never values)
// - the option texts
//
// This is intentionally low-volume and serialized via a simple queue to avoid
// flooding the provider on pages with many controls.
// ─────────────────────────────────────────────────────────────────────────────

let _smartApplyAiDropdownQueue = Promise.resolve();

function _saEnqueueAiDropdownTask(fn) {
  _smartApplyAiDropdownQueue = _smartApplyAiDropdownQueue
    .then(() => fn())
    .catch((e) => {
      console.warn('exempliphai: AI dropdown task failed', e);
      return null;
    });
  return _smartApplyAiDropdownQueue;
}

function _saAllowedProfileKeys(profile) {
  try {
    const blockedKeys = new Set(['API Key', 'aiMappingEnabled', 'cloudSyncEnabled']);
    return Object.keys(profile || {}).filter((k) => k && !blockedKeys.has(k));
  } catch (_) {
    return [];
  }
}

async function _saAiPickBestDropdownOptionText({
  apiKey,
  label,
  allowedProfileKeys,
  options,
  model,
  timeoutMs = 8000,
} = {}) {
  try {
    if (!apiKey) return null;
    if (!label) return null;
    if (!Array.isArray(options) || options.length === 0) return null;

    const depsOk = await ensureAiDepsLoaded();
    if (!depsOk) return null;

    const provider = globalThis.__SmartApplyProviders?.gemini;
    if (!provider?.generateNarrativeAnswer) return null;

    const cleanOptions = Array.from(
      new Set(
        options
          .map((t) => String(t || '').trim())
          .filter((t) => t.length > 0)
          .slice(0, 60) // cap payload
      )
    );
    if (!cleanOptions.length) return null;

    const prompt = `Best option for "${String(label).trim()}" from profile keys [${(allowedProfileKeys || []).join(', ')}]:\n\nOptions:\n- ${cleanOptions.join('\n- ')}\n\nReturn ONLY the single best option text exactly as it appears in the list above. No quotes. No explanation.`;

    const text = await _saEnqueueAiDropdownTask(() =>
      provider.generateNarrativeAnswer({
        apiKey,
        questionText: prompt,
        maxWords: 20,
        tone: 'direct',
        model,
        timeoutMs,
        maxRetries: 1,
      })
    );

    const answer = String(text || '').trim();
    if (!answer) return null;

    // Prefer exact match to avoid surprises.
    const exact = cleanOptions.find((o) => o === answer);
    if (exact) return exact;

    // Fallback: choose the closest option by fuzzy score.
    let best = { t: null, score: 0 };
    for (const o of cleanOptions) {
      const sc = matchScore(answer, o);
      if (sc > best.score) best = { t: o, score: sc };
    }

    if (best.t && best.score >= 55) return best.t;
    return null;
  } catch (e) {
    console.warn('exempliphai: AI pick best dropdown option failed', e);
    return null;
  }
}

function inferSectionFromSnapshotCtx(sectionCtx) {
  try {
    if (!sectionCtx) return '';
    const parts = [];
    if (sectionCtx.legend) parts.push(sectionCtx.legend);
    if (Array.isArray(sectionCtx.headings) && sectionCtx.headings.length) parts.push(sectionCtx.headings.join(' > '));
    return parts.filter(Boolean).join(' | ');
  } catch (_) {}
  return '';
}

function isEmptyForAi(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase();

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const v = String(el.value || '').trim();
      if (type === 'checkbox' || type === 'radio') return false;
      return v.length === 0;
    }

    const ce = el.getAttribute?.('contenteditable');
    if ((ce && ce !== 'false') || el.isContentEditable) {
      const t = String(el.textContent || '').trim();
      return t.length === 0;
    }
  } catch (_) {}
  return false;
}

function shouldConsiderLabelForAi(label) {
  const t = normalizeText(label);
  if (!t) return false;
  if (t.length < 6) return false;
  if (t.length > 220) return false;

  // Minimize requests: only send labels that look like mapping candidates.
  const hints = [
    'authorized',
    'authorization',
    'sponsorship',
    'visa',
    'work in the united states',
    'salary',
    'compensation',
    'notice period',
    'available',
    'start date',
    'relocate',
    'linkedin',
    'github',
    'website',
    'portfolio',
    'location',
    'city',
    'state',
    'country',
    'zip',
    'postal',
    'phone',
    'email',
  ];

  return hints.some((h) => t.includes(h));
}

function controlKindForElement(el) {
  try {
    const tag = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute?.('role') || '').toLowerCase();
    if (role === 'combobox') return 'combobox';

    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';

    if (tag === 'input') {
      const type = (el.getAttribute?.('type') || 'text').toLowerCase();
      if (type === 'file') return 'file';
      if (type === 'date') return 'date';
      if (type === 'time') return 'time';
      if (type === 'datetime-local') return 'datetime-local';
      return 'input';
    }

    const ce = el.getAttribute?.('contenteditable');
    if ((ce && ce !== 'false') || el.isContentEditable) return 'contenteditable';
  } catch (_) {}
  return 'unknown';
}

async function tryHybridAiMapping(form, res) {
  if (!form) return;

  // Cooldown: avoid re-calling AI rapidly on multi-step pages.
  const now = Date.now();
  if (now - _smartApplyHybridLastRunAt < 15000) return;

  if (!res?.aiMappingEnabled) return;

  const apiKey = res?.['API Key'];
  if (!apiKey) return;

  const fs = globalThis.__SmartApply?.formSnapshot;
  const policy = globalThis.__SmartApply?.policy;
  const aiFillPlan = globalThis.__SmartApply?.aiFillPlan;
  const fillExecutor = globalThis.__SmartApply?.fillExecutor;

  if (!fs?.findControls || !fs?.stableFingerprint || !fs?.computeBestLabel) {
    console.warn('exempliphai: formSnapshot not loaded; cannot run hybrid mapping');
    return;
  }
  if (!policy || !aiFillPlan || !fillExecutor) {
    console.warn('exempliphai: Phase-2 modules missing (policy/aiFillPlan/fillExecutor)');
    return;
  }

  const depsOk = await ensureAiDepsLoaded();
  if (!depsOk) return;

  const domain = window.location.hostname || '';
  const pageUrl = window.location.href || '';

  // Allowed profile KEYS only (never values)
  const blockedKeys = new Set(['API Key', 'aiMappingEnabled', 'cloudSyncEnabled']);
  const allowedProfileKeys = Object.keys(res || {}).filter((k) => k && !blockedKeys.has(k));

  // Collect unresolved candidates.
  const unresolved_fields = [];
  const controls = typeof fs.findControlElements === 'function'
    ? fs.findControlElements(form)
    : fs.findControls(form);

  for (const el of controls) {
    try {
      const type = (el.getAttribute?.('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') continue;
      if (type === 'file') continue;

      if (_filledElements.has(el)) continue;
      if (!isEmptyForAi(el)) continue;

      const label = fs.computeBestLabel(el) || '';
      const sectionCtx = fs.extractSectionContext ? fs.extractSectionContext(el) : null;
      const section = inferSectionFromSnapshotCtx(sectionCtx);

      // Policy gate BEFORE we send anything to AI.
      if (policy.isConsentCheckbox?.({ label })) continue;
      if (policy.isSensitiveField?.({ label, section })) continue;

      if (!shouldConsiderLabelForAi(label)) continue;

      const fp = fs.stableFingerprint(el, { root: form });
      if (!fp) continue;

      const options = fs.extractOptions ? fs.extractOptions(el) : [];
      const optStrings = Array.isArray(options)
        ? Array.from(
            new Set(
              options
                .map((o) => (o?.label || o?.value || '').toString().trim())
                .filter(Boolean)
            )
          ).slice(0, 32)
        : [];

      unresolved_fields.push({
        field_fingerprint: fp,
        control: {
          kind: controlKindForElement(el),
          tag: (el.tagName || '').toLowerCase(),
          type: type,
          role: (el.getAttribute?.('role') || '').toLowerCase(),
          name: el.getAttribute?.('name') || '',
          id: el.getAttribute?.('id') || '',
          autocomplete: el.getAttribute?.('autocomplete') || '',
        },
        descriptor: {
          label,
          section,
          required: el.required || el.getAttribute?.('aria-required') === 'true',
          visible: true,
          options: optStrings,
        },
      });

      if (unresolved_fields.length >= 10) break; // minimize
    } catch (_) {}
  }

  if (!unresolved_fields.length) return;

  _smartApplyHybridLastRunAt = now;

  console.log('exempliphai: Hybrid mapping candidates', unresolved_fields.length);

  const tier1 = await aiFillPlan.generateTier1(
    {
      domain,
      page_url: pageUrl,
      snapshot_hash: `sha256:${now.toString(36)}`,
      unresolved_fields,
    },
    allowedProfileKeys,
    { apiKey, allowAiMapping: true, timeoutMs: 20000, outerRetries: 1 }
  );

  if (!tier1?.ok) {
    console.warn('exempliphai: AI mapping failed', tier1?.error);
    return;
  }

  const execRes = await fillExecutor.execute(tier1.plan, {
    root: form,
    profile: res,
    force: false,
    confidenceThreshold: 0.75,
  });

  console.log('exempliphai: Hybrid AI mapping executor result', execRes);
}

async function processFields(jobForm, fieldMap, form, res) {
  // Track which DOM elements have already been attempted in THIS call to prevent
  // multiple param keys (e.g. "experience years", "total experience", "relevant experience")
  // from retrying the same combobox within one processFields pass.
  const _attemptedThisPass = new WeakSet();

  for (let jobParam in fieldMap) {
    await _saPausePoint();
    const param = fieldMap[jobParam];
    if (param === "Resume") {
      // AI right-click handlers are installed globally on page load.
      _saInstallAiAnswerHandlers();

      let localData = await getStorageDataLocal();
      if (!localData.Resume) continue;

      let el = inputQuery(jobParam, form);

      // Fallback for strict Resume field if generic inputQuery fails, 
      // primarily for main resume uploaders with specific IDs
      if (!el && jobParam.toLowerCase().includes("resume")) {
        let resumeDiv = {
          greenhouse: 'input[id="resume"]',
          lever: 'input[id="resume-upload-input"]',
          dover: 'input[type="file"][accept=".pdf"], input[type="file"][accept="application/pdf"]',
          oracle: 'input[type="file"]',
          generic: 'input[type="file"]'
        };
        let selector = resumeDiv[jobForm] || 'input[type="file"]';
        el = document.querySelector(selector);
      }

      if (!el) continue;

      // GUARD: Do NOT upload resume to cover letter file inputs
      const elId = (el.id || '').toLowerCase();
      const elName = (el.name || '').toLowerCase();
      const elLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const parentGroupLabel = el.closest('[aria-labelledby]')?.getAttribute('aria-labelledby') || '';
      const parentGroupText = parentGroupLabel ? (document.getElementById(parentGroupLabel)?.textContent || '').toLowerCase() : '';
      
      if (elId.includes('cover') || elName.includes('cover') || elLabel.includes('cover') || parentGroupText.includes('cover')) {
        console.log(`exempliphai: SKIP resume upload to cover letter input: ${elId || elName}`);
        _filledElements.add(el);
        continue;
      }

      el.addEventListener("submit", function (event) {
        event.preventDefault();
      });

      const dt = new DataTransfer();
      let arrBfr = base64ToArrayBuffer(localData.Resume);

      dt.items.add(
        new File([arrBfr], `${localData["Resume_name"]}`, {
          type: "application/pdf",
        })
      );
      el.files = dt.files;
      el.dispatchEvent(changeEvent);
      await sleep(delays.short);
      console.log(`exempliphai: Uploaded resume to ${elId || elName || 'file input'}`);

      _filledElements.add(el);
      continue;
    }

    if (param === "Skills") {
      let localData = await getStorageDataLocal("Resume_details");
      if (localData && localData.Resume_details) {
        try {
          let details = localData.Resume_details;
          if (typeof details === 'string') {
            details = JSON.parse(details);
          }
          if (details.skills && Array.isArray(details.skills)) {
            let fillValue = details.skills.join(", ");
            let inputElement = inputQuery(jobParam, form);
            if (inputElement) {
              setNativeValue(inputElement, fillValue);
            }
          }
        } catch (e) {
          console.error("Error parsing skills from resume details:", e);
        }
      }
      continue;
    }

    if (["Certification Name", "Issuing Organization", "Credential ID", "Credential URL", "Issue Date Month", "Expiration Date Month"].includes(param)) {
      let localData = await getStorageDataLocal("Resume_details");
      let certs = [];
      if (localData && localData.Resume_details && localData.Resume_details.certifications) {
        certs = localData.Resume_details.certifications;
      }

      if (certs.length > 0) {
        let cert = certs[0]; // Accessing the first certification
        let val = "";
        if (param === "Certification Name") val = cert.name;
        if (param === "Issuing Organization") val = cert.issuer;
        if (param === "Credential ID") val = cert.credentialId;
        if (param === "Credential URL") val = cert.url;
        if (param === "Issue Date Month") {
          // Heuristic: if input is month select, use month. if generic input, use full date space separated
          // But existing utils expect month. let's just assume month for now or full string
          // Actually, autofill logic later assumes monthToNumber if simple date month field? No, it uses setNativeValue.
          // Let's pass the full string or part.
          // Let's assume month name is stored.
          val = cert.issueDate ? cert.issueDate.split(' ')[0] : "";
        }
        if (param === "Expiration Date Month") {
          val = cert.expirationDate ? cert.expirationDate.split(' ')[0] : "";
        }

        if (val) {
          let inputElement = inputQuery(jobParam, form);
          if (inputElement) {
            setNativeValue(inputElement, val);
            // Also handle dropdowns if needed
            let btn = inputElement.closest(".select__control--outside-label");
            if (btn) {
              btn.dispatchEvent(mouseUpEvent);
              await sleep(delays.short);
              btn.dispatchEvent(keyDownEvent);
              await sleep(delays.short);
            }
          }
        }
      }
      continue;
    }

    let useLongDelay = false;
    // param already defined at top of loop

    let fillValue = res[param];
    if (!fillValue) {
      console.log(`exempliphai: SKIP "${jobParam}" (param="${param}") — no stored value`);
      continue;
    }
    let inputElement = inputQuery(jobParam, form);
    if (!inputElement) {
      console.log(`exempliphai: SKIP "${jobParam}" (param="${param}") — no matching element found in form`);
      continue;
    }

    // Skip already-filled (permanent phone overwrite fix across passes)
    if (_filledElements.has(inputElement)) {
      console.log(`exempliphai: Skip filled ${jobParam} (${inputElement.name || inputElement.id || inputElement.type}): already has "${inputElement.value}"`);
      continue;
    }

    // Skip elements that were recently attempted but had no matching option
    // (prevents "experience years"/"total experience"/"relevant experience" looping)
    if (isRecentlySkipped(inputElement)) {
      console.log(`exempliphai: Skip recently-skipped ${jobParam} (${inputElement.name || inputElement.id || inputElement.type})`);
      continue;
    }

    // Skip elements already attempted in this processFields pass (dedup across
    // different param names that fuzzy-match to the same DOM element)
    if (_attemptedThisPass.has(inputElement)) {
      console.log(`exempliphai: Skip already-attempted-this-pass ${jobParam} (${inputElement.name || inputElement.id || inputElement.type})`);
      continue;
    }
    _attemptedThisPass.add(inputElement);

    // ── GREENHOUSE REACT-SELECT GUARD ──
    // Greenhouse custom questions use React-Select comboboxes (role="combobox" with
    // aria-labelledby pointing to a <label>). Before filling, verify the question label
    // actually matches what we're trying to fill. This prevents data pollution where
    // e.g. "Race" value gets stuffed into "Are you a former educator?" dropdown.
    if (inputElement.getAttribute?.("role") === "combobox") {
      const labelledById = inputElement.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelEl = document.getElementById(labelledById);
        const labelText = normalizeText(labelEl?.textContent || "");
        const paramNorm = normalizeText(jobParam);
        const score = matchScore(paramNorm, labelText);
        
        // Permissive: pass if score ≥ 45 or label contains param text.
        // Only hard-skip if score < 30 (clearly unrelated).
        const isRelevant = score >= 45 || labelText.includes(paramNorm);
        
        if (!isRelevant && score < 30) {
          console.log(`exempliphai: SKIP combobox "${labelText}" — doesn't match param "${jobParam}" (score ${score} < 30)`);
          continue;
        }
        if (!isRelevant) {
          console.log(`exempliphai: WARN combobox "${labelText}" — weak match for param "${jobParam}" (score ${score}), proceeding anyway`);
        }
      }
    }

    // Scroll smoothly to current field for sequential editing
    inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);  // User-requested: 200ms delay

    if (param === "Gender" || param === "Location (City)") useLongDelay = true;
    if (param === "Location (City)") fillValue = formatCityStateCountry(res, param);

    // Textareas: fill directly, no dropdown handling needed.
    if (inputElement instanceof HTMLTextAreaElement) {
      setNativeValue(inputElement, fillValue);
      _filledElements.add(inputElement);
      dispatchInputAndChange(inputElement);
      continue;
    }

    // Native <select> and radio groups need special handling:
    if (inputElement instanceof HTMLSelectElement) {
      if (await setBestSelectOption(inputElement, fillValue, {
        label: jobParam,
        ai: {
          enabled: res?.aiMappingEnabled === true,
          apiKey: res?.['API Key'],
          allowedProfileKeys: _saAllowedProfileKeys(res),
        },
      })) _filledElements.add(inputElement);
      continue;
    }

    if (inputElement.type === "radio") {
      if (clickBestRadioInGroup(inputElement, fillValue, form)) _filledElements.add(inputElement);
      continue;
    }

    if (inputElement.type === "checkbox") {
      if (clickBestCheckboxInGroup(inputElement, fillValue, form)) _filledElements.add(inputElement);
      continue;
    }

    // ── GREENHOUSE REACT-SELECT COMBOBOX HANDLING ──
    // Greenhouse uses react-select for dropdowns. These are <input role="combobox">
    // inside .select__control containers. The key challenge: React-Select ignores
    // programmatic value changes — we must simulate real user interaction:
    // 1. Click the control/indicator to open the dropdown
    // 2. Type into the input to trigger React-Select's internal filtering
    // 3. Wait for [role=listbox] to appear (up to 2s)
    // 4. Extract options → best match → click
    // 5. On failure: do NOT clear (can wipe correct selections); mark _recentlySkipped to prevent retry loops
    const isReactSelectCombobox = inputElement.getAttribute?.("role") === "combobox" &&
      inputElement.closest?.(".select-shell, .select__container, [class*=\"select__\"]");

    if (isReactSelectCombobox) {
      try {
        const selectShell = inputElement.closest('.select-shell, .select__container, [class*="select__"], [class*="css"]')
          || inputElement.parentElement?.parentElement;

        const ok = await fillReactSelectKeyboard(inputElement, fillValue, jobParam, {
          selectShell,
          timeoutMs: 3000,
          minScore: 40,
          tag: `exempliphai: React-Select "${jobParam}"`,
          ai: {
            enabled: res?.aiMappingEnabled === true,
            apiKey: res?.['API Key'],
            allowedProfileKeys: _saAllowedProfileKeys(res),
          },
        });

        if (ok) {
          _filledElements.add(inputElement);
        } else {
          // Do not clear on verify failure. fillReactSelectKeyboard now leaves the
          // current value as-is when verification is flaky (common on Greenhouse).
          // Mark as recently skipped to avoid thrashing this control on reruns.
          console.log(`exempliphai: React-Select "${jobParam}" — verify/match failed, left as-is (no clear)`);
          markRecentlySkipped(inputElement);
        }
      } catch (e) {
        console.error(`exempliphai: Error handling React-Select for "${jobParam}"`, e);
        markRecentlySkipped(inputElement);
      }
      continue;
    }

    // Custom ARIA dropdowns: role="combobox" controlling a role="listbox" (Ashby/BambooHR/etc.)
    const listboxId =
      inputElement.getAttribute?.("aria-owns") ||
      inputElement.getAttribute?.("aria-controls");
    if (listboxId && inputElement.getAttribute?.("role") === "combobox") {
      try {
        inputElement.click();
      } catch (_) {}
      await sleep(delays.short);

      const listbox = document.getElementById(listboxId);
      if (listbox) {
        const options = Array.from(listbox.querySelectorAll('[role="option"]'));
        let bestOpt = { el: null, score: 0 };
        for (const opt of options) {
          const score = matchScore(fillValue, opt.textContent);
          if (score > bestOpt.score) bestOpt = { el: opt, score };
        }
        if (bestOpt.el && bestOpt.score >= 50) {
          bestOpt.el.click();
          _filledElements.add(inputElement);
          await sleep(delays.short);
          continue;
        }
      }
    }

    // Plain text inputs
    setNativeValue(inputElement, fillValue);
    _filledElements.add(inputElement);

    //for the dropdown elements (legacy Greenhouse v1 style)
    let btn = inputElement.closest(".select__control--outside-label");
    if (!btn) continue;

    btn.dispatchEvent(mouseUpEvent);
    await sleep(useLongDelay ? delays.long : delays.short);
    btn.dispatchEvent(keyDownEvent);
    await sleep(delays.short);
  }
  // Removed global scrollToTop(); per-field scrolling now handles it
  console.log(`exempliphai: Complete in ${getTimeElapsed(initTime)}s.`);
  _saUpdateAutofillButtonUI({ running: false });

  // Track Applied Job
  try {
    let company = window.location.hostname.replace('www.', '').split('.')[0];
    company = company.charAt(0).toUpperCase() + company.slice(1);

    const jobEntry = {
      company: company,
      role: document.title.split('-')[0].trim() || "Unknown Role", // Simple heuristic
      date: new Date().toISOString(),
      url: window.location.href
    };

    chrome.storage.sync.get(['cloudSyncEnabled', 'AppliedJobsSync'], (resSync) => {
      const syncEnabled = !!resSync.cloudSyncEnabled;

      chrome.storage.local.get(['AppliedJobs'], (result) => {
        let jobs = result.AppliedJobs || [];
        // Avoid duplicate entries for the same URL on the same day
        const today = new Date().toDateString();
        const alreadyTracked = jobs.some(j => j.url === jobEntry.url && new Date(j.date).toDateString() === today);

        if (!alreadyTracked) {
          jobs.unshift(jobEntry); // Add to top

          chrome.storage.local.set({ AppliedJobs: jobs }, () => {
            console.log("exempliphai: Job tracked in local history.");
          });

          // Firebase tracking (MV3 SW)
          try {
            chrome.runtime?.sendMessage?.({ action: 'TRACK_APPLIED_JOB', job: jobEntry });
          } catch (_) {}

          // Legacy sync storage tracking (deprecated)
          if (syncEnabled) {
            let syncJobs = resSync.AppliedJobsSync || [];
            syncJobs.unshift(jobEntry);
            // Limit to 100 for sync storage constraints
            syncJobs = syncJobs.slice(0, 100);
            chrome.storage.sync.set({ AppliedJobsSync: syncJobs }, () => {
              console.log("exempliphai: Job tracked in cloud history.");
            });
          }
        }
      });
    });
  } catch (e) {
    console.error("exempliphai: Error tracking job", e);
  }

}

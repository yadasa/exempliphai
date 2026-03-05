/*
  autofill.js

  CRITICAL REGRESSION FIX (post 5540247):
  - Restore the original robust form detection + field matching/filling.
  - Keep ES module imports (MV3 content script type=module).
  - Re-apply targeted v2 improvements (3x scan, scroll+highlight, shadow/iframe pierce, randomFill radios/selects, storage hooks, Force Fill support).
*/

import {
  keyDownEvent,
  mouseUpEvent,
  changeEvent,
  sleep,
  curDateStr,
  scrollToTop,
  base64ToArrayBuffer,
  getTimeElapsed,
  delays,
  getStorageDataLocal,
  getStorageDataSync,
  getStorageValue,
  setNativeValue,
  fields,
  highlightElement,
  safeScrollIntoView,
  querySelectorAllDeep,
  isControlFilled,
  randomFill,
} from './utils.js';

import { workDayAutofill } from './workday.js';

let initTime;
let lastClickedElement = null;
let aiListenerInstalled = false;
let running = false;

const applicationFormQuery = '#application-form, #application_form, #applicationform';

window.addEventListener('load', () => {
  console.log('Exempliphai: found job page.');
  initTime = Date.now();
  installAiContextMenuListener();
  awaitForm();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.action === 'autofill') triggerAutofill({ forceFill: false });
  if (msg.action === 'forceFill') triggerAutofill({ forceFill: true });
});

function installAiContextMenuListener() {
  if (aiListenerInstalled) return;
  aiListenerInstalled = true;

  // Track last right-clicked element so context menu "✨ Autofill with AI" works.
  document.addEventListener(
    'contextmenu',
    (event) => {
      lastClickedElement = event.target;
    },
    true
  );

  chrome.runtime.onMessage.addListener((request) => {
    if (request?.action === 'TRIGGER_AI_REPLY' && lastClickedElement) {
      generateAIAnswer(lastClickedElement);
    }
  });
}

async function generateAIAnswer(element) {
  const originalCursor = element.style.cursor;
  element.style.cursor = 'wait';

  try {
    // 1) Question text
    let question = element.getAttribute('aria-label') || element.getAttribute('placeholder') || '';
    if (!question) {
      const id = element.id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) question = label.innerText;
      }
    }

    if (!question) {
      // closest readable text
      let parent = element.parentElement;
      while (parent && !question && parent.tagName !== 'FORM') {
        const txt = (parent.innerText || '').trim();
        if (txt.length > 5 && txt.length < 200) question = txt;
        parent = parent.parentElement;
      }
    }

    // 2) API key
    const syncData = await getStorageDataSync('API Key');
    const apiKey = syncData['API Key'];
    if (!apiKey) {
      alert('Please set your Gemini API Key in the Exempliphai settings.');
      return;
    }

    // 3) Context from resume details + PDFs
    const localData = await getStorageDataLocal(['Resume', 'LinkedIn PDF', 'Resume_details']);
    const resumeDetails = localData.Resume_details || {};
    const resumeBase64 = localData.Resume;
    const linkedinBase64 = localData['LinkedIn PDF'];

    let context = 'User Profile Context:\n';
    if (resumeDetails.experiences) context += 'Experience:\n' + JSON.stringify(resumeDetails.experiences) + '\n';
    if (resumeDetails.skills)
      context +=
        'Skills: ' +
        (Array.isArray(resumeDetails.skills) ? resumeDetails.skills.join(', ') : resumeDetails.skills) +
        '\n';
    if (resumeDetails.certifications)
      context += 'Certifications:\n' + JSON.stringify(resumeDetails.certifications) + '\n';

    const parts = [
      {
        text: `You are a helpful assistant applying for a job.\n${context}\n\nTask: Write a professional, concise answer to the following job application question. Use the first person. Do not include placeholders like [Your Name]. Just the answer.\n\nQuestion: ${question}`,
      },
    ];

    if (resumeBase64) {
      parts.push({ inline_data: { data: resumeBase64, mime_type: 'application/pdf' } });
    }
    if (linkedinBase64) {
      parts.push({ inline_data: { data: linkedinBase64, mime_type: 'application/pdf' } });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );

    const json = await response.json();
    if (json?.error) throw new Error(json.error.message || 'Unknown API error');

    const candidate = json?.candidates?.[0];
    const answer = candidate?.content?.parts?.[0]?.text;
    if (answer) setNativeValue(element, answer);
  } catch (error) {
    console.error('AI Generation Error', error);
    alert(`Failed to generate answer: ${error.message || String(error)}`);
  } finally {
    element.style.cursor = originalCursor;
  }
}

function detectJobBoard(hostname) {
  for (const board of Object.keys(fields)) {
    if (board === 'generic') continue;
    if (hostname.includes(board)) return board;
  }
  return 'generic';
}

function hasAnyControls(root) {
  try {
    return !!root?.querySelector?.('input, textarea, select');
  } catch {
    return false;
  }
}

function getCandidateRoot() {
  return (
    document.querySelector(applicationFormQuery) ||
    document.querySelector('form') ||
    document.querySelector('#mainContent') ||
    document.body
  );
}

async function awaitForm() {
  const observer = new MutationObserver((_, obs) => {
    const board = detectJobBoard(window.location.hostname);

    if (board === 'workday') {
      obs.disconnect();
      triggerAutofill({ forceFill: false });
      return;
    }

    const root = getCandidateRoot();
    if (root && hasAnyControls(root)) {
      obs.disconnect();
      triggerAutofill({ forceFill: false, rootOverride: root });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Lever sometimes has the form immediately.
  if (window.location.hostname.includes('lever')) {
    const root = document.querySelector('#application-form, #application_form');
    if (root) triggerAutofill({ forceFill: false, rootOverride: root });
  }
}

async function triggerAutofill({ forceFill, rootOverride } = {}) {
  // Avoid parallel runs.
  if (running) return;
  running = true;

  try {
    const storedForce = await getStorageValue('sync', 'forceFillEnabled', false);
    const effectiveForceFill = !!forceFill || !!storedForce;

    const board = detectJobBoard(window.location.hostname);
    const root = rootOverride || getCandidateRoot();

    await autofill({ board, root, forceFill: effectiveForceFill });
  } finally {
    running = false;
  }
}

function normalizeWhitespace(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAssociatedLabelText(el) {
  // label[for=id]
  const id = el?.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return normalizeWhitespace(label.textContent).toLowerCase();
  }

  // wrapped by label
  const wrappingLabel = el?.closest?.('label');
  if (wrappingLabel?.textContent) return normalizeWhitespace(wrappingLabel.textContent).toLowerCase();

  // aria-labelledby
  const labelledby = el?.getAttribute?.('aria-labelledby');
  if (labelledby) {
    const parts = labelledby
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const lid of parts) {
      const node = document.getElementById(lid);
      const txt = normalizeWhitespace(node?.textContent || '').toLowerCase();
      if (txt) return txt;
    }
  }

  return '';
}

function isUsableControl(el) {
  if (!el) return false;
  if (el.disabled) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return false;
  }
  try {
    if (el.getClientRects && el.getClientRects().length === 0) {
      // Many hidden elements have no client rects.
      // (Shadow DOM inputs still usually have rects once visible.)
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

function inputQuery(jobParam, root) {
  const normalizedParam = String(jobParam ?? '').toLowerCase();
  const controls = querySelectorAllDeep('input, textarea, select', root || document);

  // Try stronger matches first.
  const candidates = controls.filter(isUsableControl);

  // 1) Exact-ish: name/id equals
  for (const el of candidates) {
    const id = (el.id || '').toLowerCase().trim();
    const name = (el.name || '').toLowerCase().trim();
    if (id === normalizedParam || name === normalizedParam) return el;
  }

  // 2) Includes any attribute or label
  for (const el of candidates) {
    const attrs = [
      el.id,
      el.name,
      el.placeholder,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('aria-labelledby'),
      el.getAttribute?.('aria-describedby'),
      el.getAttribute?.('data-qa'),
      el.getAttribute?.('data-automation-id'),
      el.getAttribute?.('data-automation-label'),
    ]
      .map((s) => (s == null ? '' : String(s).toLowerCase().trim()))
      .filter(Boolean);

    const labelText = getAssociatedLabelText(el);

    // Avoid false positive: Email Address when looking for Address
    if (normalizedParam === 'address') {
      const combined = (attrs.join(' ') + ' ' + labelText).toLowerCase();
      if (combined.includes('email') && combined.includes('address')) continue;
    }

    if (labelText && labelText.includes(normalizedParam)) return el;

    for (const a of attrs) {
      if (a.includes(normalizedParam)) return el;
    }
  }

  return null;
}

function formatCityStateCountry(data, param) {
  let formattedStr = `${data[param] != undefined ? `${data[param]},` : ''} ${
    data['Location (State/Region)'] != undefined ? `${data['Location (State/Region)']},` : ''
  }`;
  if (formattedStr[formattedStr.length - 1] === ',') {
    formattedStr = formattedStr.slice(0, formattedStr.length - 1);
  }
  return formattedStr.trim();
}

async function autofill({ board, root, forceFill }) {
  if (running) {
    // already protected, but keep
  }

  console.log('Exempliphai: Starting autofill.', { board, forceFill });

  const res = await getStorageDataSync();
  res['Current Date'] = curDateStr();

  // v2 improvement: run a few scans to catch dynamic rendering.
  const scanCount = await getStorageValue('sync', 'scanCount', 3);
  const scanDelayMs = await getStorageValue('sync', 'scanDelayMs', 800);

  await sleep(delays.initial);

  const missing = [];

  if (board === 'workday') {
    await workDayAutofill(res);
    return;
  }

  const map = fields[board] || fields.generic;

  for (let scan = 0; scan < Math.max(1, Number(scanCount) || 1); scan++) {
    await processFields({
      board,
      fieldMap: map,
      root,
      res,
      forceFill,
      missing,
    });

    if (scan < scanCount - 1) await sleep(scanDelayMs);
  }

  // Persist missing fields for debugging / future UI.
  try {
    chrome.storage.local.set({ lastMissingFields: missing.slice(0, 200) });
  } catch {
    // ignore
  }

  scrollToTop();
  console.log(`Exempliphai: Complete in ${getTimeElapsed(initTime)}s.`);

  trackAppliedJob();
}

async function processFields({ board, fieldMap, root, res, forceFill, missing }) {
  // Ensure we can query even if root is null.
  const queryRoot = root || document;

  for (const jobParam of Object.keys(fieldMap)) {
    const param = fieldMap[jobParam];
    if (param == null) continue;

    // Resume upload
    if (param === 'Resume') {
      const localData = await getStorageDataLocal();
      if (!localData?.Resume) continue;

      // Primary query
      let el = inputQuery(jobParam, queryRoot);

      // Fallback for file inputs
      if (!el && String(jobParam).toLowerCase().includes('resume')) {
        const resumeDiv = {
          greenhouse: 'input[id="resume"]',
          lever: 'input[id="resume-upload-input"]',
          dover: 'input[type="file"][accept=".pdf"], input[type="file"][accept="application/pdf"]',
          oracle: 'input[type="file"]',
          generic: 'input[type="file"]',
        };
        const selector = resumeDiv[board] || 'input[type="file"]';
        el = document.querySelector(selector);
      }

      if (!el) continue;

      // Skip if already selected unless Force Fill.
      try {
        if (!forceFill && el.files && el.files.length) continue;
      } catch {
        // ignore
      }

      safeScrollIntoView(el);
      highlightElement(el);

      const dt = new DataTransfer();
      const arrBfr = base64ToArrayBuffer(localData.Resume);
      dt.items.add(
        new File([arrBfr], `${localData['Resume_name'] || 'resume.pdf'}`, {
          type: 'application/pdf',
        })
      );

      el.files = dt.files;
      el.dispatchEvent(changeEvent);
      await sleep(delays.short);
      continue;
    }

    // Skills from parsed resume
    if (param === 'Skills') {
      const localData = await getStorageDataLocal('Resume_details');
      let details = localData?.Resume_details;

      try {
        if (typeof details === 'string') details = JSON.parse(details);
      } catch {
        // ignore
      }

      if (details?.skills && Array.isArray(details.skills)) {
        const fillValue = details.skills.join(', ');
        const inputElement = inputQuery(jobParam, queryRoot);
        if (inputElement) {
          if (forceFill || !isControlFilled(inputElement)) {
            safeScrollIntoView(inputElement);
            highlightElement(inputElement);
            setNativeValue(inputElement, fillValue);
          }
        }
      }
      continue;
    }

    // First certification (basic)
    if (
      [
        'Certification Name',
        'Issuing Organization',
        'Credential ID',
        'Credential URL',
        'Issue Date Month',
        'Expiration Date Month',
      ].includes(param)
    ) {
      const localData = await getStorageDataLocal('Resume_details');
      const certs = localData?.Resume_details?.certifications || [];
      if (!certs.length) continue;

      const cert = certs[0];
      let val = '';
      if (param === 'Certification Name') val = cert.name;
      if (param === 'Issuing Organization') val = cert.issuer;
      if (param === 'Credential ID') val = cert.credentialId;
      if (param === 'Credential URL') val = cert.url;
      if (param === 'Issue Date Month') val = cert.issueDate ? String(cert.issueDate).split(' ')[0] : '';
      if (param === 'Expiration Date Month')
        val = cert.expirationDate ? String(cert.expirationDate).split(' ')[0] : '';

      if (!val) continue;

      const inputElement = inputQuery(jobParam, queryRoot);
      if (!inputElement) continue;

      if (!forceFill && isControlFilled(inputElement)) continue;

      safeScrollIntoView(inputElement);
      highlightElement(inputElement);
      setNativeValue(inputElement, val);

      // React select fallback
      const btn = inputElement.closest('.select__control--outside-label');
      if (btn) {
        btn.dispatchEvent(mouseUpEvent);
        await sleep(delays.short);
        btn.dispatchEvent(keyDownEvent);
        await sleep(delays.short);
      }

      continue;
    }

    // Standard fields
    let fillValue = res[param];

    const inputElement = inputQuery(jobParam, queryRoot);
    if (!inputElement) continue;

    // If no value available, consider randomFill for radios/selects (v2 feature)
    if (!fillValue) {
      const didRandom = await randomFill(inputElement, { onlyIfRequired: true });
      if (!didRandom) {
        missing.push({
          board,
          jobParam,
          param,
          url: window.location.href,
          hostname: window.location.hostname,
        });
      }
      continue;
    }

    let useLongDelay = false;
    if (param === 'Gender' || param === 'Location (City)') useLongDelay = true;

    if (param === 'Location (City)') fillValue = formatCityStateCountry(res, param);

    if (!forceFill && isControlFilled(inputElement)) continue;

    // v2 improvements: scroll + highlight
    safeScrollIntoView(inputElement);
    highlightElement(inputElement);

    setNativeValue(inputElement, fillValue);

    // dropdown elements (greenhouse/react-select style)
    const btn = inputElement.closest('.select__control--outside-label');
    if (btn) {
      btn.dispatchEvent(mouseUpEvent);
      await sleep(useLongDelay ? delays.long : delays.short);
      btn.dispatchEvent(keyDownEvent);
      await sleep(delays.short);
    }
  }
}

function trackAppliedJob() {
  try {
    let company = window.location.hostname.replace('www.', '').split('.')[0];
    company = company.charAt(0).toUpperCase() + company.slice(1);

    const jobEntry = {
      company,
      role: document.title.split('-')[0].trim() || 'Unknown Role',
      date: new Date().toISOString(),
      url: window.location.href,
    };

    chrome.storage.sync.get(['cloudSyncEnabled', 'AppliedJobsSync'], (resSync) => {
      const syncEnabled = !!resSync.cloudSyncEnabled;

      chrome.storage.local.get(['AppliedJobs'], (result) => {
        let jobs = result.AppliedJobs || [];

        const today = new Date().toDateString();
        const alreadyTracked = jobs.some(
          (j) => j.url === jobEntry.url && new Date(j.date).toDateString() === today
        );

        if (alreadyTracked) return;

        jobs.unshift(jobEntry);
        chrome.storage.local.set({ AppliedJobs: jobs }, () => {
          console.log('Exempliphai: Job tracked in local history.');
        });

        if (syncEnabled) {
          let syncJobs = resSync.AppliedJobsSync || [];
          syncJobs.unshift(jobEntry);
          syncJobs = syncJobs.slice(0, 100);
          chrome.storage.sync.set({ AppliedJobsSync: syncJobs }, () => {
            console.log('Exempliphai: Job tracked in cloud history.');
          });
        }
      });
    });
  } catch (e) {
    console.error('Exempliphai: Error tracking job', e);
  }
}

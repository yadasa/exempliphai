/*
import {
  keyDownEvent,
  keyUpEvent,
  mouseUpEvent,
  changeEvent,
  inputEvent,
  sleep,
  curDateStr,
  scrollToTop,
  base64ToArrayBuffer,
  monthToNumber,
  getTimeElapsed,
  delays,
  getStorageDataLocal,
  getStorageDataSync,
  setNativeValue,
  fields
} from "./utils";
import { workDayAutofill } from './workday';
*/

let initTime;
let _smartApplyBooted = false;
function bootSmartApply() {
  if (_smartApplyBooted) return;
  _smartApplyBooted = true;
  console.log("SmartApply: found job page.");
  initTime = new Date().getTime();
  setupLongTextareaHints();
  injectAutofillNowButton();
  awaitForm();
}

// Run immediately if page already loaded, otherwise wait for DOMContentLoaded.
// Also handle BFCache restores via pageshow.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootSmartApply, { once: true });
} else {
  bootSmartApply();
}
window.addEventListener('pageshow', bootSmartApply);
const applicationFormQuery = "#application-form, #application_form, #applicationform";


const AUTOFILL_NOW_BUTTON_ID = "smartapply-autofill-now";
let smartApplyAutofillLock = false;
let smartApplyLastAutofillAt = 0;
let smartApplyMutationDebounce = null;

// Track filled elements to prevent re-filling in subsequent passes
const _filledElements = new WeakSet();

// EEO value synonyms: map common user-stored values to ATS-expected values
const EEO_SYNONYMS = {
  "i don't wish to answer": "Decline to self-identify",
  "i do not wish to answer": "Decline to self-identify",
  "i wish not to answer": "Decline to self-identify",
  "prefer not to say": "Decline to self-identify",
  "prefer not to disclose": "Decline to self-identify",
  "not a veteran": "I am not a veteran",
  "not a protected veteran": "I am not a protected veteran",
  "no, i am not a veteran": "I am not a veteran",
};

function normalizeEeoValue(value) {
  const lower = (value || "").toLowerCase().trim();
  return EEO_SYNONYMS[lower] || value;
}

function isGreenhouseDom() {
  try {
    return !!(
      document.querySelector('form.application--form') ||
      document.querySelector('#application-form.application--form') ||
      document.querySelector('.eeoc__container') ||
      document.querySelector('.application--container')
    );
  } catch (_) {}
  return false;
}

function isLeverDom() {
  try {
    return !!(
      document.querySelector('form#application-form[enctype="multipart/form-data"]') ||
      document.querySelector('[data-qa="btn-submit"].postings-btn') ||
      document.querySelector('.application-question.resume')
    );
  } catch (_) {}
  return false;
}

function detectJobFormKey() {
  try {
    const host = (window.location.hostname || "").toLowerCase();
    for (const k of Object.keys(fields || {})) {
      if (k === "generic") continue;
      if (host.includes(k)) return k;
    }
    // Fallback: DOM-based detection for embedded ATS forms
    if (isGreenhouseDom()) return "greenhouse";
    if (isLeverDom()) return "lever";
  } catch (_) {}
  return null;
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

async function tryAutofillNow({ force = false, reason = "auto" } = {}) {
  if (smartApplyAutofillLock) return false;

  const now = Date.now();
  if (!force && now - smartApplyLastAutofillAt < 1500) return false;

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
    await autofill(form);
    return true;
  } catch (e) {
    console.error('SmartApply: Autofill failed', { reason, e });
    return false;
  } finally {
    smartApplyAutofillLock = false;
  }
}

function injectAutofillNowButton() {
  try {
    if (document.getElementById(AUTOFILL_NOW_BUTTON_ID)) return;

    // Keep the button scoped to ATS-like pages only (manifest matches are broad).
    const detected = detectJobFormKey();
    if (!detected && !isLikelyApplicationPage()) return;

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

    btn.addEventListener('click', async () => {
      const prev = btn.textContent;
      btn.textContent = 'FILLING...';
      btn.disabled = true;
      btn.style.opacity = '0.85';
      try {
        await tryAutofillNow({ force: true, reason: 'button' });
      } finally {
        btn.textContent = prev;
        btn.disabled = false;
        btn.style.opacity = '1';
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
      const r = root && root.querySelectorAll ? root : document;
      const textareas = Array.from(r.querySelectorAll('textarea'));
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

function isCountryDropdown(selectEl) {
  // Detect if a <select> contains country options by checking for well-known countries
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const options = Array.from(selectEl.options || []);
  const countrySignals = ['united states', 'canada', 'united kingdom', 'australia', 'germany', 'france'];
  let countryCount = 0;
  for (const opt of options) {
    const text = (opt.textContent || "").toLowerCase();
    if (countrySignals.some(c => text.includes(c))) countryCount++;
    if (countryCount >= 3) return true;
  }
  return false;
}

function setBestSelectOption(selectEl, fillValue) {
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return false;

  // Apply EEO synonym normalization
  const normalizedFill = normalizeEeoValue(fillValue);

  let best = { opt: null, score: 0 };
  for (const opt of options) {
    if (opt.disabled) continue;
    const score = Math.max(
      matchScore(normalizedFill, opt.textContent),
      matchScore(normalizedFill, opt.value),
      matchScore(fillValue, opt.textContent),
      matchScore(fillValue, opt.value)
    );
    if (score > best.score) best = { opt, score };
  }

  if (!best.opt) return false;
  // Avoid choosing a random option on weak matches.
  if (best.score < 60) return false;

  // Prefer setting by value.
  selectEl.value = best.opt.value;
  best.opt.selected = true;
  dispatchInputAndChange(selectEl);
  return true;
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

  const esc = (val) =>
    CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
  const scope = root || radioEl.form || document;
  const radios = Array.from(scope.querySelectorAll(`input[type="radio"][name="${esc(name)}"]`));
  if (!radios.length) return false;

  let best = { el: null, score: 0 };
  for (const r of radios) {
    const labelText = getRadioLabelText(r);
    const score = Math.max(matchScore(fillValue, r.value), matchScore(fillValue, labelText));
    if (score > best.score) best = { el: r, score };
  }

  if (!best.el) return false;
  if (best.score < 40) return false;

  if (!best.el.checked) {
    best.el.click();
    dispatchInputAndChange(best.el);
  }
  return true;
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

  // Pass 1: match on element attributes.
  let el = nodes.find((node) => {
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
      // Removed node.value: existing values shouldn't be used for field identification
      // as they cause false positives (e.g., matching filled-in race values to unrelated fields)
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

  if (bestMatch.el && bestMatch.score >= 65) return bestMatch.el;
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

  // Try once immediately (some pages render the form before our MutationObserver sees any changes).
  await tryAutofillNow({ force: false, reason: 'initial' });

  // Keep watching for multi-step flows (e.g., language pickers) that reveal the form later.
  const observer = new MutationObserver(() => {
    if (smartApplyMutationDebounce) clearTimeout(smartApplyMutationDebounce);
    smartApplyMutationDebounce = setTimeout(() => {
      tryAutofillNow({ force: false, reason: 'mutation' });
    }, 200);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

async function autofill(form) {
  console.log("SmartApply: Starting autofill.");
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();

  // Normalize: Full Name → First/Last if missing
  if (!res["First Name"] && res["Full Name"]) {
    const parts = res["Full Name"].trim().split(/\s+/);
    res["First Name"] = parts[0] || "";
    res["Last Name"] = parts[parts.length - 1] || "";
    if (parts.length > 2) {
      res["Middle Name"] = parts.slice(1, -1).join(" ");
    }
  }
  // Normalize: Email Address → Email
  if (!res["Email"] && res["Email Address"]) {
    res["Email"] = res["Email Address"];
  }
  // Normalize: Phone Number → Phone
  if (!res["Phone"] && res["Phone Number"]) {
    res["Phone"] = res["Phone Number"];
  }

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
    console.log("SmartApply: No specific config found, using generic.");
    await processFields('generic', fields.generic, form, res);
  }
}

async function processFields(jobForm, fieldMap, form, res) {
  for (let jobParam in fieldMap) {
    const param = fieldMap[jobParam];
    // Skip null mappings (e.g., cover_letter intentionally set to null)
    if (param === null || param === undefined) continue;
    if (param === "Resume") {
      // Basic Context Menu Logic
      let lastClickedElement = null;

      const getQuestionFromElement = (element) => {
        if (!element) return "";

        let question = element.getAttribute?.("aria-label") || element.getAttribute?.("placeholder") || "";
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

        return question;
      };

      document.addEventListener("contextmenu", (event) => {
        lastClickedElement = event.target;
        try {
          const question = getQuestionFromElement(lastClickedElement);
          if (question) {
            chrome.runtime.sendMessage({ action: 'STORE_LAST_QUESTION', question });
          }
        } catch (_) {}
      }, true);

      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "TRIGGER_AI_REPLY") {
          if (lastClickedElement) {
            generateAIAnswer(lastClickedElement);
          }
        }
      });

      async function generateAIAnswer(element) {
        // Show loading state (simple cursor)
        const originalCursor = element.style.cursor;
        element.style.cursor = "wait";

        try {
          // 1. Get Context (Label/Question)
          let question = getQuestionFromElement(element);

          // 2. Get User Data
          const fullSync = await getStorageDataSync();
          const apiKey = fullSync["API Key"];

          if (!apiKey) {
            alert("Please set your Gemini API Key in the Autofill Jobs extension settings.");
            element.style.cursor = originalCursor;
            return;
          }

          const localData = await getStorageDataLocal(["Resume", "LinkedIn PDF", "Resume_details"]);
          const resumeDetails = localData.Resume_details || {};
          const resumeBase64 = localData.Resume;
          const linkedinBase64 = localData["LinkedIn PDF"];

          // Format Text Context
          let context = "User Profile Context:\n";
          if (resumeDetails.experiences) {
            context += "Experience:\n" + JSON.stringify(resumeDetails.experiences) + "\n";
          }
          if (resumeDetails.skills) {
            context += "Skills: " + (Array.isArray(resumeDetails.skills) ? resumeDetails.skills.join(", ") : resumeDetails.skills) + "\n";
          }
          if (resumeDetails.certifications) {
            context += "Certifications:\n" + JSON.stringify(resumeDetails.certifications) + "\n";
          }

          context += `Full Sync Storage:\n${JSON.stringify(fullSync, null, 2)}\n`;

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

          // Construct Parts for Gemini
          const parts = [
            {
              text: `You are a helpful assistant applying for a job.
              ${context}

              ${sitePrompt ? `Site guidance: ${sitePrompt}` : ''}
              ${synonymHint ? `Synonym hint: ${synonymHint}` : ''}
              
              Task: Write a professional, concise answer to the following job application question. Use the first person. Do not include placeholders like [Your Name]. Just the answer.
              
              Question: ${question}`
            }
          ];

          if (resumeBase64) {
            parts.push({
              inline_data: {
                data: resumeBase64,
                mime_type: "application/pdf"
              }
            });
          }

          if (linkedinBase64) {
            parts.push({
              inline_data: {
                data: linkedinBase64,
                mime_type: "application/pdf"
              }
            });
          }

          // 3. Call Gemini
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts }]
              })
            }
          );

          const json = await response.json();
          if (json.error) {
            throw new Error(json.error.message || "Unknown API Error");
          }

          const candidate = json.candidates && json.candidates[0];
          if (candidate) {
            let answer = candidate.content.parts[0].text;
            // Insert Answer
            setNativeValue(element, answer);
          }

        } catch (error) {
          console.error("AI Generation Error", error);
          alert(`Failed to generate answer: ${error.message}`);
        } finally {
          element.style.cursor = originalCursor;
        }
      }
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
    if (!fillValue) continue;
    let inputElement = inputQuery(jobParam, form);
    if (!inputElement) continue;

    // Skip elements already filled by a previous pass
    if (_filledElements.has(inputElement)) continue;

    if (param === "Gender" || param === "Location (City)") useLongDelay = true;
    if (param === "Location (City)") fillValue = formatCityStateCountry(res, param);

    setNativeValue(inputElement, fillValue);

    // Textareas don't need select/radio/dropdown handling.
    if (inputElement instanceof HTMLTextAreaElement) {
      dispatchInputAndChange(inputElement);
      _filledElements.add(inputElement);
      continue;
    }

    // Native <select> and radio groups need special handling:
    // - setNativeValue may set select.value to the raw fillValue (which may not equal an option.value)
    // - radio groups need us to click the correct input in the group
    if (inputElement instanceof HTMLSelectElement) {
      // For country dropdowns, prefer Location (Country) over Location (City)
      let selectFillValue = fillValue;
      if (isCountryDropdown(inputElement) && res["Location (Country)"]) {
        selectFillValue = res["Location (Country)"];
      }
      // Try with EEO synonym normalization first, then raw value
      const normalizedValue = normalizeEeoValue(selectFillValue);
      const filled = setBestSelectOption(inputElement, normalizedValue) || setBestSelectOption(inputElement, selectFillValue);
      if (filled) _filledElements.add(inputElement);
      continue;
    }

    if (inputElement.type === "radio") {
      const normalizedValue = normalizeEeoValue(fillValue);
      const filled = clickBestRadioInGroup(inputElement, normalizedValue, form) || clickBestRadioInGroup(inputElement, fillValue, form);
      if (filled) _filledElements.add(inputElement);
      continue;
    }

    // Custom ARIA dropdowns: role="combobox" controlling a role="listbox" (Ashby/BambooHR/Greenhouse react-select)
    if (inputElement.getAttribute?.("role") === "combobox") {
      let listboxId =
        inputElement.getAttribute?.("aria-owns") ||
        inputElement.getAttribute?.("aria-controls");

      // Greenhouse react-select: derive listbox ID from input ID or aria-describedby
      if (!listboxId && inputElement.id) {
        listboxId = "react-select-" + inputElement.id + "-listbox";
      }
      if (!listboxId) {
        const describedBy = inputElement.getAttribute?.("aria-describedby") || "";
        const match = describedBy.match(/react-select-([^-]+(?:-[^-]+)*)-placeholder/);
        if (match) {
          listboxId = "react-select-" + match[1] + "-listbox";
        }
      }

      if (listboxId) {
        // Click to open the dropdown (react-select creates listbox on focus/click)
        try {
          inputElement.focus();
          inputElement.click();
        } catch (_) {}
        await sleep(delays.short);

        const listbox = document.getElementById(listboxId);
        if (listbox) {
          const options = Array.from(listbox.querySelectorAll('[role="option"]'));
          const normalizedFill = normalizeEeoValue(fillValue);
          let bestOpt = { el: null, score: 0 };
          for (const opt of options) {
            const score = Math.max(
              matchScore(normalizedFill, opt.textContent),
              matchScore(fillValue, opt.textContent)
            );
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
    }

    // Mark as filled for general text inputs
    _filledElements.add(inputElement);

    //for the dropdown elements
    let btn = inputElement.closest(".select__control--outside-label");
    if (!btn) continue;

    btn.dispatchEvent(mouseUpEvent);
    await sleep(useLongDelay ? delays.long : delays.short);
    btn.dispatchEvent(keyDownEvent);
    await sleep(delays.short);
  }
  // Removed: scrollToTop() was preventing users from reviewing/correcting filled fields
  console.log(`SmartApply: Complete in ${getTimeElapsed(initTime)}s.`);

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
            console.log("SmartApply: Job tracked in local history.");
          });

          if (syncEnabled) {
            let syncJobs = resSync.AppliedJobsSync || [];
            syncJobs.unshift(jobEntry);
            // Limit to 100 for sync storage constraints
            syncJobs = syncJobs.slice(0, 100);
            chrome.storage.sync.set({ AppliedJobsSync: syncJobs }, () => {
              console.log("SmartApply: Job tracked in cloud history.");
            });
          }
        }
      });
    });
  } catch (e) {
    console.error("SmartApply: Error tracking job", e);
  }

}


/*
  utils.js
  Utility variables / functions used by contentScripts/autofill.js (and workday.js).

  v2 regression fix:
  - Restore the original robust field mapping + filling helpers.
  - Keep the extension as MV3 content-script ES modules (export/import).
  - Add optional v2 improvements (shadow/iframe pierce hooks, highlight/scroll, randomFill helpers).
*/

/**
 * Fields per job board map to the stored params array in the extension.
 * Key = jobParam (substring we look for in input attributes/labels)
 * Value = stored profile key (human-readable label used in storage)
 */
const fields = {
  greenhouse: {
    first_name: "First Name",
    middle_name: "Middle Name",
    last_name: "Last Name",
    "Preferred Name": "Full Name",
    email: "Email",
    phone: "Phone",
    cover_letter: "Resume",
    "cover letter": "Resume",
    LinkedIn: "LinkedIn",
    Github: "Github",
    Twitter: "Twitter",
    X: "Twitter",
    "candidate-location": "Location (City)",
    Website: "Personal Website",
    Portfolio: "Personal Website",
    LeetCode: "LeetCode",
    Medium: "Medium",
    Blog: "Medium",
    Employer: "Current Employer",
    "Current Company": "Current Employer",
    resume: "Resume",
    school: "School",
    degree: "Degree",
    discipline: "Discipline",
    "start-month": "Start Date Month",
    "start-year": "Start Date Year",
    "end-month": "End Date Month",
    "end-year": "End Date Year",
    gender: "Gender",
    hispanic_ethnicity: "Hispanic/Latino",
    race: "Race",
    "react-select-race-placeholder race-error": "Race",
    veteran_status: "Veteran Status",
    disability: "Disability Status",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    "address line": "Location (Street)",
    street: "Location (Street)",
    skills: "Skills",
  },
  lever: {
    resume: "Resume",
    name: "Full Name",
    email: "Email",
    phone: "Phone",
    location: "Location (City)",
    org: "Current Employer",
    company: "Current Employer",
    employer: "Current Employer",
    "urls[LinkedIn]": "LinkedIn",
    "urls[GitHub]": "Github",
    "urls[Linkedin]": "LinkedIn",
    "urls[LeetCode]": "LeetCode",
    "urls[Medium]": "Medium",
    "urls[X]": "Other URL",
    "urls[Twitter]": "Other URL",
    "urls[Portfolio]": "Personal Website",
    "urls[Link to portfolio]": "Personal Website",
    website: "Personal Website",
    portfolio: "Personal Website",
    "eeo[gender]": "Gender",
    "eeo[race]": "Race",
    "eeo[veteran]": "Veteran Status",
    "eeo[disability]": "Disability Status",
    "eeo[disabilitySignature]": "Full Name",
    "eeo[disabilitySignatureDate]": "Current Date",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    "address line": "Location (Street)",
    street: "Location (Street)",
    skills: "Skills",
  },
  dover: {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    linkedinUrl: "LinkedIn",
    github: "Github",
    phoneNumber: "Phone",
    resume: "Resume",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    "address line": "Location (Street)",
    street: "Location (Street)",
    skills: "Skills",
  },
  workday: {
    "My Information": {
      country: "Location (Country)",
      firstName: "First Name",
      lastName: "Last Name",
      addressLine1: "Location (Street)",
      addressSection_countryRegion: "Location (State/Region)",
      city: "Location (City)",
      postal: "Postal/Zip Code",
      "phone-device-type": "Phone Type",
      phoneType: "Phone Type",
      deviceType: "Phone Type",
      "phone-number": "Phone",
      phoneNumber: "Phone",
    },
    "My Experience": {
      "add-button": "Work Experience",
      schoolName: "School",
      degree: "Degree",
      fieldOfStudy: "Discipline",
      gradeAverage: "GPA",
      selectedItemList: "Skills",
      "file-upload-input-ref": "Resume",
      linkedin: "LinkedIn",
      "years of experience": "Years of Experience",
      "experience years": "Years of Experience",
      "total experience": "Years of Experience",
      "relevant experience": "Years of Experience",
    },
    "Application Questions": {
      authorized: "Legally Authorized to Work",
      sponsorship: "Requires Sponsorship",
      notice: "Job Notice Period",
      salary: "Expected Salary",
      language: "Languages",
    },
    "Voluntary Disclosures": {
      ethnicity: "Race",
      race: "Race",
      gender: "Gender",
      veteran: "Veteran Status",
      disability: "Disability Status",
    },
    "Self Identify": {
      name: "Full Name",
      "month-input": "Current Date",
      "day-input": "Current Date",
      "year-input": "Current Date",
    },
  },
  oracle: {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    address: "Location (Street)",
    city: "Location (City)",
    zip: "Postal/Zip Code",
    country: "Location (Country)",
    resume: "Resume",
    cv: "Resume",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    skills: "Skills",
  },
  recruitee: {
    "candidate[name]": "Full Name",
    "candidate[email]": "Email",
    "candidate[phone]": "Phone",
    "candidate[cv]": "Resume",
    "candidate[cover_letter]": "Resume",
    name: "Full Name",
    email: "Email",
    phone: "Phone",
    cv: "Resume",
    cover_letter: "Resume",
    resume: "Resume",
    github: "Github",
    linkedin: "LinkedIn",
    portfolio: "Personal Website",
    website: "Personal Website",
    city: "Location (City)",
    "address line": "Location (Street)",
    street: "Location (Street)",
    zip: "Postal/Zip Code",
    language: "Languages",
    salary: "Expected Salary",
    notice: "Job Notice Period",
  },
  successfactors: {
    firstName: "First Name",
    lastName: "Last Name",
    cellPhone: "Phone",
    contactEmail: "Email",
    "address line": "Location (Street)",
    street: "Location (Street)",
    city: "Location (City)",
    zip: "Postal/Zip Code",
    country: "Location (Country)",
    state: "Location (State/Region)",
    resume: "Resume",
    coverLetter: "Resume",
    cv: "Resume",
    jobTitle: "Job Title",
    company: "Current Employer",
    school: "School",
    major: "Discipline",
    degree: "Degree",
    "start date": "Start Date Month",
    "end date": "End Date Month",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    "years of experience": "Years of Experience",
    skills: "Skills",
  },
  generic: {
    "first name": "First Name",
    "middle name": "Middle Name",
    "last name": "Last Name",
    "full name": "Full Name",
    email: "Email",
    phone: "Phone",
    linkedin: "LinkedIn",
    github: "Github",
    leetcode: "LeetCode",
    medium: "Medium",
    portfolio: "Personal Website",
    website: "Personal Website",
    blog: "Medium",
    other: "Other URL",
    resume: "Resume",
    cv: "Resume",
    "cover letter": null,
    generic_address_street: "Location (Street)",
    "street address": "Location (Street)",
    "address line": "Location (Street)",
    address1: "Location (Street)",
    city: "Location (City)",
    zip: "Postal/Zip Code",
    country: "Location (Country)",
    employer: "Current Employer",
    university: "School",
    school: "School",
    degree: "Degree",
    major: "Discipline",
    discipline: "Discipline",
    gpa: "GPA",
    "job title": "Job Title",
    company: "Current Employer",
    "start date": "Date Available",
    "end date": "End Date Month",
    authorized: "Legally Authorized to Work",
    sponsorship: "Requires Sponsorship",
    notice: "Job Notice Period",
    salary: "Expected Salary",
    language: "Languages",
    "years of experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    "phone type": "Phone Type",
    skills: "Skills",
    certification: "Certification Name",
    "certification name": "Certification Name",
    "issuing organization": "Issuing Organization",
    issuer: "Issuing Organization",
    "issue date": "Issue Date Month",
    "expiration date": "Expiration Date Month",
    "credential id": "Credential ID",
    "credential url": "Credential URL",
    "license number": "Credential ID",
    pronouns: "Pronouns",
    relocate: "Willing to Relocate",
    relocation: "Willing to Relocate",
    available: "Date Available",
    availability: "Date Available",
    security: "Security Clearance",
    clearance: "Security Clearance",
  },
};

const keyDownEvent = new KeyboardEvent("keydown", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  which: 13,
  bubbles: true,
});
const keyUpEvent = new KeyboardEvent("keyup", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  which: 13,
  bubbles: true,
});
const mouseUpEvent = new MouseEvent("mouseup", {
  bubbles: true,
  cancelable: true,
});
const changeEvent = new Event("change", { bubbles: true });
const inputEvent = new Event("input", { bubbles: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function curDateStr() {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())}`;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < binaryString.length; i++) {
    view[i] = binaryString.charCodeAt(i);
  }
  return arrayBuffer;
}

function monthToNumber(month) {
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const normalizedMonth = String(month ?? "").toLowerCase().trim();
  return months[normalizedMonth] || null;
}

function getTimeElapsed(startTime) {
  const cur = Date.now();
  return ((cur - startTime) / 1000).toFixed(3);
}

const getStorageDataLocal = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) chrome.storage.local.get(null, resolve);
    else chrome.storage.local.get(key, resolve);
  });
};

const getStorageDataSync = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) chrome.storage.sync.get(null, resolve);
    else chrome.storage.sync.get(key, resolve);
  });
};

async function getStorageValue(area, key, defaultValue) {
  const store = area === "local" ? chrome.storage.local : chrome.storage.sync;
  return new Promise((resolve) => {
    store.get([key], (result) => resolve(result?.[key] ?? defaultValue));
  });
}

function setNativeValue(el, value) {
  if (!el) return;

  // Checkboxes/radios: click when needed.
  if (el.type === "checkbox" || el.type === "radio") {
    const valLower = String(value).toLowerCase();
    let shouldCheck = !!value;

    if (["no", "false", "0"].includes(valLower)) shouldCheck = false;
    else if (["yes", "true", "1"].includes(valLower)) shouldCheck = true;

    if (
      (shouldCheck && !el.checked) ||
      (!shouldCheck && el.checked && el.type === "checkbox")
    ) {
      el.click();
    }
    return;
  }

  // Selects: try to match by option text/value substring.
  if (el instanceof HTMLSelectElement) {
    const valLower = String(value).toLowerCase();
    const yesSyn = ["yes", "true", "1"];
    const noSyn = ["no", "false", "0"];

    for (const o of Array.from(el.options)) {
      const optVal = String(o.value ?? "").toLowerCase();
      const optText = String(o.textContent ?? "").toLowerCase();

      if (optVal.includes(valLower) || optText.includes(valLower)) {
        el.value = o.value;
        el.dispatchEvent(changeEvent);
        return;
      }

      if (
        yesSyn.includes(valLower) &&
        (yesSyn.includes(optVal) || yesSyn.includes(optText))
      ) {
        el.value = o.value;
        el.dispatchEvent(changeEvent);
        return;
      }
      if (
        noSyn.includes(valLower) &&
        (noSyn.includes(optVal) || noSyn.includes(optText))
      ) {
        el.value = o.value;
        el.dispatchEvent(changeEvent);
        return;
      }
    }

    // Fallback: set direct.
    el.value = value;
    el.dispatchEvent(changeEvent);
    return;
  }

  // Text-like inputs/textareas (React-safe).
  const previousValue = el.value;
  try {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  } catch {
    el.value = value;
  }

  // React 16+ value tracker.
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue(previousValue);

  el.setAttribute("value", value);
  el.dispatchEvent(inputEvent);
  el.dispatchEvent(changeEvent);
}

const delays = {
  initial: 1000,
  short: 200,
  long: 600,
};

function highlightElement(el, ms = 900) {
  if (!el || !el.style) return;
  const prevOutline = el.style.outline;
  const prevOutlineOffset = el.style.outlineOffset;
  const prevTransition = el.style.transition;

  el.style.transition = "outline 120ms ease";
  el.style.outline = "3px solid rgba(34, 197, 94, 0.95)";
  el.style.outlineOffset = "2px";

  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOutlineOffset;
    el.style.transition = prevTransition;
  }, ms);
}

function safeScrollIntoView(el) {
  try {
    el?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
  } catch {
    // ignore
  }
}

/**
 * Shadow DOM + same-origin iframe query helper.
 * Returns a *flat* array of matches across document, shadow roots, and same-origin iframes.
 */
function querySelectorAllDeep(selector, root = document) {
  const results = [];
  const queue = [root];
  const seen = new Set();

  while (queue.length) {
    const curRoot = queue.shift();
    if (!curRoot || seen.has(curRoot)) continue;
    seen.add(curRoot);

    // Collect matches
    try {
      if (curRoot.querySelectorAll) {
        results.push(...curRoot.querySelectorAll(selector));
      }
    } catch {
      // invalid selector or non-queryable root
    }

    // Walk descendants to find shadow roots + iframes
    let elements = [];
    try {
      if (curRoot.querySelectorAll) elements = Array.from(curRoot.querySelectorAll("*"));
    } catch {
      elements = [];
    }

    for (const el of elements) {
      if (el?.shadowRoot) queue.push(el.shadowRoot);
      if (el?.tagName === "IFRAME") {
        try {
          const doc = el.contentDocument;
          if (doc) queue.push(doc);
        } catch {
          // cross-origin
        }
      }
    }
  }

  return results;
}

function isControlFilled(el) {
  if (!el) return false;
  if (el.type === "checkbox" || el.type === "radio") return !!el.checked;
  if (el instanceof HTMLSelectElement) return !!el.value;
  return String(el.value ?? "").trim().length > 0;
}

async function randomFill(el, { onlyIfRequired = true } = {}) {
  if (!el) return false;

  const enabled = await getStorageValue("sync", "randomFillEnabled", true);
  if (!enabled) return false;

  const required =
    !!el.required ||
    el.getAttribute("aria-required") === "true" ||
    el.getAttribute("required") === "true";
  if (onlyIfRequired && !required) return false;

  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options).filter(
      (o) => o && String(o.value ?? "").trim() !== ""
    );
    if (!options.length) return false;
    const pick = options[Math.floor(Math.random() * options.length)];
    el.value = pick.value;
    el.dispatchEvent(changeEvent);
    return true;
  }

  if (el.type === "radio") {
    const name = el.name;
    if (!name) return false;
    const radios = querySelectorAllDeep(`input[type="radio"][name="${CSS.escape(name)}"]`);
    if (!radios.length) return false;
    radios[Math.floor(Math.random() * radios.length)].click();
    return true;
  }

  if (el.type === "checkbox") {
    el.click();
    return true;
  }

  // Text/textarea: keep conservative (only fill if explicitly enabled).
  const fillText = await getStorageValue("sync", "randomFillTextEnabled", false);
  if (!fillText) return false;

  const fillers = ["N/A", "Yes", "No", "Other"]; // intentionally short
  const val = fillers[Math.floor(Math.random() * fillers.length)];
  setNativeValue(el, val);
  return true;
}

export {
  fields,
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
  getStorageValue,
  setNativeValue,
  highlightElement,
  safeScrollIntoView,
  querySelectorAllDeep,
  isControlFilled,
  randomFill,
};

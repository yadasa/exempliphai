/*
    Utility variables / functions used by autofill.
*/

/**
 Fields per job board map to the stored params array in the extension
 */
const fields = {
  greenhouse: {
    first_name: "First Name",
    middle_name: "Middle Name",
    last_name: "Last Name",
    "Preferred Name": "Full Name",
    email: "Email",
    phone: "Phone",
    // NOTE: cover_letter intentionally omitted — do NOT upload resume to cover letter
    LinkedIn: "LinkedIn",
    Github: "Github",
    Twitter: "Twitter",
    X: "Twitter",
    "candidate-location": "Location (City)",
    Website: "Personal Website",
    Portfolio: "Personal Website",
    "LeetCode": "LeetCode",
    "Medium": "Medium",
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
    disability_status: "Disability Status",
    disability: "Disability Status",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    "authorized": "Legally Authorized to Work",
    "sponsorship": "Requires Sponsorship",
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "base salary expectations": "Expected Salary",
    "salary expectations": "Expected Salary",
    "desired salary": "Expected Salary",
    "compensation expectations": "Expected Salary",
    "annual gross salary": "Expected Salary",
    "language": "Languages",
    "address line": "Location (Street)",
    "street": "Location (Street)",
    "skills": "Skills",
    "gender identify": "Gender",
    "gender identity": "Gender",
    "what gender": "Gender",
    "age range": "Age Range",
    "how many years of experience": "Years of Experience"
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
    "candidate-location": "Location (Country)",
    "base salary expectations": "Expected Salary",
    "salary expectations": "Expected Salary",
    "desired salary": "Expected Salary",
    "compensation expectations": "Expected Salary",
    "expected compensation": "Expected Salary",
    "expected salary": "Expected Salary",
    "base salary": "Expected Salary",
    "salary requirement": "Expected Salary",
    "what gender do you identify as": "Gender",
    "gender identity": "Gender",
    "gender identify": "Gender",
    "what gender": "Gender",
    "years of experience": "Years of Experience",
    "experience years": "Years of Experience",
    "total experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    "authorized": "Legally Authorized to Work",
    "sponsorship": "Requires Sponsorship",
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "language": "Languages",
    "address line": "Location (Street)",
    "street": "Location (Street)",
    "skills": "Skills"
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
    "authorized": "Legally Authorized to Work",
    "sponsorship": "Requires Sponsorship",
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "language": "Languages",
    "address line": "Location (Street)",
    "street": "Location (Street)",
    "skills": "Skills"
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
      "relevant experience": "Years of Experience"
    },
    "Application Questions": {
      "authorized": "Legally Authorized to Work",
      "sponsorship": "Requires Sponsorship",
      "notice": "Job Notice Period",
      "salary": "Expected Salary",
      "language": "Languages"
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
    "authorized": "Legally Authorized to Work",
    "sponsorship": "Requires Sponsorship",
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "language": "Languages",
    "skills": "Skills"
  },
  recruitee: {
    "candidate[name]": "Full Name",
    "candidate[email]": "Email",
    "candidate[phone]": "Phone",
    "candidate[cv]": "Resume",
    "candidate[cover_letter]": "Resume",
    "name": "Full Name",
    "email": "Email",
    "phone": "Phone",
    "cv": "Resume",
    "cover_letter": "Resume",
    "resume": "Resume",
    "github": "Github",
    "linkedin": "LinkedIn",
    "portfolio": "Personal Website",
    "website": "Personal Website",
    "city": "Location (City)",
    "address line": "Location (Street)",
    "street": "Location (Street)",
    "zip": "Postal/Zip Code",
    "language": "Languages",
    "salary": "Expected Salary",
    "notice": "Job Notice Period"
  },
  successfactors: {
    "firstName": "First Name",
    "lastName": "Last Name",
    "cellPhone": "Phone",
    "contactEmail": "Email",
    "address line": "Location (Street)",
    "street": "Location (Street)",
    "city": "Location (City)",
    "zip": "Postal/Zip Code",
    "country": "Location (Country)",
    "state": "Location (State/Region)",
    "resume": "Resume",
    "coverLetter": "Resume",
    "cv": "Resume",
    "jobTitle": "Job Title",
    "company": "Current Employer",
    "school": "School",
    "major": "Discipline",
    "degree": "Degree",
    "start date": "Start Date Month",
    "end date": "End Date Month",
    "authorized": "Legally Authorized to Work",
    "sponsorship": "Requires Sponsorship",
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "language": "Languages",
    "years of experience": "Years of Experience",
    "skills": "Skills"
  },
  generic: {
    "first name": "First Name",
    "middle name": "Middle Name",
    "last name": "Last Name",
    "full name": "Full Name",
    "email": "Email",
    "phone": "Phone",

    // Social / URLs
    "linkedin": "LinkedIn",
    "github": "Github",
    "leetcode": "LeetCode",
    "medium": "Medium",
    "blog": "Medium", // Heuristic: often blog == medium for devs
    "portfolio": "Personal Website",
    "website": "Personal Website",
    "other": "Other URL",

    // Documents
    "resume": "Resume",
    "cv": "Resume",
    "cover letter": null, // Intentionally null / generic

    // Address / location
    "generic_address_street": "Location (Street)", // Renamed to avoid partial match with "email address"
    "street address": "Location (Street)",
    "address line": "Location (Street)",
    "address1": "Location (Street)",

    "city state": "Location (City)",
    "location city": "Location (City)",
    "your location": "Location (City)",
    "current location": "Location (City)",
    "where are you located": "Location (City)",
    "location": "Location (City)",
    "city": "Location (City)",

    "state region": "Location (State/Region)",
    "state": "Location (State/Region)",
    "region": "Location (State/Region)",
    "province": "Location (State/Region)",

    "zip": "Postal/Zip Code",
    "country": "Location (Country)",

    // Employment / education
    "employer": "Current Employer",
    "company": "Current Employer",
    "job title": "Job Title", // Might correspond to a specific input if tracked
    "university": "School",
    "school": "School",
    "degree": "Degree",
    "major": "Discipline",
    "discipline": "Discipline",
    "gpa": "GPA",

    // Dates
    "start date": "Start Date Month", // Heuristic mapping, might need refinement
    "end date": "End Date Month",

    // Work Authorization (expanded variants)
    "work authorization status": "Legally Authorized to Work",
    "legally authorized": "Legally Authorized to Work",
    "work authorization": "Legally Authorized to Work",
    "authorized to work": "Legally Authorized to Work",
    "legal right to work": "Legally Authorized to Work",
    "eligible to work": "Legally Authorized to Work",
    "right to work": "Legally Authorized to Work",
    "authorized": "Legally Authorized to Work",

    // Visa / Sponsorship (expanded variants)
    "visa sponsorship": "Requires Sponsorship",
    "require sponsorship": "Requires Sponsorship",
    "requires sponsorship": "Requires Sponsorship",
    "require visa": "Requires Sponsorship",
    "immigration sponsorship": "Requires Sponsorship",
    "work visa": "Requires Sponsorship",
    "employment visa": "Requires Sponsorship",
    "future sponsorship": "Requires Sponsorship",
    "sponsorship": "Requires Sponsorship",

    // Veteran Status (generic)
    "protected veteran": "Veteran Status",
    "veteran status": "Veteran Status",
    "military service": "Veteran Status",
    "armed forces": "Veteran Status",
    "military": "Veteran Status",
    "veteran": "Veteran Status",

    // Disability (generic)
    "disability status": "Disability Status",
    "disability": "Disability Status",
    "disabled": "Disability Status",

    // Race/Ethnicity (generic)
    "hispanic/latino": "Hispanic/Latino",
    "hispanic": "Hispanic/Latino",
    "latino": "Hispanic/Latino",
    "latina": "Hispanic/Latino",

    "ethnicity": "Race",
    "ethnic": "Race",
    "race": "Race",

    // Gender (generic)
    "gender": "Gender",
    "sex": "Gender",

    // Other common fields
    "notice": "Job Notice Period",
    "salary": "Expected Salary",
    "expected salary": "Expected Salary",
    "salary expectations": "Expected Salary",
    "base salary": "Expected Salary",
    "salary expectation": "Expected Salary",
    "compensation": "Expected Salary",
    "desired salary": "Expected Salary",
    "salary requirement": "Expected Salary",
    "language": "Languages",
    "years of experience": "Years of Experience",
    "relevant experience": "Years of Experience",
    "veteran status": "Veteran Status",
    "veteran": "Veteran Status",
    "protected veteran": "Veteran Status",
    "military": "Veteran Status",
    "phone type": "Phone Type",
    "skills": "Skills",
    "pronouns": "Pronouns",
    "gender identify": "Gender",
    "what gender": "Gender",
    "relocate": "Willing to Relocate",
    "relocation": "Willing to Relocate",
    "available": "Date Available",
    "availability": "Date Available",
    "date available": "Date Available",
    "security": "Security Clearance",
    "clearance": "Security Clearance",

    // Certifications
    "certification name": "Certification Name",
    "certification": "Certification Name",
    "issuing organization": "Issuing Organization",
    "issuer": "Issuing Organization",
    "issue date": "Issue Date Month", // Heuristic
    "expiration date": "Expiration Date Month", // Heuristic
    "credential id": "Credential ID",
    "credential url": "Credential URL",
    "license number": "Credential ID"
  }
};

const keyDownEvent = typeof KeyboardEvent !== "undefined"
  ? new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
    })
  : null;
const keyUpEvent = typeof KeyboardEvent !== "undefined"
  ? new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
    })
  : null;
const mouseUpEvent = typeof MouseEvent !== "undefined"
  ? new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
    })
  : null;
const changeEvent = typeof Event !== "undefined" ? new Event("change", { bubbles: true }) : null;
const inputEvent = typeof Event !== "undefined" ? new Event("input", { bubbles: true }) : null;

// ─────────────────────────────────────────────────────────────────────────────
// Fresh key event factories (React-Select / keyboard-driven widgets)
//
// NOTE: Re-using the same Event object across multiple dispatches is unreliable
// across browsers.  Prefer creating a new KeyboardEvent per dispatch.
// ─────────────────────────────────────────────────────────────────────────────

function _makeKeyEvent(type, init) {
  try {
    if (typeof KeyboardEvent === "undefined") return null;
    return new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
  } catch (_) {
    return null;
  }
}

function createShiftEnterKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    shiftKey: true,
  });
}

function createShiftEnterKeyUp() {
  return _makeKeyEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    shiftKey: true,
  });
}

function createArrowRightKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "ArrowRight",
    code: "ArrowRight",
    keyCode: 39,
    which: 39,
  });
}

function createArrowRightKeyUp() {
  return _makeKeyEvent("keyup", {
    key: "ArrowRight",
    code: "ArrowRight",
    keyCode: 39,
    which: 39,
  });
}

function createArrowDownKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "ArrowDown",
    code: "ArrowDown",
    keyCode: 40,
    which: 40,
  });
}

function createArrowUpKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "ArrowUp",
    code: "ArrowUp",
    keyCode: 38,
    which: 38,
  });
}

function createEnterKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
  });
}

function createEnterKeyUp() {
  return _makeKeyEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
  });
}

function createEscapeKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
  });
}

function createTabKeyDown() {
  return _makeKeyEvent("keydown", {
    key: "Tab",
    code: "Tab",
    keyCode: 9,
    which: 9,
  });
}

function createTabKeyUp() {
  return _makeKeyEvent("keyup", {
    key: "Tab",
    code: "Tab",
    keyCode: 9,
    which: 9,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 
Get current date as string in day/month/year format.
*/
function curDateStr() {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())}`;
}
/**
Scroll to top of window. 
*/
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "instant" });
}
/**
 Turns base64 string (w/o prefix) to array buffer.
*/
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);

  // Create a new ArrayBuffer and copy the binary string into it
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const view = new Uint8Array(arrayBuffer);

  // Convert binary string to an array of bytes
  for (let i = 0; i < binaryString.length; i++) {
    view[i] = binaryString.charCodeAt(i);
  }

  return arrayBuffer;
}
/**
 Turns month string into corresponding integer (ex: december -> 12).
 */
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
  const normalizedMonth = month.toLowerCase().trim();
  return months[normalizedMonth] || null;
}
/**
 Debug function to show runtime.
 */
function getTimeElapsed(startTime) {
  let cur = new Date().getTime();
  return ((cur - startTime) / 1000).toFixed(3);
}
/**
 Data retreival for chrome local storage.
 */
const getStorageDataLocal = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) {
      // If no key is passed, fetch all data
      chrome.storage.local.get(null, resolve);
    } else {
      // If a key is passed, fetch only the value for that key
      chrome.storage.local.get(key, resolve);
    }
  });
};
/**
 Data retreival for chrome sync storage.
 */
const getStorageDataSync = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) {
      // If no key is passed, fetch all data
      chrome.storage.sync.get(null, resolve);
    } else {
      // If a key is passed, fetch only the value for that key
      chrome.storage.sync.get(key, resolve);
    }
  });
};
function setNativeValue(el, value) {
  if (!el) return;

  const isCheckboxOrRadio = el.type === "checkbox" || el.type === "radio";
  const isSelect = el instanceof HTMLSelectElement;
  const isTextarea = el instanceof HTMLTextAreaElement;

  // React's internal value tracker needs the *previous* value/checked state.
  const tracker = el._valueTracker;
  const previousValue = isCheckboxOrRadio ? el.checked : el.value;

  if (isCheckboxOrRadio) {
    const valLower = String(value).toLowerCase();
    let shouldCheck = !!value; // Default truthy check

    // Explicitly handle "no", "false", "0" as false
    if (["no", "false", "0"].includes(valLower)) {
      shouldCheck = false;
    }
    // Explicitly handle "yes", "true", "1" as true
    else if (["yes", "true", "1"].includes(valLower)) {
      shouldCheck = true;
    }

    // Only click if the state needs changing.
    // For radios, we typically only click to SET to true.
    // We avoid clicking if we intend to set to false (unchecking a radio by clicking it usually does nothing or re-checks it).
    if (
      (shouldCheck && !el.checked) ||
      (!shouldCheck && el.checked && el.type === "checkbox")
    ) {
      el.click();
    }
  } else if (isSelect) {
    const valLower = String(value).toLowerCase();
    const yesSynonyms = ["yes", "true", "1"];
    const noSynonyms = ["no", "false", "0"];

    for (let o of el.children) {
      const optVal = (o.value || "").toLowerCase();
      const optText = (o.textContent || "").toLowerCase();

      // Check 1: Direct inclusion (e.g. "United States" in "United States of America")
      if (optVal.includes(valLower) || optText.includes(valLower)) {
        el.value = o.value;
        break;
      }

      // Check 2: Boolean Synonym Matching
      if (
        yesSynonyms.includes(valLower) &&
        (yesSynonyms.includes(optVal) || yesSynonyms.includes(optText))
      ) {
        el.value = o.value;
        break;
      }
      if (
        noSynonyms.includes(valLower) &&
        (noSynonyms.includes(optVal) || noSynonyms.includes(optText))
      ) {
        el.value = o.value;
        break;
      }
    }
  } else {
    const nextValue = value ?? "";

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement?.prototype,
      "value"
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement?.prototype,
      "value"
    )?.set;

    const setter = isTextarea ? nativeTextareaValueSetter : nativeInputValueSetter;

    if (setter) {
      setter.call(el, nextValue);
    } else {
      el.value = nextValue;
    }
  }

  // Ensure React detects the change (critical for React 16+ forms)
  if (tracker) {
    try {
      tracker.setValue(previousValue);
    } catch (_) {}
  }

  // Keep attribute in sync for text-like inputs/selects
  if (!isCheckboxOrRadio) {
    try {
      el.setAttribute("value", value);
    } catch (_) {}
  }

  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (_) {}
  try {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (_) {}
}
const delays = {
  initial: 1000,
  short: 200,
  medium: 400,
  long: 600,
};

/**
 * Create an InputEvent when available; fallback to a plain Event.
 * (Node does not implement InputEvent, so tests use the fallback.)
 */
function makeInputLikeEvent(type, init = {}, el = null) {
  const bubbles = init.bubbles ?? true;
  const cancelable = init.cancelable ?? type === "beforeinput";

  // Use the element's realm when possible (important for DOM polyfills like linkedom).
  const view = el?.ownerDocument?.defaultView || globalThis;

  try {
    const InputEventCtor = view?.InputEvent;
    if (InputEventCtor) {
      return new InputEventCtor(type, { ...init, bubbles, cancelable });
    }
  } catch (_) {}

  try {
    const EventCtor = view?.Event;
    if (EventCtor) {
      return new EventCtor(type, { bubbles, cancelable });
    }
  } catch (_) {}

  try {
    return new Event(type, { bubbles, cancelable });
  } catch (_) {
    return { type };
  }
}

/**
 * Set value for contenteditable / rich editor roots.
 *
 * Best-effort: tries execCommand('insertText') then falls back to textContent/innerHTML.
 * Always dispatches beforeinput + input + change (when possible).
 */
function setContentEditableValue(el, value, opts = {}) {
  if (!el) return false;

  const nextValue = value ?? "";
  const preferExecCommand = opts.preferExecCommand ?? true;
  const useInnerHTML = opts.useInnerHTML ?? false;

  const isCE =
    !!el.isContentEditable ||
    String(el.getAttribute?.("contenteditable") || "").toLowerCase() === "true" ||
    (el.getAttribute?.("role") === "textbox" && el.getAttribute?.("aria-multiline") === "true");

  if (!isCE) return false;

  try {
    el.focus?.();
  } catch (_) {}

  try {
    el.dispatchEvent(
      makeInputLikeEvent(
        "beforeinput",
        {
          inputType: "insertText",
          data: String(nextValue),
        },
        el
      )
    );
  } catch (_) {}

  let wrote = false;

  if (preferExecCommand) {
    try {
      const doc = el.ownerDocument;
      if (doc?.execCommand) {
        try {
          const sel = doc.getSelection?.();
          const range = doc.createRange?.();
          if (sel && range) {
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (_) {}

        doc.execCommand("insertText", false, String(nextValue));
        wrote = true;
      }
    } catch (_) {}
  }

  if (!wrote) {
    try {
      if (useInnerHTML) {
        el.innerHTML = String(nextValue);
      } else {
        el.textContent = String(nextValue);
      }
      wrote = true;
    } catch (_) {}
  }

  try {
    el.dispatchEvent(
      makeInputLikeEvent(
        "input",
        {
          inputType: "insertText",
          data: String(nextValue),
        },
        el
      )
    );
  } catch (_) {}

  try {
    const view = el?.ownerDocument?.defaultView || globalThis;
    const EventCtor = view?.Event || Event;
    el.dispatchEvent(new EventCtor("change", { bubbles: true }));
  } catch (_) {}

  return wrote;
}

function pad2(n) {
  const s = String(n);
  return s.length === 1 ? "0" + s : s;
}

/**
 * Split a date-like input into { year, month, day } (all zero-padded strings).
 * Supports:
 * - YYYY-MM-DD
 * - DD/MM/YYYY and MM/DD/YYYY (order configurable)
 * - Month name formats (e.g., "March 9, 2026", "9 March 2026")
 */
function splitDateParts(dateLike, options = {}) {
  const order = String(options.order || "DMY").toUpperCase(); // DMY | MDY

  if (dateLike instanceof Date && !Number.isNaN(dateLike.getTime?.())) {
    return {
      year: String(dateLike.getFullYear()),
      month: pad2(dateLike.getMonth() + 1),
      day: pad2(dateLike.getDate()),
    };
  }

  const raw = String(dateLike || "").trim();
  if (!raw) return null;

  // ISO
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: m[1], month: m[2], day: m[3] };

  // Numeric with separators
  m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    let y = m[3];
    if (y.length === 2) y = "20" + y;

    let day, month;
    // Heuristics if ambiguous
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (order === "MDY") {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }

    return { year: String(y), month: pad2(month), day: pad2(day) };
  }

  // Month name formats
  m = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})$/i);
  if (m) {
    const monthNum = monthToNumber(m[1]);
    if (!monthNum) return null;
    return { year: m[3], month: pad2(monthNum), day: pad2(parseInt(m[2], 10)) };
  }

  m = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (m) {
    const monthNum = monthToNumber(m[2]);
    if (!monthNum) return null;
    return { year: m[3], month: pad2(monthNum), day: pad2(parseInt(m[1], 10)) };
  }

  return null;
}

/**
 * Parse a date-like input into ISO YYYY-MM-DD (local date, not UTC-shifted).
 */
function parseToISODate(dateLike, options = {}) {
  const parts = splitDateParts(dateLike, options);
  if (!parts) return null;

  const y = parseInt(parts.year, 10);
  const m = parseInt(parts.month, 10);
  const d = parseInt(parts.day, 10);

  if (!y || y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  // Validate that it is a real date
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return null;

  return String(y).padStart(4, "0") + "-" + pad2(m) + "-" + pad2(d);
}

/**
 * Format a date-like input into the value string expected by <input type="date">.
 */
function formatForNativeDateInput(dateLike, options = {}) {
  return parseToISODate(dateLike, options) || "";
}

/**
 * Widget adapter abstraction (stub)
 */
const widgetAdapters = [
  {
    id: "react-select",
    matches(el) {
      try {
        if (!el || el.getAttribute?.("role") !== "combobox") return false;
        const describedBy = String(el.getAttribute?.("aria-describedby") || "");
        if (describedBy.includes("react-select")) return true;
        if (String(el.id || "").startsWith("react-select")) return true;
        // Greenhouse v2 wraps react-select in .select-shell/.select__container
        if (el.closest?.(".select-shell, .select__container, [class*=\"select__\"]")) return true;
        // Greenhouse pattern: combobox input whose aria-describedby references
        // a react-select placeholder (e.g. "react-select-question_XXX-placeholder")
        if (/react-select/.test(describedBy)) return true;
        // Greenhouse pattern: parent has remix-css-* classes (React-Select with CSS-in-JS)
        const parent = el.parentElement;
        if (parent) {
          const cls = String(parent.className || "");
          if (cls.includes("select__input-container") || cls.includes("remix-css-")) return true;
        }
      } catch (_) {}
      return false;
    },
    async setValue(_el, _value, _ctx = {}) {
      // Implementation in autofill.js (React-Select combobox handler)
      return false;
    },
  },
  {
    id: "aria-combobox",
    matches(el) {
      try {
        if (!el || el.getAttribute?.("role") !== "combobox") return false;
        const lbId = el.getAttribute?.("aria-controls") || el.getAttribute?.("aria-owns");
        if (!lbId) return false;
        return true;
      } catch (_) {}
      return false;
    },
    async setValue(_el, _value, _ctx = {}) {
      // TODO: implement (open + listbox option click)
      return false;
    },
  },
  {
    id: "mui",
    matches(el) {
      try {
        if (!el) return false;
        const cls = String(el.className || "");
        if (cls.includes("Mui")) return true;
        if (el.closest?.(".MuiAutocomplete-root, .MuiInputBase-root")) return true;
      } catch (_) {}
      return false;
    },
    async setValue(_el, _value, _ctx = {}) {
      // TODO: implement (Autocomplete)
      return false;
    },
  },
];

function getWidgetAdapter(el) {
  for (const a of widgetAdapters) {
    try {
      if (a.matches?.(el)) return a;
    } catch (_) {}
  }
  return null;
}

async function trySetValueWithAdapter(el, value, ctx = {}) {
  const a = getWidgetAdapter(el);
  if (!a || !a.setValue) return false;
  try {
    return await a.setValue(el, value, ctx);
  } catch (_) {
    return false;
  }
}

// Expose all helpers as globals for classic content script loading
// (Content scripts are loaded as classic scripts sharing a scope — no ESM)
// No-op if already on globalThis (e.g. Node test env).

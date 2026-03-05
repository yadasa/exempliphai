// utils.js - Enhanced with more queries, randomFill support
// Field mappings per hostname. Add your new ATS here.

const HOSTNAME_MAPPINGS = {
  'greenhouse.io': {
    'First Name': 'inputQuery("first")',
    'Last Name': 'inputQuery("last")',
    'Email': 'inputQuery("email")',
    'Phone': 'inputQuery("phone")',
    'Resume': 'inputQuery("resume") || inputQuery("file")',
    // Add radio/dropdown examples
    'US Work Authorization': 'inputQuery("auth") || inputQuery("work")', // Will use randomFill
  },
  'lever.co': {
    'First Name': 'inputQuery("first")',
    // ... existing
  },
  'recruitee.com': {  // Example from your earlier note
    'First Name': 'inputQuery("first")',
    'Email': 'inputQuery("email")',
    'Resume': '.file-input',
  },
  // TODO: Add hostnames from your HTML examples, e.g.:
  // 'jobs.yoursite.com': {
  //   'First Name': '#applicant-fn',
  //   'Custom Question': 'inputQuery("question")', // randomFill
  // }
};

// Enhanced inputQuery with more keywords
function inputQuery(keywords) {
  const selectors = [
    `[id*="${keywords.toLowerCase()}"]`,
    `[name*="${keywords.toLowerCase()}"]`,
    `[placeholder*="${keywords.toLowerCase()}"]`,
    `[aria-label*="${keywords.toLowerCase()}"]`,
    `[data-qa*="${keywords.toLowerCase()}"]`,
    // New: More variants
    `[id^="field-${keywords.toLowerCase()}"]`,
    `[name$="${keywords.toLowerCase()}"]`, // ends with
    `label:contains("${keywords}") ~ input`, // label before input
  ].join(', ');
  return document.querySelector(selectors);
}

// Random fill helpers
async function randomFill(field, type) {
  const randomFillEnabled = await getStorage('randomFill', true);
  if (!randomFillEnabled) return null;

  if (type === 'radio') {
    const radios = document.querySelectorAll(`input[type="radio"][name="${field.name}"]`);
    if (radios.length > 0) {
      const randomRadio = radios[Math.floor(Math.random() * radios.length)];
      randomRadio.click();
      return randomRadio;
    }
  } else if (type === 'select') {
    const options = Array.from(field.options).filter(opt => opt.value && opt.text);
    if (options.length > 0) {
      const randomOpt = options[Math.floor(Math.random() * options.length)];
      field.value = randomOpt.value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return field;
    }
  } else if (type === 'dropdown-custom') { // e.g., React Select
    // Click to open, then click random option
    field.click();
    await new Promise(r => setTimeout(r, 500)); // Wait for dropdown
    const options = document.querySelectorAll('[role="option"]');
    if (options.length > 0) {
      options[Math.floor(Math.random() * options.length)].click();
      return true;
    }
  } else if (type === 'textarea' || type === 'text') {
    const fillers = ['N/A', 'Yes', 'No', 'Other', '2020-2023', 'JavaScript, Python']; // Expand as needed
    field.value = fillers[Math.floor(Math.random() * fillers.length)];
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return field;
  }
  return null;
}

async function getStorage(key, defaultValue) {
  return new Promise(resolve => {
    chrome.storage.sync.get([key], result => resolve(result[key] ?? defaultValue));
  });
}

export { inputQuery, HOSTNAME_MAPPINGS, randomFill, getStorage };

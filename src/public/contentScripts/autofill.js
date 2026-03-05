// autofill.js - Enhanced with radio/dropdown/randomFill
import { inputQuery, HOSTNAME_MAPPINGS, randomFill, getStorage } from './utils.js';

async function autofill() {
  const profile = await getStorage('profile', {});
  const hostname = window.location.hostname;
  let mappings = HOSTNAME_MAPPINGS[hostname.split('.').slice(-2).join('.')] || HOSTNAME_MAPPINGS[hostname] || {};

  // Fallback to generic if no hostname match
  if (Object.keys(mappings).length === 0) {
    mappings = {
      'First Name': 'inputQuery("first") || inputQuery("fn")',
      'Last Name': 'inputQuery("last") || inputQuery("ln")',
      'Email': 'inputQuery("email")',
      'Phone': 'inputQuery("phone") || inputQuery("mobile")',
      'Resume': 'inputQuery("resume") || inputQuery("cv") || inputQuery("file")',
    };
  }

  console.log('Autofilling on', hostname, 'with mappings:', mappings);

  for (const [fieldName, selectorStr] of Object.entries(mappings)) {
    const field = eval(selectorStr); // Use eval for dynamic selectors (secure in extension context)
    if (!field) continue;

    let value = profile[fieldName.toLowerCase().replace(/ /g, '_')];
    if (!value && fieldName.toLowerCase().includes('resume')) {
      // Resume blob logic (existing)
      const resumeFile = await getStorage('resumeFile');
      if (resumeFile) {
        const dt = new DataTransfer();
        dt.items.add(new File([resumeFile.blob], resumeFile.name, { type: 'application/pdf' }));
        field.files = dt.files;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      continue;
    }

    if (value) {
      if (field.tagName === 'SELECT' || field.type === 'select-one') {
        // Dropdown
        field.value = value;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (field.type === 'radio') {
        // Radio group
        const groupName = fieldName.toLowerCase().replace(/ /g, '_');
        const radios = document.querySelectorAll(`input[type="radio"][name*="${groupName}"]`);
        const targetRadio = Array.from(radios).find(r => r.value === value) || radios[0];
        if (targetRadio) targetRadio.click();
      } else {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      // Unknown field: randomFill fallback
      const filled = await randomFill(field, field.type || field.tagName.toLowerCase());
      console.log(`Random filled: ${fieldName}`, filled);
    }
  }

  // Special cases (existing + new)
  const selectControl = document.querySelector('.select__control');
  if (selectControl) selectControl.click(); // Open dropdowns

  // Track app
  await chrome.storage.local.set({ applications: [{ url: window.location.href, date: new Date().toISOString() }] });
  console.log('Autofill complete!');
}

// Trigger on context menu or mutation observer for dynamic forms
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'autofill') autofill();
});

// Watch for dynamic loads/iframes
const observer = new MutationObserver(autofill);
observer.observe(document.body, { childList: true, subtree: true });

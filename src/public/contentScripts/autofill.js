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
window.addEventListener("load", (_) => {
  console.log("SmartApply: found job page.");
  initTime = new Date().getTime();
  awaitForm();
});
const applicationFormQuery = "#application-form, #application_form, #applicationform";

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

function setBestSelectOption(selectEl, fillValue) {
  if (!(selectEl instanceof HTMLSelectElement)) return false;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return false;

  let best = { opt: null, score: 0 };
  for (const opt of options) {
    if (opt.disabled) continue;
    const score = Math.max(
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

  const esc = (val) => (CSS?.escape ? CSS.escape(val) : val.replace(/[^a-zA-Z0-9_\-]/g, "\$&"));
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


function inputQuery(jobParam, form) {
  const normalizedParam = normalizeText(jobParam);
  const nodes = Array.from(form.querySelectorAll("input, select"));

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
      // Occasionally helpful for <select> + custom inputs.
      node.value,
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

  return el;
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
  // Create a MutationObserver to detect changes in the DOM
  const observer = new MutationObserver((_, observer) => {
    for (let jobForm in fields) {
      if (!window.location.hostname.includes(jobForm)) continue;
      //workday
      if (jobForm == "workday") {
        autofill(null);
        observer.disconnect();
        return;
      }
      let form = document.querySelector(applicationFormQuery);
      if (form) {
        observer.disconnect();
        autofill(form);
        return;
      } else {
        form = document.querySelector("form, #mainContent");
        if (form) {
          observer.disconnect();
          autofill(form);
          return;
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  if (window.location.hostname.includes("lever")) {
    let form = document.querySelector("#application-form, #application_form");
    if (form) autofill(form);
  }
}

async function autofill(form) {
  console.log("SmartApply: Starting autofill.");
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  await sleep(delays.initial);
  let matchFound = false;
  for (let jobForm in fields) {
    if (window.location.hostname.includes(jobForm) && jobForm !== 'generic') {
      matchFound = true;
      if (jobForm == "workday") {
        workDayAutofill(res);
        return;
      }
      await processFields(jobForm, fields[jobForm], form, res);
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
    if (param === "Resume") {
      // Basic Context Menu Logic
      let lastClickedElement = null;

      document.addEventListener("contextmenu", (event) => {
        lastClickedElement = event.target;
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
          let question = element.getAttribute("aria-label") || element.getAttribute("placeholder") || "";
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

          // 2. Get User Data
          const syncData = await getStorageDataSync("API Key");
          const apiKey = syncData["API Key"];

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

          // Construct Parts for Gemini
          const parts = [
            {
              text: `You are a helpful assistant applying for a job.
              ${context}
              
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

    if (param === "Gender" || "Location (City)") useLongDelay = true;
    if (param === "Location (City)") fillValue = formatCityStateCountry(res, param);

    setNativeValue(inputElement, fillValue);

    // Native <select> and radio groups need special handling:
    // - setNativeValue may set select.value to the raw fillValue (which may not equal an option.value)
    // - radio groups need us to click the correct input in the group
    if (inputElement instanceof HTMLSelectElement) {
      setBestSelectOption(inputElement, fillValue);
      continue;
    }

    if (inputElement.type === "radio") {
      clickBestRadioInGroup(inputElement, fillValue, form);
      continue;
    }

    //for the dropdown elements
    let btn = inputElement.closest(".select__control--outside-label");
    if (!btn) continue;

    btn.dispatchEvent(mouseUpEvent);
    await sleep(useLongDelay ? delays.long : delays.short);
    btn.dispatchEvent(keyDownEvent);
    await sleep(delays.short);
  }
  scrollToTop();
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


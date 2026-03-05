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
  console.log("Exempliphai: found job page.");
  initTime = new Date().getTime();
  awaitForm();
});
const applicationFormQuery = "#application-form, #application_form, #applicationform";


function inputQuery(jobParam, form) {
  let normalizedParam = jobParam.toLowerCase();
  let inputElement = Array.from(form.querySelectorAll("input")).find(
    (input) => {
      const attributes = [
        input.id?.toLowerCase().trim(),
        input.name?.toLowerCase().trim(),
        input.placeholder?.toLowerCase().trim(),
        input.getAttribute("aria-label")?.toLowerCase().trim(),
        input.getAttribute("aria-labelledby")?.toLowerCase().trim(),
        input.getAttribute("aria-describedby")?.toLowerCase().trim(),
        input.getAttribute("data-qa")?.toLowerCase().trim(),
      ];

      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        if (attr != undefined && attr.includes(normalizedParam)) {
          // Optimization: If searching for "address", ignore if it also contains "email" 
          // to avoid false positive with "Email Address".
          if (normalizedParam === "address" && attr.includes("email")) {
            continue;
          }
          return true;
        }
      }
      return false;
    }
  );
  return inputElement;
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
  console.log("Exempliphai: Starting autofill.");
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
    console.log("Exempliphai: No specific config found, using generic.");
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
    //for the dropdown elements
    let btn = inputElement.closest(".select__control--outside-label");
    if (!btn) continue;

    btn.dispatchEvent(mouseUpEvent);
    await sleep(useLongDelay ? delays.long : delays.short);
    btn.dispatchEvent(keyDownEvent);
    await sleep(delays.short);
  }
  scrollToTop();
  console.log(`Exempliphai: Complete in ${getTimeElapsed(initTime)}s.`);

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
            console.log("Exempliphai: Job tracked in local history.");
          });

          if (syncEnabled) {
            let syncJobs = resSync.AppliedJobsSync || [];
            syncJobs.unshift(jobEntry);
            // Limit to 100 for sync storage constraints
            syncJobs = syncJobs.slice(0, 100);
            chrome.storage.sync.set({ AppliedJobsSync: syncJobs }, () => {
              console.log("Exempliphai: Job tracked in cloud history.");
            });
          }
        }
      });
    });
  } catch (e) {
    console.error("Exempliphai: Error tracking job", e);
  }

}


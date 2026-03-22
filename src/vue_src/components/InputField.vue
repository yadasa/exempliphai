<template>
  <div>
    <div class="inputFieldDiv">
      <h2 style="align-items: center; display: flex; gap: 1rem;">
        {{ label }}
        <svg
          v-if="explanation"
          @click="showExplanation"
          style="cursor: pointer; color: var(--accent-color);"
          xmlns="http://www.w3.org/2000/svg"
          height="24px"
          viewBox="0 -960 960 960"
          width="24px"
          fill="currentColor"
        >
          <path
            d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
          />
        </svg>
      </h2>

      <input
        v-if="!isDropdown && !files.includes(label)"
        :type="hidden"
        :placeholder="placeHolder"
        v-model="inputValue"
        @input="saveData"
        @focus="onFocus"
        @blur="onBlur"
      />

      <div
        v-if="files.includes(label)"
        class="inputFieldfileHolder"
        style="display: flex; flex-direction: column; gap: 0.55rem;"
      >
        <input type="file" title="" value="" :placeholder="placeHolder" @change="saveResume" />
        <h2>{{ inputValue }}</h2>

        <button v-if="label === 'Resume'" type="button" class="tailorResumeBtn" @click="openTailorModal">
          Tailor Resume
        </button>
      </div>

      <CustomDropdown
        v-if="isDropdown && !files.includes(label)"
        :class="hidden"
        :modelValue="inputValue"
        :options="optionsForDropdown"
        :placeholder="`Select ${label}`"
        :disabled="false"
        @update:modelValue="(val) => { inputValue = val as any; dropdownPrivacy(); }"
      />
    </div>

    <!-- Tailor Resume Modal -->
    <div v-if="label === 'Resume' && showTailorModal" class="modalOverlay" role="dialog" aria-modal="true">
      <div class="modalCard tailorModalCard">
        <button class="modalCloseBtn" @click="closeTailorModal" aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
            <path
              d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
            />
          </svg>
        </button>

        <div class="modalHeader">
          <h1 class="modalHeaderTitle">Tailor resume to current job</h1>
        </div>

        <div class="modalBody">
          <div class="inputFieldDiv">
            <h2>Job Title</h2>
            <input v-model="tailorJobTitle" placeholder="Software Engineer" />
          </div>

          <div class="textAreaDiv" style="align-items: flex-start;">
            <h2>Job Description</h2>
            <textarea
              v-model="tailorJobDescription"
              placeholder="Paste the job description (or click Extract from page)"
              style="height: 8.5rem; resize: vertical;"
            />
          </div>

          <div class="tailorRow">
            <button type="button" class="tailorSecondaryBtn" @click="extractJobContext" :disabled="tailoring">
              Extract from page
            </button>
            <button type="button" class="tailorPrimaryBtn" @click="runTailor" :disabled="tailoring">
              {{ tailoring ? 'Tailoring…' : 'Generate tailored resume' }}
            </button>
          </div>

          <p v-if="tailorStatus" class="tailorStatus">{{ tailorStatus }}</p>
          <p v-if="tailorError" class="tailorError">{{ tailorError }}</p>

          <div v-if="tailoredResumeText">
            <div class="textAreaDiv" style="align-items: flex-start;">
              <h2>Preview</h2>
              <textarea :value="tailoredResumeText" readonly style="height: 13rem; resize: vertical;" />
            </div>

            <div class="tailorRow">
              <button type="button" class="tailorSecondaryBtn" @click="downloadTailoredTxt">
                Download .txt
              </button>
              <button type="button" class="tailorSecondaryBtn" @click="downloadTailoredPdf">
                Download PDF
              </button>
            </div>
          </div>
        </div>

        <div class="modalFooter">
          <button class="modalSaveBtn" @click="closeTailorModal">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, ref, watch } from 'vue';
import { jsPDF } from 'jspdf';
import { createGeminiProvider } from '../../public/contentScripts/providers/gemini.js';
import CustomDropdown from '@/components/CustomDropdown.vue';
import { usePrivacy } from '@/composables/Privacy';
import { useExplanation } from '@/composables/Explanation.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {
  components: { CustomDropdown },
  props: ['label', 'placeHolder', 'explanation'],
  data() {
    return {
      files: ['Resume', 'LinkedIn PDF']
    };
  },

  setup(props) {
    // Declare a reactive input value using Vue's ref
    const inputValue = ref('');
    // Use the composable
    const { privacy } = usePrivacy();
    const hidden = ref('text');
    const { toggleExplanation, setExplanation } = useExplanation();
    const { loadDetails } = useResumeDetails();
    watch(privacy, (newVal) => {
      hidden.value = newVal ? 'password' : 'text';
    });

    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    const dropdownOptions: Record<string, string[]> = {
      'Phone Type': ['Landline', 'Mobile', 'Office Phone'],
      'Legally Authorized to Work': ['Yes', 'No'],
      'Requires Sponsorship': ['Yes', 'No'],
      'Willing to Relocate': ['Yes', 'No'],
      'Security Clearance': ['Yes', 'No'],

      Pronouns: ['He/Him', 'She/Her', 'They/Them', 'Decline To Self Identify', 'Other'],
      Gender: ['Male', 'Female', 'Decline To Self Identify'],
      Race: [
        'American Indian or Alaskan Native',
        'Asian',
        'Black or African American',
        'White',
        'Native Hawaiian or Other Pacific Islander',
        'Two or More Races',
        'Decline To Self Identify',
      ],
      'Hispanic/Latino': ['Yes', 'No', 'Decline To Self Identify'],
      'Veteran Status': [
        'I am not a protected veteran',
        'I identify as one or more of the classifications of a protected veteran',
        "I don't wish to answer",
      ],
      'Disability Status': [
        'Yes, I have a disability, or have had one in the past',
        'No, I do not have a disability and have not had one in the past',
        'I do not want to answer',
      ],

      Degree: [
        "Associate's Degree",
        "Bachelor's Degree",
        'Doctor of Medicine (M.D.)',
        'Doctor of Philosophy (Ph.D.)',
        "Engineer's Degree",
        'High School',
        'Juris Doctor (J.D.)',
        'Master of Business Administration (M.B.A.)',
        "Master's Degree",
        'Other',
      ],

      'Start Date Month': months,
      'End Date Month': months,

      // Used in modals (work experience/certifications)
      'Start Month': months,
      'End Month': months,
      'Issue Month': months,
      'Expiration Month': months,
    };

    const dropdowns = Object.keys(dropdownOptions);

    const isDropdown = computed(() => {
      return Array.isArray(props.placeHolder) || dropdowns.includes(props.label);
    });

    const optionsForDropdown = computed(() => {
      if (Array.isArray(props.placeHolder)) return props.placeHolder;
      return dropdownOptions[props.label] || [];
    });

    const showExplanation = () => {
      setExplanation(props.explanation);
      toggleExplanation();
    }

    const saveResume = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
          if (!e.target?.result) return;
          const b64 = (e.target.result as string).split(',')[1];
          chrome.storage.local.set({ [`${props.label + '_name'}`]: file.name }, () => {
            inputValue.value = file.name
            console.log(`${props.label} + _name saved:`, file.name);
          });
          chrome.storage.local.set({ [props.label]: b64 }, () => {
            console.log(`${props.label} saved:`, b64);
          });

          chrome.storage.sync.get(['API Key', 'consents'], (key) => {
            const apiKey = String(key?.consents?.geminiApiKey || key?.['API Key'] || '').trim();
            if (apiKey) {
              //parse resume, return skills
              fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({

                    contents: [
                      {
                        parts: [
                          {
                    text: `Identify and extract information from this resume/profile. Return ONLY a JSON object with this exact structure:
                    {
                      "skills": ["skill1", "skill2"],
                      "experiences": [{"jobTitle": "", "jobEmployer": "", "jobDuration": "mm/yy-mm/yy", "isCurrentEmployer": boolean, "roleBulletsString": ""}],
                      "certifications": [{"name": "", "issuer": "", "issueDate": "Month Year", "expirationDate": "Month Year", "credentialId": "", "url": ""}],
                      "profile": {
                        "First Name": "",
                        "Middle Name": "",
                        "Last Name": "",
                        "Full Name": "",
                        "Email": "",
                        "Phone": "",
                        "LinkedIn": "",
                        "Github": "",
                        "LeetCode": "",
                        "Medium": "",
                        "Personal Website": "",
                        "Other URL": "",
                        "Location (Street)": "",
                        "Location (City)": "",
                        "Location (State/Region)": "",
                        "Location (Country)": "",
                        "Postal/Zip Code": "",
                        "Legally Authorized to Work": "",
                        "Requires Sponsorship": "",
                        "Job Notice Period": "",
                        "Expected Salary": "",
                        "Languages": "",
                        "Willing to Relocate": "",
                        "Date Available": "",
                        "Security Clearance": "",
                        "Pronouns": "",
                        "Gender": "",
                        "Race": "",
                        "Hispanic/Latino": "",
                        "Veteran Status": "",
                        "Disability Status": "",
                        "School": "",
                        "Degree": "",
                        "Discipline": "",
                        "GPA": "",
                        "Start Date Month": "",
                        "Start Date Year": "",
                        "End Date Month": "",
                        "End Date Year": "",
                        "Current Employer": "",
                        "Years of Experience": ""
                      }
                    }
                    Ensure all keys match the UI labels exactly. For yes/no fields, return "Yes" or "No". For dates, use full month names.`,
                          },
                          {
                            'inline_data': {
                              data: b64,
                              'mime_type': 'application/pdf',
                            }
                          }
                        ]
                      },
                    ]


                  })
                }

              ).then((response) => response.json())
                .then((json) => {
                  console.log("Gemini API Raw Response:", json);
                  
                  if (json.error) {
                    throw new Error(`Gemini API Error: ${json.error.message || json.error.status}`);
                  }

                  if (!json.candidates || !json.candidates[0]) {
                    throw new Error("Invalid Gemini response structure: No candidates returned.");
                  }

                  const candidate = json.candidates[0];
                  if (candidate.finishReason !== 'STOP' && candidate.finishReason !== undefined) {
                    throw new Error(`Gemini API stopped unexpectedly. Reason: ${candidate.finishReason}`);
                  }

                  if (!candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
                    throw new Error("Invalid Gemini response structure: Missing content or parts.");
                  }

                  let resText = candidate.content.parts[0].text;
                  const jsonMatch = resText.match(/\{[\s\S]*\}/);
                  if (jsonMatch) {
                    resText = jsonMatch[0];
                  }
                  
                  try {
                    const resObj = JSON.parse(resText);
                    console.log("Parsed Gemini Object:", resObj);
                    
                    // Save Skills and Experiences to local storage while preserving existing certs
                    chrome.storage.local.get(['Resume_details'], (result) => {
                        let existing = result.Resume_details || { skills: [], experiences: [], certifications: [] };
                        if (typeof existing === 'string') {
                            try { existing = JSON.parse(existing); } catch(e) { existing = { skills: [], experiences: [], certifications: [] }; }
                        }
                        
                        const updatedLocal = {
                            skills: resObj.skills || existing.skills || [],
                            experiences: resObj.experiences || existing.experiences || [],
                            certifications: resObj.certifications || existing.certifications || []
                        };
                        
                        chrome.storage.local.set({ Resume_details: updatedLocal }, () => {
                            console.log(`Resume details (skills/exp) updated in local storage.`);
                            loadDetails();
                        });
                    });

                    // Save Profile details to sync storage for other InputFields
                    if (resObj.profile && typeof resObj.profile === 'object') {
                        const profileFields = Object.keys(resObj.profile).filter(k => resObj.profile[k]);
                        if (profileFields.length > 0) {
                            chrome.storage.sync.set(resObj.profile, () => {
                                console.log("Profile fields updated in sync storage:", resObj.profile);
                                alert(`Success! Identified ${profileFields.length} profile fields from ${props.label}.`);
                            });
                        } else {
                            console.warn("Gemini returned an empty profile object.");
                        }
                    }

                  } catch (parseError) {
                    console.error("Failed to parse Gemini JSON:", parseError, "Raw Text:", resText);
                    alert("Parsed AI response was not valid JSON. See console for details.");
                  }

                }).catch(e => {
                  console.error("Gemini API Execution Error:", e);
                  alert(`Gemini API Error: ${e.message}. Please check the console for details.`);
                });
            }
          });
        };
        reader.readAsDataURL(file);
      }
    };
    const saveData = () => {
      // Store the value of the input field in chrome storage
      chrome.storage.sync.set({ [props.label]: inputValue.value }, () => {
        console.log(`${props.label} saved:`, inputValue.value);
      });
    };
    const loadData = () => {
      if (!chrome.storage) return;
      chrome.storage.sync.get([props.label], (data) => {

        inputValue.value = data[props.label] || '';  // Default to empty string if no value is found
        if (inputValue.value == '' && (props.label === "Resume" || props.label === "LinkedIn PDF")) {
          chrome.storage.local.get([`${props.label + '_name'}`], (localData) => {

            inputValue.value = localData[`${props.label + '_name'}`] || 'No file found';  // Default to empty string if no value is found
          });
        }
      });
    };
    const onFocus = () => {
      if (privacy.value) hidden.value = "text";

    };
    const onBlur = () => {
      if (privacy.value) hidden.value = "password";

    };
    const dropdownPrivacy = () => {
      saveData();
      if (privacy.value) onBlur();
    }
    // Load data when the component is mounted
    loadData();

    // Listen for storage changes
    if (chrome.storage) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'sync' && changes[props.label]) {
                const newValue = changes[props.label].newValue;
                console.log(`InputField [${props.label}]: Sync Storage updated to:`, newValue);
                inputValue.value = newValue || '';
            }
            if (areaName === 'local' && changes[`${props.label}_name`]) {
                const newValue = changes[`${props.label}_name`].newValue;
                console.log(`InputField [${props.label}]: Local Storage (filename) updated to:`, newValue);
                inputValue.value = newValue || 'No file found';
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resume tailoring (Popup) — Gemini
    // ─────────────────────────────────────────────────────────────────────

    const showTailorModal = ref(false);
    const tailorJobTitle = ref('');
    const tailorJobDescription = ref('');
    const tailoredResumeText = ref('');
    const tailoredResumeDetails = ref<any>(null);
    const tailoring = ref(false);
    const tailorStatus = ref('');
    const tailorError = ref('');

    const storageSyncGet = (keys: any) =>
      new Promise<any>((resolve) => {
        try {
          chrome.storage.sync.get(keys, (res) => resolve(res || {}));
        } catch (e) {
          resolve({});
        }
      });

    const storageLocalGet = (keys: any) =>
      new Promise<any>((resolve) => {
        try {
          chrome.storage.local.get(keys, (res) => resolve(res || {}));
        } catch (e) {
          resolve({});
        }
      });

    const storageLocalSet = (obj: any) =>
      new Promise<boolean>((resolve) => {
        try {
          chrome.storage.local.set(obj, () => resolve(true));
        } catch (e) {
          resolve(false);
        }
      });

    const estimateCostUsd = (tokensIn: number, tokensOut: number) => {
      const inTok = Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0;
      const outTok = Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0;
      // Best-effort estimate (USD per 1M tokens)
      const USD_PER_1M_IN = 5.0;
      const USD_PER_1M_OUT = 15.0;
      const usd = (inTok * USD_PER_1M_IN + outTok * USD_PER_1M_OUT) / 1_000_000;
      return Math.round(usd * 1_000_000) / 1_000_000;
    };

    const appendAuditLog = async (entry: any) => {
      try {
        const got = await storageLocalGet(['audit_log']);
        const cur = Array.isArray(got.audit_log) ? got.audit_log : [];
        const next = cur.concat([entry]).slice(-1000);
        await storageLocalSet({ audit_log: next });
      } catch (e) {
        console.warn('Failed to append audit_log', e);
      }
    };

    const closeTailorModal = () => {
      showTailorModal.value = false;
    };

    const extractJobContext = async () => {
      tailorError.value = '';
      tailorStatus.value = '';

      const postToBackground = (msg: any) =>
        new Promise<any>((resolve) => {
          try {
            const port = chrome.runtime.connect({ name: 'exempliphai-popup' });
            let done = false;

            const finish = (resp: any) => {
              if (done) return;
              done = true;
              try {
                port.onMessage.removeListener(onMsg);
              } catch (_) {}
              try {
                port.disconnect();
              } catch (_) {}
              resolve(resp);
            };

            const onMsg = (resp: any) => finish(resp);
            port.onMessage.addListener(onMsg);

            port.onDisconnect.addListener(() => {
              const err = chrome?.runtime?.lastError;
              finish({ ok: false, error: err?.message || 'Disconnected from background.' });
            });

            port.postMessage(msg);
          } catch (e: any) {
            resolve({ ok: false, error: String(e?.message || e) });
          }
        });

      // Preferred: Port-based postMessage (keeps MV3 service worker alive during the request)
      let resp: any = await postToBackground('EXTRACT_JOB_CONTEXT');

      // Fallback: classic sendMessage
      if (!resp || resp?.ok === false) {
        resp = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ action: 'EXTRACT_JOB_CONTEXT' }, (r) => {
              const err = chrome?.runtime?.lastError;
              if (err) resolve({ ok: false, error: err.message || String(err) });
              else resolve(r);
            });
          } catch (e: any) {
            resolve({ ok: false, error: String(e?.message || e) });
          }
        });
      }

      if (resp?.ok === false) {
        tailorError.value = resp?.error || resp?.reason || 'Failed to extract job context.';
        return;
      }

      const jt = String(resp?.jobTitle || '').trim();
      const jd = String(resp?.jobDescription || '').trim();

      // Only fill if user hasn't started typing.
      if (jt && !tailorJobTitle.value.trim()) tailorJobTitle.value = jt;
      if (jd && !tailorJobDescription.value.trim()) tailorJobDescription.value = jd;

      tailorStatus.value = jt || jd ? 'Extracted job context from page.' : 'Could not detect job description; paste it manually.';
    };

    const openTailorModal = async () => {
      if (props.label !== 'Resume') return;
      showTailorModal.value = true;
      tailorStatus.value = '';
      tailorError.value = '';
      tailoredResumeText.value = '';
      tailoredResumeDetails.value = null;

      await extractJobContext();
    };

    const runTailor = async () => {
      if (tailoring.value) return;

      tailorError.value = '';
      tailorStatus.value = '';
      tailoring.value = true;

      try {
        const sync = await storageSyncGet(['API Key', 'AI Model', 'consents']);
        const apiKey = String(sync?.consents?.geminiApiKey || sync?.['API Key'] || '').trim();
        const model = String(sync?.['AI Model'] || 'gemini-1.5-flash').trim();

        if (!apiKey) {
          throw new Error('Missing Gemini API Key (Settings → General).');
        }

        const local = await storageLocalGet(['Resume_details']);
        let resumeDetails: any = local?.Resume_details;
        if (!resumeDetails) {
          throw new Error('Missing Resume_details. Upload your resume first so Exempliphai can parse it.');
        }
        if (typeof resumeDetails === 'string') {
          try {
            resumeDetails = JSON.parse(resumeDetails);
          } catch (_) {
            // keep as string
          }
        }

        const jobTitle = String(tailorJobTitle.value || '').trim();
        const jobDescription = String(tailorJobDescription.value || '').trim();

        if (!jobDescription) {
          const ok = confirm('No job description detected/pasted. Tailor anyway (generic)?');
          if (!ok) return;
        }

        tailorStatus.value = 'Tailoring resume…';

        const provider = createGeminiProvider({ apiKey, model });
        const r: any = await provider.tailorResume({
          model,
          resumeData: resumeDetails,
          jobTitle,
          jobDescription,
          timeoutMs: 70000,
          maxRetries: 1,
        });

        const parsed: any = r?.tailored || {};
        const details = parsed?.tailored_resume_details && typeof parsed.tailored_resume_details === 'object'
          ? parsed.tailored_resume_details
          : parsed;

        const tailoredText = String(parsed?.tailored_resume_text || '').trim();

        if (!details || typeof details !== 'object') {
          throw new Error('Tailored output missing tailored_resume_details.');
        }

        tailoredResumeDetails.value = details;
        tailoredResumeText.value = tailoredText;

        const tokensIn = Number(r?.tokensIn || 0);
        const tokensOut = Number(r?.tokensOut || 0);
        const cost = estimateCostUsd(tokensIn, tokensOut);

        await storageLocalSet({
          tailored_resume_details: details,
          tailored_resume_text: tailoredText,
          tailored_resume_meta: {
            jobTitle,
            model,
            generatedAt: new Date().toISOString(),
            tokensIn,
            tokensOut,
          },
          tailored_resume_changes: String(r?.changesDescription || parsed?.changesDescription || '').slice(0, 2000),
          tailored_resume_keywordsAdded: Array.isArray(parsed?.keywordsAdded) ? parsed.keywordsAdded.slice(0, 80) : [],
        });

        await appendAuditLog({
          ts: new Date().toISOString(),
          event: 'tailor_resume_manual',
          model,
          input_tokens: tokensIn,
          output_tokens: tokensOut,
          cost_estimate: cost,
        });

        tailorStatus.value = `Saved tailored resume. Tokens: ${tokensIn} in / ${tokensOut} out. Est. cost: $${cost.toFixed(4)}.`;

        // Ensure other UI (resume details chips) can refresh if needed.
        try {
          loadDetails();
        } catch (_) {}
      } catch (e) {
        tailorError.value = String((e as any)?.message || e);
        tailorStatus.value = '';
      } finally {
        tailoring.value = false;
      }
    };

    const downloadTailoredTxt = () => {
      try {
        const text = String(tailoredResumeText.value || '').trim();
        if (!text) return;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tailored_resume.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn('Download txt failed', e);
      }
    };

    const downloadTailoredPdf = () => {
      try {
        const text = String(tailoredResumeText.value || '').trim();
        if (!text) return;

        const doc = new jsPDF({ unit: 'pt', format: 'letter' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 44;
        const maxW = pageW - margin * 2;

        doc.setFont('times', 'normal');
        doc.setFontSize(11);

        const lines = doc.splitTextToSize(text, maxW);
        let y = margin;

        for (const line of lines) {
          if (y > pageH - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += 14;
        }

        doc.save('tailored_resume.pdf');
      } catch (e) {
        console.warn('Download pdf failed', e);
      }
    };

    return {
      inputValue,
      isDropdown,
      optionsForDropdown,
      saveData,
      saveResume,
      hidden,
      onFocus,
      onBlur,
      dropdownPrivacy,
      showExplanation,

      // Tailor resume UI
      showTailorModal,
      tailorJobTitle,
      tailorJobDescription,
      tailoredResumeText,
      tailoring,
      tailorStatus,
      tailorError,
      openTailorModal,
      closeTailorModal,
      extractJobContext,
      runTailor,
      downloadTailoredTxt,
      downloadTailoredPdf,
    };
  },
};
</script>

<style scoped>
.tailorResumeBtn {
  width: 100%;
  padding: 0.65rem 0.85rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent-color) 55%, var(--card-border));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--input-bg));
  color: var(--text-primary);
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}

.tailorResumeBtn:hover {
  filter: brightness(1.03);
  transform: translateY(-1px);
}

.tailorModalCard {
  max-width: 980px;
}

.tailorRow {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 0.75rem 0 0.35rem 0;
}

.tailorPrimaryBtn,
.tailorSecondaryBtn {
  flex: 1 1 240px;
  padding: 0.8rem 1rem;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  font-weight: 800;
}

.tailorPrimaryBtn {
  background: var(--gradient-primary);
  color: #fff;
  box-shadow: 0 18px 35px rgba(102, 126, 234, 0.25);
}

.tailorSecondaryBtn {
  background: color-mix(in srgb, var(--bg-primary) 85%, #fff);
  border: 1px solid var(--card-border);
  color: var(--text-primary);
}

.tailorPrimaryBtn:disabled,
.tailorSecondaryBtn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.tailorStatus {
  margin-top: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.tailorError {
  margin-top: 0.5rem;
  color: #ef4444;
  font-size: 0.92rem;
  font-weight: 700;
}
</style>
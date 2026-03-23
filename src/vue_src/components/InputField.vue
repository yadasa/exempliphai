<template>
  <div class="inputFieldDiv">
    <h2 style="align-items: center; display: flex; gap:1rem;">{{ label }} <svg v-if="explanation"
        @click="showExplanation" style="cursor: pointer; color: var(--accent-color);" xmlns="http://www.w3.org/2000/svg" height="24px"
        viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path
          d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
      </svg></h2>

    <input v-if="!isDropdown && !files.includes(label)" :type="hidden" :placeholder="placeHolder"
      v-model="inputValue" @input="saveData" @focus="onFocus" @blur="onBlur" />
    <div v-if="files.includes(label)" class="inputFieldfileHolder">
      <input v-if="files.includes(label)" type="file" title="" value="" :placeholder="placeHolder"
        @change="saveResume" />
      <h2 v-if="files.includes(label)">{{ inputValue }}</h2>

      <!-- Resume Tailor (only for Resume upload) -->
      <div v-if="isResumeLabel" class="tailorControls">
        <div style="display:flex; gap:0.5rem; flex-wrap: wrap;">
          <button class="tailorBtn" @click="tailorResume" :disabled="tailorBusy">
            {{ tailorBusy ? 'Tailoring…' : 'Tailor Resume' }}
          </button>
          <button class="tailorBtn secondary" @click="openTailorModal" :disabled="!tailoredText">
            Preview
          </button>
          <button class="tailorBtn secondary" @click="downloadTailoredTxt" :disabled="!tailoredText">
            Download .txt
          </button>
          <button class="tailorBtn secondary" @click="downloadTailoredPdf" :disabled="!tailoredText">
            Download PDF
          </button>
        </div>

        <p v-if="tailorError" class="tailorError">{{ tailorError }}</p>

        <p v-if="tailoredMetaText" class="tailorMeta">{{ tailoredMetaText }}</p>
      </div>
    </div>

    <div v-if="showTailorModal" class="tailorModalOverlay" @click.self="closeTailorModal">
      <div class="tailorModal">
        <div style="display:flex; justify-content: space-between; align-items:center; gap:0.75rem;">
          <h2 style="margin:0; font-size: 1.05rem;">Tailored Resume</h2>
          <button class="tailorBtn secondary" @click="closeTailorModal">Close</button>
        </div>

        <textarea v-model="tailoredText" class="tailorTextarea" spellcheck="false"></textarea>

        <div style="display:flex; gap:0.5rem; flex-wrap: wrap;">
          <button class="tailorBtn" @click="saveTailored" :disabled="!tailoredText">Save</button>
          <button class="tailorBtn secondary" @click="downloadTailoredTxt" :disabled="!tailoredText">Download .txt</button>
          <button class="tailorBtn secondary" @click="downloadTailoredPdf" :disabled="!tailoredText">Download PDF</button>
        </div>

        <p style="margin: 0.6rem 0 0; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.35;">
          Tip: Enable <b>Auto-tailor</b> in Settings to tailor automatically before autofill.
        </p>
      </div>
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
</template>

<script lang="ts">
import { computed, ref, watch } from 'vue';
import CustomDropdown from '@/components/CustomDropdown.vue';
import { usePrivacy } from '@/composables/Privacy';
import { useExplanation } from '@/composables/Explanation.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';
import { simplePdfFromText, uint8ToBase64, downloadBlob } from '@/utils/simplePdf';
import { buildTailorResumePrompt } from '@/utils/tailorPrompt.js';
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

    // Resume tailoring (Resume upload only)
    const isResumeLabel = computed(() => props.label === 'Resume');
    const tailorBusy = ref(false);
    const tailorError = ref('');
    const showTailorModal = ref(false);
    const tailoredText = ref('');
    const tailoredMeta = ref<any | null>(null);

    const countWords = (s: string) => {
      const t = String(s || '').trim();
      if (!t) return 0;
      return t.split(/\s+/).filter(Boolean).length;
    };

    const tailoredWordCount = computed(() => countWords(tailoredText.value));

    const tailoredMetaText = computed(() => {
      if (!tailoredMeta.value) return '';
      const m = tailoredMeta.value || {};
      const jt = (m.jobTitle || '').toString().trim();
      const co = (m.company || '').toString().trim();
      const at = (m.createdAt || '').toString().trim();
      const url = (m.pageUrl || '').toString().trim();
      const title = [jt, co].filter(Boolean).join(' @ ');
      const bits = [title || url || 'Unknown job', at ? `Saved ${at}` : 'Saved'];

      const wc = tailoredWordCount.value;
      if (wc) bits.push(wc > 600 ? `Words ${wc} (over 600)` : `Words ${wc}`);

      return bits.filter(Boolean).join(' · ');
    });

    const loadTailored = () => {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get(['Resume_tailored_text', 'Resume_tailored_meta'], (res) => {
        const t = (res as any)?.Resume_tailored_text;
        const m = (res as any)?.Resume_tailored_meta;
        if (typeof t === 'string') tailoredText.value = t;
        if (m && typeof m === 'object') tailoredMeta.value = m;
      });
    };

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

    const openTailorModal = () => {
      showTailorModal.value = true;
    };

    const closeTailorModal = () => {
      showTailorModal.value = false;
    };

    const saveTailored = () => {
      if (!chrome?.storage?.local) return;
      if (!tailoredText.value) return;

      const nowIso = new Date().toISOString();
      const meta = {
        ...(tailoredMeta.value || {}),
        createdAt: (tailoredMeta.value && tailoredMeta.value.createdAt) ? tailoredMeta.value.createdAt : nowIso,
        updatedAt: nowIso,
      };

      const pdfBytes = simplePdfFromText(tailoredText.value);
      const pdfB64 = uint8ToBase64(pdfBytes);

      chrome.storage.local.set(
        {
          Resume_tailored_text: tailoredText.value,
          Resume_tailored_pdf: pdfB64,
          Resume_tailored_name: 'resume-tailored.pdf',
          Resume_tailored_meta: meta,
        },
        () => {
          tailoredMeta.value = meta;
          alert('Saved tailored resume locally.');
        }
      );
    };

    const downloadTailoredTxt = () => {
      if (!tailoredText.value) return;
      const blob = new Blob([tailoredText.value], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, 'resume-tailored.txt');
    };

    const downloadTailoredPdf = () => {
      if (!tailoredText.value) return;
      const bytes = simplePdfFromText(tailoredText.value);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      downloadBlob(blob, 'resume-tailored.pdf');
    };

    const getActiveTabJobContext = async (): Promise<any> => {
      if (!chrome?.runtime?.sendMessage) return { ok: false, reason: 'no_runtime' };
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_ACTIVE_TAB_JOB_CONTEXT' }, (resp) => {
          const err = chrome?.runtime?.lastError;
          if (err) resolve({ ok: false, error: err.message || String(err) });
          else resolve(resp || { ok: false });
        });
      });
    };

    const tailorResume = async () => {
      if (!isResumeLabel.value) return;
      tailorError.value = '';
      if (tailorBusy.value) return;
      tailorBusy.value = true;

      try {
        // API key
        const apiKey = await new Promise<string>((resolve) => {
          chrome.storage.sync.get(['API Key'], (res) => resolve(String((res as any)?.['API Key'] || '')));
        });
        if (!apiKey) throw new Error('Missing Gemini API key. Add it in Settings.');

        // Resume PDF (base64)
        const resumeLocal = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['Resume', 'Resume_name'], (res) => resolve(res || {}));
        });
        const resumeB64 = String((resumeLocal as any)?.Resume || '').trim();
        if (!resumeB64) throw new Error('Upload a Resume PDF first (Experience tab).');

        const jobCtx = await getActiveTabJobContext();
        const pageUrl = String(jobCtx?.pageUrl || '');
        const jobTitle = String(jobCtx?.title || jobCtx?.jobTitle || '').trim();
        const company = String(jobCtx?.company || '').trim();
        const jd = String(jobCtx?.description || jobCtx?.jobDescription || '').trim();

        const prompt = buildTailorResumePrompt({
          jobTitle,
          company,
          pageUrl,
          jobDescription: jd,
        });

        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: prompt },
                    {
                      inline_data: {
                        data: resumeB64,
                        mime_type: 'application/pdf',
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.25,
                responseMimeType: 'application/json',
              },
            }),
          }
        );

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || (json as any)?.error) {
          const msg = (json as any)?.error?.message || `Gemini HTTP ${resp.status}`;
          throw new Error(msg);
        }

        const outText = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!outText) throw new Error('Gemini response missing text');

        const s = String(outText);
        const first = s.indexOf('{');
        const last = s.lastIndexOf('}');
        const jsonText = first !== -1 && last !== -1 && last > first ? s.slice(first, last + 1) : s;

        const out = JSON.parse(jsonText);
        const t = String(out?.tailored_resume_text || '').trim();
        if (!t) throw new Error('No tailored_resume_text returned.');

        tailoredText.value = t;
        let pageKey = pageUrl;
        try {
          const u = new URL(pageUrl);
          pageKey = `${u.origin}${u.pathname}`;
        } catch (_) {}

        tailoredMeta.value = {
          createdAt: new Date().toISOString(),
          pageUrl,
          pageKey,
          jobTitle: String(out?.job_title || jobTitle || ''),
          company: String(out?.company || company || ''),
        };

        showTailorModal.value = true;
      } catch (e: any) {
        tailorError.value = String(e?.message || e);
      } finally {
        tailorBusy.value = false;
      }
    };

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

          chrome.storage.sync.get('API Key', (key) => {
            key = key['API Key']
            if (key) {
              //parse resume, return skills
              fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
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
    if (isResumeLabel.value) loadTailored();

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
            if (areaName === 'local' && isResumeLabel.value && (changes.Resume_tailored_text || changes.Resume_tailored_meta)) {
                if (changes.Resume_tailored_text) {
                    tailoredText.value = String(changes.Resume_tailored_text.newValue || '');
                }
                if (changes.Resume_tailored_meta) {
                    tailoredMeta.value = changes.Resume_tailored_meta.newValue || null;
                }
            }
        });
    }

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

      // Tailor UI
      isResumeLabel,
      tailorBusy,
      tailorError,
      showTailorModal,
      tailoredText,
      tailoredMetaText,
      openTailorModal,
      closeTailorModal,
      tailorResume,
      saveTailored,
      downloadTailoredTxt,
      downloadTailoredPdf,
    };
  },
};
</script>

<style scoped>
.tailorControls {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border-color);
}

.tailorBtn {
  border: 0;
  border-radius: 999px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: white;
  box-shadow: 0 12px 28px rgba(79, 70, 229, 0.18);
}

.tailorBtn.secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  box-shadow: none;
}

.tailorBtn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.tailorError {
  margin: 0.5rem 0 0;
  color: #ef4444;
  font-size: 0.9rem;
}

.tailorMeta {
  margin: 0.5rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.35;
}

.tailorModalOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 14px;
}

.tailorModal {
  width: 100%;
  max-width: 520px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
}

.tailorTextarea {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
  width: 100%;
  height: 320px;
  resize: vertical;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.35;
}
</style>
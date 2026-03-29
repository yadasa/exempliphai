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
      <input v-if="files.includes(label)" type="file" title="" value="" :placeholder="placeHolder" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
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
import { useToast } from '@/composables/Toast';
import { simplePdfFromText, uint8ToBase64, downloadBlob } from '@/utils/simplePdf';
import { buildTailorResumePrompt } from '@/utils/tailorPrompt.js';
import mammoth from 'mammoth';
export default {
  components: { CustomDropdown },
  props: ['label', 'placeHolder', 'explanation'],
  data() {
    return {
      files: ['Resume', 'Cover Letter']
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
    const { showToast } = useToast();
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
          showToast('Saved tailored resume locally.', { variant: 'success' });
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

        // Resume upload (base64 + mime type + extracted text)
        const resumeLocal = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['Resume', 'Resume_name', 'Resume_mimeType', 'Resume_extracted_text'], (res) => resolve(res || {}));
        });
        const resumeB64 = String((resumeLocal as any)?.Resume || '').trim();
        const resumeMime = String((resumeLocal as any)?.Resume_mimeType || '').trim() || 'application/pdf';
        const resumeText = String((resumeLocal as any)?.Resume_extracted_text || '').trim();
        if (!resumeB64) throw new Error('Upload a Resume first (Experience tab).');

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

        if (resumeMime !== 'application/pdf' && !resumeText) {
          throw new Error('Upload saved, but resume text is missing. Re-upload your resume and try again.');
        }

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
                    ...(resumeMime === 'application/pdf'
                      ? [
                          {
                            inline_data: {
                              data: resumeB64,
                              mime_type: 'application/pdf',
                            },
                          },
                        ]
                      : [
                          {
                            text: `\n\n--- RESUME_TEXT_START ---\n${resumeText}\n--- RESUME_TEXT_END ---\n`,
                          },
                        ]),
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

        // Best-effort: count AI usage in cloud stats.
        try {
          chrome.runtime.sendMessage({
            action: 'FIREBASE_INCREMENT_STATS',
            customAnswersGenerated: 1,
            setLastCustomAnswer: true,
            source: 'resume_tailor',
          });
        } catch (_) {}

        showTailorModal.value = true;
      } catch (e: any) {
        tailorError.value = String(e?.message || e);
      } finally {
        tailorBusy.value = false;
      }
    };

    const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      let bin = '';
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(bin);
    };

    const sniffResumeFile = (file: File, buf: ArrayBuffer): { kind: 'pdf' | 'docx' | 'txt'; mimeType: string } | null => {
      const nameLower = String(file?.name || '').toLowerCase();
      const type = String(file?.type || '').toLowerCase();
      const bytes = new Uint8Array(buf);

      // PDF magic: %PDF
      if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return { kind: 'pdf', mimeType: 'application/pdf' };
      }

      // DOCX is a zip container (PK\x03\x04)
      if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        // Only allow as DOCX when type/extension matches.
        if (
          type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          nameLower.endsWith('.docx')
        ) {
          return {
            kind: 'docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          };
        }
      }

      // TXT (mime or extension) — signature varies
      if (type === 'text/plain' || nameLower.endsWith('.txt')) {
        return { kind: 'txt', mimeType: 'text/plain' };
      }

      return null;
    };

    const extractTextFromPdf = async (buf: ArrayBuffer): Promise<string> => {
      // pdfjs-dist is large; dynamic import keeps initial popup load smaller.
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: buf, disableWorker: true });
      const pdf = await task.promise;
      const pages: string[] = [];

      for (let i = 1; i <= (pdf.numPages || 0); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const line = (content.items || [])
          .map((it: any) => String(it?.str || '').trim())
          .filter(Boolean)
          .join(' ');
        if (line) pages.push(line);
      }

      return pages.join('\n\n');
    };

    const extractTextFromDocx = async (buf: ArrayBuffer): Promise<string> => {
      const out: any = await (mammoth as any).extractRawText({ arrayBuffer: buf });
      return String(out?.value || '');
    };

    const extractTextFromTxt = async (buf: ArrayBuffer): Promise<string> => {
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
      } catch (_) {
        // Fallback
        return new TextDecoder().decode(new Uint8Array(buf));
      }
    };

    const extractTextFromUpload = async (kind: 'pdf' | 'docx' | 'txt', buf: ArrayBuffer): Promise<string> => {
      if (kind === 'pdf') return await extractTextFromPdf(buf);
      if (kind === 'docx') return await extractTextFromDocx(buf);
      return await extractTextFromTxt(buf);
    };

    const parseResumeFromTextWithGemini = async (apiKey: string, resumeText: string) => {
      const prompt = `Identify and extract information from this resume/profile. You will be given plain text extracted from the resume.
Return ONLY a JSON object with this exact structure:
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
Ensure all keys match the UI labels exactly. For yes/no fields, return "Yes" or "No". For dates, use full month names.`;

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
                  { text: `\n\n--- RESUME_TEXT_START ---\n${resumeText}\n--- RESUME_TEXT_END ---\n` },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      const json = await resp.json().catch(() => ({} as any));
      if (!resp.ok || (json as any)?.error) {
        const msg = (json as any)?.error?.message || `Gemini HTTP ${resp.status}`;
        throw new Error(msg);
      }

      const outText = (json as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!outText) throw new Error('Invalid Gemini response: missing text');

      let s = String(outText);
      const m = s.match(/\{[\s\S]*\}/);
      if (m) s = m[0];

      return JSON.parse(s);
    };

    const saveResume = async (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const buf = await file.arrayBuffer();
        const sniffed = sniffResumeFile(file, buf);
        if (!sniffed) {
          console.warn('Resume upload rejected (unsupported)', { name: file.name, type: file.type });
          showToast('Upload failed — use PDF, DOCX, or TXT.', { variant: 'warning' });
          try {
            (event.target as HTMLInputElement).value = '';
          } catch (_) {}
          loadData();
          return;
        }

        const { kind, mimeType } = sniffed;
        const b64 = arrayBufferToBase64(buf);

        // Store file for Storage upload (full blob) + keep mimeType for SW.
        await new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              [`${props.label + '_name'}`]: file.name,
              [`${props.label + '_mimeType'}`]: mimeType,
              [props.label]: b64,
            } as any,
            () => resolve()
          );
        });

        inputValue.value = file.name;

        // Extract plain text for Gemini.
        const extracted = String((await extractTextFromUpload(kind, buf)) || '').trim();
        if (props.label === 'Resume') {
          try {
            chrome.storage.local.set({ Resume_extracted_text: extracted } as any);
          } catch (_) {}
        }
        if (props.label === 'Cover Letter') {
          try {
            chrome.storage.local.set({ Cover_Letter_extracted_text: extracted } as any);
          } catch (_) {}
        }

        // Only parse the Resume into fields.
        if (!isResumeLabel.value) {
          showToast('Uploaded successfully.', { variant: 'success' });
          return;
        }

        if (!extracted) {
          showToast('Upload saved, but could not extract text. Try a different file.', { variant: 'error' });
          return;
        }

        const apiKey = await new Promise<string>((resolve) => {
          chrome.storage.sync.get(['API Key'], (res) => resolve(String((res as any)?.['API Key'] || '')));
        });

        if (!apiKey) {
          showToast('Upload saved. Add your Gemini API key in Settings to parse it.', { variant: 'warning' });
          return;
        }

        try {
          const resObj = await parseResumeFromTextWithGemini(apiKey, extracted);

          // Save Skills and Experiences to local storage while preserving existing certs
          chrome.storage.local.get(['Resume_details'], (result) => {
            let existing: any = (result as any).Resume_details || { skills: [], experiences: [], certifications: [] };
            if (typeof existing === 'string') {
              try {
                existing = JSON.parse(existing);
              } catch (e) {
                existing = { skills: [], experiences: [], certifications: [] };
              }
            }

            const updatedLocal = {
              skills: resObj.skills || existing.skills || [],
              experiences: resObj.experiences || existing.experiences || [],
              certifications: resObj.certifications || existing.certifications || [],
            };

            chrome.storage.local.set({ Resume_details: updatedLocal }, () => {
              console.log('Resume details (skills/exp) updated in local storage.');
              loadDetails();
            });
          });

          // Save Profile details to sync storage for other InputFields
          if (resObj.profile && typeof resObj.profile === 'object') {
            const profileFields = Object.keys(resObj.profile).filter((k) => (resObj.profile as any)[k]);
            if (profileFields.length > 0) {
              chrome.storage.sync.set(resObj.profile, () => {
                console.log('Profile fields updated in sync storage:', resObj.profile);
                showToast(`Success! Identified ${profileFields.length} profile fields from ${props.label}.`, { variant: 'success' });
              });
            } else {
              console.warn('Gemini returned an empty profile object.');
              showToast('Uploaded successfully, but no profile fields were found.', { variant: 'warning' });
            }
          } else {
            showToast('Upload saved, but the AI response was missing profile fields. Try again.', { variant: 'warning' });
          }
        } catch (e: any) {
          console.error('Gemini resume parse error:', e);
          showToast('Upload saved, but parsing failed. Try again.', { variant: 'error' });
        }
      } catch (e: any) {
        console.error('Resume upload/parse error:', e);
        showToast('Upload failed — please try again (PDF/DOCX/TXT).', { variant: 'error' });
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
        if (inputValue.value == '' && (props.label === "Resume" || props.label === "Cover Letter")) {
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
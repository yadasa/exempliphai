<template>
  <div class="inputFieldDiv">
    <h2 style="align-items: center; display: flex; gap:1rem;">{{ label }} <svg v-if="explanation"
        @click="showExplanation" style='cursor: pointer;' xmlns="http://www.w3.org/2000/svg" height="24px"
        viewBox="0 -960 960 960" width="24px" fill="#5f6368">
        <path
          d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
      </svg></h2>

    <input v-if="!dropDowns.includes(label) && !files.includes(label)" :type="hidden" :placeholder="placeHolder"
      v-model="inputValue" @input="saveData" @focus="onFocus" @blur="onBlur" />
    <div v-if="files.includes(label)" class="inputFieldfileHolder">
      <input v-if="files.includes(label)" type="file" title="" value="" :placeholder="placeHolder"
        @change="saveResume" />
      <h2 v-if="files.includes(label)">{{ inputValue }}</h2>
    </div>

    <select :class=hidden v-if="dropDowns.includes(label)" v-model="inputValue" @change="dropdownPrivacy">

      <option v-for="option in placeHolder" :key="option" :value="option">{{ option }}</option>
    </select>

  </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';
import { usePrivacy } from '@/composables/Privacy';
import { useExplanation } from '@/composables/Explanation.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {
  props: ['label', 'placeHolder', 'explanation'],
  data() {
    return {
      dropDowns: ['Gender', 'Hispanic/Latino', 'Veteran Status', 'Disability Status', 'Degree', 'Start Date Month', 'End Date Month', 'Race', 'Phone Type', 'Issue Date Month', 'Expiration Date Month', 'Pronouns', 'Willing to Relocate', 'Security Clearance'],
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

    return {
      inputValue,
      saveData,
      saveResume,
      hidden,
      onFocus,
      onBlur,
      dropdownPrivacy,
      showExplanation
    };
  },
};
</script>
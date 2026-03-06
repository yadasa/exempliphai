<template>
    <div v-if='isOn' class="modalOverlay" role="dialog" aria-modal="true">
        <div class="modalCard">
            <button class="modalCloseBtn" @click="exit" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                    <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
                </svg>
            </button>

            <div class="modalHeader">
                <h1 class="modalHeaderTitle">Add work experience</h1>
            </div>

            <div class="modalBody">
                <div class="inputFieldDiv">
                    <h2>Job Title</h2>
                    <input placeholder="Software Engineer I" v-model="jobTitle" />
                </div>
                <div class="inputFieldDiv">
                    <h2>Job Employer</h2>
                    <input placeholder="JavaScript" v-model="jobEmployer" />
                </div>
                <div class="inputFieldDiv">
                    <h2>Start Month</h2>
                    <CustomDropdown
                        v-model="startMonth"
                        :options="months"
                        placeholder="Select month"
                        :disabled="false"
                    />
                </div>
                <div class="inputFieldDiv">
                    <h2>Start Year</h2>
                    <input placeholder="2024" v-model="startYear" />
                </div>

                <div class="inputFieldDiv" style="flex-direction: row; align-items: center; gap: 10px;">
                    <input type="checkbox" id="currentJob" v-model="isCurrent" style="width: auto;" />
                    <label for="currentJob">I currently work here</label>
                </div>

                <div v-if="!isCurrent" class="inputFieldDiv">
                    <h2>End Month</h2>
                    <CustomDropdown
                        v-model="endMonth"
                        :options="months"
                        placeholder="Select month"
                        :disabled="false"
                    />
                </div>
                <div v-if="!isCurrent" class="inputFieldDiv">
                    <h2>End Year</h2>
                    <input placeholder="2024" v-model="endYear" />
                </div>
                <div class="textAreaDiv">
                    <h2>Description</h2>
                    <textarea
                        placeholder="• Spearheaded the development of mobile application pages using React Native, Expo, Figma"
                        v-model="roleDescription" />
                </div>
            </div>

            <div class="modalFooter">
                <button class="modalSaveBtn" @click="saveData">SAVE</button>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { ref } from 'vue';
import CustomDropdown from '@/components/CustomDropdown.vue';
import { useWorkExperience } from '@/composables/WorkExperience.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';

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
    'December'
];

export default {
    components: { CustomDropdown },

    setup() {
        const { loadDetails } = useResumeDetails();
        const { isOn, toggleIsOn } = useWorkExperience();
        const jobTitle = ref('');
        const jobEmployer = ref('');
        const startMonth = ref('');
        const startYear = ref('');
        const endMonth = ref('');
        const endYear = ref('');
        const roleDescription = ref('');
        const isCurrent = ref(false);

        const exit = () => {
            jobTitle.value = '';
            jobEmployer.value = '';
            startMonth.value = '';
            startYear.value = '';
            endMonth.value = '';
            endYear.value = '';
            roleDescription.value = '';
            isCurrent.value = false;
            toggleIsOn();
        }
        const saveData = () => {
            // Validate inputs
            if (!jobTitle.value || !jobEmployer.value) {
                console.error('Invalid work experience: Job Title and Employer are required.');
                return;
            }
            
            let experience = {
                "jobTitle": jobTitle.value,
                "jobEmployer": jobEmployer.value,
                "jobDuration": `${startMonth.value} ${startYear.value} - ${isCurrent.value ? 'Present' : (endMonth.value + ' ' + endYear.value)}`,
                "isCurrentEmployer": isCurrent.value,
                "roleBulletsString": roleDescription.value
            };
            if (!chrome.storage) return;
            if (!experience) return;
            chrome.storage.local.get(['Resume_details'], (data) => {
                let jsonData = data['Resume_details'];
                if (jsonData) {
                    if (typeof jsonData === 'string') {
                        try {
                            jsonData = JSON.parse(jsonData);
                        } catch (e) {
                            jsonData = { skills: [], experiences: [] };
                        }
                    }
                    if (typeof jsonData === 'object' && jsonData !== null) {
                        jsonData.experiences = [...Array.isArray(jsonData.experiences) ? jsonData.experiences : [], experience];
                        chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                            console.log(`'Resume_details' saved:`, jsonData);
                        });
                        loadDetails();
                        toggleIsOn();
                    }
                } else {
                    let defaultData = {
                        "skills": [
                            {}
                        ],
                        "experiences": [
                            experience
                        ]
                    }
                    chrome.storage.local.set({ ['Resume_details']: defaultData }, () => {
                        console.log(`'Resume_details' saved:`, data);
                    });
                    loadDetails();
                    toggleIsOn();
                }
            });
        }
        return {
            months,
            isOn, exit, jobTitle, jobEmployer, startMonth, startYear,
            endMonth, endYear, roleDescription, isCurrent,
            saveData
        };
    },
};
</script>
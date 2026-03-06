<template>
    <div v-if='isOn' class="modalOverlay" role="dialog" aria-modal="true">
        <div class="modalCard">
            <button class="modalCloseBtn" @click="exit" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                    <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
                </svg>
            </button>

            <div class="modalHeader">
                <h1 class="modalHeaderTitle">Add Certification</h1>
            </div>

            <div class="modalBody">
                <div class="inputFieldDiv">
                    <h2>Certification Name</h2>
                    <input placeholder="AWS Certified Solutions Architect" v-model="certificationName" />
                </div>
                <div class="inputFieldDiv">
                    <h2>Issuing Organization</h2>
                    <input placeholder="Amazon Web Services" v-model="issuingOrganization" />
                </div>

                <div class="inputFieldDiv">
                    <h2>Issue Month</h2>
                    <CustomDropdown
                        v-model="issueMonth"
                        :options="months"
                        placeholder="Select month"
                        :disabled="false"
                    />
                </div>
                <div class="inputFieldDiv">
                    <h2>Issue Year</h2>
                    <input placeholder="2023" v-model="issueYear" />
                </div>

                <div class="inputFieldDiv">
                    <h2>Expiration Month</h2>
                    <CustomDropdown
                        v-model="expirationMonth"
                        :options="months"
                        placeholder="Select month"
                        :disabled="false"
                    />
                </div>
                <div class="inputFieldDiv">
                    <h2>Expiration Year</h2>
                    <input placeholder="2026" v-model="expirationYear" />
                </div>

                <div class="inputFieldDiv">
                    <h2>Credential ID</h2>
                    <input placeholder="AWS-123456" v-model="credentialId" />
                </div>
                <div class="inputFieldDiv">
                    <h2>Credential URL</h2>
                    <input placeholder="https://aws.amazon.com/..." v-model="credentialUrl" />
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
import { useCertifications } from '@/composables/Certifications.ts';
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
        const { isOn, toggleIsOn } = useCertifications();
        
        const certificationName = ref('');
        const issuingOrganization = ref('');
        const issueMonth = ref('');
        const issueYear = ref('');
        const expirationMonth = ref('');
        const expirationYear = ref('');
        const credentialId = ref('');
        const credentialUrl = ref('');

        const exit = () => {
            certificationName.value = '';
            issuingOrganization.value = '';
            issueMonth.value = '';
            issueYear.value = '';
            expirationMonth.value = '';
            expirationYear.value = '';
            credentialId.value = '';
            credentialUrl.value = '';
            toggleIsOn();
        }

        const saveData = () => {
            if (!certificationName.value) {
                console.error('Certification Name is required.');
                return;
            }

            let certification = {
                "name": certificationName.value,
                "issuer": issuingOrganization.value,
                "issueDate": `${issueMonth.value} ${issueYear.value}`,
                "expirationDate": `${expirationMonth.value} ${expirationYear.value}`,
                "credentialId": credentialId.value,
                "url": credentialUrl.value
            };

            if (!chrome.storage) return;

            chrome.storage.local.get(['Resume_details'], (data) => {
                let jsonData = data['Resume_details'];
                if (jsonData) {
                    if (typeof jsonData === 'string') {
                        try {
                            jsonData = JSON.parse(jsonData);
                        } catch (e) {
                            jsonData = { skills: [], experiences: [], certifications: [] };
                        }
                    }
                } else {
                    jsonData = { skills: [], experiences: [], certifications: [] };
                }

                if (typeof jsonData === 'object' && jsonData !== null) {
                    // Ensure certifications array exists
                    jsonData.certifications = [...Array.isArray(jsonData.certifications) ? jsonData.certifications : [], certification];

                    // Ensure other structures exist
                    if (!Array.isArray(jsonData.experiences)) jsonData.experiences = [];
                    if (!Array.isArray(jsonData.skills)) jsonData.skills = [];

                    chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                        console.log(`'Resume_details' saved:`, jsonData);
                    });
                    loadDetails();
                    toggleIsOn();
                }
            });
        }
        return {
            months,
            isOn, exit, 
            certificationName, issuingOrganization, 
            issueMonth, issueYear, 
            expirationMonth, expirationYear, 
            credentialId, credentialUrl,
            saveData
        };
    },
};
</script>

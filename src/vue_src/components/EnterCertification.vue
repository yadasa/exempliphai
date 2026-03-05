<template>
    <div v-if='isOn' class="explanationBg">
        <button class="modalCloseBtn" @click="exit" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
            </svg>
        </button>
        <h1 class="explanation">Add Certification</h1>
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
            <select v-model="issueMonth">
                <option v-for="option in [
                    'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'
                ]" :key="option" :value="option">{{ option }}</option>
            </select>
        </div>
        <div class="inputFieldDiv">
            <h2>Issue Year</h2>
            <input placeholder="2023" v-model="issueYear" />
        </div>

        <div class="inputFieldDiv">
            <h2>Expiration Month</h2>
            <select v-model="expirationMonth">
                <option v-for="option in [
                    'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'
                ]" :key="option" :value="option">{{ option }}</option>
            </select>
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

        <svg style='cursor: pointer;' @click="saveData" xmlns="http://www.w3.org/2000/svg" height="24px"
            viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
        </svg>
        <svg style='cursor: pointer;' @click="exit" xmlns="http://www.w3.org/2000/svg" height="24px"
            viewBox="0 -960 960 960" width="24px" fill="currentColor">
            <path
                d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
        </svg>
    </div>
</template>

<script lang="ts">
import { ref } from 'vue';
import { useCertifications } from '@/composables/Certifications.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';

export default {
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

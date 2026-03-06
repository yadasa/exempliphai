<template>
    <div v-if='isOn' class="modalOverlay" role="dialog" aria-modal="true">
        <div class="modalCard">
            <button class="modalCloseBtn" @click="exit" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
                    <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
                </svg>
            </button>

            <div class="modalHeader">
                <h1 class="modalHeaderTitle">Add a skill</h1>
            </div>

            <div class="modalBody">
                <div class="inputFieldDiv">
                    <h2></h2>
                    <input placeholder="JavaScript" v-model="inputValue">
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
import { useResumeDetails } from '@/composables/ResumeDetails';
import { useSkills } from '@/composables/Skills.ts';
export default {

    setup() {
        const { loadDetails } = useResumeDetails();
        const { isOn, toggleIsOn } = useSkills();
        const inputValue = ref('');
        const exit = () => {
            inputValue.value = '';
            toggleIsOn();
        }
        const saveData = () => {
            let res = inputValue.value;
            if (!chrome.storage) return;
            if (!res) return;
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
                        jsonData.skills = [...Array.isArray(jsonData.skills) ? jsonData.skills : [], res];
                        chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                            console.log(`'Resume_details' saved:`, jsonData);
                        });
                        toggleIsOn();
                        loadDetails();
                    }
                } else {
                    let defaultData = {
                        "skills": [
                            res
                        ],
                        "experiences": [
                            {}
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
            isOn, exit, inputValue, saveData
        };
    },
};
</script>
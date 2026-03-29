<template>
    <div class="gridFieldDivHolder">
        <h2 style="align-items: center; display: flex; gap:1rem;">{{ label }}</h2>

        <div class="gridFieldDiv">
            <GridDataItem
                v-for="option in dataRef"
                :key="option"
                :value="option"
                :content="option"
                :type="label"
                :class="{ 'gridDataItem--experience': label === 'Work Experience' }"
            />

            <!-- Skills: inline add (type + enter => add bubble) -->
            <template v-if="label === 'Skills'">
                <div
                    v-if="isAddingSkill"
                    class="gridDataItem gridDataItemInput"
                >
                    <input
                        ref="skillInputEl"
                        class="gridDataInlineInput"
                        v-model="skillDraft"
                        placeholder="Add skill"
                        @keydown.enter.prevent="addSkill"
                        @keydown.esc.prevent="cancelSkillAdd"
                        @blur="onSkillBlur"
                    />
                </div>

                <div
                    v-else
                    class="gridDataItem gridDataItemAdd"
                    role="button"
                    tabindex="0"
                    aria-label="Add skill"
                    @click="beginSkillAdd"
                    @keydown.enter.prevent="beginSkillAdd"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="rgba(255,255,255,0.9)">
                        <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
                    </svg>
                </div>
            </template>

            <!-- Everything else keeps the modal-driven + button -->
            <GridDataItem
                v-else
                :type="label"
                :isLast="true"
                :class="{ 'gridDataItem--experience': label === 'Work Experience' }"
            />
        </div>
    </div>
</template>

<script lang="ts">
import { nextTick, ref, watch } from 'vue';
import GridDataItem from '@/components/GridDataItem.vue';
import { useResumeDetails } from '@/composables/ResumeDetails';

export default {
    props: ['label'],
    components: {
        GridDataItem
    },
    setup(props) {
        const dataRef = ref<string[]>([]);
        const { details, loadDetails } = useResumeDetails();

        // Skills inline add
        const isAddingSkill = ref(false);
        const skillDraft = ref('');
        const skillInputEl = ref<HTMLInputElement | null>(null);

        watch(details, (newData: any) => {
            if (props.label == 'Work Experience') {
                dataRef.value = parseExperience(newData?.experiences);
            } else if (props.label == 'Certifications') {
                dataRef.value = parseCertification(newData?.certifications);
            } else {
                dataRef.value = Array.isArray(newData?.skills) ? newData.skills : [];
            }
        }, { immediate: true });

        const parseExperience = (experiences: any) => {
            const returnArr: string[] = [];
            if (!experiences) return returnArr;
            for (const experience of experiences) {
                if (experience?.jobTitle && experience?.jobEmployer) {
                    returnArr.push(`${experience.jobTitle} @ ${experience.jobEmployer}`);
                }
            }
            return returnArr;
        };

        const parseCertification = (certifications: any) => {
            const returnArr: string[] = [];
            if (!certifications) return returnArr;
            for (const cert of certifications) {
                if (cert?.name && cert?.issuer) {
                    returnArr.push(`${cert.name} @ ${cert.issuer}`);
                } else if (cert?.name) {
                    returnArr.push(cert.name);
                }
            }
            return returnArr;
        };

        const beginSkillAdd = async () => {
            isAddingSkill.value = true;
            await nextTick();
            skillInputEl.value?.focus();
        };

        const cancelSkillAdd = () => {
            isAddingSkill.value = false;
            skillDraft.value = '';
        };

        const onSkillBlur = () => {
            // If they click away without typing anything, just close the inline input.
            if (!skillDraft.value.trim()) cancelSkillAdd();
        };

        const addSkill = () => {
            const res = skillDraft.value.trim();
            if (!res) return;
            // Keep input open so they can quickly add multiple skills.
            skillDraft.value = '';
            nextTick(() => skillInputEl.value?.focus());

            if (!chrome?.storage?.local) return;

            chrome.storage.local.get(['Resume_details'], (data) => {
                let jsonData: any = data['Resume_details'];

                if (typeof jsonData === 'string') {
                    try {
                        jsonData = JSON.parse(jsonData);
                    } catch (e) {
                        jsonData = {};
                    }
                }

                if (!jsonData || typeof jsonData !== 'object') jsonData = {};

                const existingSkills = Array.isArray(jsonData.skills)
                    ? jsonData.skills.filter((s: any) => typeof s === 'string' && s.trim())
                    : [];

                if (!existingSkills.includes(res)) existingSkills.push(res);

                jsonData.skills = existingSkills;
                if (!Array.isArray(jsonData.experiences)) jsonData.experiences = [];
                if (!Array.isArray(jsonData.certifications)) jsonData.certifications = [];

                chrome.storage.local.set({ ['Resume_details']: jsonData }, () => {
                    loadDetails();
                });
            });
        };

        return {
            dataRef,
            // skills inline
            isAddingSkill,
            skillDraft,
            skillInputEl,
            beginSkillAdd,
            cancelSkillAdd,
            onSkillBlur,
            addSkill
        };
    },
};
</script>

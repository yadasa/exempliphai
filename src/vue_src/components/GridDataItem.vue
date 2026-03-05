<template>
    <div class="gridDataItem">
        <h1 v-if="content">{{ content }}</h1>
        <svg v-if="!isLast" style='cursor: pointer;' @click="deleteSelf" xmlns="http://www.w3.org/2000/svg"
            height="15px" viewBox="0 -960 960 960" width="15px" fill="rgba(255,255,255,0.4)">
            <path
                d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
        </svg>
        <svg v-if="isLast" style='cursor: pointer;' @click="toggleIsOn" xmlns="http://www.w3.org/2000/svg" height="22px"
            viewBox="0 -960 960 960" width="22px" fill="rgba(255,255,255,0.8)">
            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
        </svg>
    </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';

import { useSkills } from '@/composables/Skills.ts';
import { useWorkExperience } from '@/composables/WorkExperience.ts';
import { useCertifications } from '@/composables/Certifications.ts';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {
    props: ['content', 'isLast', 'type'],
    setup(props) {
        let toggleIsOn: any;
        if (props.type === "Work Experience") toggleIsOn = useWorkExperience().toggleIsOn;
        else if (props.type === "Certifications") toggleIsOn = useCertifications().toggleIsOn;
        else toggleIsOn = useSkills().toggleIsOn;
        const { loadDetails } = useResumeDetails();

        const deleteSelf = () => {
            if (!chrome.storage) return;
            chrome.storage.local.get(['Resume_details'], (data) => {
                let val = data['Resume_details'];
                let res;
                if (val) {
                    if (typeof val === "string") {
                        let jsonData = JSON.parse(val);
                        res = jsonData;

                    } else {
                        res = val;
                    }

                }
                if (res) {
                    if (props.type == "Work Experience" && res.experiences) {
                        let employer = props.content.split('@')[1].trim();
                        let job = props.content.split('@')[0].trim();

                        // Filter out invalid or matching entries
                        if (Array.isArray(res.experiences)) {
                            res.experiences = res.experiences.filter((exp: any) => {
                                return exp.jobEmployer !== employer || exp.jobTitle !== job;
                            });
                        }
                        
                        chrome.storage.local.set({ ['Resume_details']: res }, () => {
                            console.log(`'Resume_details' saved:`);
                            loadDetails();
                        });

                    }
                    if (props.type == "Skills" && res.skills) {
                        const index = res.skills.indexOf(props.content);
                        if (index > -1) {
                            res.skills.splice(index, 1);
                            chrome.storage.local.set({ ['Resume_details']: res }, () => {
                                console.log(`'Resume_details' saved:`);
                                loadDetails();
                            });

                        }
                    }
                    if (props.type == "Certifications" && res.certifications) {
                         let name = props.content;
                         let issuer = "";
                         if (props.content.includes('@')) {
                             name = props.content.split('@')[0].trim();
                             issuer = props.content.split('@')[1].trim();
                         }
                         
                         if (Array.isArray(res.certifications)) {
                             res.certifications = res.certifications.filter((cert: any) => {
                                 if (issuer && cert.issuer) {
                                     return cert.name !== name || cert.issuer !== issuer;
                                 }
                                 return cert.name !== name;
                             });
                         }
                         
                         chrome.storage.local.set({ ['Resume_details']: res }, () => {
                            console.log(`'Resume_details' saved:`);
                            loadDetails();
                        });
                    }



                }
            });
        }
        return {
            toggleIsOn, deleteSelf
        };
    },
};
</script>
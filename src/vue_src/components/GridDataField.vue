<template>
    <div class="gridFieldDivHolder">
        <h2 style="align-items: center; display: flex; gap:1rem;">{{ label }}</h2>
        <div class="gridFieldDiv">

            <GridDataItem v-for="option in dataRef" :key="option" :value="option" :content="option" :type="label">
            </GridDataItem>
            <GridDataItem :type="label" isLast=true updateData="loadData" />
        </div>


    </div>
</template>

<script lang="ts">
import { ref, watch } from 'vue';
import GridDataItem from '@/components/GridDataItem.vue';
import { useResumeDetails } from '@/composables/ResumeDetails';
export default {
    props: ['label'],
    components: {
        GridDataItem
    },
    setup(props) {
        // Declare a reactive input value using Vue's ref
        const inputValue = ref('');
        const dataRef = ref<string[]>([]);
        const { details } = useResumeDetails();

        watch(details, (newData: any) => {
            console.log(newData)
            if (props.label == "Work Experience") {
                dataRef.value = parseExperience(newData.experiences);
            } else if (props.label == "Certifications") {
                dataRef.value = parseCertification(newData.certifications);
            } else {
                dataRef.value = newData.skills;
            }
        });
        const parseExperience = (experiences: any) => {
            let returnArr = <string[]>[];
            if (!experiences) return returnArr;
            for (let experience of experiences) {
                if (experience.jobTitle && experience.jobEmployer) {
                    returnArr.push(`${experience.jobTitle} @ ${experience.jobEmployer}`)
                }
            }
            return returnArr;
        }
        const parseCertification = (certifications: any) => {
            let returnArr = <string[]>[];
            if (!certifications) return returnArr;
            for (let cert of certifications) {
                if (cert.name && cert.issuer) {
                    returnArr.push(`${cert.name} @ ${cert.issuer}`)
                } else if (cert.name) {
                     returnArr.push(cert.name)
                }
            }
            return returnArr;
        }

        return {
            inputValue,
            dataRef,
        };
    },
};
</script>
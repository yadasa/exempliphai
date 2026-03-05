import { ref, computed } from 'vue';

const details = ref({});
export function useResumeDetails() {
  const loadDetails = () => {
    if (!chrome.storage) return;
    chrome.storage.local.get('Resume_details', (data) => {
        let val = data['Resume_details'];
        if (val) {
            if(typeof val === "string") {
                try {
                    let jsonData = JSON.parse(val);
                    details.value = jsonData;
                } catch (e) {
                    console.error("ResumeDetails: Failed to parse storage data", e);
                    details.value = {};
                }
                return;
            }
            details.value = val;
        } else {
            details.value = {};
        }
    });
};
loadDetails();
  return {
    details: computed(() => details.value), 
    loadDetails
  };
}

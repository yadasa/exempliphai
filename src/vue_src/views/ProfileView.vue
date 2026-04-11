<script setup lang="ts">
import InputField from '@/components/InputField.vue';
import SignInGate from '@/components/SignInGate.vue';
import { useIsAuthed } from '@/composables/Auth';
import { onBeforeUnmount, onMounted, ref } from 'vue';

const { isAuthed } = useIsAuthed();

const syncStatus = ref<string>('');

async function refreshStatus() {
  try {
    const got = await chrome.storage.local.get(['firebaseSync_status']);
    syncStatus.value = String((got as any)?.firebaseSync_status || '');
  } catch (_) {
    syncStatus.value = '';
  }
}

function prettyStatus(s: string) {
  if (s === 'saving') return 'Saving…';
  // Kei preference: hide "Synced" label (too noisy).
  if (s === 'synced') return '';
  if (s === 'offline') return 'Offline (queued)';
  return '';
}

const onChanged = (changes: any, area: string) => {
  if (area !== 'local') return;
  if (changes?.firebaseSync_status) refreshStatus();
};

onMounted(() => {
  refreshStatus();
  try {
    chrome.storage.onChanged.addListener(onChanged as any);
  } catch (_) {}
});

onBeforeUnmount(() => {
  try {
    chrome.storage.onChanged.removeListener(onChanged as any);
  } catch (_) {}
});
</script>

<template>
  <SignInGate v-if="isAuthed === false" />
  <div v-else-if="isAuthed === null" class="action-card" style="padding: 14px; opacity: 0.85;">
    Loading…
  </div>
  <div v-else style="position: relative;">
    <div v-if="prettyStatus(syncStatus)" class="syncStatusPill">
      {{ prettyStatus(syncStatus) }}
    </div>
    <InputField label="First Name" placeHolder="John" />
    <InputField label="Middle Name" placeHolder="Quincy" />
    <InputField label="Last Name" placeHolder="Pork" />
    <InputField label="Full Name" placeHolder="John Pork Sr." />
    <InputField label="Email" placeHolder="jpork@mit.edu" />
    <InputField label="Phone" placeHolder="123-345-6789" />
    <InputField label="Phone Type" :placeHolder="['Landline', 'Mobile', 'Office Phone']" />

    <h2 class="subheading">Socials</h2>
    <InputField label="LinkedIn" placeHolder="https://linkedin.com/in/johnpork" />
    <InputField label="Github" placeHolder="https://github.com/andrewmillercode" />
    <InputField label="LeetCode" placeHolder="https://leetcode.com/..." />
    <InputField label="Medium" placeHolder="https://medium.com/@..." />
    <InputField label="Personal Website" placeHolder="johnpork.com" />
    <InputField label="Other URL" placeHolder="https://..." />

    <h2 class="subheading">Location</h2>
    <InputField label="Location (Street)" placeHolder="123 Sesame St" />
    <InputField label="Location (City)" placeHolder="Albuquerque" />
    <InputField label="Location (State/Region)" placeHolder="New Mexico" />
    <InputField label="Location (Country)" placeHolder="United States of America" />
    <InputField label="Postal/Zip Code" placeHolder="87104" />

    <h2 class="subheading">Additional Information</h2>
    <InputField label="Legally Authorized to Work" :placeHolder="['Yes', 'No']" />
    <InputField label="Requires Sponsorship" :placeHolder="['Yes', 'No']" />
    <InputField label="Job Notice Period" placeHolder="Two weeks" />
    <InputField label="Expected Salary" placeHolder="$150,000" />
    <InputField label="Languages" placeHolder="English, Spanish" />
    <InputField label="Willing to Relocate" :placeHolder="['Yes', 'No']" />
    <InputField label="Date Available" placeHolder="Immediately" />
    <InputField label="Security Clearance" :placeHolder="['Yes', 'No']" />

    <h2 class="subheading">Voluntary Identification</h2>
    <InputField label="Pronouns" :placeHolder="['He/Him', 'She/Her', 'They/Them', 'Decline To Self Identify', 'Other']" />
    <InputField label="Gender" :placeHolder="['Male', 'Female', 'Decline To Self Identify']" />
    <InputField
      label="Race"
      :placeHolder="[
        'American Indian or Alaskan Native',
        'Asian',
        'Black or African American',
        'White',
        'Native Hawaiian or Other Pacific Islander',
        'Two or More Races',
        'Decline To Self Identify'
      ]"
    />
    <InputField label="Hispanic/Latino" :placeHolder="['Yes', 'No', 'Decline To Self Identify']" />
    <InputField
      label="Veteran Status"
      :placeHolder="['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', 'I don\'t wish to answer']"
    />
    <InputField
      label="Disability Status"
      :placeHolder="['Yes, I have a disability, or have had one in the past', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer']"
    />
  </div>
</template>

<style scoped>
.syncStatusPill {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-primary) 75%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  backdrop-filter: blur(10px);
  pointer-events: none;
}
</style>

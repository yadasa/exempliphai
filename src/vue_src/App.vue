<script setup lang="ts">
//Component imports
import InputField from '@/components/InputField.vue';
import GridDataField from '@/components/GridDataField.vue';
import PrivacyToggle from '@/components/PrivacyToggle.vue';
import Explanation from '@/components/Explanation.vue';
import EnterSkill from '@/components/EnterSkill.vue';
import EnterWorkExperience from '@/components/EnterWorkExperience.vue';
import EnterCertification from '@/components/EnterCertification.vue';
import JobTracker from '@/components/JobTracker.vue';
import JobSearch from '@/components/JobSearch.vue';
import SettingsTab from '@/components/SettingsTab.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { useTheme } from '@/composables/Theme';

import { ref, nextTick, onMounted } from 'vue';

const { loadTheme } = useTheme();
const activeTab = ref('profile');

onMounted(() => {
  loadTheme();

  chrome.action?.onClicked?.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AI_REPLY' });
    });
  });
});

const setTab = async (tab: string) => {
  activeTab.value = tab;
  await nextTick();
  const contentArea = document.querySelector('.content-area');
  if (contentArea) {
    contentArea.scrollTop = 0;
  }
};

</script>


<template>
  <EnterWorkExperience/>
  <EnterSkill/>
  <EnterCertification />
  <Explanation/>
  
  <div class="app-container">
      <div class="headerDiv">
        <h1 class="aSelfTop">Exempliphai</h1>
        <div class="aRight gap-2">
          <ThemeToggle />
          <PrivacyToggle />
        </div>
      </div>
      
      <div class="content-area px-4">
          <!-- Profile Tab -->
          <div v-if="activeTab === 'profile'">
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
              <InputField label="Race" :placeHolder="[
              'American Indian or Alaskan Native',
              'Asian',
              'Black or African American',
              'White',
              'Native Hawaiian or Other Pacific Islander',
              'Two or More Races',
              'Decline To Self Identify'
            ]" />
              <InputField label="Hispanic/Latino" :placeHolder="['Yes', 'No', 'Decline To Self Identify']" />
              <InputField label="Veteran Status"
                :placeHolder="['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', 'I don\'t wish to answer']" />
              <InputField label="Disability Status"
                :placeHolder="['Yes, I have a disability, or have had one in the past', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer']" />
          </div>
          
          <!-- Experience Tab -->
          <div v-if="activeTab === 'experience'">
               <InputField  label="Resume" placeHolder="No file found"/>
               <InputField  label="LinkedIn PDF" placeHolder="No file found"/>
               <h2 class="subheading">Work Experience</h2>
               <InputField label="Current Employer" placeHolder="Apple" />
               <InputField label="Years of Experience" placeHolder="5" />
               <GridDataField label="Work Experience" />
               
               <GridDataField label="Skills" />
               <GridDataField label="Certifications" />
               
               <h2 class="subheading">Education</h2>
               <InputField label="School" placeHolder="Massachusetts Institute of Technology" />
               <InputField label="Degree" :placeHolder="[
                 'Associate\'s Degree',
                 'Bachelor\'s Degree',
                 'Doctor of Medicine (M.D.)',
                 'Doctor of Philosophy (Ph.D.)',
                 'Engineer\'s Degree',
                 'High School',
                 'Juris Doctor (J.D.)',
                 'Master of Business Administration (M.B.A.)',
                 'Master\'s Degree',
                 'Other'
               ]" />
               <InputField label="Discipline" placeHolder="Computer Science" />
               <InputField label="Start Date Month" :placeHolder="[
                 'January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'
               ]" />
               <InputField label="Start Date Year" placeHolder="2024" />
               <InputField label="End Date Month" :placeHolder="[
                 'January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'
               ]" />
               <InputField label="End Date Year" placeHolder="2025" />
               <InputField label="GPA" placeHolder="3.94" />
          </div>
          
          <!-- Dashboard Tab -->
          <div v-if="activeTab === 'dashboard'">
              <JobTracker />
          </div>

          <!-- Job Search Tab -->
          <div v-if="activeTab === 'jobSearch'">
              <JobSearch />
          </div>
          
          <!-- Settings Tab -->
          <div v-if="activeTab === 'settings'">
              <SettingsTab />
          </div>
      </div>
      
      <!-- Tab Bar -->
      <div class="tab-bar">
          <button @click="setTab('profile')" :class="{ active: activeTab === 'profile' }">
             <span class="tab-icon">👤</span> Profile
          </button>
          <button @click="setTab('experience')" :class="{ active: activeTab === 'experience' }">
             <span class="tab-icon">💼</span> Experience
          </button>
          <button @click="setTab('dashboard')" :class="{ active: activeTab === 'dashboard' }">
             <span class="tab-icon">📊</span> Dashboard
          </button>
          <button @click="setTab('jobSearch')" :class="{ active: activeTab === 'jobSearch' }">
             <span class="tab-icon">🔎</span> Job Search
          </button>
          <button @click="setTab('settings')" :class="{ active: activeTab === 'settings' }">
             <span class="tab-icon">⚙️</span> Settings
          </button>
      </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 600px; /* Fixed height for extension popup */
  width: 400px;
  background: var(--bg-primary);
}

.content-area {
  flex: 1;
  overflow: auto;
  padding-top: 0.25rem;
  /* Fix cut-off (e.g., Disability Status) behind fixed tab bar */
  padding-bottom: calc(var(--tab-bar-height) + 28px);
}

.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: var(--tab-bar-height);
  background: var(--tab-bar-bg);
  backdrop-filter: blur(10px);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid var(--tab-border-top);
  z-index: 100;
  box-shadow: 0 -10px 30px rgba(15, 23, 42, 0.10);
}

.tab-bar button {
  background: none;
  border: none;
  color: var(--tab-text-inactive);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.78rem;
  font-weight: 600;
  transition: transform 0.12s ease, color 0.12s ease;
}

.tab-bar button:hover {
  transform: translateY(-1px);
}

.tab-bar button.active {
  color: var(--accent-color);
}

.tab-icon {
  font-size: 1.15rem;
  margin-bottom: 2px;
}
</style>

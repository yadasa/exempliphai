<script setup lang="ts">
import InputField from '@/components/InputField.vue';
import GridDataField from '@/components/GridDataField.vue';
</script>

<template>
  <div>
    <InputField label="Resume" placeHolder="No file found" />
    <InputField label="LinkedIn PDF" placeHolder="No file found" />

    <h2 class="subheading">Work Experience</h2>
    <InputField label="Current Employer" placeHolder="Apple" />
    <InputField label="Years of Experience" placeHolder="5" />
    <GridDataField label="Work Experience" />

    <GridDataField label="Skills" />
    <GridDataField label="Certifications" />

    <h2 class="subheading">Education</h2>
    <InputField label="School" placeHolder="Massachusetts Institute of Technology" />
    <InputField
      label="Degree"
      :placeHolder="[
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
      ]"
    />
    <InputField label="Discipline" placeHolder="Computer Science" />
    <InputField
      label="Start Date Month"
      :placeHolder="[
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
      ]"
    />
    <InputField label="Start Date Year" placeHolder="2024" />
    <InputField
      label="End Date Month"
      :placeHolder="[
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
      ]"
    />
    <InputField label="End Date Year" placeHolder="2025" />
    <InputField label="GPA" placeHolder="3.94" />
  </div>
</template>

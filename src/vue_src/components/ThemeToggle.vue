<template>
  <button @click="toggleTheme" class="themeToggle" :title="theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
    <!-- Sun Icon for Light Mode -->
    <svg v-if="theme === 'dark'" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0 72q-80 0-136-56t-56-136q0-80 56-136t136-56q80 0 136 56t56 136q0 80-56 136t-136 56Zm0 72q-15 0-25.5-10.5T444-252v-72q0-15 10.5-25.5T480-360q15 0 25.5 10.5T516-324v72q0 15-10.5 25.5T480-216Zm0-432q-15 0-25.5-10.5T444-684v-72q0-15 10.5-25.5T480-792q15 0 25.5 10.5T516-756v72q0 15-10.5 25.5T480-648ZM216-444q-15 0-25.5-10.5T180-480q0-15 10.5-25.5T216-516h72q15 0 25.5 10.5T324-480q0 15-10.5 25.5T288-444h-72Zm432 0q-15 0-25.5-10.5T612-480q0-15 10.5-25.5T648-516h72q15 0 25.5 10.5T756-480q0 15-10.5 25.5T720-444h-72ZM284-233q-11 11-25.5 10.5T233-234q-11-11-10.5-25.5T234-285l51-51q11-11 25.5-10.5T336-335q11 11 10.5 25.5T335-284l-51 51Zm442-442q-11 11-25.5 10.5T675-676q-11-11-10.5-25.5T676-727l51-51q11-11 25.5-10.5T778-777q11 11 10.5 25.5T777-726l-51 51ZM234-676q-11-11-10.5-25.5T235-727l51-51q11-11 25.5-10.5T337-778q11 11 10.5 25.5T336-727l-51 51q-11 11-25.5 10.5T234-676Zm442 442q-11-11-10.5-25.5T677-285l51 51q11 11 25.5 10.5T779-234q11 11 10.5 25.5T778-233l-51-51q-11 11-25.5 10.5T676-234Z"/>
    </svg>
    <!-- Moon Icon for Dark Mode -->
    <svg v-else xmlns="http://www.w3.org/2000/vue" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
        <path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q52 0 98.5-24.5T836-534q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-72q70 0 123-37.5T684-331q-21 7-42 10.5t-42 3.5q-120 0-204-84t-84-204q0-21 3.5-42t10.5-42q-64 28-101 81T292-480q0 112 78 190t190 78Zm-2-288Z"/>
    </svg>
  </button>
</template>

<script lang="ts">
import { useTheme } from '@/composables/Theme';
import { onMounted } from 'vue';

export default {
  setup() {
    const { theme, toggleTheme, loadTheme } = useTheme();

    onMounted(() => {
      loadTheme();
    });

    return {
      theme,
      toggleTheme
    };
  }
};
</script>

<style scoped>
.themeToggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  transition: background-color 0.3s;
}

.themeToggle:hover {
  background-color: var(--bg-secondary);
}
</style>

import { createRouter, createWebHashHistory } from 'vue-router';

import ProfileView from '@/views/ProfileView.vue';
import ExperienceView from '@/views/ExperienceView.vue';
import DashboardView from '@/views/DashboardView.vue';
import JobSearchView from '@/views/JobSearchView.vue';
import SettingsView from '@/views/SettingsView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/profile' },
    { path: '/profile', name: 'profile', component: ProfileView },
    { path: '/experience', name: 'experience', component: ExperienceView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/job-search', name: 'job-search', component: JobSearchView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
});

export default router;

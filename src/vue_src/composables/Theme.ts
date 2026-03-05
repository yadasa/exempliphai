import { ref, watch } from 'vue';

const theme = ref<'light' | 'dark'>('light');

export function useTheme() {
    const key = "ThemeSetting";

    const loadTheme = () => {
        if (!chrome.storage) {
            applyTheme('light');
            return;
        }
        chrome.storage.sync.get([key], (data) => {
            if (data[key]) {
                theme.value = data[key];
            } else {
                theme.value = 'light'; // Default
            }
            applyTheme(theme.value);
        });
    };

    const toggleTheme = () => {
        theme.value = theme.value === 'light' ? 'dark' : 'light';
        applyTheme(theme.value);
        if (chrome.storage) {
            chrome.storage.sync.set({ [key]: theme.value });
        }
    };

    const applyTheme = (currentTheme: 'light' | 'dark') => {
        document.documentElement.setAttribute('data-theme', currentTheme);
    };

    const setTheme = (newTheme: 'light' | 'dark') => {
        theme.value = newTheme;
        applyTheme(newTheme);
    }

    return {
        theme,
        toggleTheme,
        loadTheme,
        setTheme
    };
}

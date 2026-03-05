<template>
    <div class="settingsTab">
        <h2 class="subheading">General</h2>
        <InputField label="API Key" explanation="The API Key field requires a Gemini-1.5-flash api key." placeHolder="AIyKwaSyBTOk..." />
        <p style="margin-top: 0.5rem; color: var(--text-secondary); font-size: 0.9rem;">
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--accent-color); text-decoration: none;">Get a free API Key here</a>
        </p>
        
        <h2 class="subheading">Data Management</h2>
        <div class="data-actions">
            <div class="action-card">
                <h3>Export Data</h3>
                <p>Download a backup of your profile and resume data.</p>
                <button @click="exportData" class="action-btn export-btn">Export to JSON</button>
            </div>
            
            <div class="action-card">
                <h3>Cloud Sync (Experimental)</h3>
                <p>Sync your job history to your Google account. Limited to the most recent 100 jobs.</p>
                <div class="toggle-container">
                    <label class="switch">
                        <input type="checkbox" v-model="cloudSyncEnabled" @change="toggleCloudSync" />
                        <span class="slider round"></span>
                    </label>
                    <span>Enable Cloud Sync</span>
                </div>
            </div>

            <div class="action-card">
                <h3>Import Data</h3>
                <p>Restore your data from a JSON backup file.</p>
                <input type="file" ref="fileInput" @change="importData" accept=".json" style="display: none" />
                <button @click="triggerFileInput" class="action-btn import-btn">Import from JSON</button>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { ref } from 'vue';
import InputField from '@/components/InputField.vue';

export default {
    components: {
        InputField
    },
    setup() {
        const fileInput = ref<HTMLInputElement | null>(null);
        const cloudSyncEnabled = ref(false);

        const loadSettings = async () => {
            if (!chrome.storage) return;
            chrome.storage.sync.get(['cloudSyncEnabled'], (result) => {
                cloudSyncEnabled.value = !!result.cloudSyncEnabled;
            });
        };

        const toggleCloudSync = () => {
             chrome.storage.sync.set({ cloudSyncEnabled: cloudSyncEnabled.value }, () => {
                 console.log("Cloud sync toggled:", cloudSyncEnabled.value);
             });
        };

        loadSettings();

        const exportData = async () => {
            if (!chrome.storage) return;

            const syncData = await new Promise((resolve) => chrome.storage.sync.get(null, (res) => resolve(res || {}))) as any;
            const localData = await new Promise((resolve) => chrome.storage.local.get(null, (res) => resolve(res || {})));

            // Security: Don't export the API Key
            if (syncData && typeof syncData === 'object') {
                delete syncData['API Key'];
            }

            const exportObj = {
                sync: syncData,
                local: localData,
                exportDate: new Date().toISOString(),
                version: "1.0"
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "autofill_jobs_backup.json");
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        };

        const triggerFileInput = () => {
            fileInput.value?.click();
        };

        const importData = (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result as string;
                    const data = JSON.parse(content);

                    if (data.sync) {
                        chrome.storage.sync.set(data.sync, () => {
                            console.log('Sync data imported');
                        });
                    }
                    if (data.local) {
                        chrome.storage.local.set(data.local, () => {
                            console.log('Local data imported');
                            alert('Data imported successfully! Please reload the extension.');
                        });
                    }
                } catch (error) {
                    console.error('Error importing data:', error);
                    alert('Failed to import data. Invalid JSON file.');
                }
            };
            reader.readAsText(file);
        };

        return {
            exportData,
            importData,
            triggerFileInput,
            fileInput,
            cloudSyncEnabled,
            toggleCloudSync
        };
    }
};
</script>

<style scoped>
.settingsTab {
    padding: 0.25rem 0;
}

.data-actions {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.action-card {
    background: var(--card-bg);
    padding: 1rem;
    border-radius: 14px;
    border: 1px solid var(--card-border);
    box-shadow: var(--shadow-1);
}

.action-card h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
    font-weight: 800;
    letter-spacing: -0.02em;
}

.action-card p {
    font-size: 0.95rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
    line-height: 1.45;
}

.action-btn {
    padding: 0.7rem 1rem;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    font-weight: 800;
    width: 100%;
    transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
}

.export-btn {
    background: var(--gradient-primary);
    color: white;
    box-shadow: 0 18px 35px rgba(102, 126, 234, 0.25);
}

.import-btn {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
    box-shadow: 0 18px 35px rgba(34, 197, 94, 0.22);
}

.action-btn:hover {
    transform: translateY(-1px);
    filter: brightness(1.02);
}

.toggle-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    color: var(--text-primary);
    font-weight: 600;
}

/* Toggle Switch Styles */
.switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(15, 23, 42, 0.18);
  border: 1px solid var(--border-color);
  transition: .25s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 2px;
  background: #fff;
  transition: .25s;
  box-shadow: var(--shadow-1);
}

input:checked + .slider {
  background: color-mix(in srgb, var(--accent-color) 85%, #fff);
}

input:checked + .slider:before {
  transform: translateX(24px);
}

.slider.round {
  border-radius: 999px;
}

.slider.round:before {
  border-radius: 999px;
}
</style>

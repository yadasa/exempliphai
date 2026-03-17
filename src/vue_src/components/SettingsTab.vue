<template>
    <div class="settingsTab">
        <h2 class="subheading">General</h2>
        <InputField label="API Key" explanation="The API Key field requires a Gemini-1.5-flash api key." placeHolder="AIyKwaSyBTOk..." />
        <p style="margin-top: 0.5rem; color: var(--text-secondary); font-size: 0.9rem;">
            <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--accent-color); text-decoration: none;">Get a free API Key here</a>
        </p>

        <div class="toggle-container" style="margin: 0.75rem 0 0.35rem 0;">
            <label class="switch">
                <input type="checkbox" v-model="autoSubmitEnabled" @change="toggleAutoSubmit" />
                <span class="slider round"></span>
            </label>
            <span>Auto-submit after autofill</span>
        </div>
        <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.35;">
            When enabled, Exempliphai will try to click the page’s <b>Submit</b>/<b>Next</b>/<b>Continue</b> button after it finishes autofilling.
        </p>


        <h2 class="subheading">List Mode (Batch Apply)</h2>
        <div class="action-card" style="margin-bottom: 1rem;">
            <div class="toggle-container" style="margin: 0.25rem 0 0.5rem 0;">
                <label class="switch">
                    <input type="checkbox" v-model="listModeEnabled" @change="toggleListMode" />
                    <span class="slider round"></span>
                </label>
                <span>Enable List mode</span>
            </div>

            <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.35;">
                Upload a CSV with a <b>url</b> column (optional <b>notes</b>). When running, Exempliphai will open each URL in a new tab, autofill it,
                optionally auto-submit (if enabled above), then advance to the next URL.
                <br />
                <span style="opacity: 0.9;">Safety: max 50 URLs, 30s delay between opening tabs.</span>
            </p>

            <div class="toggle-container" style="margin: 0.75rem 0 0.35rem 0; opacity: 0.98;">
                <label class="switch">
                    <input type="checkbox" v-model="closePreviousTabs" @change="toggleClosePreviousTabs" :disabled="!listModeEnabled" />
                    <span class="slider round"></span>
                </label>
                <span>Close previous tabs after next opens</span>
            </div>
            <p class="text-warning small close-prev-tabs-warning">
                Warning: Some apps require manual review; closing may discard unsaved progress.
            </p>
            <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.35;">
                When enabled, Exempliphai will close the prior list-mode tab after the next one finishes loading.
            </p>

            <input type="file" ref="csvInput" @change="importCsv" accept=".csv,text/csv" style="display: none" />
            <button @click="triggerCsvInput" class="action-btn export-btn" :disabled="!listModeEnabled">Upload CSV</button>

            <div v-if="queueTotal > 0" class="listmode-status">
                <div class="status-row"><b>Status:</b> <span>{{ listModePaused ? 'Paused' : 'Running' }}</span></div>
                <div class="status-row"><b>Progress:</b> {{ displayIndex }} / {{ queueTotal }}
                    <span style="opacity:0.85;">(done {{ queueDone }}, pending {{ queuePending }}, error {{ queueError }})</span>
                </div>
                <div class="status-row" v-if="activeTabId"><b>Active Tab:</b> {{ activeTabId }}</div>
                <div class="status-row" v-if="activeJobUrl"><b>Active URL:</b> <a :href="activeJobUrl" target="_blank">open</a></div>
                <div class="status-row" v-if="currentNotes"><b>Notes:</b> {{ currentNotes }}</div>
                <div class="status-row" v-if="nextOpenInSeconds !== null"><b>Next tab in:</b> {{ nextOpenInSeconds }}s</div>
            </div>

            <div class="listmode-actions">
                <button @click="startListMode" class="action-btn export-btn" :disabled="!listModeEnabled || queueTotal === 0 || !listModePaused">
                    Start / Resume
                </button>
                <button @click="pauseListMode" class="action-btn import-btn" :disabled="!listModeEnabled || listModePaused">
                    Pause
                </button>
                <button @click="skipCurrent" class="action-btn" style="margin-top: 0.5rem; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; box-shadow: 0 18px 35px rgba(245, 158, 11, 0.22);" :disabled="!listModeEnabled || queueTotal === 0">
                    Skip current
                </button>
                <button @click="clearList" class="action-btn" style="margin-top: 0.5rem; background: linear-gradient(135deg, #ef4444, #b91c1c); color: white; box-shadow: 0 18px 35px rgba(239, 68, 68, 0.22);" :disabled="queueTotal === 0">
                    Clear queue
                </button>
            </div>
        </div>
        
        <h2 class="subheading">Data Management</h2>
        <div class="data-actions">
            <div class="action-card">
                <h3>AI</h3>
                <p>Generate an answer for the last right-clicked field.</p>

                <div class="toggle-container" style="margin: 0.75rem 0 0.5rem 0;">
                    <label class="switch">
                        <input type="checkbox" v-model="aiMappingEnabled" @change="toggleAiMapping" />
                        <span class="slider round"></span>
                    </label>
                    <span>Enable AI-assisted autofill (field mapping)</span>
                </div>
                <p style="margin-top: 0; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.35;">
                    Sends only form field labels/options + a list of your saved profile key names to Gemini (not your profile values).
                </p>

                <button @click="triggerAI" class="action-btn export-btn">AI Answer Last Right-Click Field</button>
                <button @click="generateAllPending" class="action-btn export-btn" style="margin-top: 0.5rem;">Generate All Pending</button>
            </div>

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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import InputField from '@/components/InputField.vue';

type JobQueueItem = {
    url: string;
    notes?: string;
    status?: 'pending' | 'done' | 'error';
    attempts?: number;
    noClickCount?: number;
    lastError?: string;
    lastUrl?: string;
    updatedAt?: string;
    completedAt?: string;
};

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = '';
    let inQuotes = false;

    const src = String(text || '');

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];

        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            continue;
        }

        if (ch === ',') {
            row.push(cur);
            cur = '';
            continue;
        }

        if (ch === '\n') {
            row.push(cur);
            rows.push(row.map((c) => String(c ?? '').trim()));
            row = [];
            cur = '';
            continue;
        }

        if (ch === '\r') continue;

        cur += ch;
    }

    row.push(cur);
    rows.push(row.map((c) => String(c ?? '').trim()));

    return rows.filter((r) => r.some((c) => String(c || '').trim() !== ''));
}

function buildQueueFromCsv(text: string): Array<{ url: string; notes?: string }> {
    const rows = parseCsv(text);
    if (!rows.length) return [];

    const first = rows[0] || [];

    // Headered CSV (preferred)
    const header = first.map((h) => String(h || '').trim().toLowerCase());
    let urlIdx = header.findIndex((h) => h === 'url' || h === 'job_url' || h === 'job url' || h === 'link');
    let notesIdx = header.findIndex((h) => h === 'notes' || h === 'note');

    let startRow = 1;

    // Headerless CSV fallback: first cell looks like a URL
    if (urlIdx === -1 && /^https?:\/\//i.test(String(first?.[0] || '').trim())) {
        urlIdx = 0;
        notesIdx = 1;
        startRow = 0;
    }

    if (urlIdx === -1) {
        throw new Error('CSV must include a header column named "url"');
    }

    const out: Array<{ url: string; notes?: string }> = [];

    for (const r of rows.slice(startRow)) {
        const url = String(r?.[urlIdx] || '').trim();
        if (!url) continue;
        const notes = notesIdx >= 0 ? String(r?.[notesIdx] || '').trim() : '';
        out.push({ url, notes });
    }

    return out;
}

function sendMessage<T = any>(msg: any): Promise<T> {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                resolve(resp as T);
            });
        } catch (e) {
            resolve({ ok: false, error: String((e as any)?.message || e) } as any);
        }
    });
}

export default {
    components: {
        InputField
    },
    setup() {
        const fileInput = ref<HTMLInputElement | null>(null);
        const csvInput = ref<HTMLInputElement | null>(null);

        const cloudSyncEnabled = ref(false);
        const aiMappingEnabled = ref(false);
        const autoSubmitEnabled = ref(false);
        const listModeEnabled = ref(false);
        const closePreviousTabs = ref(false);

        const jobQueue = ref<JobQueueItem[]>([]);
        const currentIndex = ref(0);
        const listModePaused = ref(true);
        const listModeActiveJob = ref<any | null>(null);
        const listModeNextOpenAt = ref<number>(0);

        const nowTick = ref(Date.now());
        let tickTimer: number | null = null;

        const queueTotal = computed(() => jobQueue.value.length);
        const queueDone = computed(() => jobQueue.value.filter((j) => j?.status === 'done').length);
        const queueError = computed(() => jobQueue.value.filter((j) => j?.status === 'error').length);
        const queuePending = computed(() => queueTotal.value - queueDone.value - queueError.value);

        const displayIndex = computed(() => {
            const total = queueTotal.value;
            if (!total) return 0;
            const idx = Number.isFinite(listModeActiveJob.value?.index)
                ? listModeActiveJob.value.index
                : currentIndex.value;
            return Math.min(Math.max(0, idx) + 1, total);
        });

        const activeTabId = computed(() => {
            const id = (listModeActiveJob.value as any)?.tabId;
            return Number.isFinite(id) ? id : null;
        });

        const activeJobUrl = computed(() => String(listModeActiveJob.value?.url || ''));

        const currentNotes = computed(() => {
            const idx = Number.isFinite(listModeActiveJob.value?.index)
                ? listModeActiveJob.value.index
                : currentIndex.value;
            return String(jobQueue.value?.[idx]?.notes || '').trim();
        });

        const nextOpenInSeconds = computed(() => {
            const t = Number(listModeNextOpenAt.value || 0);
            if (!t || t <= nowTick.value) return null;
            return Math.max(0, Math.ceil((t - nowTick.value) / 1000));
        });

        const loadSettings = async () => {
            if (!chrome?.storage) return;
            chrome.storage.sync.get(['cloudSyncEnabled', 'aiMappingEnabled', 'autoSubmitEnabled', 'listModeEnabled', 'closePreviousTabs'], (result) => {
                cloudSyncEnabled.value = !!(result as any).cloudSyncEnabled;
                aiMappingEnabled.value = !!(result as any).aiMappingEnabled;
                autoSubmitEnabled.value = !!(result as any).autoSubmitEnabled;
                listModeEnabled.value = !!(result as any).listModeEnabled;
                closePreviousTabs.value = !!(result as any).closePreviousTabs;
            });
        };

        const loadListModeState = async () => {
            if (!chrome?.storage) return;
            chrome.storage.local.get(['jobQueue', 'currentIndex', 'listModePaused', 'listModeActiveJob', 'listModeNextOpenAt'], (result) => {
                jobQueue.value = Array.isArray((result as any).jobQueue) ? (result as any).jobQueue : [];
                currentIndex.value = Number.isFinite((result as any).currentIndex) ? (result as any).currentIndex : 0;
                listModePaused.value = (result as any).listModePaused !== false;
                listModeActiveJob.value = (result as any).listModeActiveJob || null;
                listModeNextOpenAt.value = Number.isFinite((result as any).listModeNextOpenAt) ? (result as any).listModeNextOpenAt : 0;
            });
        };

        const toggleCloudSync = () => {
            chrome.storage.sync.set({ cloudSyncEnabled: cloudSyncEnabled.value }, () => {
                console.log("Cloud sync toggled:", cloudSyncEnabled.value);
            });
        };

        const toggleAiMapping = () => {
            chrome.storage.sync.set({ aiMappingEnabled: aiMappingEnabled.value }, () => {
                console.log("AI mapping toggled:", aiMappingEnabled.value);
            });
        };

        const toggleAutoSubmit = () => {
            chrome.storage.sync.set({ autoSubmitEnabled: autoSubmitEnabled.value }, () => {
                console.log("Auto-submit toggled:", autoSubmitEnabled.value);
            });
        };

        const toggleClosePreviousTabs = () => {
            chrome.storage.sync.set({ closePreviousTabs: closePreviousTabs.value }, () => {
                console.log("Close previous tabs toggled:", closePreviousTabs.value);
            });
        };

        const toggleListMode = async () => {
            const resp: any = await sendMessage({ action: 'LIST_MODE_SET_ENABLED', value: listModeEnabled.value });
            if (!resp?.ok) {
                alert('Failed to update list mode setting.');
            }
            if (listModeEnabled.value === false) {
                // Best-effort: pause list mode if user disables it.
                await sendMessage({ action: 'LIST_MODE_PAUSE' });
            }
            await loadListModeState();
        };

        const triggerAI = () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
                chrome.tabs.sendMessage(tabs[0].id!, { action: 'TRIGGER_AI_REPLY' })
            );
        };

        const generateAllPending = () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tabId = tabs?.[0]?.id;
                if (!tabId) return;
                chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_AI_REPLY_ALL' });
            });
        };

        const exportData = async () => {
            if (!chrome.storage) return;

            const syncData = (await new Promise((resolve) => chrome.storage.sync.get(null, (res) => resolve(res || {})))) as any;
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

        const triggerCsvInput = () => {
            csvInput.value?.click();
        };

        const importCsv = async (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const queue = buildQueueFromCsv(text);

                if (!queue.length) {
                    alert('No URLs found in CSV.');
                    return;
                }

                const resp: any = await sendMessage({ action: 'LIST_MODE_SET_QUEUE', queue });
                if (!resp?.ok) {
                    alert('Failed to save queue.');
                    return;
                }

                await loadListModeState();
                alert(`Loaded ${resp.size} job URL(s). Queue is paused until you press Start.`);
            } catch (e) {
                alert(`CSV import failed: ${String((e as any)?.message || e)}`);
            } finally {
                // allow re-upload of same file
                if (csvInput.value) csvInput.value.value = '';
            }
        };

        const startListMode = async () => {
            const resp: any = await sendMessage({ action: 'LIST_MODE_START' });
            if (resp?.ok !== true) {
                alert(`Failed to start list mode: ${resp?.reason || resp?.error || 'unknown error'}`);
            }
            await loadListModeState();
        };

        const pauseListMode = async () => {
            await sendMessage({ action: 'LIST_MODE_PAUSE' });
            await loadListModeState();
        };

        const skipCurrent = async () => {
            await sendMessage({ action: 'LIST_MODE_SKIP_CURRENT', reason: 'manual_skip' });
            await loadListModeState();
        };

        const clearList = async () => {
            if (!confirm('Clear the list-mode queue?')) return;
            await sendMessage({ action: 'LIST_MODE_CLEAR' });
            await loadListModeState();
        };

        const onStorageChanged = (changes: any, areaName: string) => {
            if (areaName === 'sync') {
                if (changes?.listModeEnabled) {
                    listModeEnabled.value = !!changes.listModeEnabled.newValue;
                }
                if (changes?.closePreviousTabs) {
                    closePreviousTabs.value = !!changes.closePreviousTabs.newValue;
                }
            }
            if (areaName === 'local') {
                if (changes?.jobQueue) jobQueue.value = Array.isArray(changes.jobQueue.newValue) ? changes.jobQueue.newValue : [];
                if (changes?.currentIndex) currentIndex.value = Number.isFinite(changes.currentIndex.newValue) ? changes.currentIndex.newValue : 0;
                if (changes?.listModePaused) listModePaused.value = changes.listModePaused.newValue !== false;
                if (changes?.listModeActiveJob) listModeActiveJob.value = changes.listModeActiveJob.newValue || null;
                if (changes?.listModeNextOpenAt) listModeNextOpenAt.value = Number.isFinite(changes.listModeNextOpenAt.newValue) ? changes.listModeNextOpenAt.newValue : 0;
            }
        };

        onMounted(() => {
            loadSettings();
            loadListModeState();

            tickTimer = window.setInterval(() => {
                nowTick.value = Date.now();
            }, 1000);

            chrome.storage.onChanged.addListener(onStorageChanged);
        });

        onBeforeUnmount(() => {
            if (tickTimer != null) window.clearInterval(tickTimer);
            chrome.storage.onChanged.removeListener(onStorageChanged);
        });

        return {
            exportData,
            importData,
            triggerFileInput,
            fileInput,
            cloudSyncEnabled,
            toggleCloudSync,
            aiMappingEnabled,
            toggleAiMapping,
            autoSubmitEnabled,
            toggleAutoSubmit,
            triggerAI,
            generateAllPending,

            // List mode
            csvInput,
            listModeEnabled,
            toggleListMode,
            closePreviousTabs,
            toggleClosePreviousTabs,
            triggerCsvInput,
            importCsv,
            jobQueue,
            currentIndex,
            listModePaused,
            queueTotal,
            queueDone,
            queuePending,
            queueError,
            displayIndex,
            activeTabId,
            activeJobUrl,
            currentNotes,
            nextOpenInSeconds,
            startListMode,
            pauseListMode,
            skipCurrent,
            clearList,
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

/* Warning helper text (e.g., Close previous tabs toggle) */
.action-card .text-warning {
    color: #d97706;
}

.action-card .small {
    font-size: 0.82rem;
}

.action-card .close-prev-tabs-warning {
    margin-top: 0;
    margin-bottom: 0.35rem;
    line-height: 1.35;
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

.action-btn:hover:not(:disabled) {
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

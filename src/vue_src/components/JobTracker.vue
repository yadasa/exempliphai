<template>
    <div class="jobTracker">
        <h2 class="subheading">Tracking</h2>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin: 6px 0 10px 0;">
            <button class="secondary-btn" @click="autofillThisPage" title="Force attempt autofill on the current tab (even if ATS isn't detected)">
                Autofill this page
            </button>
        </div>
        <div class="stats-card">
            <div class="stat-row"><b>Autofills:</b> {{ statsAutofills.toLocaleString() }}</div>
            <div class="stat-row"><b>Custom answers generated:</b> {{ statsCustomAnswers.toLocaleString() }}</div>
            <div class="stat-row" v-if="statsLastAutofill"><b>Last autofill:</b> {{ formatDate(statsLastAutofill) }}</div>

            <!-- Mini activity graph (line chart, extension-friendly) -->
            <div class="mini-graph">
                <div class="mini-graph-title">Last 14 days</div>

                <div class="mini-chart" :title="graphTitle">
                    <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="mini-chart-svg">
                        <defs>
                            <linearGradient id="miniLine" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#7c3aed" />
                                <stop offset="100%" stop-color="#2563eb" />
                            </linearGradient>
                            <linearGradient id="miniFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.55" />
                                <stop offset="70%" stop-color="#2563eb" stop-opacity="0.20" />
                                <stop offset="100%" stop-color="#2563eb" stop-opacity="0.05" />
                            </linearGradient>
                        </defs>

                        <path :d="chartAreaPath" fill="url(#miniFill)" />
                        <path :d="chartLinePath" fill="none" stroke="url(#miniLine)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                </div>

                <div class="mini-graph-legend">
                    <span><span class="dot dot-applied"></span> Applied jobs</span>
                </div>
            </div>
        </div>

        <h2 class="subheading">Applied Jobs (Last 6 Months)</h2>
        <div v-if="appliedJobs.length === 0" class="no-jobs">
            No jobs applied yet.
        </div>
        <div v-else class="job-list">
            <div v-for="(job, index) in appliedJobs" :key="index" class="job-card">
                <div class="job-header">
                    <div class="company-section">
                        <template v-if="editingIndex === index">
                            <input 
                                v-model="editValue" 
                                @keyup.enter="saveEdit(index)"
                                @keyup.esc="cancelEdit"
                                class="edit-input" ref="editInput"
                            />
                            <div class="edit-actions">
                                <span class="icon-btn save-btn" @click="saveEdit(index)" title="Save">✓</span>
                                <span class="icon-btn cancel-btn" @click="cancelEdit" title="Cancel">✕</span>
                            </div>
                        </template>
                        <template v-else>
                            <span class="job-company">{{ job.company }}</span>
                            <span class="icon-btn edit-btn" @click="startEdit(index, job.company)" title="Edit">✎</span>
                        </template>
                    </div>
                    <span class="job-date">{{ formatDate(job.date) }}</span>
                </div>
                <div class="job-role">{{ job.role }}</div>
                <a :href="job.url" target="_blank" class="job-link">View Application</a>
            </div>
        </div>
        <div class="tracker-actions">
            <div class="backup-actions">
                <button class="secondary-btn" @click="exportJobs" title="Export to JSON">Export Backup</button>
                <button class="secondary-btn" @click="triggerFileInput" title="Import from JSON">Import Backup</button>
                <input type="file" ref="fileInput" @change="importJobs" accept=".json" style="display: none" />
            </div>
            <button class="clear-btn" @click="clearHistory" v-if="appliedJobs.length > 0">Clear History</button>
            <p class="tracker-footer">Jobs are automatically removed after 6 months. Back up your data regularly!</p>
        </div>
    </div>
</template>

<script lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

export default {
    setup() {
        const appliedJobs = ref<any[]>([]);
        const editingIndex = ref<number | null>(null);
        const editValue = ref<string>('');

        // Firebase-backed stats (cached locally by the service worker)
        const statsAutofills = ref<number>(0);
        const statsCustomAnswers = ref<number>(0);
        const statsLastAutofill = ref<string>('');

        const graphDays = ref<{ label: string; count: number; h: number }[]>([]);
        const graphTitle = ref('Applied jobs per day (last 14 days)');

        const chartLinePath = ref<string>('');
        const chartAreaPath = ref<string>('');

        const autofillThisPage = async () => {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const tab = tabs?.[0];
                if (!tab?.id) return;
                chrome.tabs.sendMessage(tab.id, { action: 'FORCE_AUTOFILL_THIS_PAGE' }, (resp) => {
                    const err = chrome.runtime?.lastError;
                    if (err) {
                        console.warn('JobTracker: FORCE_AUTOFILL_THIS_PAGE failed', err);
                        return;
                    }
                    if (!resp?.ok) console.warn('JobTracker: FORCE_AUTOFILL_THIS_PAGE not ok', resp);
                });
            } catch (e) {
                console.warn('JobTracker: autofillThisPage error', e);
            }
        };

        const rebuildGraph = () => {
            // Build counts for last 14 days from appliedJobs list.
            const days = 14;
            const now = new Date();
            const start = new Date(now);
            start.setDate(start.getDate() - (days - 1));
            start.setHours(0, 0, 0, 0);

            const buckets: Record<string, number> = {};
            for (let i = 0; i < days; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                const key = d.toISOString().slice(0, 10);
                buckets[key] = 0;
            }

            for (const j of appliedJobs.value || []) {
                const dt = new Date(j?.date || j?.timestamp || '');
                if (isNaN(dt.getTime())) continue;
                dt.setHours(0, 0, 0, 0);
                const key = dt.toISOString().slice(0, 10);
                if (key in buckets) buckets[key] += 1;
            }

            const max = Math.max(1, ...Object.values(buckets));
            graphDays.value = Object.keys(buckets)
                .sort()
                .map((k) => {
                    const c = buckets[k] || 0;
                    const dt = new Date(k);
                    const label = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    return { label, count: c, h: Math.round((c / max) * 100) };
                });

            // Build SVG paths in a 100x40 viewBox.
            const pts = graphDays.value.map((d, i) => {
                const x = (i / Math.max(1, graphDays.value.length - 1)) * 100;
                const y = 36 - (d.count / max) * 30; // keep some top/bottom padding
                return { x, y };
            });

            if (!pts.length) {
                chartLinePath.value = '';
                chartAreaPath.value = '';
                return;
            }

            const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
            chartLinePath.value = line;

            // Area: line + down to baseline and back.
            const baselineY = 38;
            const area = `${line} L 100 ${baselineY} L 0 ${baselineY} Z`;
            chartAreaPath.value = area;
        };

        const loadJobs = () => {
             if (!chrome.storage) return;

             chrome.storage.local.get(['AppliedJobs'], (localRes) => {
                 chrome.storage.sync.get(['cloudSyncEnabled', 'AppliedJobsSync'], (syncRes) => {
                     const syncEnabled = !!syncRes.cloudSyncEnabled;
                     const syncJobs = Array.isArray(syncRes.AppliedJobsSync) ? syncRes.AppliedJobsSync : [];
                     let jobs = localRes.AppliedJobs;

                     // Recovery Logic: If local is empty but sync has data, use sync data
                     if ((!Array.isArray(jobs) || jobs.length === 0) && syncEnabled && syncJobs.length > 0) {
                         jobs = [...syncJobs];
                         chrome.storage.local.set({ AppliedJobs: jobs });
                         console.log("JobTracker: Recovered jobs from cloud sync.");
                     }
                     
                     // Safer date parsing and filtering
                     const cutoffDate = new Date();
                     cutoffDate.setMonth(cutoffDate.getMonth() - 6);
                     
                     if (!Array.isArray(jobs)) jobs = [];
                     const validJobs = jobs.filter((job: any) => {
                         const jobDate = new Date(job.date);
                         if (isNaN(jobDate.getTime())) return false;
                         return jobDate > cutoffDate;
                     });
                     
                     if (validJobs.length !== jobs.length) {
                         chrome.storage.local.set({ AppliedJobs: validJobs });
                     }
                     
                     appliedJobs.value = validJobs.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
                     rebuildGraph();
                 });
             });
        };

        const loadStats = () => {
            if (!chrome?.storage?.local) return;
            chrome.storage.local.get(['cloudStats'], (res) => {
                const st = (res as any)?.cloudStats || {};
                statsAutofills.value = Number(st?.autofills?.total || 0);
                statsCustomAnswers.value = Number(st?.customAnswersGenerated?.total || 0);
                statsLastAutofill.value = String(st?.lastAutofill || '');
            });
        };

        const exportJobs = () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appliedJobs.value, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `jobs_backup_${new Date().toISOString().split('T')[0]}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        };

        const triggerFileInput = () => {
            const fileInput = document.querySelector('.backup-actions input[type="file"]') as HTMLInputElement;
            fileInput?.click();
        };

        const importJobs = (event: Event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result as string;
                    const importedJobs = JSON.parse(content);
                    if (!Array.isArray(importedJobs)) throw new Error("Invalid format");

                    chrome.storage.local.get(['AppliedJobs'], (result) => {
                        const existingJobs = Array.isArray(result.AppliedJobs) ? result.AppliedJobs : [];
                        // Merge and de-duplicate by URL
                        const merged = [...importedJobs, ...existingJobs];
                        const unique = merged.filter((job, index, self) =>
                            index === self.findIndex((j) => j.url === job.url)
                        );

                        chrome.storage.local.set({ AppliedJobs: unique }, () => {
                            loadJobs();
                            alert(`Imported ${unique.length - existingJobs.length} new jobs!`);
                        });
                    });
                } catch (error) {
                    alert("Failed to import. Please ensure the file is a valid JSON export.");
                }
            };
            reader.readAsText(file);
        };

        const clearHistory = () => {
            if (confirm("Are you sure you want to clear your job history? This will also clear cloud sync if enabled.")) {
                chrome.storage.local.set({ AppliedJobs: [] }, () => {
                    appliedJobs.value = [];
                });
                // Also clear sync if enabled
                chrome.storage.sync.get(['cloudSyncEnabled'], (result) => {
                    if (result.cloudSyncEnabled) {
                        chrome.storage.sync.set({ AppliedJobsSync: [] });
                    }
                });
            }
        };

        const formatDate = (dateString: string) => {
            if (!dateString) return '';
            return new Date(dateString).toLocaleDateString();
        };

        const startEdit = (index: number, currentName: string) => {
            editingIndex.value = index;
            editValue.value = currentName;
        };

        const cancelEdit = () => {
            editingIndex.value = null;
            editValue.value = '';
        };

        const saveEdit = (index: number) => {
            if (editValue.value.trim() !== '') {
                appliedJobs.value[index].company = editValue.value.trim();
                // Persist to storage
                chrome.storage.local.get(['AppliedJobs'], (result) => {
                     // We need to update the correct job in storage. 
                     // Since appliedJobs matches the storage structure (just sorted), we should re-save the whole list.
                     // IMPORTANT: The list in storage might not be sorted the same way if we modified it, 
                     // but here we are modifying the sorted list which effectively becomes the new truth.
                     // However, to be safe, let's just save 'appliedJobs.value' back to storage 
                     // (assuming appliedJobs contains all valid jobs).
                     chrome.storage.local.set({ AppliedJobs: appliedJobs.value }, () => {
                         console.log("Job updated");
                     });
                });
            }
            editingIndex.value = null;
        };

        const onStorageChanged = (changes: any, areaName: string) => {
            if (areaName !== 'local') return;
            if (changes?.AppliedJobs) loadJobs();
            if (changes?.cloudStats) loadStats();
        };

        onMounted(() => {
            loadJobs();
            loadStats();
            chrome.storage.onChanged.addListener(onStorageChanged);
        });

        onBeforeUnmount(() => {
            chrome.storage.onChanged.removeListener(onStorageChanged);
        });

        return {
            appliedJobs,
            autofillThisPage,
            clearHistory,
            formatDate,
            editingIndex,
            editValue,
            startEdit,
            cancelEdit,
            saveEdit,
            exportJobs,
            importJobs,
            triggerFileInput,

            statsAutofills,
            statsCustomAnswers,
            statsLastAutofill,

            graphDays,
            graphTitle,
            chartLinePath,
            chartAreaPath
        };
    }
};
</script>

<style scoped>
.jobTracker {
    padding: 0.25rem 0;
    color: var(--text-primary);
}

.stats-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 0.85rem 1rem;
    box-shadow: var(--shadow-1);
}

.stat-row {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0.25rem 0;
}

.no-jobs {
    text-align: center;
    color: var(--text-secondary);
    margin-top: 2rem;
}

.job-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1rem;
    max-height: 420px;
    overflow: auto;
    padding-bottom: 0.25rem;
}

.job-card {
    background: var(--card-bg);
    padding: 1rem;
    border-radius: 14px;
    border: 1px solid var(--card-border);
    box-shadow: var(--shadow-1);
}

.job-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
}

.job-company {
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--text-primary);
}

.job-date {
    font-size: 0.82rem;
    color: var(--text-secondary);
}

.job-role {
    margin-bottom: 0.6rem;
    color: var(--text-secondary);
    font-weight: 500;
}

.job-link {
    font-size: 0.9rem;
    color: var(--accent-color);
    text-decoration: none;
    font-weight: 600;
}

.job-link:hover {
    text-decoration: underline;
}

.mini-graph {
    margin-top: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--card-border);
}

.mini-graph-title {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-bottom: 0.35rem;
}

.mini-chart {
    height: 70px;
    width: 100%;
    border-radius: 12px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
    overflow: hidden;
}

.mini-chart-svg {
    display: block;
    width: 100%;
    height: 100%;
}

.mini-graph-legend {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.45rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
}

.dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-right: 6px;
    vertical-align: middle;
}

.dot-applied {
    background: rgba(34,197,94,0.9);
}

.tracker-actions {
    margin-top: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
}

.backup-actions {
    display: flex;
    gap: 0.75rem;
    width: 100%;
    justify-content: center;
}

.secondary-btn {
    background: var(--card-bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 0.55rem 0.85rem;
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 700;
    box-shadow: var(--shadow-1);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.secondary-btn:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-2);
}

.company-section {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: 1;
}

.edit-input {
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 0.45rem 0.65rem;
    border-radius: 12px;
    font-family: inherit;
    font-size: 0.95rem;
    width: 170px;
}

.edit-actions {
    display: flex;
    gap: 0.35rem;
}

.icon-btn {
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.7;
    transition: opacity 0.12s ease, transform 0.12s ease;
    user-select: none;
}

.icon-btn:hover {
    opacity: 1;
    transform: translateY(-1px);
}

.save-btn { color: var(--accent-2); font-weight: 800; }
.cancel-btn { color: #ef4444; font-weight: 800; }
.edit-btn { font-size: 0.92rem; }

.clear-btn {
    background: linear-gradient(135deg, #ef4444, #b91c1c);
    color: white;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 800;
    box-shadow: 0 16px 30px rgba(239, 68, 68, 0.25);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.clear-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 20px 45px rgba(239, 68, 68, 0.35);
}

.tracker-footer {
    font-size: 0.82rem;
    color: var(--text-secondary);
    margin: 0;
    text-align: center;
}
</style>

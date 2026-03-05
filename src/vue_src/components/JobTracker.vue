<template>
    <div class="jobTracker">
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
import { ref, onMounted } from 'vue';

export default {
    setup() {
        const appliedJobs = ref<any[]>([]);
        const editingIndex = ref<number | null>(null);
        const editValue = ref<string>('');

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
                 });
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

        onMounted(() => {
            loadJobs();
        });

        return {
            appliedJobs,
            clearHistory,
            formatDate,
            editingIndex,
            editValue,
            startEdit,
            cancelEdit,
            saveEdit,
            exportJobs,
            importJobs,
            triggerFileInput
        };
    }
};
</script>

<style scoped>
.jobTracker {
    padding: 1rem;
    color: var(--text-primary);
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
    max-height: 400px;
    overflow-y: auto;
}
.job-card {
    background: var(--card-bg);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid var(--card-border);
}
.job-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
}
.job-company {
    font-weight: bold;
    font-size: 1.1rem;
    color: var(--text-primary);
}
.job-date {
    font-size: 0.8rem;
    color: var(--text-secondary);
}
.job-role {
    margin-bottom: 0.5rem;
}
.job-link {
    font-size: 0.9rem;
    color: #4CAF50;
    text-decoration: none;
}
.job-link:hover {
    text-decoration: underline;
}
.tracker-actions {
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
}
.backup-actions {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    justify-content: center;
}
.secondary-btn {
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
}
.secondary-btn:hover {
    background: var(--card-border);
}
.company-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
}
.edit-input {
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    color: var(--text-primary);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 1rem;
    width: 150px;
}
.edit-actions {
    display: flex;
    gap: 0.3rem;
}
.icon-btn {
    cursor: pointer;
    font-size: 1rem;
    opacity: 0.6;
    transition: opacity 0.2s;
    user-select: none;
}
.icon-btn:hover {
    opacity: 1;
}
.save-btn { color: var(--accent-color); font-weight: bold; }
.cancel-btn { color: #ff4444; font-weight: bold; }
.edit-btn { font-size: 0.9rem; } /* Pencil slightly smaller */

.clear-btn {
    background: #ff4444;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    opacity: 0.8;
}
.clear-btn:hover {
    background: #cc0000;
    opacity: 1;
}
.tracker-footer {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin: 0;
}
</style>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

type SchemaField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required?: boolean;
  format?: 'email' | 'date' | string;
  multiline?: boolean;
  item?: { title?: string; fields: SchemaField[] };
};

type SchemaCategory = {
  id: string;
  title: string;
  fields: SchemaField[];
};

type LocalProfileSchema = {
  version: number;
  title: string;
  categories: SchemaCategory[];
};

const KEY = 'LOCAL_PROFILE';
const LEGACY_KEY = 'EXEMPLIPHAI_LOCAL_PROFILE';

const schema = ref<LocalProfileSchema | null>(null);
const activeTab = ref<'profile' | 'education' | 'experience' | 'raw'>('profile');
const status = reactive<{ msg: string; kind?: 'ok' | 'err' }>(
  { msg: '' }
);

const profile = ref<Record<string, any>>({});

function setStatus(msg: string, kind?: 'ok' | 'err') {
  status.msg = msg;
  status.kind = kind;
}

function ensureObj(x: any): Record<string, any> {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

function validate(p: Record<string, any>, s: LocalProfileSchema | null): string[] {
  if (!s) return [];
  const errs: string[] = [];
  for (const cat of s.categories || []) {
    for (const f of cat.fields || []) {
      if (f.type === 'array') continue;
      if (f.required) {
        const v = p?.[f.key];
        if (v == null || String(v).trim() === '') errs.push(`${f.label} is required`);
      }
      if (f.format === 'email') {
        const v = String(p?.[f.key] || '').trim();
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs.push(`${f.label} looks invalid`);
      }
      if (f.format === 'date') {
        const v = String(p?.[f.key] || '').trim();
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(`${f.label} should be YYYY-MM-DD`);
      }
    }
  }
  return errs;
}

const validationErrors = computed(() => validate(profile.value, schema.value));

async function loadSchema() {
  const url = chrome.runtime.getURL('config/local_profile_schema.json');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load schema (${res.status})`);
  schema.value = (await res.json()) as LocalProfileSchema;
}

async function loadProfile() {
  const got = await chrome.storage.local.get([KEY, LEGACY_KEY]);
  profile.value = ensureObj((got as any)[KEY] || (got as any)[LEGACY_KEY] || {});
  setStatus(Object.keys(profile.value).length ? 'Loaded.' : 'No local profile saved.', Object.keys(profile.value).length ? 'ok' : undefined);
}

async function saveProfile() {
  const errs = validationErrors.value;
  if (errs.length) {
    setStatus(`Fix: ${errs[0]}`, 'err');
    return;
  }
  await chrome.storage.local.set({ [KEY]: profile.value, [LEGACY_KEY]: profile.value });
  setStatus('Saved.', 'ok');
}

async function clearProfile() {
  await chrome.storage.local.remove([KEY, LEGACY_KEY]);
  profile.value = {};
  setStatus('Cleared.', 'ok');
}

function updateField(field: SchemaField, raw: any) {
  const next = { ...(profile.value || {}) };

  let v: any = raw;
  if (field.type === 'number') {
    v = raw === '' || raw == null ? null : Number(raw);
    if (v != null && !Number.isFinite(v)) v = null;
  }
  if (field.type === 'boolean') {
    if (raw === '') v = null;
    else if (raw === true || raw === false) v = raw;
    else v = String(raw) === 'true';
  }

  if (v == null || v === '') delete next[field.key];
  else next[field.key] = v;

  profile.value = next;
}

function getArray(key: string): any[] {
  const cur = (profile.value as any)?.[key];
  return Array.isArray(cur) ? cur : [];
}

function addArrayItem(key: string, itemFields: SchemaField[]) {
  const next = { ...(profile.value || {}) } as any;
  const arr = getArray(key).slice();
  const blank: any = {};
  for (const f of itemFields) blank[f.key] = f.type === 'boolean' ? false : null;
  arr.push(blank);
  next[key] = arr;
  profile.value = next;
}

function removeArrayItem(key: string, idx: number) {
  const next = { ...(profile.value || {}) } as any;
  const arr = getArray(key).slice();
  arr.splice(idx, 1);
  next[key] = arr;
  profile.value = next;
}

function setProfileFromRawJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    profile.value = ensureObj(parsed);
    setStatus('JSON applied (not saved yet).', 'ok');
  } catch (e: any) {
    setStatus(`Invalid JSON: ${String(e?.message || e)}`, 'err');
  }
}

function updateArrayItemField(arrayKey: string, idx: number, field: SchemaField, raw: any) {
  const next = { ...(profile.value || {}) } as any;
  const arr = getArray(arrayKey).slice();
  const it = ensureObj(arr[idx]);

  let v: any = raw;
  if (field.type === 'number') {
    v = raw === '' || raw == null ? null : Number(raw);
    if (v != null && !Number.isFinite(v)) v = null;
  }
  if (field.type === 'boolean') {
    if (raw === '') v = null;
    else if (raw === true || raw === false) v = raw;
    else v = String(raw) === 'true';
  }

  if (v == null || v === '') delete it[field.key];
  else it[field.key] = v;

  arr[idx] = it;
  next[arrayKey] = arr;
  profile.value = next;
}

const educationArrayField = computed(() => {
  const cat = schema.value?.categories?.find(c => c.id === 'education');
  return cat?.fields?.find(f => f.type === 'array' && f.key === 'education');
});

const experienceArrayField = computed(() => {
  const cat = schema.value?.categories?.find(c => c.id === 'experience');
  return cat?.fields?.find(f => f.type === 'array' && f.key === 'experience');
});

const profileCategories = computed(() => (schema.value?.categories || []).filter(c => c.id !== 'education' && c.id !== 'experience'));

onMounted(async () => {
  try {
    await loadSchema();
  } catch (e: any) {
    setStatus(`Schema load failed: ${String(e?.message || e)}`, 'err');
  }

  try {
    await loadProfile();
  } catch (e: any) {
    setStatus(`Load failed: ${String(e?.message || e)}`, 'err');
  }
});
</script>

<template>
  <div class="local-profile">
    <div class="top-row">
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">Profile</button>
        <button class="tab" :class="{ active: activeTab === 'education' }" @click="activeTab = 'education'">Education</button>
        <button class="tab" :class="{ active: activeTab === 'experience' }" @click="activeTab = 'experience'">Experience</button>
        <button class="tab" :class="{ active: activeTab === 'raw' }" @click="activeTab = 'raw'">Raw JSON</button>
      </div>
      <div class="actions">
        <button class="btn" @click="loadProfile">Reload</button>
        <button class="btn primary" @click="saveProfile">Save</button>
        <button class="btn danger" @click="clearProfile">Clear</button>
      </div>
    </div>

    <div v-if="status.msg" class="status" :class="status.kind">
      {{ status.msg }}
    </div>

    <div v-if="validationErrors.length" class="status err" style="margin-top: 10px;">
      Validation: {{ validationErrors[0] }}
    </div>

    <div v-if="!schema" class="loading">Loading…</div>

    <div v-else>
      <div v-if="activeTab === 'raw'">
        <textarea
          class="raw"
          spellcheck="false"
          :value="JSON.stringify(profile || {}, null, 2)"
          @input="(e:any) => setProfileFromRawJson(e.target.value)"
        />
      </div>

      <div v-else-if="activeTab === 'education'">
        <div class="section-title">Education</div>
        <button class="btn" @click="addArrayItem('education', (educationArrayField as any)?.item?.fields || [])">Add</button>
        <div v-if="getArray('education').length === 0" class="note">No items yet.</div>
        <div v-for="(item, idx) in getArray('education')" :key="idx" class="card">
          <div class="card-top">
            <div class="badge">Education #{{ idx + 1 }}</div>
            <button class="btn danger" @click="removeArrayItem('education', idx)">Remove</button>
          </div>
          <div class="grid">
            <div v-for="f in ((educationArrayField as any)?.item?.fields || [])" :key="f.key" class="field">
              <label class="fieldLabel">{{ f.label }}</label>
              <template v-if="f.type === 'boolean'">
                <select class="input" :value="item?.[f.key] === true ? 'true' : item?.[f.key] === false ? 'false' : ''" @change="(e:any) => updateArrayItemField('education', idx, f, e.target.value)">
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </template>
              <template v-else-if="f.multiline">
                <textarea class="input" rows="4" :value="item?.[f.key] ?? ''" @input="(e:any) => updateArrayItemField('education', idx, f, e.target.value)" />
              </template>
              <template v-else>
                <input class="input" :type="f.type === 'number' ? 'number' : 'text'" :value="item?.[f.key] ?? ''" @input="(e:any) => updateArrayItemField('education', idx, f, e.target.value)" />
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'experience'">
        <div class="section-title">Experience</div>
        <button class="btn" @click="addArrayItem('experience', (experienceArrayField as any)?.item?.fields || [])">Add</button>
        <div v-if="getArray('experience').length === 0" class="note">No items yet.</div>
        <div v-for="(item, idx) in getArray('experience')" :key="idx" class="card">
          <div class="card-top">
            <div class="badge">Experience #{{ idx + 1 }}</div>
            <button class="btn danger" @click="removeArrayItem('experience', idx)">Remove</button>
          </div>
          <div class="grid">
            <div v-for="f in ((experienceArrayField as any)?.item?.fields || [])" :key="f.key" class="field">
              <label class="fieldLabel">{{ f.label }}</label>
              <template v-if="f.type === 'boolean'">
                <select class="input" :value="item?.[f.key] === true ? 'true' : item?.[f.key] === false ? 'false' : ''" @change="(e:any) => updateArrayItemField('experience', idx, f, e.target.value)">
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </template>
              <template v-else-if="f.multiline">
                <textarea class="input" rows="4" :value="item?.[f.key] ?? ''" @input="(e:any) => updateArrayItemField('experience', idx, f, e.target.value)" />
              </template>
              <template v-else>
                <input class="input" :type="f.type === 'number' ? 'number' : 'text'" :value="item?.[f.key] ?? ''" @input="(e:any) => updateArrayItemField('experience', idx, f, e.target.value)" />
              </template>
            </div>
          </div>
        </div>
      </div>

      <div v-else>
        <div v-for="cat in profileCategories" :key="cat.id" class="category">
          <div class="section-title">{{ cat.title }}</div>
          <div class="grid">
            <template v-for="f in cat.fields" :key="f.key">
              <div v-if="f.type !== 'array'" class="field">
                <label class="fieldLabel">{{ f.label }}<span v-if="f.required"> *</span></label>
                <template v-if="f.type === 'boolean'">
                  <select class="input" :value="profile?.[f.key] === true ? 'true' : profile?.[f.key] === false ? 'false' : ''" @change="(e:any) => updateField(f, e.target.value)">
                    <option value="">—</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </template>
                <template v-else-if="f.multiline">
                  <textarea class="input" rows="4" :value="profile?.[f.key] ?? ''" @input="(e:any) => updateField(f, e.target.value)" />
                </template>
                <template v-else>
                  <input class="input" :type="f.type === 'number' ? 'number' : 'text'" :placeholder="f.format === 'date' ? 'YYYY-MM-DD' : ''" :value="profile?.[f.key] ?? ''" @input="(e:any) => updateField(f, e.target.value)" />
                </template>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.local-profile {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.top-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  gap: 8px;
}

.tab {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--text-primary);
  font-weight: 800;
  cursor: pointer;
}

.tab.active {
  outline: 2px solid color-mix(in srgb, var(--accent-color) 70%, white);
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--text-primary);
  font-weight: 800;
  cursor: pointer;
}

.btn.primary {
  background: var(--gradient-primary);
  color: #fff;
  border: none;
}

.btn.danger {
  background: linear-gradient(135deg, #ef4444, #b91c1c);
  color: #fff;
  border: none;
}

.status {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
}

.status.ok { border-color: rgba(34,197,94,0.5); }
.status.err { border-color: rgba(239,68,68,0.6); }

.section-title {
  font-weight: 900;
  margin: 12px 0 8px 0;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr; }
}

.fieldLabel {
  font-size: 0.85rem;
  opacity: 0.85;
  margin-bottom: 4px;
}

.input {
  width: 100%;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-primary);
  padding: 10px;
  border-radius: 12px;
}

.raw {
  width: 100%;
  min-height: 520px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text-primary);
  padding: 12px;
  border-radius: 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.card {
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  padding: 12px;
  border-radius: 14px;
  margin-top: 12px;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.badge {
  font-weight: 900;
}

.note {
  opacity: 0.75;
  margin-top: 10px;
}
</style>

# DATA_FIELDS.md — Exempliphai Chrome Extension: Complete Data Fields Reference

> **Generated:** 2026-03-08  
> **Scope:** All user-input fields collected by the extension popup UI, how they're stored, and how the autofill content scripts map them to job application forms.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Storage Model](#storage-model)
3. [Collected Fields — Profile Tab](#collected-fields--profile-tab)
4. [Collected Fields — Experience Tab](#collected-fields--experience-tab)
5. [Collected Fields — Settings Tab](#collected-fields--settings-tab)
6. [Derived / Computed Fields](#derived--computed-fields)
7. [Field Mapping Logic (utils.js `fields`)](#field-mapping-logic)
8. [Autofill Flow](#autofill-flow)
9. [Fuzzy Matching & Malleability](#fuzzy-matching--malleability)
10. [Known Gaps & Issues](#known-gaps--issues)

---

## Architecture Overview

```
┌──────────────────────────────────┐
│  Popup UI (Vue 3 SPA)           │
│  index.html → App.vue           │
│  ├── Profile Tab (InputField×N) │
│  ├── Experience Tab             │
│  ├── Dashboard Tab (JobTracker) │
│  └── Settings Tab               │
└──────────┬───────────────────────┘
           │ chrome.storage.sync.set / .local.set
           ▼
┌──────────────────────────────────┐
│  Chrome Storage                  │
│  ├── sync: profile fields (text) │
│  │   key = label string          │
│  │   val = user-entered string   │
│  ├── local: binary/structured    │
│  │   Resume (base64), Resume_name│
│  │   Resume_details {skills,     │
│  │     experiences, certs}       │
│  │   Cover Letter (base64)       │
│  │   AppliedJobs[]               │
│  └── sync: API Key, ThemeSetting │
└──────────┬───────────────────────┘
           │ getStorageDataSync() / getStorageDataLocal()
           ▼
┌──────────────────────────────────┐
│  Content Scripts                 │
│  utils.js  → field maps, helpers │
│  autofill.js → form detection,   │
│    field matching, value filling  │
│  workday.js → Workday-specific   │
│  background.js → context menu,   │
│    AI command relay               │
└──────────────────────────────────┘
```

---

## Storage Model

### `chrome.storage.sync` (Profile Fields)

All simple text/dropdown InputField values are stored here. The **key** is the `label` prop of the `<InputField>` component — stored verbatim as the key in sync storage.

**Example sync storage state:**
```json
{
  "First Name": "John",
  "Last Name": "Pork",
  "Full Name": "John Pork Sr.",
  "Email": "jpork@mit.edu",
  "Phone": "123-345-6789",
  "Phone Type": "Mobile",
  "LinkedIn": "https://linkedin.com/in/johnpork",
  "Github": "https://github.com/johnpork",
  "LeetCode": "",
  "Medium": "",
  "Personal Website": "johnpork.com",
  "Other URL": "",
  "Location (Street)": "123 Sesame St",
  "Location (City)": "Albuquerque",
  "Location (State/Region)": "New Mexico",
  "Location (Country)": "United States of America",
  "Postal/Zip Code": "87104",
  "Legally Authorized to Work": "Yes",
  "Requires Sponsorship": "No",
  "Job Notice Period": "Two weeks",
  "Expected Salary": "$150,000",
  "Languages": "English, Spanish",
  "Willing to Relocate": "Yes",
  "Date Available": "Immediately",
  "Security Clearance": "No",
  "Pronouns": "He/Him",
  "Gender": "Male",
  "Race": "Black or African American",
  "Hispanic/Latino": "No",
  "Veteran Status": "I am not a protected veteran",
  "Disability Status": "No, I do not have a disability and have not had one in the past",
  "Current Employer": "Apple",
  "Years of Experience": "5",
  "School": "Massachusetts Institute of Technology",
  "Degree": "Bachelor's Degree",
  "Discipline": "Computer Science",
  "Start Date Month": "August",
  "Start Date Year": "2020",
  "End Date Month": "May",
  "End Date Year": "2024",
  "GPA": "3.94",
  "API Key": "AIyKwaSy...",
  "ThemeSetting": "dark",
  "cloudSyncEnabled": false
}
```

### `chrome.storage.local` (Binary / Structured Data)

| Key | Type | Description |
|-----|------|-------------|
| `Resume` | `string` (base64) | PDF binary of uploaded resume, no data-URI prefix |
| `Resume_name` | `string` | Original filename, e.g. `"JOHN_PORK_SE.pdf"` |
| `Cover Letter` | `string` (base64) | PDF binary of uploaded LinkedIn profile |
| `Cover Letter_name` | `string` | Original filename |
| `Resume_details` | `object` | AI-parsed resume structured data (see below) |
| `AppliedJobs` | `array` | Local job application tracking history |
| `AppliedJobsSync` | `array` | Cloud-synced subset (≤100 entries, in sync storage) |
| `last3Questions` | `array` | Last 3 right-clicked questions for AI generation |

**`Resume_details` structure:**
```json
{
  "skills": ["JavaScript", "React", "Node.js", "AWS"],
  "experiences": [
    {
      "jobTitle": "Solutions Engineer",
      "jobEmployer": "Apple",
      "jobDuration": "January 2022 - Present",
      "isCurrentEmployer": true,
      "roleBulletsString": "• Led technical demos...\n• Integrated..."
    }
  ],
  "certifications": [
    {
      "name": "AWS Solutions Architect",
      "issuer": "Amazon Web Services",
      "issueDate": "March 2023",
      "expirationDate": "March 2026",
      "credentialId": "ABC123",
      "url": "https://..."
    }
  ]
}
```

---

## Collected Fields — Profile Tab

### Personal Information

| UI Label | Storage Key | Type | Input Type | Placeholder/Options | Example |
|----------|-------------|------|------------|---------------------|---------|
| First Name | `First Name` | string | text | `"John"` | `"John"` |
| Middle Name | `Middle Name` | string | text | `"Quincy"` | `"Q"` |
| Last Name | `Last Name` | string | text | `"Pork"` | `"Pork"` |
| Full Name | `Full Name` | string | text | `"John Pork Sr."` | `"John Pork Sr."` |
| Email | `Email` | string | text | `"jpork@mit.edu"` | `"jpork@mit.edu"` |
| Phone | `Phone` | string | text | `"123-345-6789"` | `"123-345-6789"` |
| Phone Type | `Phone Type` | string | dropdown | `Landline, Mobile, Office Phone` | `"Mobile"` |

### Socials

| UI Label | Storage Key | Type | Input Type | Placeholder | Example |
|----------|-------------|------|------------|-------------|---------|
| LinkedIn | `LinkedIn` | string | text | `"https://linkedin.com/in/johnpork"` | URL string |
| Github | `Github` | string | text | `"https://github.com/..."` | URL string |
| LeetCode | `LeetCode` | string | text | `"https://leetcode.com/..."` | URL string |
| Medium | `Medium` | string | text | `"https://medium.com/@..."` | URL string |
| Personal Website | `Personal Website` | string | text | `"johnpork.com"` | URL string |
| Other URL | `Other URL` | string | text | `"https://..."` | URL string |

### Location

| UI Label | Storage Key | Type | Input Type | Placeholder | Example |
|----------|-------------|------|------------|-------------|---------|
| Location (Street) | `Location (Street)` | string | text | `"123 Sesame St"` | Address line |
| Location (City) | `Location (City)` | string | text | `"Albuquerque"` | City name |
| Location (State/Region) | `Location (State/Region)` | string | text | `"New Mexico"` | State/region |
| Location (Country) | `Location (Country)` | string | text | `"United States of America"` | Full country name |
| Postal/Zip Code | `Postal/Zip Code` | string | text | `"87104"` | Zip/postal code |

### Additional Information

| UI Label | Storage Key | Type | Input Type | Options | Example |
|----------|-------------|------|------------|---------|---------|
| Legally Authorized to Work | `Legally Authorized to Work` | string | dropdown | `Yes, No` | `"Yes"` |
| Requires Sponsorship | `Requires Sponsorship` | string | dropdown | `Yes, No` | `"No"` |
| Job Notice Period | `Job Notice Period` | string | text | `"Two weeks"` | Freeform |
| Expected Salary | `Expected Salary` | string | text | `"$150,000"` | Freeform |
| Languages | `Languages` | string | text | `"English, Spanish"` | Comma-separated |
| Willing to Relocate | `Willing to Relocate` | string | dropdown | `Yes, No` | `"Yes"` |
| Date Available | `Date Available` | string | text | `"Immediately"` | Freeform |
| Security Clearance | `Security Clearance` | string | dropdown | `Yes, No` | `"No"` |

### Voluntary Identification

| UI Label | Storage Key | Type | Input Type | Options | Example |
|----------|-------------|------|------------|---------|---------|
| Pronouns | `Pronouns` | string | dropdown | `He/Him, She/Her, They/Them, Decline To Self Identify, Other` | `"He/Him"` |
| Gender | `Gender` | string | dropdown | `Male, Female, Decline To Self Identify` | `"Male"` |
| Race | `Race` | string | dropdown | `American Indian or Alaskan Native, Asian, Black or African American, White, Native Hawaiian..., Two or More Races, Decline To Self Identify` | `"Black or African American"` |
| Hispanic/Latino | `Hispanic/Latino` | string | dropdown | `Yes, No, Decline To Self Identify` | `"No"` |
| Veteran Status | `Veteran Status` | string | dropdown | `I am not a protected veteran, I identify as one or more..., I don't wish to answer` | Long string |
| Disability Status | `Disability Status` | string | dropdown | `Yes, I have a disability..., No, I do not..., I do not want to answer` | Long string |

---

## Collected Fields — Experience Tab

### Documents

| UI Label | Storage Key (sync) | Storage Key (local) | Type | Input Type |
|----------|-------------------|---------------------|------|------------|
| Resume | `Resume_name` (local) | `Resume` (local, base64) | file | file upload |
| Cover Letter | `Cover Letter_name` (local) | `Cover Letter` (local, base64) | file | file upload |

### Employment

| UI Label | Storage Key | Type | Input Type | Example |
|----------|-------------|------|------------|---------|
| Current Employer | `Current Employer` | string | text | `"Apple"` |
| Years of Experience | `Years of Experience` | string | text | `"5"` |

### Structured Data (GridDataField — from Resume_details in local storage)

| UI Label | Local Storage Path | Type |
|----------|--------------------|------|
| Work Experience | `Resume_details.experiences[]` | array of objects |
| Skills | `Resume_details.skills[]` | array of strings |
| Certifications | `Resume_details.certifications[]` | array of objects |

### Education

| UI Label | Storage Key | Type | Input Type | Options/Placeholder |
|----------|-------------|------|------------|---------------------|
| School | `School` | string | text | `"Massachusetts Institute of Technology"` |
| Degree | `Degree` | string | dropdown | `Associate's, Bachelor's, M.D., Ph.D., Engineer's, High School, J.D., M.B.A., Master's, Other` |
| Discipline | `Discipline` | string | text | `"Computer Science"` |
| Start Date Month | `Start Date Month` | string | dropdown | `January...December` |
| Start Date Year | `Start Date Year` | string | text | `"2024"` |
| End Date Month | `End Date Month` | string | dropdown | `January...December` |
| End Date Year | `End Date Year` | string | text | `"2025"` |
| GPA | `GPA` | string | text | `"3.94"` |

---

## Collected Fields — Settings Tab

| UI Label | Storage Key | Type | Description |
|----------|-------------|------|-------------|
| API Key | `API Key` | string (sync) | Gemini API key for AI-powered answer generation |
| Cloud Sync toggle | `cloudSyncEnabled` | boolean (sync) | Enables syncing job history to Google account |
| Theme | `ThemeSetting` | string (sync) | `"light"` or `"dark"` |

---

## Derived / Computed Fields

| Field | Derivation | Used Where |
|-------|-----------|------------|
| `Current Date` | `curDateStr()` → `"DD/MM/YYYY"` format | Lever EEO disability signature date, Workday self-identify |
| `Location (City)` formatted | `formatCityStateCountry()` → `"City, State"` | Lever/Greenhouse location fields |

---

## Field Mapping Logic

### How `fields` Object in `utils.js` Works

The `fields` object is a multi-level map: **`fields[platform][formFieldKey] → storageKey`**

For most platforms (greenhouse, lever, dover, oracle, recruitee, successfactors, generic):
```
fields.lever["salary"] = "Expected Salary"
```
Means: when autofilling on Lever, if we find a form element matching `"salary"`, fill it with `chrome.storage.sync["Expected Salary"]`.

For Workday, the structure is nested by page section:
```
fields.workday["My Information"]["firstName"] = "First Name"
fields.workday["Application Questions"]["salary"] = "Expected Salary"
```

### Platform Detection

Detected by hostname match against `fields` keys:
- `greenhouse` → `job-boards.greenhouse.io`, `boards.greenhouse.io`
- `lever` → `jobs.lever.co`
- `dover` → `app.dover.com`
- `workday` → `*.myworkdayjobs.com`
- `oracle` → `*.oraclecloud.com`
- `successfactors` → `*.successfactors.eu`, `*.successfactors.com`
- `recruitee` → `*.recruitee.com`
- `generic` → fallback for any unrecognized hostname

### Complete Field Mappings by Platform

#### Lever (`fields.lever`)

| Form Field Key | → Storage Key |
|---------------|---------------|
| `resume` | Resume (file) |
| `name` | Full Name |
| `email` | Email |
| `phone` | Phone |
| `location` | Location (City) |
| `org` / `company` / `employer` | Current Employer |
| `urls[LinkedIn]` / `urls[Linkedin]` | LinkedIn |
| `urls[GitHub]` | Github |
| `urls[LeetCode]` | LeetCode |
| `urls[Medium]` | Medium |
| `urls[X]` / `urls[Twitter]` | Other URL |
| `urls[Portfolio]` / `urls[Link to portfolio]` | Personal Website |
| `website` / `portfolio` | Personal Website |
| `eeo[gender]` | Gender |
| `eeo[race]` | Race |
| `eeo[veteran]` | Veteran Status |
| `eeo[disability]` | Disability Status |
| `eeo[disabilitySignature]` | Full Name |
| `eeo[disabilitySignatureDate]` | Current Date |
| `candidate-location` | Location (Country) |
| `years of experience` / `experience years` / `total experience` / `relevant experience` | Years of Experience |
| `authorized` | Legally Authorized to Work |
| `sponsorship` | Requires Sponsorship |
| `notice` | Job Notice Period |
| `salary` | Expected Salary |
| `language` | Languages |
| `address line` / `street` | Location (Street) |
| `skills` | Skills |

#### Greenhouse (`fields.greenhouse`)

| Form Field Key | → Storage Key |
|---------------|---------------|
| `first_name` | First Name |
| `middle_name` | Middle Name |
| `last_name` | Last Name |
| `Preferred Name` | Full Name |
| `email` | Email |
| `phone` | Phone |
| `cover_letter` / `cover letter` | Resume (⚠️ known issue) |
| `LinkedIn` | LinkedIn |
| `Github` | Github |
| `Twitter` / `X` | Twitter |
| `candidate-location` | Location (City) |
| `Website` / `Portfolio` | Personal Website |
| `LeetCode` | LeetCode |
| `Medium` / `Blog` | Medium |
| `Employer` / `Current Company` | Current Employer |
| `resume` | Resume (file) |
| `school` | School |
| `degree` | Degree |
| `discipline` | Discipline |
| `start-month` / `start-year` | Start Date Month/Year |
| `end-month` / `end-year` | End Date Month/Year |
| `gender` | Gender |
| `hispanic_ethnicity` | Hispanic/Latino |
| `race` / `react-select-race-placeholder...` | Race |
| `veteran_status` | Veteran Status |
| `disability` | Disability Status |
| `years of experience` etc. | Years of Experience |
| `authorized` | Legally Authorized to Work |
| `sponsorship` | Requires Sponsorship |
| `notice` | Job Notice Period |
| `salary` | Expected Salary |
| `language` | Languages |
| `address line` / `street` | Location (Street) |
| `skills` | Skills |

#### Generic (Fallback — `fields.generic`)

Extensive fuzzy matching covering 80+ field key variants. Includes:
- Name fields: `first name`, `last name`, `full name`, `middle name`
- Contact: `email`, `phone`
- Social: `linkedin`, `github`, `leetcode`, `medium`, `portfolio`, `website`
- Documents: `resume`, `cv`, `cover letter` (null)
- Address: `street address`, `address line`, `city`, `state`, `zip`, `country`, `location`
- Employment: `employer`, `company`, `job title`, `university`, `school`, `degree`, `major`, `gpa`
- Work auth: `authorized`, `authorized to work`, `eligible to work`, `right to work`, `work authorization`, `legal right to work`, `legally authorized`, `work authorization status`
- Sponsorship: `sponsorship`, `visa sponsorship`, `require sponsorship`, `require visa`, `immigration sponsorship`, `work visa`, `employment visa`, `future sponsorship`
- Demographics: `gender`, `sex`, `race`, `ethnicity`, `hispanic`, `veteran`, `disability`, `pronouns`
- Other: `salary`, `notice`, `language`, `years of experience`, `relocate`, `available`, `security`, `clearance`
- Certifications: `certification`, `issuing organization`, `issue date`, `expiration date`, `credential id`, `credential url`

---

## Autofill Flow

### Trigger Points

1. **Page load** → `window.load` event → `awaitForm()`
2. **DOM mutations** → MutationObserver → debounced `tryAutofillNow()` (200ms)
3. **Manual button** → "🚀 AUTOFILL NOW" fixed button (top-right) → `tryAutofillNow({ force: true })`
4. **AI right-click** → Context menu "✨ Autofill with AI" → generates answer via Gemini API
5. **Keyboard shortcut** → `Ctrl+Shift+A` → triggers AI answer on last right-clicked field

### Autofill Sequence

```
1. Detect platform from hostname → platform key
2. Read chrome.storage.sync → res object
3. Add res["Current Date"] = curDateStr()
4. Wait 1000ms (initial delay)
5. If Workday → workDayAutofill(res) (section-based observer)
6. Else:
   a. processFields(platformKey, fields[platformKey], form, res)
      - For each fieldMap entry:
        - Get fillValue = res[storageKey]
        - Find element via inputQuery(formFieldKey, form)
        - Handle special types: Resume (file), Skills, Certifications
        - For normal fields: setNativeValue(el, fillValue)
        - For <select>: setBestSelectOption(el, fillValue)
        - For radio: clickBestRadioInGroup(el, fillValue)
        - For checkbox: clickBestCheckboxInGroup(el, fillValue)
        - For ARIA combobox: click → find listbox → matchScore options → click best
        - For custom dropdowns (.select__control--outside-label): mouseUp + keyDown events
   b. processFields('generic', genericExtras, form, res)  ← second pass for custom questions
7. Track job in AppliedJobs history
```

### Element Finding (`inputQuery`)

Three-pass approach:
1. **Attribute match** — check `id`, `name`, `placeholder`, `aria-label`, `aria-labelledby`, `aria-describedby`, `data-qa`, `data-automation-id`, `data-automation-label`, `autocomplete`, `value`
2. **Label text match** — check associated `<label for="...">`, wrapping `<label>`, `aria-labelledby` refs, parent container text (up to 4 levels)
3. **Fuzzy match** — `matchScore()` on label texts (Jaccard token similarity), threshold ≥ 50

---

## Fuzzy Matching & Malleability

### `normalizeText(str)`
Lowercases, strips non-alphanumeric, collapses whitespace. E.g. `"What are your base salary expectations?"` → `"what are your base salary expectations"`

### `matchScore(a, b)`
- Exact normalized match → 100
- Substring containment → 90
- Jaccard token overlap → `60 × (intersection/union)` + bonus 10 if ≥2 shared tokens

### Select Matching (`setBestSelectOption`)
- Normalizes fill value and all option text/values
- Checks direct inclusion
- Boolean synonym matching: `yes/true/1` ↔ option text containing those
- Negative synonym matching: `no/false/0/decline/prefer not/not/none`
- Country dropdown detection: resolves location strings to ISO 3166-1 alpha-2 codes
- Threshold: score ≥ 55

### Radio/Checkbox Matching
- Iterates all inputs with same `name`
- Compares fillValue against each radio's `value` and associated label text
- **Work auth override**: detects US-specific authorization questions → forces "yes"; sponsorship questions → forces "no"
- Threshold: score ≥ 40

### Value Setting (`setNativeValue`)
- Uses native input/textarea value setter (bypasses React's internal tracking)
- Handles checkbox/radio toggling with boolean parsing
- Handles `<select>` option matching (yes/no synonyms)
- Dispatches `input` + `change` events for React/framework detection
- Sets `value` attribute for framework sync

---

## Known Gaps & Issues

1. **Salary not filling on custom Lever questions**: The `salary` key in `fields.lever` maps to `"Expected Salary"`, but Lever custom question cards use names like `cards[...][field0]` — the generic pass needs label text matching for "salary expectations" → `"Expected Salary"`.

2. **Gender not filling on demographic survey radios**: Lever demographic surveys use `surveysResponses[...][responses][field2]` names, which don't match `eeo[gender]` or `gender` keys in the Lever field map. Needs label-text-based matching in generic pass.

3. **Country dropdown selecting wrong country**: The `candidate-location` class-based country select resolves `"houston, tx"` correctly via `resolveCountryCode()`, but only when `Location (City)` is the fill value. Should also check `Location (Country)` storage key.

4. **Resume uploaded to Cover Letter field**: `fields.greenhouse` maps `cover_letter` → `"Resume"`, causing resume upload to cover letter inputs.

5. **Work auth answer inversion**: User stores `"No"` for generic `"Legally Authorized to Work"` but real form asks "Are you authorized to work in the US?" expecting `"Yes"`. The `getWorkAuthOverride()` function handles this for radio groups but may not cover all checkbox/select variations.

6. **Phone field shows "Mobile"**: Phone Type value (`"Mobile"`) can leak into Phone text input if `inputQuery` resolves the wrong element.

7. **No coverage for**: Job Title (not stored independently), custom company-specific questions (handled by AI right-click), cover letter generation, references.

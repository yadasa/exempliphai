import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function loadPolicyIntoVm() {
  const src = fs.readFileSync(new URL('../public/contentScripts/policy.js', import.meta.url), 'utf8');

  const ctx = {
    console,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'policy.js' });

  const policy = ctx.__SmartApply?.policy;
  assert.ok(policy, 'policy should attach to __SmartApply.policy');
  return policy;
}

test('policy: isConsentCheckbox detects agree/consent/terms/privacy', () => {
  const policy = loadPolicyIntoVm();

  assert.equal(policy.isConsentCheckbox({ label: 'I agree to the Terms of Service' }), true);
  assert.equal(policy.isConsentCheckbox({ label: 'I consent to the Privacy Policy' }), true);
  assert.equal(policy.isConsentCheckbox({ label: 'Privacy' }), true);
  assert.equal(policy.isConsentCheckbox({ label: 'Email Address' }), false);
});

test('policy: isSensitiveField detects EEO/gender/race/veteran/disability/visa/age', () => {
  const policy = loadPolicyIntoVm();

  assert.equal(policy.isSensitiveField({ label: 'Gender' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Race' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Veteran Status' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Disability Status' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Visa Status' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Age' }), true);
  assert.equal(policy.isSensitiveField({ label: 'Date of Birth' }), true);

  assert.equal(policy.isSensitiveField({ label: 'Email' }), false);
  assert.equal(policy.isSensitiveField({ label: 'Requires Sponsorship' }), false);
});

test('policy: checkDomainConsent requires aiMappingEnabled AND allowAiMapping[domain]', () => {
  const policy = loadPolicyIntoVm();

  const setting1 = { aiMappingEnabled: false, allowAiMapping: { 'boards.greenhouse.io': true } };
  assert.equal(policy.checkDomainConsent('boards.greenhouse.io', setting1), false);

  const setting2 = { aiMappingEnabled: true, allowAiMapping: { 'boards.greenhouse.io': false } };
  assert.equal(policy.checkDomainConsent('boards.greenhouse.io', setting2), false);

  const setting3 = { aiMappingEnabled: true, allowAiMapping: { 'boards.greenhouse.io': true } };
  assert.equal(policy.checkDomainConsent('boards.greenhouse.io', setting3), true);

  // www. normalization
  assert.equal(policy.checkDomainConsent('www.boards.greenhouse.io', setting3), true);
});

test('policy: applyPolicy blocks consent checkboxes by forcing value.source=skip', () => {
  const policy = loadPolicyIntoVm();

  const action = {
    action_id: 'a1',
    field_fingerprint: 'fp:consent',
    descriptor: { label: 'I agree to the privacy policy' },
    value: { source: 'literal', literal: true },
    apply: { mode: 'click_best_label' },
  };

  const out = policy.applyPolicy(action, { domainConsent: true });
  assert.notEqual(out, action, 'applyPolicy should not mutate the input object');
  assert.equal(out.value.source, 'skip');
  assert.equal(out.policy.blocked, true);
  assert.equal(out.policy.block_reason, 'consent_checkbox');
  assert.equal(out.policy.requires_explicit_consent, true);
});

test('policy: applyPolicy marks sensitive requires_review unless domain consent', () => {
  const policy = loadPolicyIntoVm();

  const base = {
    action_id: 'a1',
    field_fingerprint: 'fp:gender',
    descriptor: { label: 'Gender', section: 'Voluntary Disclosures' },
    value: { source: 'profile', source_key: 'Gender' },
    apply: { mode: 'set_value' },
  };

  const outNoConsent = policy.applyPolicy(base, { domainConsent: false });
  assert.equal(outNoConsent.policy.requires_review, true);
  assert.equal(outNoConsent.policy.sensitive_category, 'eeo');

  const outWithConsent = policy.applyPolicy(base, { domainConsent: true });
  assert.ok(!outWithConsent.policy.requires_review);
  assert.equal(outWithConsent.policy.sensitive_category, 'eeo');
});

test('policy: filterSnapshot removes consent-like fields', () => {
  const policy = loadPolicyIntoVm();

  const snapshot = {
    domain: 'boards.greenhouse.io',
    unresolved_fields: [
      {
        field_fingerprint: 'fp:1',
        descriptor: { label: 'Email' },
      },
      {
        field_fingerprint: 'fp:2',
        descriptor: { label: 'I agree to the Terms' },
      },
      {
        field_fingerprint: 'fp:3',
        descriptor: { label: 'Privacy Policy' },
      },
    ],
  };

  const filtered = policy.filterSnapshot(snapshot);
  assert.equal(filtered.unresolved_fields.length, 1);
  assert.equal(filtered.unresolved_fields[0].field_fingerprint, 'fp:1');
});

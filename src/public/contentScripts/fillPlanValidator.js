/**
 * FillPlan v0.1 schema + lightweight validator.
 *
 * NOTE:
 * - Content scripts in this repo are currently loaded as "type: module" but do not reliably share
 *   top-level bindings across files.
 * - To make this usable both via ESM import and as a shared global, we export symbols AND attach
 *   them to window.__exempliphaiFillPlan when running in a browser.
 */

export const FILL_PLAN_VERSION = "0.1";

export const FILL_PLAN_CONTROL_KINDS = /** @type {const} */ ([
  "input",
  "textarea",
  "select",
  "radio-group",
  "checkbox-group",
  "combobox",
  "contenteditable",
  "file",
  "date",
  "time",
  "datetime-local",
  "unknown",
]);

export const FILL_PLAN_VALUE_SOURCES = /** @type {const} */ ([
  "profile",
  "resume_details",
  "derived",
  "literal",
  "skip",
]);

export const FILL_PLAN_APPLY_MODES = /** @type {const} */ ([
  "set_value",
  "select_best_option",
  "click_best_label",
  "upload_resume",
  "upload_cover_letter",
  // Back-compat
  "upload_linkedin_pdf", 
]);

export const FILL_PLAN_SENSITIVE_CATEGORIES = /** @type {const} */ ([
  "eeo",
  "health",
  "biometric",
  "none",
]);

export const FILL_PLAN_TRANSFORM_OPS = /** @type {const} */ ([
  "trim",
  "collapse_whitespace",
  "ensure_https",
  "full_name_part",
  "normalize_phone",
  "month_name_to_number",
  "iso_date_to_control_format",
  "city_state_country",
]);

export const fillPlanSchemaV0_1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://exempliphai.local/schemas/fillplan-0.1.schema.json",
  title: "FillPlan",
  type: "object",
  additionalProperties: true,
  required: ["version", "plan_id", "created_at", "domain", "page_url", "actions"],
  properties: {
    version: { const: FILL_PLAN_VERSION },
    plan_id: { type: "string", minLength: 1 },
    created_at: { type: "string", minLength: 1 },
    domain: { type: "string", minLength: 1 },
    page_url: { type: "string", minLength: 1 },
    provider: {
      type: "object",
      additionalProperties: true,
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
      },
    },
    snapshot_hash: { type: "string", minLength: 1 },
    actions: {
      type: "array",
      items: { $ref: "#/$defs/action" },
    },
  },
  $defs: {
    action: {
      type: "object",
      additionalProperties: true,
      required: ["action_id", "field_fingerprint", "value"],
      properties: {
        action_id: { type: "string", minLength: 1 },
        field_fingerprint: { type: "string", minLength: 1 },
        control: {
          type: "object",
          additionalProperties: true,
          properties: {
            kind: { enum: FILL_PLAN_CONTROL_KINDS },
            tag: { type: "string" },
            type: { type: "string" },
            role: { type: "string" },
            name: { type: "string" },
            id: { type: "string" },
            autocomplete: { type: "string" },
          },
        },
        descriptor: {
          type: "object",
          additionalProperties: true,
          properties: {
            label: { type: "string" },
            description: { type: "string" },
            section: { type: "string" },
            required: { type: "boolean" },
            visible: { type: "boolean" },
            options: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        value: {
          type: "object",
          additionalProperties: true,
          required: ["source"],
          properties: {
            source: { enum: FILL_PLAN_VALUE_SOURCES },
            source_key: { type: "string" },
            literal: {},
            derived: {
              type: "object",
              additionalProperties: true,
              required: ["kind"],
              properties: {
                kind: { type: "string", minLength: 1 },
                args: { type: "object", additionalProperties: true },
              },
            },
          },
          allOf: [
            {
              if: {
                properties: { source: { const: "profile" } },
                required: ["source"],
              },
              then: { required: ["source_key"] },
            },
          ],
        },
        transform: {
          type: "array",
          items: { $ref: "#/$defs/transformStep" },
        },
        apply: {
          type: "object",
          additionalProperties: true,
          required: ["mode"],
          properties: {
            mode: { enum: FILL_PLAN_APPLY_MODES },
            allow_overwrite: { type: "boolean" },
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" },
        alternatives: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            required: ["value"],
            properties: {
              value: { $ref: "#/$defs/valueOnly" },
              transform: {
                type: "array",
                items: { $ref: "#/$defs/transformStep" },
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
          },
        },
        policy: {
          type: "object",
          additionalProperties: true,
          properties: {
            sensitive_category: { enum: FILL_PLAN_SENSITIVE_CATEGORIES },
            requires_review: { type: "boolean" },
            requires_explicit_consent: { type: "boolean" },
          },
        },
      },
    },
    valueOnly: {
      type: "object",
      additionalProperties: true,
      required: ["source"],
      properties: {
        source: { enum: FILL_PLAN_VALUE_SOURCES },
        source_key: { type: "string" },
        literal: {},
        derived: {
          type: "object",
          additionalProperties: true,
          required: ["kind"],
          properties: {
            kind: { type: "string", minLength: 1 },
            args: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    transformStep: {
      type: "object",
      additionalProperties: true,
      required: ["op"],
      properties: {
        op: { enum: FILL_PLAN_TRANSFORM_OPS },
        // op-specific args validated in runtime validator
      },
    },
  },
};

/**
 * @typedef {{path: string, message: string}} FillPlanValidationError
 */

function isPlainObject(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function isNonEmptyString(x) {
  return typeof x === "string" && x.trim().length > 0;
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function pushErr(errors, path, message) {
  errors.push({ path, message });
}

function oneOf(values, x) {
  return values.includes(x);
}

function validateDateLikeString(value) {
  if (!isNonEmptyString(value)) return false;
  // Accept anything Date.parse can parse; also accept ISO-ish strings.
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function validateUrlLikeString(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    // Allow relative? For now require absolute.
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch (_) {
    return false;
  }
}

function validateTransformStep(step, path, errors) {
  if (!isPlainObject(step)) {
    pushErr(errors, path, "transform step must be an object");
    return;
  }
  if (!isNonEmptyString(step.op)) {
    pushErr(errors, path + ".op", "transform.op must be a non-empty string");
    return;
  }
  if (!oneOf(FILL_PLAN_TRANSFORM_OPS, step.op)) {
    pushErr(
      errors,
      path + ".op",
      `transform.op must be one of: ${FILL_PLAN_TRANSFORM_OPS.join(", ")}`
    );
    return;
  }

  // Op-specific constraints.
  switch (step.op) {
    case "full_name_part": {
      if (!oneOf(["first", "middle", "last"], step.part)) {
        pushErr(errors, path + ".part", "full_name_part requires part: first|middle|last");
      }
      break;
    }
    case "normalize_phone": {
      if (!oneOf(["E164", "national"], step.format)) {
        pushErr(errors, path + ".format", "normalize_phone requires format: E164|national");
      }
      break;
    }
    default:
      // No additional validation for other ops.
      break;
  }
}

function validateValue(value, path, errors) {
  if (!isPlainObject(value)) {
    pushErr(errors, path, "value must be an object");
    return;
  }
  if (!isNonEmptyString(value.source)) {
    pushErr(errors, path + ".source", "value.source must be a non-empty string");
    return;
  }
  if (!oneOf(FILL_PLAN_VALUE_SOURCES, value.source)) {
    pushErr(
      errors,
      path + ".source",
      `value.source must be one of: ${FILL_PLAN_VALUE_SOURCES.join(", ")}`
    );
    return;
  }

  if (value.source === "profile") {
    if (!isNonEmptyString(value.source_key)) {
      pushErr(errors, path + ".source_key", "value.source_key is required when source=profile");
    }
  }

  if (value.source === "literal") {
    if (!("literal" in value)) {
      pushErr(errors, path + ".literal", "value.literal is required when source=literal (may be null)");
    }
  }

  if (value.source === "derived") {
    if (!isPlainObject(value.derived)) {
      pushErr(errors, path + ".derived", "value.derived must be an object when source=derived");
    } else {
      if (!isNonEmptyString(value.derived.kind)) {
        pushErr(errors, path + ".derived.kind", "value.derived.kind is required when source=derived");
      }
      if ("args" in value.derived && !isPlainObject(value.derived.args)) {
        pushErr(errors, path + ".derived.args", "value.derived.args must be an object if provided");
      }
    }
  }

  if (value.source === "skip") {
    // Encourage clean payloads.
    if ("source_key" in value) {
      pushErr(errors, path + ".source_key", "value.source_key must be omitted when source=skip");
    }
    if ("literal" in value) {
      pushErr(errors, path + ".literal", "value.literal must be omitted when source=skip");
    }
    if ("derived" in value) {
      pushErr(errors, path + ".derived", "value.derived must be omitted when source=skip");
    }
  }
}

function validateApply(apply, path, errors) {
  if (!isPlainObject(apply)) {
    pushErr(errors, path, "apply must be an object");
    return;
  }
  if (!isNonEmptyString(apply.mode)) {
    pushErr(errors, path + ".mode", "apply.mode must be a non-empty string");
    return;
  }
  if (!oneOf(FILL_PLAN_APPLY_MODES, apply.mode)) {
    pushErr(errors, path + ".mode", `apply.mode must be one of: ${FILL_PLAN_APPLY_MODES.join(", ")}`);
  }
  if ("allow_overwrite" in apply && typeof apply.allow_overwrite !== "boolean") {
    pushErr(errors, path + ".allow_overwrite", "apply.allow_overwrite must be a boolean if provided");
  }
}

function validatePolicy(policy, path, errors) {
  if (!isPlainObject(policy)) {
    pushErr(errors, path, "policy must be an object");
    return;
  }
  if ("sensitive_category" in policy && !oneOf(FILL_PLAN_SENSITIVE_CATEGORIES, policy.sensitive_category)) {
    pushErr(
      errors,
      path + ".sensitive_category",
      `policy.sensitive_category must be one of: ${FILL_PLAN_SENSITIVE_CATEGORIES.join(", ")}`
    );
  }
  if ("requires_review" in policy && typeof policy.requires_review !== "boolean") {
    pushErr(errors, path + ".requires_review", "policy.requires_review must be a boolean if provided");
  }
  if ("requires_explicit_consent" in policy && typeof policy.requires_explicit_consent !== "boolean") {
    pushErr(
      errors,
      path + ".requires_explicit_consent",
      "policy.requires_explicit_consent must be a boolean if provided"
    );
  }
}

function validateAction(action, i, errors) {
  const path = `actions[${i}]`;

  if (!isPlainObject(action)) {
    pushErr(errors, path, "action must be an object");
    return;
  }

  if (!isNonEmptyString(action.action_id)) {
    pushErr(errors, path + ".action_id", "action_id must be a non-empty string");
  }
  if (!isNonEmptyString(action.field_fingerprint)) {
    pushErr(errors, path + ".field_fingerprint", "field_fingerprint must be a non-empty string");
  }

  // control
  if ("control" in action) {
    if (!isPlainObject(action.control)) {
      pushErr(errors, path + ".control", "control must be an object if provided");
    } else if ("kind" in action.control && !oneOf(FILL_PLAN_CONTROL_KINDS, action.control.kind)) {
      pushErr(
        errors,
        path + ".control.kind",
        `control.kind must be one of: ${FILL_PLAN_CONTROL_KINDS.join(", ")}`
      );
    }
  }

  // descriptor
  if ("descriptor" in action) {
    if (!isPlainObject(action.descriptor)) {
      pushErr(errors, path + ".descriptor", "descriptor must be an object if provided");
    } else if ("options" in action.descriptor) {
      if (!Array.isArray(action.descriptor.options) || !action.descriptor.options.every((x) => typeof x === "string")) {
        pushErr(errors, path + ".descriptor.options", "descriptor.options must be an array of strings if provided");
      }
    }
  }

  // value (required)
  validateValue(action.value, path + ".value", errors);

  // transform
  if ("transform" in action) {
    if (!Array.isArray(action.transform)) {
      pushErr(errors, path + ".transform", "transform must be an array if provided");
    } else {
      for (let t = 0; t < action.transform.length; t++) {
        validateTransformStep(action.transform[t], `${path}.transform[${t}]`, errors);
      }
    }
  }

  // apply
  if ("apply" in action) {
    validateApply(action.apply, path + ".apply", errors);
  }

  // confidence
  if ("confidence" in action) {
    if (!isFiniteNumber(action.confidence) || action.confidence < 0 || action.confidence > 1) {
      pushErr(errors, path + ".confidence", "confidence must be a number between 0 and 1 if provided");
    }
  }

  // alternatives
  if ("alternatives" in action) {
    if (!Array.isArray(action.alternatives)) {
      pushErr(errors, path + ".alternatives", "alternatives must be an array if provided");
    } else {
      for (let a = 0; a < action.alternatives.length; a++) {
        const alt = action.alternatives[a];
        const ap = `${path}.alternatives[${a}]`;
        if (!isPlainObject(alt)) {
          pushErr(errors, ap, "alternative must be an object");
          continue;
        }
        validateValue(alt.value, ap + ".value", errors);
        if ("transform" in alt) {
          if (!Array.isArray(alt.transform)) {
            pushErr(errors, ap + ".transform", "alternative.transform must be an array if provided");
          } else {
            for (let t = 0; t < alt.transform.length; t++) {
              validateTransformStep(alt.transform[t], `${ap}.transform[${t}]`, errors);
            }
          }
        }
        if ("confidence" in alt) {
          if (!isFiniteNumber(alt.confidence) || alt.confidence < 0 || alt.confidence > 1) {
            pushErr(errors, ap + ".confidence", "alternative.confidence must be a number between 0 and 1 if provided");
          }
        }
      }
    }
  }

  // policy
  if ("policy" in action) {
    validatePolicy(action.policy, path + ".policy", errors);
  }
}

/**
 * Validate a FillPlan object.
 *
 * @param {unknown} plan
 * @returns {{ok: true, value: any, errors: []} | {ok: false, value: any, errors: FillPlanValidationError[]}}
 */
export function validateFillPlan(plan) {
  const errors = /** @type {FillPlanValidationError[]} */ ([]);

  if (!isPlainObject(plan)) {
    return { ok: false, value: plan, errors: [{ path: "", message: "plan must be an object" }] };
  }

  if (plan.version !== FILL_PLAN_VERSION) {
    pushErr(errors, "version", `version must be ${FILL_PLAN_VERSION}`);
  }

  if (!isNonEmptyString(plan.plan_id)) {
    pushErr(errors, "plan_id", "plan_id must be a non-empty string");
  }

  if (!validateDateLikeString(plan.created_at)) {
    pushErr(errors, "created_at", "created_at must be a parseable datetime string");
  }

  if (!isNonEmptyString(plan.domain)) {
    pushErr(errors, "domain", "domain must be a non-empty string");
  }

  if (!validateUrlLikeString(plan.page_url)) {
    pushErr(errors, "page_url", "page_url must be a valid absolute URL");
  }

  if ("provider" in plan && plan.provider != null) {
    if (!isPlainObject(plan.provider)) {
      pushErr(errors, "provider", "provider must be an object if provided");
    } else {
      if (!isNonEmptyString(plan.provider.name)) {
        pushErr(errors, "provider.name", "provider.name must be a non-empty string");
      }
      if ("model" in plan.provider && plan.provider.model != null && !isNonEmptyString(plan.provider.model)) {
        pushErr(errors, "provider.model", "provider.model must be a non-empty string if provided");
      }
    }
  }

  if (!Array.isArray(plan.actions)) {
    pushErr(errors, "actions", "actions must be an array");
  } else {
    for (let i = 0; i < plan.actions.length; i++) {
      validateAction(plan.actions[i], i, errors);
    }
  }

  if (errors.length) return { ok: false, value: plan, errors };
  return { ok: true, value: plan, errors: /** @type {any} */ ([]) };
}

/**
 * Parse + validate FillPlan JSON.
 *
 * @param {string} json
 * @returns {{ok: true, value: any, errors: []} | {ok: false, value: any, errors: FillPlanValidationError[]}}
 */
export function parseAndValidateFillPlanJSON(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      value: null,
      errors: [{ path: "", message: `invalid JSON: ${e?.message || String(e)}` }],
    };
  }
  return validateFillPlan(value);
}

/**
 * Throwing variant (handy for strict callers).
 *
 * @param {unknown} plan
 * @returns {any}
 */
export function assertValidFillPlan(plan) {
  const res = validateFillPlan(plan);
  if (!res.ok) {
    const msg = res.errors.map((e) => `${e.path || "<root>"}: ${e.message}`).join("\n");
    throw new Error(`Invalid FillPlan:\n${msg}`);
  }
  return res.value;
}

// Expose as a shared global for non-ESM callers.
try {
  if (typeof window !== "undefined") {
    window.__exempliphaiFillPlan = {
      version: FILL_PLAN_VERSION,
      schema: fillPlanSchemaV0_1,
      enums: {
        controlKinds: FILL_PLAN_CONTROL_KINDS,
        valueSources: FILL_PLAN_VALUE_SOURCES,
        applyModes: FILL_PLAN_APPLY_MODES,
        transformOps: FILL_PLAN_TRANSFORM_OPS,
        sensitiveCategories: FILL_PLAN_SENSITIVE_CATEGORIES,
      },
      validateFillPlan,
      parseAndValidateFillPlanJSON,
      assertValidFillPlan,
    };
  }
} catch (_) {
  // ignore
}

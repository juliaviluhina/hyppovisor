# Quickstart: Validate "Fill Form Fields and the Space Key"

Proves the feature end-to-end: an agent can draft a full form, dangerous targets stay
refused, `space` activates the focused element under the click rules, and every call is
audited.

## Prerequisites

- `npm install` done; Node ≥ 22.
- `npm run build` passes (TypeScript clean after the `InteractOperation` / `appliesTo`
  changes).
- Test fixture `tests/fixtures/form.html` extended with: plain `text`/`email`/`tel`/`url`/
  `number` inputs and a `<textarea>`, all inside one `<form>`; an `<input type="file">`; a
  consent checkbox (`<label>I agree to the terms</label>`); a `button[type="submit"]`; a
  plain `<button type="button">Add another</button>`; a minimal `role="combobox"` with an
  inner `<input>` and `role="option"` children.

## 1. Unit — rules and allowlist (`tests/unit/blocklist.test.ts`)

```
npm run test -- blocklist
```

Expected:

- `in-form` rule reports `appliesTo: "click"` from `listBlocklistRules()`; `matchBlocklist(d, "fill")`
  never returns `ruleId: "in-form"` for any descriptor.
- `matchBlocklist` parity: for descriptors matching `submit-control`, `consent-toggle`,
  `external-act-label`, `credential-field`, the verdict and `ruleId` are identical for
  `op: "click"` and `op: "space"`.
- `listSafeFillTypes()` returns exactly `text, email, tel, url, search, number` (+ element
  kinds `textarea`, `contenteditable`); `isSafeFillTarget` denies `file`, `select`,
  `listbox`, combobox container, `checkbox`, `radio`, `hidden`, `button` with a reason.

Ref: [data-model.md](./data-model.md) §2–§3, [contracts/interact-tool.md](./contracts/interact-tool.md).

## 2. Integration — in-form fill permitted (`tests/integration/interaction.spec.ts`)

Load `form.html`, then:

- `interact(fill, "#first_name", "Iuliia")` → `outcome: "permitted"`; DOM shows the value.
- `fill` on the `email`, `tel`, `url`, `number` inputs and the `<textarea>` → all permitted.
- After each, the tab URL is unchanged and no `submit` event fired (attach a listener in the
  fixture that records to `window.__submitted`).
- `interact(fill, "#first_name", "Xxxx")` a second time → field reads `"Xxxx"`, not
  `"IuliiaXxxx"` (FR-017 replace).

## 3. Integration — dangerous targets still refused

- `interact(click, 'button[type="submit"]')` → refused, `ruleId: "submit-control"`.
- `interact(fill, "#resume")` (file input) → refused, `ruleId: "unsafe-fill-type"`.
- `interact(fill, "#country")` (`<select>` or combobox container) → refused.
- `interact(click, "#agree")` (consent checkbox) → refused, `ruleId: "consent-toggle"`.
- On a login fixture, `interact(fill, "#password")` → refused, `ruleId: "credential-field"`.
- Combobox **filter** input: `interact(fill, "#country-combobox-input", "Ger")` → permitted;
  option list narrows; nothing submitted.

## 4. Integration — the `space` operation

- Focus the plain checkbox, `interact(space)` (no selector) → permitted; checkbox toggled.
- Focus `button[type="submit"]`, `interact(space)` → refused, `ruleId: "submit-control"`.
- Focus the plain `<button type="button">` inside the form, `interact(space)` → permitted
  (in-form does not gate space); a `click` on the same button is refused by `in-form`.
- Focus the `email` input, `interact(space)` → permitted; value gains one `" "`; no submit.
- Blur everything (`document.activeElement === body`), `interact(space)` → refused, reason
  "no focused target", `ruleId: null`.
- Focus a `role="option"` in the open combobox list, `interact(space)` → permitted; option
  chosen.

## 5. Audit log

After the runs above, read `interaction-log.jsonl` from the app `userData` dir:

- One line per `fill` and per `space` call, permitted or refused.
- Refused lines carry the matched `ruleId` (or `null` for "no focused target").
- No page text in any line — only `operation`, `target`, `outcome`, `ruleId`, `url`.

## 6. e2e (optional, `npm run test:e2e`)

On a real Greenhouse application form (opened via `open_url`):

- `fill` every plain text/email/tel/url/number/textarea field → 100% permitted, no submit
  (SC-001).
- Every submit button / consent toggle / credential field → refused with the pre-feature
  `ruleId` (SC-002).

## 7. Governance / docs

- `.specify/memory/constitution.md`: Principle I has the value-entry clause; Amendment
  History has a 2026-08-29 MINOR entry; footer reads `Version: 1.2.0`.
- `README.md` "What the app will not do" and the `interact` tool description string match the
  new behavior (FR-016): `fill` allowed on plain value fields + combobox filter inputs
  inside a form; `space` gated by submit/consent/external-act/credential; submit/consent/
  credential targets and Enter remain unavailable.

## Done when

All of §1–§5 pass, §7 is verified by inspection, and `npm run build` + `npm run lint` are
clean.

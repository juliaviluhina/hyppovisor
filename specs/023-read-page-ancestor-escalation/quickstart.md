# Quickstart: Ancestor Escalation and Exclusion

1. Run `npm test` to execute the unit and integration suites.
2. Use the existing read-page fixture harness with `selector: "#detail-pane"`,
   `ancestorLevels: 1`, and `exclude: [".chat-panel"]`.
3. Confirm the result contains surrounding context but not `.chat-panel` text or markup, and
   inspect `scope.effectiveAncestorLevels` and `scope.exclusions`.
4. Repeat with `ancestorLevels: 0`, `exclude: []`, and `reduceDom: false` to confirm compatibility.
5. Exercise invalid CSS, an unmatched exclusion, root exclusion, and a level beyond `<html>`.

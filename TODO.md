# TODO

## Login email/password autofill corner artifact

- [ ] Fix the thin whitish edge visible at the rounded corners of the email
  and password fields on the login page when saved credentials are autofilled.
- Reproduce in the affected browser with a saved email/password. Compare login
  fields with the signup fields and Google sign-in button; signup currently
  looks correct.
- The login fields were moved into rounded, overflow-clipped shells and their
  autofill fill was set to the panel color, but the reporter has not confirmed
  that this resolves the visual artifact. Inspect actual computed styles and
  browser autofill rendering before choosing another fix.
- Verify normal, autofilled, focused, and password-visibility states. Keep the
  email/password fields consistent with signup and Google button corner styling.
- Update the related check in `scripts/check-app.js` and close feedback item
  F-005 in `FEEDBACK.md` only after the visual issue is confirmed fixed.

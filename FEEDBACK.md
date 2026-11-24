# WealthRoute feedback tracker

This file records user feedback, follow-up actions, and verification. Keep
reported problems open until the relevant change is deployed and tested.

## Reported feedback

| ID | Feedback | Priority | Status |
| --- | --- | --- | --- |
| F-001 | Google sign-in reports that the site address is not authorized. | High | Closed (2026-11-15) — verified on Pages; sign-in now works without the unauthorized-domain error. |
| F-002 | Sign-up username input gives a confusing format error when a full name or email address is entered. | Medium | Closed (2026-11-16) — signup now accepts email/password without a username field, and a temporary member username is created automatically. |
| F-003 | Consider packaging a beta for the Google Play Store. | Later | Backlog — evaluate packaging, release readiness, and Play Store requirements. |
| F-004 | Consider monetization, potentially ads before other revenue. | Later | Backlog — assess privacy, trust, and suitability for a personal-finance app before deciding. |
| F-005 | Login email and password autofill shows a thin light edge at the rounded corners; signup fields look correct. | Medium | Open — fields now use rounded clipping shells; verify with saved credentials in the deployed login page. |

## Details and follow-up

### F-001 — Google sign-in domain authorization

The reported `auth/unauthorized-domain` message means Firebase Authentication
does not allow the hostname currently serving the app. The app already displays
a specific message for this Firebase error; changing the website or Worker
configuration alone does not authorize the hostname in Firebase.

- In Firebase Console, open **Authentication → Settings → Authorized domains**
  for the Firebase project used by WealthRoute.
- Add `wealth-route.pages.dev` (hostname only, no scheme or path). Also add
  `kudzanaigomera.github.io` if Google sign-in should continue working on the
  GitHub Pages site.
- Verify that **Google** is enabled under **Authentication → Sign-in method**.
- Tested **Continue with Google** on `wealth-route.pages.dev` after the domain
  was added; the flow reached the app without the unauthorized-domain error.
- User confirmed they can log in successfully on the Pages site.

### F-002 — Signup format popup

The browser “Please match the requested format” popup is no longer triggered in
signup because the form no longer requires a username field. The app creates a
unique temporary `member...` username automatically from the Firebase UID and
allows the user to change it later in **Settings → Account**.

- Remove username entry from signup so account creation only asks for email
  and password.
- Generate a unique temporary `member-...` username from the Firebase user ID.
- Let the user change that username later in **Settings → Account**.
- Keep email and password checks in app code rather than native browser format
  validation.
- Verified in the app: sign-up now works without the native format popup.

### F-003 — Play Store beta

Revisit after core account flows and mobile behavior are stable. Assess the
packaging approach, testing and release requirements before committing to a
beta.

### F-004 — Monetization and ads

No monetization decision has been made. Review privacy, user trust, and the
risks of advertising in a personal-finance product before implementation.

### F-005 — Login autofill corner edge

The reported artifact appears on the login email and password fields when the
browser fills saved credentials. The signup fields look correct, suggesting the
issue is tied to browser autofill rather than the shared field colors. The
login-only autofill styling previously painted a large inset shadow directly
on the input, where its corners could show a thin light edge.

- Email and password controls now sit inside rounded, overflow-clipped shells
  with the same panel background as the Google sign-in button.
- Keep autofill text readable and the autofill fill matched to the panel; avoid
  moving the oversized autofill fill outside the clipping shell.
- Verify the deployed login page with actual saved email/password credentials
  in the affected browser. Confirm the corners match the signup fields and
  Google button, including on focus. Close this item only after that visual
  check.

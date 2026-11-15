# WealthRoute feedback tracker

This file records user feedback, follow-up actions, and verification. Keep
reported problems open until the relevant change is deployed and tested.

## Reported feedback

| ID | Feedback | Priority | Status |
| --- | --- | --- | --- |
| F-001 | Google sign-in reports that the site address is not authorized. | High | Closed (2026-11-15) — verified on Pages; sign-in now works without the unauthorized-domain error. |
| F-002 | Sign-up username input gives a confusing format error when a full name or email address is entered. | Medium | Open — email/password-only signup and automatic username are implemented locally; deploy and user retest pending. |
| F-003 | Consider packaging a beta for the Google Play Store. | Later | Backlog — evaluate packaging, release readiness, and Play Store requirements. |
| F-004 | Consider monetization, potentially ads before other revenue. | Later | Backlog — assess privacy, trust, and suitability for a personal-finance app before deciding. |

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

The user reported that the browser's “Please match the requested format” popup
still appears in the live signup form. Keep this item open until the updated
flow is deployed and verified with the user.

- Remove username entry from signup so account creation only asks for email
  and password.
- Generate a unique temporary `member-...` username from the Firebase user ID.
- Let the user change that username later in **Settings → Account**.
- Keep email and password checks in app code rather than native browser format
  validation.
- This revision is implemented locally; deploy and retest the live form before
  closing the feedback item.

### F-003 — Play Store beta

Revisit after core account flows and mobile behavior are stable. Assess the
packaging approach, testing and release requirements before committing to a
beta.

### F-004 — Monetization and ads

No monetization decision has been made. Review privacy, user trust, and the
risks of advertising in a personal-finance product before implementation.

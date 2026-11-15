# WealthRoute feedback tracker

This file records user feedback, follow-up actions, and verification. Keep
reported problems open until the relevant change is deployed and tested.

## Reported feedback

| ID | Feedback | Priority | Status |
| --- | --- | --- | --- |
| F-001 | Google sign-in reports that the site address is not authorized. | High | Closed (2026-11-15) — verified on Pages; sign-in now works without the unauthorized-domain error. |
| F-002 | Sign-up username input gives a confusing format error when a full name or email address is entered. | Medium | Closed (2026-11-15) — custom validation now prevents the browser’s generic format popup and keeps the username rules clear. |
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

### F-002 — Username format guidance

The username is a unique account handle, not a display name or email address.
Its existing rules are 3-20 letters, numbers, or underscores, with no spaces.
The sign-up form now states these rules next to the field and for assistive
technology. The validation rules were not loosened.

### F-003 — Play Store beta

Revisit after core account flows and mobile behavior are stable. Assess the
packaging approach, testing and release requirements before committing to a
beta.

### F-004 — Monetization and ads

No monetization decision has been made. Review privacy, user trust, and the
risks of advertising in a personal-finance product before implementation.

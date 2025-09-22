# Portal-only mode

The Dashboard route (`/dashboard`) has been removed. The main Portal (`/`) provides chat and voice. These controls are gated behind authentication:

- When not signed in, the Chat button and Voice button are disabled and show a hint to sign in.
- After signing in, both controls are enabled.

Sign-in/sign-up live at `/signin` and `/signup`. After successful sign-in, users are redirected back to the Portal.

Routes overview:

- Main Portal: `/`
- Admin Panel: `/admin`
- Interstellar Admin: `/admin/interstellar`
- Interstellar Manager: `/interstellar`

Settings UX:

- The Settings modal uses collapsible sections with per-section open/closed state persisted in localStorage.

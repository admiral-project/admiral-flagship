# admiral-flagship

Administrative web console for the Admiral PaaS platform.

`admiral-flagship` provides a graphical interface for platform operators to manage nodes, applications, tenants, instances, backups, and jobs.

## Architecture

`admiral-flagship` is a **thin administrative frontend** for `admirald`.

- Flask serves as a BFF (Backend For Frontend): proxies all requests to the `admirald` API and manages admin sessions.
- PatternFly 6 CSS for layout and components.
- Vue 3 + Vue Router 4 (no build step, served via CDN) for SPA routing.
- **No direct database access.** All state comes from the `admirald` API.
- **No business logic.** Every administrative action is delegated to `admirald`.

## Current product state

`admiral-flagship` is functional and is part of the normal single-node installation flow.

Current UI areas include:

- Dashboard
- Nodes
- Apps catalog
- Instances
- Backups
- Jobs
- Change password
- Security

### Operator authorization

Flagship has one operator role: `admin`, with full administrative access.
Delegated `support` and `audit` roles are intentionally not part of the
product authorization model. Operational auditability is provided by the
platform's existing operation and request audit records.

Current instance detail capabilities include:

- instance summary and placement data
- runtime status and health labels
- pause action
- destructive action review gate
- tier change flow
- database and volume backup triggers
- restore request access
- recent operations history

## Dependencies

**All dependencies are available in official repositories — no pip, no npm, no external registries required.**

| Package | Repository | Notes |
|---------|-----------|-------|
| `python3-flask` | EPEL 10 | Web framework |
| `python3-requests` | BaseOS (Rocky Linux 10) / EPEL | HTTP client for admirald API |
| `@patternfly/patternfly` | CDN (unpkg) | CSS framework, loaded at runtime |
| `vue` + `vue-router` | CDN (unpkg) | Frontend framework, loaded at runtime |

No build step is required. The frontend runs entirely from the HTML template served by Flask.

## Operator security and browser verification

Each operator owns a **verified email address**. The address is shown and edited
from the **Security** page (side menu, next to *Change Password*).

### SMTP configuration

Email verification is delivered through SMTP using environment variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `FLAGSHIP_SMTP_HOST` | yes (verification in use) | SMTP relay host |
| `FLAGSHIP_SMTP_PORT` | no | Defaults to `587` |
| `FLAGSHIP_SMTP_STARTTLS` | no | Defaults to `1`, disables with `0` (implicit TLS only) |
| `FLAGSHIP_SMTP_USERNAME` | no | Username for authenticated SMTP |
| `FLAGSHIP_SMTP_PASSWORD` | no | Password for authenticated SMTP |
| `FLAGSHIP_SMTP_FROM` | yes (verification in use) | Envelope sender used for verification mail |

If `FLAGSHIP_SMTP_HOST` or `FLAGSHIP_SMTP_FROM` is empty, login on an untrusted
browser **fails closed**: the account cannot sign in from that browser until
SMTP is configured, because the single-use code cannot be delivered.

### Enrollment

1. Log in as the operator.
2. Open **Security**.
3. Set the operator email and click *Send verification code*.
4. Enter the code and click *Verify code*.
5. Enable *Require a single-use email code on new browsers*.

From that point on, signing in from any browser **without** the trusted-device
cookie requires a single-use code that is emailed to the account. Browsers that
completed the flow once keep a signed trusted-device cookie and skip the code
on later logins, including over logout.

Notes:

- Each code is single-use and expires after 10 minutes.
- Code delivery is reattempted once already issued; verification codes are
  rate-limited per username and source IP, and a failed or repeated code does
  not open a session.
- SMTP credentials, the code, and the account email are never written to logs.
- The Flagship audit log records that a verification code was issued or
  consumed, without the code itself or the destination address.

### Break-glass recovery

If the operator loses access to the verified email, recovery is **explicit and
auditable** and requires platform administrative access:

1. The operator still trusts an existing session on some browser: disable the
   flag from the **Security** page, enroll a fresh verified email, then
   re-enable it.

2. Otherwise, a host administrator clears the flag in the Admiral database
   (the operator profile row is preserved, only `mfa_email_enabled` changes):

   ```console
   $ sudo -u postgres psql admiral -c \
     "UPDATE admin_users SET mfa_email_enabled = false WHERE username = 'OPERATOR';"
   ```

   That file-level change is visible to platform admins in the PostgreSQL
   statement log and in subsequent Flagship request logs. After recovery
   completes, re-enable the flag from the **Security** page and rotate the
   operator password as a precaution.

There is deliberately no self-service "reset this code" path: an attacker who
can read the email inbox or relay must still know the password, and the
rate-limiter and fail-closed behavior remain active during every attempt.

## Installation model

The official installation path for `admiral-flagship` is RPM-based.

- Build the Admiral RPM set from this umbrella repository.
- Install `admiral-flagship` as part of the normal single-node package set.
- Use the systemd service installed by the RPM for runtime management.

Direct ad hoc installation with `pip` is not the documented product path.

## Design rules

- `admiral-flagship` does not execute infrastructure operations directly.
- All operations (pause, resume, backup, deprovision, migrate) are requested via the `admirald` API.
- The console is read-heavy: it shows platform state fetched from `admirald`.
- Destructive actions require explicit confirmation before proceeding.

See `AGENTS.md` for the full architectural guidelines.

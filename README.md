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

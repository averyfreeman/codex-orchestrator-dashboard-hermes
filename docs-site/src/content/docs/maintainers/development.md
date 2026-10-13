---
title: Develop and validate
description: Run the dashboard and execute its browser, TypeScript, Python, Ansible, and documentation checks.
---

## Local workflow

```sh
npm ci
npm run dev
```

The root npm workspace contains both the Next.js application and the Astro documentation site. Documentation commands are `npm run docs:dev`, `npm run docs:check`, and `npm run docs:build`.

## Validation set

Run the public snapshot check before committing. The complete local acceptance commands are:

```sh
uv python install 3.11
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
npm run docs:check
npm run docs:build
.venv/bin/python scripts/test_sync_codex_profile.py
.venv/bin/python -m unittest scripts.test_codex_control scripts.test_codex_recovery scripts.test_herdr_sessions scripts.test_codex_sync scripts.test_macos_launchagents scripts.test_ansible_inventory scripts.test_resource_metrics
.venv/bin/python -m compileall -q scripts ansible/inventory.py
.venv/bin/python scripts/check_public_snapshot.py
PATH="$PWD/.venv/bin:$PATH" .venv/bin/ansible-playbook -i ansible/inventory.py --syntax-check ansible/playbooks/sync-linux-fleet.yml
```

Install Playwright Chromium once with `npx playwright install chromium` before running the browser test. The test launches the built app on loopback and stubs its API responses, so it does not contact configured hosts.

The docs check compiles Astro/Starlight content; the docs build must be produced with the lockfile and emitted to `docs-site/dist`. Validate generated URLs include the configured repository base path and test the docs preview at desktop and narrow widths.

## Source documentation

The supported source languages are TypeScript and Python. Exported route, library, and UI symbols have JSDoc; stable Python helper APIs and CLI entrypoints use PEP 257 docstrings. Keep tests, generated/vendor files, and ordinary private helpers out of that scope. Prefer explaining behavioral constraints, trust boundaries, and data shape over repeating the function name.

For a source change, update the appropriate operator or maintainer guide and its API/script reference in the same change. Never copy private inventory data or machine-specific values into docs fixtures.

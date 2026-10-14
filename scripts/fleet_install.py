#!/usr/bin/env python3
"""Fixed host-side activation recipes for checksum-verified fleet artifacts.

Imported by the sync helper after its host identity/freshness gate. No commands,
package versions, or destination paths are accepted from the browser.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

RELEASE_PLUGINS = {'git-bbq', 'hugo-railway', 'linkedin-chatgpt-adjunct', 'spit-roast', 'astra-watch', 'long-running-tasks-plugin'}


def activate_fleet_artifact(request: dict) -> dict:
    # unpack/checksum are supplied by fleet_artifacts in the combined helper.
    digest = request.get('artifact')
    dependency_digest = request.get('dependencies')
    plugins = request.get('plugins')
    if not isinstance(plugins, list) or not plugins or not set(plugins) <= RELEASE_PLUGINS:
        raise ValueError('Invalid approved plugin subset')
    if any(not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value) for value in (digest, dependency_digest)):
        raise ValueError('Invalid artifact reference')
    home = Path.home()
    root = home / 'build/codex-fleet-sync'
    packages = root / ('packages-' + digest)
    dependencies = root / ('dependencies-' + dependency_digest)
    unpack(root / 'artifacts' / (digest + '.tar.gz'), digest, packages)
    unpack(root / 'artifacts' / (dependency_digest + '.tar.gz'), dependency_digest, dependencies)
    env = os.environ.copy()
    env['PATH'] = str(home / '.local/bin') + ':' + str(home / '.bun/bin') + ':' + env.get('PATH', '')
    env['CODEX_HOME'] = str(_resolve_codex_home(request.get('codexHome')))
    cli = _codex_path(Path(env['CODEX_HOME']))
    if not cli or not shutil.which('uv', path=env['PATH']) or not shutil.which('node', path=env['PATH']):
        raise ValueError('Node, uv, and Codex must be provisioned before activation')
    def command(args, cwd=None):
        result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=300)
        if result.returncode:
            raise ValueError('A fixed fleet dependency or plugin recipe failed')
        return result.stdout
    node = shutil.which('node', path=env['PATH'])
    npm = shutil.which('npm', path=env['PATH'])
    if npm:
        npm_command = [npm]
    else:
        npm_root = root / 'npm-12.2.0'
        npm_cli = npm_root / 'package/bin/npm-cli.js'
        if not npm_cli.is_file():
            npm_root.mkdir(mode=0o700, parents=True, exist_ok=True)
            with tarfile.open(dependencies / 'npm-12.2.0.tgz') as archive:
                archive.extractall(npm_root, filter='data')
        npm_command = [node, str(npm_cli)]
    runtime = root / 'node-mcp'
    runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ('package.json', 'package-lock.json'):
        _atomic_write(runtime / name, (dependencies / 'node-mcp' / name).read_bytes())
    command(npm_command + ['ci', '--omit=dev'], runtime)
    for name, executable, entry in (
        ('fs-mcp', str(runtime / 'node_modules/@oven/bun-linux-x64/bin/bun'), 'node_modules/@jungho-dev/fs-mcp/out/index.mjs'),
        ('mcp-sequentialthinking-tools', node, 'node_modules/mcp-sequentialthinking-tools/dist/index.js'),
    ):
        if name == 'fs-mcp' and not Path(executable).is_file():
            candidate = home / '.bun/bin/bun'
            if not candidate.is_file() or command([str(candidate), '--version']).strip() != '1.4.2':
                raise ValueError('Pinned Bun runtime is unavailable')
            executable = str(candidate)
        # Paths derive exclusively from real home and fixed release layout.
        _atomic_write(home / '.local/bin' / name, ('#!/bin/sh\nexec ' + _shell_quote(executable) + ' ' + _shell_quote(str(runtime / entry)) + ' "$@"\n').encode(), 0o700)
    command(['uv', 'tool', 'install', '--force', '--python', '/usr/bin/python3', str(dependencies / 'ubuntu-mcp')])
    if request.get('daisyui') is True:
        command(['uv', 'tool', 'install', '--force', '--python', '/usr/bin/python3', str(dependencies / 'daisyui_mcp-0.2.1-py3-none-any.whl')])
    marketplaces = json.loads(command([cli, 'plugin', 'marketplace', 'list', '--json']))
    rows = marketplaces.get('marketplaces', []) if isinstance(marketplaces, dict) else marketplaces
    existing = next((row for row in rows if row.get('name') == 'fleet-release'), None)
    if existing:
        command([cli, 'plugin', 'marketplace', 'remove', 'fleet-release'])
    command([cli, 'plugin', 'marketplace', 'add', str(packages), '--json'])
    installed = json.loads(command([cli, 'plugin', 'list', '--json'])).get('installed', [])
    for name in plugins:
        if name == 'linkedin-chatgpt-adjunct':
            command(npm_command + ['ci', '--omit=dev'], packages / name)
        if name == 'long-running-tasks-plugin':
            command(['uv', 'sync', '--locked', '--no-dev', '--python', '/usr/bin/python3'], packages / name)
        if any(row.get('name') == name and row.get('marketplaceName') == 'fleet-release' for row in installed):
            command([cli, 'plugin', 'remove', name + '@fleet-release'])
        command([cli, 'plugin', 'add', name + '@fleet-release', '--json'])
    if 'astra-watch' in plugins:
        launcher = home / '.codex/plugins/cache/fleet-release/astra-watch/0.1.0/scripts/astra-watch'
        _atomic_write(home / '.local/bin/astra-watch-mcp', ('#!/bin/sh\nexec ' + _shell_quote(str(launcher)) + ' "$@"\n').encode(), 0o700)
    return {'status': 'applied', 'plugins': len(plugins), 'artifacts': 2}


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"

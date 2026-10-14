#!/usr/bin/env python3
"""Bounded file-backed artifact staging; never transport native binaries as JSON.

Archives are immutable SHA-256 addressed files. Extraction validates every member
before touching the destination, rejects links/devices/traversal, and preserves
only the owner's executable bit. Callers transfer archives with strict SSH/SFTP.
"""
from __future__ import annotations
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile

MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1024 * 1024 * 1024
MAX_MEMBERS = 50000
EXCLUDED = {'.git', '.venv', 'node_modules', 'target', '__pycache__', '.DS_Store', '.env.example', '.env.sample'}


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def pack(source: Path, staging: Path) -> tuple[Path, str]:
    staging.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=staging, suffix='.tar.gz')
    os.close(fd)
    temporary = Path(name)
    try:
        count = total = 0
        with temporary.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w') as archive:
            for path in sorted(source.rglob('*')):
                relative = path.relative_to(source)
                if any(part in EXCLUDED for part in relative.parts):
                    continue
                if path.name.startswith('.env') or any(word in path.name.lower() for word in ('credentials', 'id_rsa', 'id_ed25519', 'auth.json')):
                    raise ValueError('Artifact contains host-owned credential material')
                if path.is_symlink() and (not path.resolve().is_relative_to(source.resolve()) or not path.is_file()):
                    raise ValueError('Artifact link escapes its source or targets a directory')
                if not path.is_file():
                    continue
                count += 1
                total += path.stat().st_size
                if count > MAX_MEMBERS or total > MAX_EXPANDED:
                    raise ValueError('Artifact exceeds expanded bounds')
                info = archive.gettarinfo(str(path.resolve()), relative.as_posix())
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                info.mode = 0o700 if info.mode & 0o111 else 0o600
                with path.open('rb') as stream:
                    archive.addfile(info, stream)
        if temporary.stat().st_size > MAX_ARCHIVE:
            raise ValueError('Artifact exceeds archive bound')
        digest = checksum(temporary)
        target = staging / (digest + '.tar.gz')
        os.replace(temporary, target)
        return target, digest
    finally:
        temporary.unlink(missing_ok=True)


def unpack(archive_path: Path, digest: str, destination: Path) -> bool:
    if archive_path.stat().st_size > MAX_ARCHIVE or checksum(archive_path) != digest:
        raise ValueError('Artifact checksum or size mismatch')
    if destination.is_symlink():
        raise ValueError('Artifact destination is a link')
    # Recheck the checksum even on repeat runs; a damaged transfer is never adopted.
    marker = destination / '.fleet-artifact-sha256'
    if destination.exists():
        if marker.is_file() and marker.read_text() == digest:
            inventory = destination / '.fleet-artifact-files.json'
            if not inventory.is_file(): raise ValueError('Artifact recovery inventory is missing')
            files = json.loads(inventory.read_text())
            for name, metadata in files.items():
                file = destination / name
                if file.is_symlink() or not file.is_file() or checksum(file) != metadata[0] or bool(file.stat().st_mode & 0o111) != metadata[1]:
                    raise ValueError('Staged artifact content changed')
            return False
        raise ValueError('Destination exists with different provenance')
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.fleet-artifact-', dir=destination.parent))
    try:
        with tarfile.open(archive_path, 'r:gz') as archive:
            members = archive.getmembers()
            total = 0
            seen = set()
            if len(members) > MAX_MEMBERS:
                raise ValueError('Artifact exceeds member bound')
            for member in members:
                relative = PurePosixPath(member.name)
                if (relative.is_absolute() or '..' in relative.parts or not relative.parts
                        or '\\' in member.name or member.name in seen
                        or any(ord(c) < 32 for c in member.name)
                        or not member.isfile()):
                    raise ValueError('Unsafe artifact member')
                seen.add(member.name)
                total += member.size
                if total > MAX_EXPANDED:
                    raise ValueError('Artifact exceeds expanded bound')
            files = {}
            for member in members:
                path = temporary.joinpath(*PurePosixPath(member.name).parts)
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as source, path.open('wb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                path.chmod(0o700 if member.mode & 0o111 else 0o600)
                files[member.name] = [checksum(path), bool(member.mode & 0o111)]
        inventory = temporary / '.fleet-artifact-files.json'
        inventory.write_text(json.dumps(files,sort_keys=True))
        inventory.chmod(0o600)
        (temporary / '.fleet-artifact-sha256').write_text(digest)
        (temporary / '.fleet-artifact-sha256').chmod(0o600)
        os.replace(temporary, destination)
        return True
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)

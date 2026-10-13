"""Collect bounded, content-free host capacity metrics with standard libraries."""

import os
import pathlib
import platform
import re
import shutil
import subprocess
import time


def parse_linux_cpu_stat(text):
    """Return total and idle jiffies from the aggregate /proc/stat CPU row."""
    fields = text.splitlines()[0].split() if text.splitlines() else []
    if not fields or fields[0] != "cpu" or len(fields) < 5:
        return None
    try:
        values = [int(value) for value in fields[1:9]]
    except ValueError:
        return None
    if len(values) < 4 or any(value < 0 for value in values):
        return None
    total = sum(values)
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return (total, idle) if total > 0 else None


def cpu_percent_between(before, after):
    """Calculate non-idle CPU percentage between two aggregate samples."""
    if not before or not after:
        return None
    total_delta = after[0] - before[0]
    idle_delta = after[1] - before[1]
    if total_delta <= 0 or idle_delta < 0 or idle_delta > total_delta:
        return None
    return round(max(0.0, min(100.0, (total_delta - idle_delta) * 100 / total_delta)), 1)


def parse_linux_meminfo(text):
    """Return physical memory total and available bytes from /proc/meminfo."""
    values = {}
    for line in text.splitlines():
        match = re.match(r"^(MemTotal|MemAvailable):\s*(\d+)\s*kB\s*$", line)
        if match:
            values[match.group(1)] = int(match.group(2)) * 1024
    total = values.get("MemTotal")
    available = values.get("MemAvailable")
    if not total or available is None or available > total:
        return None
    return total, available


def parse_macos_cpu_usage(text):
    """Return busy CPU percentage from one macOS top sample."""
    match = re.search(r"CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys", text)
    if not match:
        return None
    try:
        user, system = (float(value) for value in match.groups())
    except ValueError:
        return None
    if not all(0 <= value <= 100 for value in (user, system)) or user + system > 100.5:
        return None
    return round(min(100.0, user + system), 1)


def parse_macos_vm_stat(text, total_bytes):
    """Return memory total and available bytes from macOS vm_stat output."""
    page_size_match = re.search(r"page size of (\d+) bytes", text)
    if not page_size_match or not isinstance(total_bytes, int) or total_bytes <= 0:
        return None
    page_size = int(page_size_match.group(1))
    page_counts = {}
    for name in ("free", "inactive", "speculative"):
        match = re.search(rf"^Pages {name}:\s*([\d,]+)\.?\s*$", text, re.MULTILINE)
        if not match:
            return None
        page_counts[name] = int(match.group(1).replace(",", ""))
    available = sum(page_counts.values()) * page_size
    if page_size <= 0 or available > total_bytes:
        return None
    return total_bytes, available


def _command_output(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=4, check=False)
        return result.stdout if result.returncode == 0 else ""
    except Exception:
        return ""


def _linux_cpu_percent():
    try:
        before = parse_linux_cpu_stat(pathlib.Path("/proc/stat").read_text())
        if not before:
            return None
        time.sleep(0.2)
        after = parse_linux_cpu_stat(pathlib.Path("/proc/stat").read_text())
        return cpu_percent_between(before, after)
    except Exception:
        return None


def _memory(system):
    try:
        if system == "Linux":
            return parse_linux_meminfo(pathlib.Path("/proc/meminfo").read_text())
        if system == "Darwin":
            total_text = _command_output(["sysctl", "-n", "hw.memsize"]).strip()
            total_bytes = int(total_text)
            return parse_macos_vm_stat(_command_output(["vm_stat"]), total_bytes)
    except Exception:
        return None
    return None


def _cpu(system):
    if system == "Linux":
        return _linux_cpu_percent()
    if system == "Darwin":
        return parse_macos_cpu_usage(_command_output(["top", "-l", "1", "-n", "0"]))
    return None


def _rounded_percent(used, total):
    if not isinstance(total, (int, float)) or total <= 0:
        return None
    return round(max(0.0, min(100.0, used * 100 / total)), 1)


def collect_resource_metrics(home=None, system=None):
    """Collect CPU, memory, load, and home-volume capacity without user content."""
    system = system or platform.system()
    cpu_count = os.cpu_count()
    try:
        load1 = round(os.getloadavg()[0], 2)
    except (AttributeError, OSError):
        load1 = None

    memory = _memory(system)
    memory_total, memory_available = memory if memory else (None, None)
    try:
        disk = shutil.disk_usage(str(home or pathlib.Path.home()))
        disk_total, disk_free = disk.total, disk.free
    except (OSError, ValueError):
        disk_total, disk_free = None, None

    memory_used_percent = None
    if isinstance(memory_total, int) and isinstance(memory_available, int):
        memory_used_percent = _rounded_percent(memory_total - memory_available, memory_total)
    return {
        "cpuPercent": _cpu(system),
        "cpuCount": cpu_count,
        "load1": load1,
        "memoryPercent": memory_used_percent,
        "memoryTotalMb": round(memory_total / (1024 * 1024), 1) if isinstance(memory_total, int) and memory_total > 0 else None,
        "memoryAvailableMb": round(memory_available / (1024 * 1024), 1) if memory_available is not None else None,
        "diskPercent": _rounded_percent(disk_total - disk_free, disk_total) if disk_total else None,
        "diskTotalGb": round(disk_total / (1024 ** 3), 1) if disk_total else None,
        "diskFreeGb": round(disk_free / (1024 ** 3), 1) if disk_free is not None else None,
    }

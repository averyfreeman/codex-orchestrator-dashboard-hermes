import unittest
from types import SimpleNamespace
from unittest.mock import patch

from scripts.resource_metrics import (
    cpu_percent_between,
    collect_resource_metrics,
    parse_linux_cpu_stat,
    parse_linux_meminfo,
    parse_macos_cpu_usage,
    parse_macos_vm_stat,
)


class ResourceMetricParsingTests(unittest.TestCase):
    def test_collection_returns_aggregate_cpu_memory_and_home_disk_values(self):
        with patch("scripts.resource_metrics._cpu", return_value=49.9), patch(
            "scripts.resource_metrics._memory", return_value=(4 * 1024**2, 1 * 1024**2)
        ), patch("scripts.resource_metrics.os.cpu_count", return_value=4), patch(
            "scripts.resource_metrics.os.getloadavg", return_value=(2.5, 3.0, 4.0)
        ), patch(
            "scripts.resource_metrics.shutil.disk_usage",
            return_value=SimpleNamespace(total=100 * 1024**3, free=25 * 1024**3),
        ):
            metrics = collect_resource_metrics("/fixture/home", system="Linux")

        self.assertEqual(
            metrics,
            {
                "cpuPercent": 49.9,
                "cpuCount": 4,
                "load1": 2.5,
                "memoryPercent": 75.0,
                "memoryTotalMb": 4.0,
                "memoryAvailableMb": 1.0,
                "diskPercent": 75.0,
                "diskTotalGb": 100.0,
                "diskFreeGb": 25.0,
            },
        )

    def test_linux_cpu_percentage_uses_busy_and_idle_counter_deltas(self):
        before = parse_linux_cpu_stat("cpu 100 0 30 870 0 0 0 0 0 0")
        after = parse_linux_cpu_stat("cpu 200 0 80 920 0 0 0 0 0 0")

        self.assertEqual(cpu_percent_between(before, after), 75.0)

    def test_linux_memory_uses_available_memory_not_only_free_pages(self):
        total_bytes, available_bytes = parse_linux_meminfo(
            "MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 250 kB\n"
        )

        self.assertEqual(total_bytes, 1_024_000)
        self.assertEqual(available_bytes, 256_000)

    def test_macos_cpu_usage_adds_user_and_system_percentages(self):
        self.assertEqual(
            parse_macos_cpu_usage("CPU usage: 10.00% user, 5.00% sys, 85.00% idle"),
            15.0,
        )

    def test_macos_memory_uses_page_size_and_available_page_counters(self):
        total_bytes, available_bytes = parse_macos_vm_stat(
            "Mach Virtual Memory Statistics: (page size of 4096 bytes)\n"
            "Pages free: 100.\nPages inactive: 200.\nPages speculative: 10.\n",
            4_096_000,
        )

        self.assertEqual(total_bytes, 4_096_000)
        self.assertEqual(available_bytes, 310 * 4096)

    def test_invalid_samples_return_none_instead_of_false_zero_pressure(self):
        self.assertIsNone(parse_linux_cpu_stat("not cpu stats"))
        self.assertIsNone(cpu_percent_between((100, 50), (100, 50)))
        self.assertIsNone(parse_linux_meminfo("MemFree: 10 kB\n"))
        self.assertIsNone(parse_macos_cpu_usage("CPU usage unavailable"))
        self.assertIsNone(parse_macos_vm_stat("invalid", 1000))


if __name__ == "__main__":
    unittest.main()

import { connection, NextResponse } from "next/server";
import { collectOverview } from "@/lib/collector";
import { appendSnapshot } from "@/lib/logging";
import { readResourceThresholds } from "@/lib/resource-metrics";

/** Collect the private fleet, append a content-free snapshot, and return current reports. */
export async function GET() {
  await connection();
  const hosts = await collectOverview();
  await appendSnapshot(hosts);
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    hosts,
    resourceThresholds: readResourceThresholds(process.env),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

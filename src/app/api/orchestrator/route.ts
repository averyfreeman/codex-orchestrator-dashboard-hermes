import { NextResponse } from "next/server";
import { hermesApiClientFromEnvironment } from "@/lib/hermes-api";

/** Return a bounded health indicator; never expose the API Server credential. */
export async function GET() {
  try {
    const client = hermesApiClientFromEnvironment();
    const [health, planningToolsDisabled] = await Promise.all([client.health(), client.planningToolsDisabled()]);
    const available = health.available && planningToolsDisabled;
    return NextResponse.json({
      status: available ? "available" : "unavailable",
      configured: true,
      planningToolsDisabled,
      error: !planningToolsDisabled
        ? "The Hermes planner needs a dedicated profile with all tools disabled."
        : !health.available ? "Hermes API Server is unavailable." : undefined,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    const configured = Boolean(process.env.API_SERVER_KEY);
    return NextResponse.json({
      status: "unavailable",
      configured,
      planningToolsDisabled: false,
      error: !configured ? "Hermes API Server is not configured." : "Hermes API Server is unavailable, not bound to loopback, or not safely configured.",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

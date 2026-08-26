"use client";

import { Workspace } from "@/ui/Workspace";
import { WebMcpBridge } from "@/webmcp/adapter";

export default function Home() {
  return <><WebMcpBridge /><Workspace /></>;
}

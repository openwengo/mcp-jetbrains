#!/usr/bin/env node
import { log } from "./shared.js";
import { startHttpServer } from "./http-server.js";

// Check transport mode from environment variable
const TRANSPORT_MODE = process.env.TRANSPORT_MODE || "stdio";

async function main() {
    log(`Starting JetBrains MCP Proxy in ${TRANSPORT_MODE} mode...`);
    
    if (TRANSPORT_MODE === "http") {
        // Start HTTP server with Streamable HTTP transport
        await startHttpServer();
    } else {
        // Default to stdio mode (existing functionality)
        const { runStdioServer } = await import("./stdio-server.js");
        await runStdioServer();
    }
}

main().catch(error => {
    log("Failed to start server:", error);
    process.exit(1);
});
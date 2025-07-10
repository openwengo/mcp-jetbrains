#!/usr/bin/env node
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import { log, findWorkingIDEEndpoint, handleToolCall } from "./shared.js";

/**
 * Globally store the cached IDE endpoint.
 * We'll update this once at the beginning and every 10 seconds.
 */
let cachedEndpoint: string | null = null;

/**
 * If you need to remember the last known response from /mcp/list_tools, store it here.
 * That way, you won't re-check it every single time a new request comes in.
 */
let previousResponse: string | null = null;

/**
 * Helper to send the "tools changed" notification.
 */
function sendToolsChanged() {
    try {
        log("Sending tools changed notification.");
        server.notification({method: "notifications/tools/list_changed"});
    } catch (error) {
        log("Error sending tools changed notification:", error);
    }
}

/**
 * Test if /mcp/list_tools is responding on a given endpoint
 *
 * @returns true if working, false otherwise
 */
async function testListTools(endpoint: string): Promise<boolean> {
    log(`Sending test request to ${endpoint}/mcp/list_tools`);
    try {
        const res = await fetch(`${endpoint}/mcp/list_tools`);
        if (!res.ok) {
            log(`Test request to ${endpoint}/mcp/list_tools failed with status ${res.status}`);
            return false;
        }

        const currentResponse = await res.text();
        log(`Received response from ${endpoint}/mcp/list_tools: ${currentResponse.substring(0, 100)}...`);

        // If the response changed from last time, notify
        if (previousResponse !== null && previousResponse !== currentResponse) {
            log("Response has changed since the last check.");
            sendToolsChanged();
        }
        previousResponse = currentResponse;

        return true;
    } catch (error) {
        log(`Error during testListTools for endpoint ${endpoint}:`, error);
        return false;
    }
}

/**
 * Updates the cached endpoint by finding a working IDE endpoint.
 * This runs once at startup and then once every 10 seconds in runServer().
 */
async function updateIDEEndpoint() {
    try {
        cachedEndpoint = await findWorkingIDEEndpoint();
        log(`Updated cachedEndpoint to: ${cachedEndpoint}`);
    } catch (error) {
        // If we fail to find a working endpoint, keep the old one if it existed.
        // It's up to you how to handle this scenario (e.g., set cachedEndpoint = null).
        log("Failed to update IDE endpoint:", error);
    }
}

/**
 * Main MCP server
 */
const server = new Server(
    {
        name: "jetbrains/proxy",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {
                listChanged: true,
            },
            resources: {},
        },
        instructions: "You can interact with an JetBrains IntelliJ IDE and its features through this MCP (Model Context Protocol) server. The server provides access to various IDE tools and functionalities. " +
            "All requests should be formatted as JSON objects according to the Model Context Protocol specification."
    },

);

/**
 * Handles listing tools by using the *cached* endpoint (no new search each time).
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("Handling ListToolsRequestSchema request.");
    if (!cachedEndpoint) {
        // If no cached endpoint, we can't proceed
        throw new Error("No working IDE endpoint available.");
    }
    try {
        log(`Using cached endpoint ${cachedEndpoint} to list tools.`);
        const toolsResponse = await fetch(`${cachedEndpoint}/mcp/list_tools`);
        if (!toolsResponse.ok) {
            log(`Failed to fetch tools with status ${toolsResponse.status}`);
            throw new Error("Unable to list tools");
        }
        const tools = await toolsResponse.json();
        log(`Successfully fetched tools: ${JSON.stringify(tools)}`);
        return {tools};
    } catch (error) {
        log("Error handling ListToolsRequestSchema request:", error);
        throw error;
    }
});

/**
 * Request handler for "CallToolRequestSchema"
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    log("Handling CallToolRequestSchema request:", request);
    try {
        const result = await handleToolCall(request.params.name, request.params.arguments ?? {}, cachedEndpoint);
        log("Tool call handled successfully:", result);
        return result;
    } catch (error) {
        log("Error handling CallToolRequestSchema request:", error);
        throw error;
    }
});

/**
 * Starts the server, connects via stdio, and schedules endpoint checks.
 */
export async function runStdioServer() {
    log("Initializing stdio server...");

    // 1) Do an initial endpoint check (once at startup)
    await updateIDEEndpoint();

    const transport = new StdioServerTransport();
    try {
        await server.connect(transport);
        log("Server connected to transport.");
    } catch (error) {
        log("Error connecting server to transport:", error);
        throw error;
    }

    // 2) Then check again every 10 seconds (in case IDE restarts or ports change)
    setInterval(updateIDEEndpoint, 10_000);
    log("Scheduled endpoint check every 10 seconds.");

    log("JetBrains Proxy MCP Server running on stdio");
}
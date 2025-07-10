#!/usr/bin/env node
import express, { Request, Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { log, findWorkingIDEEndpoint, handleToolCall } from "./shared.js";

const HTTP_PORT = parseInt(process.env.HTTP_PORT || "3000");
const HTTP_HOST = process.env.HTTP_HOST || "0.0.0.0";

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

/**
 * Check if a request is an initialize request
 */
function isInitializeRequest(body: any): boolean {
    return body && body.method === "initialize";
}

/**
 * Convert JSON Schema to Zod shape for MCP tool registration
 */
function jsonSchemaToZodShape(jsonSchema: any): Record<string, z.ZodTypeAny> {
    if (!jsonSchema || jsonSchema.type !== "object") {
        return {};
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    for (const [key, prop] of Object.entries(properties)) {
        const propSchema = prop as any;
        let zodType: z.ZodTypeAny;

        switch (propSchema.type) {
            case "string":
                zodType = z.string();
                break;
            case "number":
                zodType = z.number();
                break;
            case "boolean":
                zodType = z.boolean();
                break;
            case "array":
                zodType = z.array(z.any());
                break;
            default:
                zodType = z.any();
        }

        // Make optional if not in required array
        if (!required.includes(key)) {
            zodType = zodType.optional();
        }

        shape[key] = zodType;
    }

    return shape;
}

/**
 * Create and configure MCP server instance with dynamic tool proxying
 */
async function createMcpServer(cachedEndpoint: () => string | null): Promise<McpServer> {
    const server = new McpServer({
        name: "jetbrains/proxy",
        version: "0.1.0",
    });

    // We'll dynamically proxy tools from the IDE
    // First, we need to get the list of available tools from the IDE
    const endpoint = cachedEndpoint();
    if (endpoint) {
        try {
            const toolsResponse = await fetch(`${endpoint}/mcp/list_tools`);
            if (toolsResponse.ok) {
                const toolsData = await toolsResponse.json();
                const tools = toolsData || [];
                log(`Registered ${tools.length} IDE tools`);
                
                // Register each tool as a proxy
                for (const tool of tools) {
                    // Convert JSON Schema to Zod shape
                    const zodShape = jsonSchemaToZodShape(tool.inputSchema);
                    
                    server.registerTool(
                        tool.name,
                        {
                            title: tool.title || tool.name,
                            description: tool.description || `Proxy tool for ${tool.name}`,
                            inputSchema: zodShape
                        },
                        async (args: any) => {
                            log(`Executing tool: ${tool.name} with args:`, args);
                            const result = await handleToolCall(tool.name, args, cachedEndpoint());
                            return result;
                        }
                    );
                }
            }
        } catch (error) {
            log("Error fetching tools from IDE:", error);
        }
    }

    return server;
}

/**
 * Start HTTP server with Streamable HTTP transport
 */
export async function startHttpServer() {
    log("Starting HTTP MCP server...");

    // Initialize IDE endpoint discovery
    let cachedEndpoint: string | null = null;
    
    const updateIDEEndpoint = async () => {
        try {
            cachedEndpoint = await findWorkingIDEEndpoint();
            log(`Updated cachedEndpoint to: ${cachedEndpoint}`);
        } catch (error) {
            log("Failed to update IDE endpoint:", error);
        }
    };

    // Initial endpoint discovery
    await updateIDEEndpoint();
    
    // Schedule periodic endpoint checks
    setInterval(updateIDEEndpoint, 10_000);

    const app = express();
    
    // Middleware
    app.use(express.json());
    
    // Minimal logging middleware
    app.use((req: Request, res: Response, next) => {
        if (req.body && req.body.method) {
            log(`[${req.method}] ${req.path} - ${req.body.method}`);
        } else {
            log(`[${req.method}] ${req.path}`);
        }
        next();
    });
    
    app.use(cors({
        origin: '*', // Configure appropriately for production
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id']
    }));

    // Health check endpoint
    app.get('/health', (req: Request, res: Response) => {
        res.json({
            status: 'ok',
            transport: 'http-streamable',
            ideEndpoint: cachedEndpoint,
            sessions: Object.keys(transports).length
        });
    });

    // Handle POST requests for client-to-server communication
    app.post('/mcp', async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        try {
            if (sessionId && transports[sessionId]) {
                // Reuse existing transport
                transport = transports[sessionId];
                log(`Reusing existing session: ${sessionId}`);
            } else if (!sessionId && isInitializeRequest(req.body)) {
                // New initialization request
                log("Creating new session for initialization request");
                
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (newSessionId: string) => {
                        log(`Session initialized: ${newSessionId}`);
                        transports[newSessionId] = transport;
                    },
                    enableDnsRebindingProtection: false, // Disabled for backwards compatibility
                });

                // Clean up transport when closed
                transport.onclose = () => {
                    if (transport.sessionId) {
                        log(`Cleaning up session: ${transport.sessionId}`);
                        delete transports[transport.sessionId];
                    }
                };

                // Create and setup MCP server
                const mcpServer = await createMcpServer(() => cachedEndpoint);

                // Connect to the MCP server
                await mcpServer.connect(transport);
            } else {
                // Invalid request
                log("Invalid request: No valid session ID provided");
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Bad Request: No valid session ID provided',
                    },
                    id: null,
                });
                return;
            }

            // Handle the request
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            log("Error handling MCP POST request:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
            log(`Invalid or missing session ID: ${sessionId}`);
            res.status(400).send('Invalid or missing session ID');
            return;
        }
        
        const transport = transports[sessionId];
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            log("Error handling session request:", error);
            if (!res.headersSent) {
                res.status(500).send('Internal server error');
            }
        }
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get('/mcp', handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete('/mcp', handleSessionRequest);

    // Start the server
    const server = app.listen(HTTP_PORT, HTTP_HOST, () => {
        log(`JetBrains MCP Proxy HTTP Server listening on http://${HTTP_HOST}:${HTTP_PORT}`);
        log(`Health check available at: http://${HTTP_HOST}:${HTTP_PORT}/health`);
        log(`MCP endpoint: http://${HTTP_HOST}:${HTTP_PORT}/mcp`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        log('Received SIGTERM, shutting down gracefully...');
        server.close(() => {
            log('HTTP server closed');
            process.exit(0);
        });
    });

    process.on('SIGINT', () => {
        log('Received SIGINT, shutting down gracefully...');
        server.close(() => {
            log('HTTP server closed');
            process.exit(0);
        });
    });

    return server;
}
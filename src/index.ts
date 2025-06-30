import {ServerType, startStdioServer} from "mcp-proxy";
import * as process from "node:process";

if(process.env.IDE_PORT == null) {
    console.error(`Port is not configured.`);
    process.exit(1);
}
console.error(`Starting proxy for IDE: ${process.env.IDE_PORT}`);
await startStdioServer({
    serverType: ServerType.SSE,
    url: `http://127.0.0.1:${process.env.IDE_PORT}/sse`,
});
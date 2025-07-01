[![official JetBrains project](http://jb.gg/badges/incubator-flat-square.svg)](https://github.com/JetBrains#jetbrains-on-github)
# JetBrains MCP Proxy Server

A Model Context Protocol (MCP) server that acts as a proxy between MCP clients and JetBrains IDEs, enabling seamless integration for code assistance and IDE automation through the MCP ecosystem.

See: https://www.anthropic.com/engineering/desktop-extensions

You will need an IntelliJ-based IDE with built-in MCP Server (2025.3+).

Provide port specified in: _Settings | Tools | MCP Server_

## Troubleshooting
* Check Claude Desktop has version 0.11.6+
* After changing port in settings you have to restart Claude 
* Built-in Node might not work, switch to local in _Claude Client | Preferences | Extensions | Use Built-in Node.js for MCP_

## Developer guide
To publish new release:
```
git tag dxt-v1.0.2
git push origin dxt-v1.0.2
```
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config';
import { createMontagioServer } from './index';

// stdout carries the protocol: anything for people goes to stderr, and only paths and URLs.
const config = readConfig();
const server = createMontagioServer(config);
await server.connect(new StdioServerTransport());
console.error(`[montagio-mcp] ready on stdio, app at ${config.baseUrl}${config.outDir ? `, files saved to ${config.outDir}` : ''}`);

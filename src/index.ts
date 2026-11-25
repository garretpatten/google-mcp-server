#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadCredentials, loadEnv } from './config.js';
import { FetchHttpClient } from './http.js';
import { GoogleAuthClient } from './google-auth.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { GoogleTasksClient } from './google-tasks.js';
import { buildTools, ToolArgumentError } from './tools.js';
import { describeApiError } from './google-api.js';

const SERVER_NAME = 'google-mcp-server';
const SERVER_VERSION = '0.1.2';

export function buildServer(): Server {
  loadEnv();
  const credentials = loadCredentials();

  const http = new FetchHttpClient();
  const auth = new GoogleAuthClient(http, credentials);
  const calendar = new GoogleCalendarClient(http, auth);
  const tasks = new GoogleTasksClient(http, auth);
  const tools = buildTools(calendar, tasks);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    try {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const text = await tool.handler(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message =
        error instanceof ToolArgumentError
          ? error.message
          : error instanceof Error
            ? error.message
            : describeUnknownError(error);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  return server;
}

function describeUnknownError(error: unknown): string {
  if (error && typeof error === 'object' && 'statusCode' in error && 'body' in error) {
    const { statusCode, body } = error as { statusCode: unknown; body: unknown };
    return describeApiError(Number(statusCode), String(body));
  }
  return String(error);
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

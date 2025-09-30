import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import Client from "@blink.so/api";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: "anthropic/claude-sonnet-4",
    system: `You are an orchestration agent that can discover and delegate to other specialized agents.

You have tools to:
- List all available agents in your organization
- Get detailed capabilities of any agent
- Delegate queries to the appropriate specialized agents

When asked a question, first discover what agents are available, then route the query appropriately.`,
    messages: convertToModelMessages(messages),
    tools: {
      list_agents: tool({
        description:
          "List all available agents in the organization. Use this to discover what specialized agents exist and what they can do.",
        inputSchema: z.object({
          organization_id: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Optional organization ID to filter agents. If not provided, lists agents from all organizations you have access to.",
            ),
        }),
        execute: async ({ organization_id }) => {
          const apiToken = process.env.BLINK_API_TOKEN;
          if (!apiToken) {
            throw new Error(
              "BLINK_API_TOKEN environment variable not set. Please configure your Blink API token.",
            );
          }

          const client = new Client({ authToken: apiToken });

          // If no org specified, get all orgs and list agents from each
          if (!organization_id) {
            const orgs = await client.organizations.list();
            const allAgents = await Promise.all(
              orgs.map(async (org) => {
                const response = await client.agents.list({
                  organization_id: org.id,
                  per_page: 100,
                });
                return response.items;
              }),
            );
            return allAgents.flat();
          }

          // Otherwise list agents from specific org
          const response = await client.agents.list({
            organization_id,
            per_page: 100,
          });
          return response.items;
        },
      }),

      get_agent_capabilities: tool({
        description:
          "Get detailed information about a specific agent including its name, description, and request URL.",
        inputSchema: z.object({
          agent_id: z
            .string()
            .uuid()
            .describe("The UUID of the agent to get information for."),
        }),
        execute: async ({ agent_id }) => {
          const apiToken = process.env.BLINK_API_TOKEN;
          if (!apiToken) {
            throw new Error(
              "BLINK_API_TOKEN environment variable not set. Please configure your Blink API token.",
            );
          }

          const client = new Client({ authToken: apiToken });

          // Get the agent details
          const agent = await client.agents.get(agent_id);

          return {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            visibility: agent.visibility,
            request_url: agent.request_url,
            active_deployment_id: agent.active_deployment_id,
            organization_id: agent.organization_id,
          };
        },
      }),

      get_ip_info: tool({
        description: "Get IP address information of the computer.",
        inputSchema: z.object({}),
        execute: async () => {
          const response = await fetch("https://ipinfo.io/json");
          return response.json();
        },
      }),
    },
  });
});

agent.serve();

import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";

const agent = blink.agent();

agent.on("chat", async ({ messages }) => {
  return streamText({
    model: "anthropic/claude-sonnet-4.5",
    system: `You are an orchestration agent that can discover and delegate to other specialized agents.

You have tools to:
- List all available agents in your organization
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
              "Optional organization ID to filter agents. If not provided, uses BLINK_ORG_ID environment variable or lists agents from all organizations.",
            ),
        }),
        execute: async ({ organization_id }) => {
          const apiToken = process.env.BLINK_API_TOKEN;
          if (!apiToken) {
            throw new Error(
              "BLINK_API_TOKEN environment variable not set. Please configure your Blink API token.",
            );
          }

          const baseURL = "https://blink.so";

          // Use provided org_id, fall back to env var, or list all
          const orgId = organization_id || process.env.BLINK_ORG_ID;

          // If no org specified, get all orgs and list agents from each
          if (!orgId) {
            const orgsResponse = await fetch(`${baseURL}/api/organizations`, {
              headers: {
                Authorization: `Bearer ${apiToken}`,
              },
            });

            if (!orgsResponse.ok) {
              throw new Error(
                `Failed to list organizations: ${orgsResponse.statusText}`,
              );
            }

            const orgs = (await orgsResponse.json()) as Array<{ id: string }>;
            const allAgents = await Promise.all(
              orgs.map(async (org) => {
                const agentsResponse = await fetch(
                  `${baseURL}/api/agents?organization_id=${org.id}&per_page=100`,
                  {
                    headers: {
                      Authorization: `Bearer ${apiToken}`,
                    },
                  },
                );

                if (!agentsResponse.ok) {
                  return [];
                }

                const data = (await agentsResponse.json()) as { items: any[] };
                return data.items;
              }),
            );
            return allAgents.flat();
          }

          // Otherwise list agents from specific org
          const response = await fetch(
            `${baseURL}/api/agents?organization_id=${orgId}&per_page=100`,
            {
              headers: {
                Authorization: `Bearer ${apiToken}`,
              },
            },
          );

          if (!response.ok) {
            throw new Error(`Failed to list agents: ${response.statusText}`);
          }

          const data = (await response.json()) as { items: any[] };
          return data.items;
        },
      }),
    },
  });
});

agent.serve();

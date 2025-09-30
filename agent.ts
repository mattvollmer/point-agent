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
- Delegate queries to specialized agents

When asked a question:
1. First use list_agents to discover what specialized agents are available
2. Analyze which agent(s) are best suited for the query based on their names and descriptions
3. Use delegate_to_agent to send the query to the appropriate specialist
4. Present the response to the user

You can delegate to multiple agents if needed and synthesize their responses.`,
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

      delegate_to_agent: tool({
        description:
          "Delegate a query to a specialized agent. Use this after discovering which agent is best suited for the user's question. The agent will process the query and return a response.",
        inputSchema: z.object({
          agent_id: z
            .string()
            .uuid()
            .describe(
              "The UUID of the agent to delegate to. Get this from list_agents.",
            ),
          organization_id: z
            .string()
            .uuid()
            .describe(
              "The organization ID of the agent. Get this from list_agents.",
            ),
          query: z
            .string()
            .describe("The question or task to send to the specialized agent."),
        }),
        execute: async ({ agent_id, organization_id, query }) => {
          const apiToken = process.env.BLINK_API_TOKEN;
          if (!apiToken) {
            throw new Error(
              "BLINK_API_TOKEN environment variable not set. Cannot authenticate with agent.",
            );
          }

          const baseURL = "https://blink.so";

          // Create a chat with the agent and send the message
          const response = await fetch(`${baseURL}/api/chats`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiToken}`,
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              organization_id,
              agent_id,
              stream: true,
              messages: [
                {
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: query,
                    },
                  ],
                },
              ],
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Failed to communicate with agent: ${response.status} ${response.statusText} - ${errorText}`,
            );
          }

          // The response is a server-sent event stream
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body from agent");
          }

          const decoder = new TextDecoder();
          let fullResponse = "";

          // Set a timeout for reading the stream (30 seconds)
          const timeoutMs = 30000;
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(
              () => reject(new Error("Agent response timeout")),
              timeoutMs,
            );
          });

          try {
            await Promise.race([
              (async () => {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  const chunk = decoder.decode(value, { stream: true });
                  const lines = chunk.split("\n");

                  for (const line of lines) {
                    if (line.startsWith("data: ")) {
                      const data = line.slice(6).trim();
                      if (!data || data === "[DONE]") continue;

                      try {
                        const parsed = JSON.parse(data);

                        // Handle message chunk events from the agent
                        if (
                          parsed.event === "message.chunk.added" &&
                          parsed.data?.chunk
                        ) {
                          const chunkData = parsed.data.chunk;
                          if (
                            chunkData.type === "text-delta" &&
                            chunkData.textDelta
                          ) {
                            fullResponse += chunkData.textDelta;
                          }
                        }
                      } catch (e) {
                        // Skip invalid JSON
                      }
                    }
                  }
                }
              })(),
              timeoutPromise,
            ]);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === "Agent response timeout"
            ) {
              // Return what we have so far
              return (
                fullResponse ||
                "Agent response timed out after partial response"
              );
            }
            throw error;
          } finally {
            reader.releaseLock();
          }

          return fullResponse || "Agent returned no response";
        },
      }),
    },
  });
});

agent.serve();

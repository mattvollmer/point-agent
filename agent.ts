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
- Delegate queries to specialized agents (asynchronous)
- Check responses from delegated agents

Workflow for delegation:
1. Use list_agents to discover what specialized agents are available
2. Analyze which agent(s) are best suited for the query based on their names and descriptions
3. Use delegate_to_agent to send the query - this returns immediately with a chat_id
4. Use check_agent_response with the chat_id to get the actual response
5. If the agent is still processing, wait a moment and check again
6. Present the response to the user

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
          "Delegate a query to a specialized agent. This creates a chat with the agent and returns immediately with a chat ID. The agent will process the request asynchronously.",
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
            },
            body: JSON.stringify({
              organization_id,
              agent_id,
              stream: false,
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

          const chatData = await response.json();

          return {
            status: "delegated",
            message:
              "Successfully delegated query to agent. The agent is processing your request.",
            chat_id: (chatData as { id: string }).id,
            agent_id,
            query,
          };
        },
      }),

      check_agent_response: tool({
        description:
          "Check the response from an agent that was previously delegated to. Use this after delegate_to_agent to get the actual response.",
        inputSchema: z.object({
          chat_id: z
            .string()
            .uuid()
            .describe("The chat ID returned from delegate_to_agent."),
        }),
        execute: async ({ chat_id }) => {
          const apiToken = process.env.BLINK_API_TOKEN;
          if (!apiToken) {
            throw new Error(
              "BLINK_API_TOKEN environment variable not set. Cannot authenticate with agent.",
            );
          }

          const baseURL = "https://blink.so";

          // Get the chat messages
          const response = await fetch(
            `${baseURL}/api/messages?chat_id=${chat_id}`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${apiToken}`,
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Failed to get chat messages: ${response.status} ${response.statusText} - ${errorText}`,
            );
          }

          const messagesData = await response.json();

          // Find the assistant's response (the last assistant message)
          const messages = (messagesData as { items: any[] }).items || [];
          const assistantMessages = messages.filter(
            (m: any) => m.role === "assistant",
          );

          if (assistantMessages.length === 0) {
            return {
              status: "processing",
              message:
                "The agent is still processing your request. Please wait a moment and check again.",
            };
          }

          // Get the last assistant message and extract text
          const lastAssistantMessage =
            assistantMessages[assistantMessages.length - 1];
          let responseText = "";

          if (lastAssistantMessage.parts) {
            for (const part of lastAssistantMessage.parts) {
              if (part.type === "text" && part.text) {
                responseText += part.text;
              }
            }
          }

          return {
            status: "completed",
            response: responseText || "Agent returned no text response",
            message_count: messages.length,
          };
        },
      }),
    },
  });
});

agent.serve();

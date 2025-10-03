import { convertToModelMessages, streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import * as slackbot from "@blink-sdk/slackbot";
import withModelIntent from "@blink-sdk/model-intent";

const agent = blink.agent();

agent.on("chat", async ({ messages, context, abortSignal }) => {
  // Check if this is a Slack message
  const slackMetadata = slackbot.findLastMessageMetadata(messages);

  let systemPrompt = `You are Blink Coordinator, an orchestration agent that discovers and delegates to specialized Blink agents.

Your role is to route user queries to the most appropriate specialist agent(s) and synthesize their responses.

<specialist-agents>
You have access to the following specialist agents. Each has specific capabilities:

V2ProjectManager [27b60a8e-ece9-4ba9-866c-abbfdc232b06]
Capabilities: Deep visibility into Coder's v2 GitHub project and historical changes
Use for: Status of planned/in-progress engineering work, GitHub project tracking

HackerTracker [bdec25ce-88a3-47ab-9184-a0b7a7f736c6]
Capabilities: Summarizes latest Hacker News stories and comments
Use for: Tech news, trending HN topics, community discussions

CoderDocsResearcher [d53ab7e0-c274-42aa-97ef-95d3ac2aca2e]
Capabilities: Understands coder.com/docs with read access to Coder's repositories
Use for: Documentation questions, Coder product research, technical implementation details

blonk [6f73b915-ffc2-4e94-a60c-0e2bb9ae6f1b]
Capabilities: Coding agent with deep integrations with Coder's GitHub repositories
Use for: Code analysis, creating PRs, deep technical code research, implementation details at the code level

ProductboardAnalyst [cacd27c5-6619-4e8d-aee1-3dac83a49459]
Capabilities: Understands ProductBoard features,releases, customer feedback and Vivun data
Use for: Product initiatives (in-progress/upcoming), roadmap queries, customer feedback analysis

CoderBlogAnalyst [e67f152b-6f52-430a-848a-4a8dde7c6656]
Capabilities: Understands DatoCMS published content, cross-references Coder releases
Use for: Content gaps, blog topic recommendations, published content analysis
</specialist-agents>

<delegation-strategy>
Common delegation patterns by domain:

Engineering and Development:
- Code changes or PRs: blonk
- Project status or planning: V2ProjectManager
- Documentation: CoderDocsResearcher

Product and Planning:
- Roadmap or initiatives: ProductboardAnalyst
- Project tracking: V2ProjectManager

Content and Marketing:
- Blog or content analysis: CoderBlogAnalyst
- Documentation research: CoderDocsResearcher

External Data:
- Tech news or trends: HackerTracker

Code Analysis:
- Deep technical investigation: blonk
</delegation-strategy>

<workflow>
When handling a user query:

1. Analyze the user's query to understand their intent
2. ALWAYS identify MULTIPLE specialist agent(s) that could contribute to the query (refer to specialist-agents list)
3. Use delegate_to_agent with the agent_id to send the query to MULTIPLE agents in parallel (returns immediately with chat_id)
4. Use check_agent_response with the chat_id to retrieve the response
5. If agent is still processing, wait briefly and check again
6. Wait for all answers before synthensizing to the user

CRITICAL: Do NOT return to the user until you have the complete response.
Do NOT say "I will follow up" or "checking in a moment".
Keep calling check_agent_response until you get the full answer.

CRITICAL: When delegating to a specialist agent, you MUST pass the user's original query EXACTLY as they wrote it. Do NOT rephrase, translate, summarize, or modify the query in any way. Pass the verbatim user message to the specialist agent. This is essential for maintaining context and intent.
</workflow>

<multi-agent-synthesis>
When you delegate to multiple agents:

- Clearly attribute which response came from which agent
- Identify key differences and similarities between responses
- Synthesize responses into a coherent answer leveraging each agent's strengths
- When responses conflict or offer different perspectives, present both viewpoints clearly
- Offer the user the option to explore one agent's response in more detail

Example: "V2ProjectManager indicates the feature is planned for Q2, while blonk's code analysis shows partial implementation already exists. Would you like me to investigate either perspective further?"
</multi-agent-synthesis>

<conversation-continuity>
Important context about ongoing conversations:

- When you delegate to the same agent multiple times in one conversation, messages are sent to the same chat
- This allows specialist agents to maintain context from previous questions
- Each specialist agent has its own separate conversation thread
- You can delegate to multiple agents and synthesize their responses
</conversation-continuity>`;

  // Add Slack formatting rules if message is from Slack
  if (slackMetadata) {
    systemPrompt += `

<formatting-rules>
${slackbot.systemPrompt}
</formatting-rules>`;
  }

  const tools = {
    ...slackbot.tools({
      messages,
      context,
    }),

    list_agents: tool({
      description:
        "List all available agents in the organization. Use this to discover what specialized agents exist and what they can do.",
      inputSchema: z.object({
        organization_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional organization ID to filter agents. If not provided, uses BLINK_ORG_ID environment variable or lists agents from all organizations."
          ),
      }),
      execute: async ({ organization_id }) => {
        const apiToken = process.env.BLINK_API_TOKEN;
        if (!apiToken) {
          throw new Error(
            "BLINK_API_TOKEN environment variable not set. Please configure your Blink API token."
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
              `Failed to list organizations: ${orgsResponse.statusText}`
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
                }
              );

              if (!agentsResponse.ok) {
                return [];
              }

              const data = (await agentsResponse.json()) as { items: any[] };
              return data.items;
            })
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
          }
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
        "Delegate a query to a specialized agent. This creates a chat with the agent (or continues an existing conversation) and returns immediately with a chat ID. The agent will process the request asynchronously.",
      inputSchema: z.object({
        agent_id: z
          .string()
          .uuid()
          .describe(
            "The UUID of the agent to delegate to. Get this from list_agents."
          ),
        organization_id: z
          .string()
          .uuid()
          .describe(
            "The organization ID of the agent. Get this from list_agents."
          ),
        query: z
          .string()
          .describe("The question or task to send to the specialized agent."),
        force_new_chat: z
          .boolean()
          .optional()
          .describe(
            "If true, always create a new chat instead of continuing existing conversation. Default: false"
          ),
      }),
      execute: async ({ agent_id, organization_id, query, force_new_chat }) => {
        const apiToken = process.env.BLINK_API_TOKEN;
        if (!apiToken) {
          throw new Error(
            "BLINK_API_TOKEN environment variable not set. Cannot authenticate with agent."
          );
        }

        const baseURL = "https://blink.so";

        // Check if we already have a chat with this agent
        const storeKey = `agent_chat:${agent_id}`;
        const existingChatId = await context.store.get(storeKey);

        if (existingChatId && !force_new_chat) {
          // Send a new message to the existing chat
          const response = await fetch(`${baseURL}/api/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({
              chat_id: existingChatId,
              behavior: "enqueue",
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
            // If the chat doesn't exist anymore, fall through to create new one
            if (response.status === 404) {
              await context.store.delete(storeKey);
            } else {
              throw new Error(
                `Failed to send message to agent: ${response.status} ${response.statusText} - ${errorText}`
              );
            }
          } else {
            // Reset check count for new message to existing chat
            const checkCountKey = `check_count:${existingChatId}`;
            await context.store.set(checkCountKey, "0");

            return {
              status: "delegated",
              message:
                "Successfully sent message to existing conversation with agent. The agent is processing your request.",
              chat_id: existingChatId,
              agent_id,
              query,
              continued_conversation: true,
            };
          }
        }

        // Create a new chat with the agent
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
            `Failed to communicate with agent: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        const chatData = await response.json();
        const newChatId = (chatData as { id: string }).id;

        // Store the chat ID for this agent
        await context.store.set(storeKey, newChatId);

        // Initialize check count for new chat
        const checkCountKey = `check_count:${newChatId}`;
        await context.store.set(checkCountKey, "0");

        return {
          status: "delegated",
          message:
            "Successfully delegated query to agent. The agent is processing your request.",
          chat_id: newChatId,
          agent_id,
          query,
          continued_conversation: false,
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
            "BLINK_API_TOKEN environment variable not set. Cannot authenticate with agent."
          );
        }

        const baseURL = "https://blink.so";

        // Track how many times we've checked this chat
        const checkCountKey = `check_count:${chat_id}`;
        const previousCount = await context.store.get(checkCountKey);
        const checkCount =
          (previousCount ? parseInt(previousCount, 10) : 0) + 1;
        await context.store.set(checkCountKey, checkCount.toString());

        // First check the chat status
        const chatResponse = await fetch(`${baseURL}/api/chats/${chat_id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });

        if (!chatResponse.ok) {
          const errorText = await chatResponse.text();
          throw new Error(
            `Failed to get chat: ${chatResponse.status} ${chatResponse.statusText} - ${errorText}`
          );
        }

        const chatData = (await chatResponse.json()) as {
          status: string;
          created_at: string;
          error: string | null;
        };

        // Check if there's an error
        if (chatData.error) {
          return {
            status: "error",
            message: `The agent encountered an error: ${chatData.error}`,
            chat_status: chatData.status,
            check_count: checkCount,
          };
        }

        // If chat is still streaming, it's actively working
        if (chatData.status === "streaming") {
          return {
            status: "processing",
            message:
              "The agent is still processing your request. Please wait a moment and check again.",
            chat_status: chatData.status,
            check_count: checkCount,
          };
        }

        // If chat is NOT streaming but also not idle, check for timeout
        if (chatData.status !== "idle") {
          // Calculate elapsed time only for timeout detection
          const createdAt = new Date(chatData.created_at);
          const elapsedMs = Date.now() - createdAt.getTime();
          const timeoutMs = 2 * 60 * 1000; // 2 minutes

          if (elapsedMs > timeoutMs) {
            return {
              status: "timeout",
              message: `The agent chat is stuck in '${chatData.status}' state for over 2 minutes. It may have encountered an issue. You can try asking the question again.`,
              chat_status: chatData.status,
              check_count: checkCount,
            };
          }

          // Still within timeout window, return processing
          return {
            status: "processing",
            message: `The agent chat is in '${chatData.status}' state. Waiting for it to start processing...`,
            chat_status: chatData.status,
            check_count: checkCount,
          };
        }

        // Get the chat messages
        const response = await fetch(
          `${baseURL}/api/messages?chat_id=${chat_id}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiToken}`,
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to get chat messages: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        const messagesData = await response.json();

        // Find all assistant messages
        const messages = (messagesData as { items: any[] }).items || [];
        const assistantMessages = messages.filter(
          (m: any) => m.role === "assistant"
        );

        if (assistantMessages.length === 0) {
          return {
            status: "processing",
            message:
              "The agent is still processing your request. Please wait a moment and check again.",
            chat_status: chatData.status,
          };
        }

        // Collect text from ALL assistant messages, not just the last one
        let fullResponse = "";

        for (const msg of assistantMessages) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                fullResponse += part.text + "\n\n";
              }
            }
          }
        }

        // Clean up extra whitespace
        fullResponse = fullResponse.trim();

        return {
          status: "completed",
          response: fullResponse || "Agent returned no text response",
          message_count: messages.length,
          assistant_message_count: assistantMessages.length,
          chat_status: chatData.status,
        };
      },
    }),
  };

  return streamText({
    model: "anthropic/claude-sonnet-4.5",
    system: systemPrompt,
    messages: convertToModelMessages(messages),
    tools: withModelIntent(tools, {
      async onModelIntents(modelIntents) {
        const metadata = slackbot.findLastMessageMetadata(messages);
        if (!metadata) {
          return;
        }
        if (abortSignal?.aborted) {
          const client = await slackbot.createClient(context, metadata);
          try {
            await client.assistant.threads.setStatus({
              channel_id: metadata.channel,
              thread_ts: metadata.threadTs ?? metadata.ts,
              status: ``,
            });
          } catch (err) {
            // Ignore errors setting status
          }
          return;
        }

        let statuses = modelIntents.map((i) => {
          let displayIntent = i.modelIntent;
          if (displayIntent.length > 0) {
            displayIntent =
              displayIntent.charAt(0).toLowerCase() + displayIntent.slice(1);
          }
          return displayIntent;
        });
        statuses = [...new Set(statuses)];
        const client = await slackbot.createClient(context, metadata);
        try {
          await client.assistant.threads.setStatus({
            channel_id: metadata.channel,
            thread_ts: metadata.threadTs ?? metadata.ts,
            status: `is ${statuses.join(", ")}...`,
          });
        } catch (err) {
          // Ignore errors setting status
        }
      },
    }),
  });
});

agent.on("request", async (request, context) => {
  const url = new URL(request.url);

  // Handle Slack OAuth and webhooks
  if (url.pathname.startsWith("/slack")) {
    if (slackbot.isOAuthRequest(request)) {
      return slackbot.handleOAuthRequest(request, context);
    }
    if (slackbot.isWebhook(request)) {
      return slackbot.handleWebhook(request, context);
    }
  }

  return new Response("Not Found", { status: 404 });
});

agent.serve();

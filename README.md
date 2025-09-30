# Point Agent - Orchestration Agent

An orchestration agent that can discover and delegate to other specialized Blink agents.

## Features

- **Agent Discovery**: List all available agents in your organization(s)
- **Agent Details**: Get detailed information about any agent including description and request URL
- **Future**: Delegate queries to specialized agents and reconcile responses

## Setup

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Configure environment variables**:
   
   Create a `.env.local` file:
   ```bash
   cp .env.example .env.local
   ```
   
   Then add your tokens:
   - `BLINK_API_TOKEN`: Get from [blink.so/settings/api-keys](https://blink.so/settings/api-keys)
   - `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude

3. **Run in development**:
   ```bash
   blink dev
   ```

4. **Deploy to Blink Cloud**:
   ```bash
   blink deploy
   ```

## Available Tools

### `list_agents`
Discovers all agents available to you across your organizations.

**Parameters:**
- `organization_id` (optional): Filter to a specific organization

**Example query:**
> "What agents are available?"

### `get_agent_capabilities`
Retrieves detailed information about a specific agent.

**Parameters:**
- `agent_id` (required): UUID of the agent

**Returns:**
- Agent name, description, visibility
- Request URL for delegation
- Active deployment information

**Example query:**
> "Tell me more about agent abc-123-def"

## Usage Examples

### Discovering Agents
```
User: What agents do I have access to?

Agent: [Calls list_agents tool]

Agent: You have access to 3 agents:
1. Finance Agent - Handles accounting and revenue queries
2. Bug Triage Agent - Monitors and analyzes GitHub issues
3. Customer Support Agent - Helps with support ticket analysis
```

### Getting Agent Details
```
User: Tell me more about the Finance Agent

Agent: [Calls get_agent_capabilities with the Finance Agent's ID]

Agent: The Finance Agent:
- Specializes in accounting and revenue analysis
- Can query Stripe and QuickBooks
- Request URL: https://finance-agent.blink.so/...
- Currently running deployment: v1.2.3
```

## Next Steps

This agent currently focuses on **discovery**. Future enhancements will include:

1. **Delegation Tools**: Direct query routing to specialized agents
2. **Response Reconciliation**: Combining responses from multiple agents
3. **Query Decomposition**: Breaking complex queries into sub-tasks
4. **Agent Chaining**: Sequential delegation across multiple agents

## Architecture

```
User Query
    ↓
Orchestrator Agent (this agent)
    ↓
[Discovery Phase]
    ├─ list_agents → Get all available agents
    └─ get_agent_capabilities → Understand what each agent does
    ↓
[Future: Delegation Phase]
    ├─ Route query to appropriate agent(s)
    ├─ Collect responses
    └─ Reconcile and synthesize
    ↓
Unified Response to User
```

## Development

- Built with [Blink](https://blink.so) framework
- Uses [AI SDK v5](https://sdk.vercel.ai/docs) for tool definitions
- TypeScript for type safety

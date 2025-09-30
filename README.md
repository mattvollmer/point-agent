# Blink Coordinator - Orchestration Agent

An orchestration agent that can discover and delegate to other specialized Blink agents.

## Features

- **Agent Discovery**: List all available agents in your organization(s)
- **Agent Details**: Get detailed information about any agent including description and request URL
- **Future**: Delegate queries to specialized agents and reconcile responses

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

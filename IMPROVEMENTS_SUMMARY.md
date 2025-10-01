# Blink Coordinator Improvements Summary

Comprehensive summary of all improvements made to the point-agent (Blink Coordinator).

## Overview

The Blink Coordinator is an orchestration agent that discovers and delegates to specialized Blink agents. This document tracks all enhancements made to improve its functionality, reliability, and user experience.

---

## ✅ Merged Improvements

### 1. Agent Discovery Tools (PR #1)
**Status:** Merged  
**Branch:** `blink/agent-discovery-tools`

**What it does:**
- Added `list_agents` tool to discover available specialist agents
- Added `get_agent_capabilities` tool to get agent details
- Integrated Blink Cloud API (`@blink.so/api`)

**Key Features:**
```typescript
list_agents({ organization_id }) // Lists all agents in org
get_agent_capabilities({ agent_id }) // Gets agent metadata
```

---

### 2. Preserve Original Query (PR #2)
**Status:** Merged  
**Branch:** `blink/preserve-original-query`

**Problem:** Coordinator was rephrasing user queries when delegating

**Solution:** Added CRITICAL instruction:
```
CRITICAL: When delegating to a specialist agent, you MUST pass the
user's original query EXACTLY as they wrote it. Do NOT rephrase,
translate, summarize, or modify the query in any way.
```

**Impact:**
- ✅ Maintains original context and nuance
- ✅ Preserves user's specific wording
- ✅ Ensures specialist agents respond to actual question

---

### 3. Elapsed Time Validation (PR #3)
**Status:** Merged  
**Branch:** `blink/fix-elapsed-time-calculation`

**Problem:** `elapsed_seconds` showing 72,399+ seconds (~20 hours)

**Solution:** Added validation:
- Wrapped date parsing in try-catch
- Validated elapsed time must be 0-86400 seconds (24 hours)
- Omit field if parsing fails

**Note:** This PR added validation but didn't fix the root cause (see PR #4)

---

### 4. Unix Timestamp Conversion (PR #4)
**Status:** Merged  
**Branch:** `blink/fix-unix-timestamp-conversion`

**Problem:** API returns timestamps in SECONDS, JavaScript expects MILLISECONDS

**Solution:** Smart timestamp detection:
```typescript
if (created_at < 10_000_000_000) {
  // Seconds (before year 2286)
  createdAtMs = created_at * 1000;
} else {
  // Already in milliseconds
  createdAtMs = created_at;
}
```

**Impact:**
- ✅ Correctly converts seconds to milliseconds
- ✅ Handles numeric timestamps, ISO strings, numeric strings
- ✅ Fixed the actual root cause of timestamp issues

---

## 🔄 Open Pull Requests

### 5. Stale Chat Detection (PR #5)
**Status:** Open (Draft)  
**Branch:** `blink/fix-stale-chat-persistence`

**Problem:** Coordinator reusing 20+ hour old chats from previous days

**Example:**
```
Yesterday 3pm: "What's in v2?"
Today 11am: "Who made commit #3?"
→ Reuses yesterday's chat ❌ (confusing mixed context)
```

**Solution:** Check chat age before reusing:
```typescript
if (chatAge > 1 hour) {
  console.log('Chat is stale, creating new chat');
  await context.store.delete(chatId);
  // Create fresh chat
}
```

**Behavior:**
| Chat Age | Action |
|----------|--------|
| < 1 hour | Continue conversation |
| > 1 hour | Create new chat |
| 404 missing | Create new chat |

**Benefits:**
- ✅ No more mixing context from different days
- ✅ Clear conversation boundaries
- ✅ Prevents stale context issues

---

### 6. Simple Check Counter (PR #6)
**Status:** Open (Draft)  
**Branch:** `blink/replace-elapsed-with-check-count`

**Problem:** Complex timestamp logic was over-engineered

**Solution:** Replace with simple incrementing counter:

**Before:**
```
check_agent_response: elapsed_seconds=73121 // Confusing!
```

**After:**
```
check_agent_response: check_count=1 // Clear!
check_agent_response: check_count=2
check_agent_response: check_count=3
```

**Implementation:**
```typescript
const checkCountKey = `check_count:${chat_id}`;
const previousCount = await context.store.get(checkCountKey);
const checkCount = (previousCount ? parseInt(previousCount, 10) : 0) + 1;
await context.store.set(checkCountKey, checkCount.toString());
```

**Impact:**
- **-94 lines** of complex code removed
- ✅ Clear progress indication
- ✅ No timestamp confusion
- ✅ Much simpler to understand

---

## 📊 Key Improvements by Category

### Discovery & Delegation
- ✅ Agent discovery via Blink Cloud API
- ✅ Preserve original user queries (no rephrasing)
- ✅ Built-in agent directory with use cases
- ✅ Stale chat detection (1 hour threshold)

### System Prompt Enhancements
- ✅ XML-structured format for better AI comprehension
- ✅ Agent directory with IDs and capabilities
- ✅ Delegation strategy guidance
- ✅ Multi-agent synthesis instructions
- ✅ Conversation continuity rules

### Slack Integration
- ✅ Full `@blink-sdk/slackbot` integration
- ✅ Webhook and OAuth handlers
- ✅ Model intent status updates
- ✅ Conditional Slack formatting

### Code Quality
- ✅ Removed ~150 lines of complex timestamp logic
- ✅ Simplified check progress indicator
- ✅ Better error handling
- ✅ Debug logging for production issues

---

## 🎯 Current State

### Agent Identity
**Name:** Blink Coordinator  
**Role:** Orchestration agent that routes queries to specialists

### Available Specialist Agents
1. **V2ProjectManager** - GitHub project tracking
2. **HackerTracker** - Tech news and HN discussions
3. **CoderDocsResearcher** - Documentation and product research
4. **blonk** - Code analysis and PRs
5. **ProductboardAnalyst** - Product initiatives and roadmap
6. **CoderBlogAnalyst** - Content and blog analysis

### Tools
- `list_agents` - Discover available agents
- `get_agent_capabilities` - Get agent details
- `delegate_to_agent` - Send query to specialist
- `check_agent_response` - Poll for response
- Full Slack tools from `@blink-sdk/slackbot`

### Features
- ✅ Automatic agent discovery
- ✅ Query delegation with conversation continuity
- ✅ Multi-agent synthesis
- ✅ Stale chat detection (pending merge)
- ✅ Simple progress indicators (pending merge)
- ✅ Slack integration with status updates

---

## 📝 Lessons Learned

### Timestamp Handling
- Always validate timestamp formats from APIs
- Unix timestamps can be in seconds OR milliseconds
- Simple counters often better than complex time calculations

### Chat Persistence
- Context store persists per coordinator conversation
- Need expiry mechanism to prevent stale context
- 1 hour threshold balances continuity vs freshness

### System Prompts
- XML structure better for AI comprehension than markdown
- Semantic tags improve prompt caching
- CRITICAL instructions help enforce important behaviors

### Code Simplification
- Over-engineering happens easily with edge cases
- Simple solutions often better than complex ones
- Remove code when possible, don't just add

---

## 🚀 Future Enhancements

### Potential Improvements
1. **Adaptive polling** - Smart check intervals based on agent speed
2. **Agent health tracking** - Monitor which agents are available
3. **User preferences** - Respect pinned or favorite agents
4. **Multi-agent chaining** - Sequential delegation workflows
5. **Response caching** - Cache frequent queries
6. **Agent performance metrics** - Track response times

### Configuration Options
- Make stale chat threshold configurable
- Allow custom polling strategies
- Per-agent timeout settings

---

## 📚 Documentation

### Setup
```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Add BLINK_API_TOKEN, ANTHROPIC_API_KEY

# Deploy
blink deploy
```

### Environment Variables
```bash
BLINK_API_TOKEN=your_token_here
BLINK_ORG_ID=your_org_id (optional)
ANTHROPIC_API_KEY=your_key_here

# Slack (optional)
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
```

---

## 🤝 Contributors

All improvements co-authored by:
- Matt Vollmer <95866673+mattvollmer@users.noreply.github.com>
- Blink (AI Assistant)

---

_Last updated: October 1, 2025_

import type Anthropic from "@anthropic-ai/sdk";

export interface ToolContext {
  conversationId: string; // the enquirer's WhatsApp id
}

export interface AgentTool {
  definition: Anthropic.Tool;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

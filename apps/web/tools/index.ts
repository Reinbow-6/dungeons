import type { DmChatMessagePart, DmChatUIMessage } from "@/agent/types";
import { askUser } from "./ask_user";
import { githubRepo } from "./github_repo";

const baseTools = {
  github_repo: githubRepo,
  ask_user: askUser,
};

export function getTools() {
  return baseTools;
}

export type ChatUIMessage = DmChatUIMessage;
export type ChatMessagePart = DmChatMessagePart;

export type TextMessagePart = Extract<ChatMessagePart, { type: "text" }>;
export type ReasoningMessagePart = Extract<
  ChatMessagePart,
  { type: "reasoning" }
>;
export type SourceUrlPart = Extract<ChatMessagePart, { type: "source-url" }>;
export type GithubRepoToolPart = Extract<
  ChatMessagePart,
  { type: "tool-github_repo" }
>;
export type AskUserToolPart = Extract<
  ChatMessagePart,
  { type: "tool-ask_user" }
>;
export type WebSearchToolPart = Extract<
  ChatMessagePart,
  { type: "tool-web_search" }
>;

export type DmToolPart = Extract<
  ChatMessagePart,
  {
    type:
      | "tool-resolve_check"
      | "tool-resolve_save"
      | "tool-declare_check"
      | "tool-investigate"
      | "tool-transition_scene"
      | "tool-inventory"
      | "tool-rollback_to_event"
      | "tool-lookup_rules"
      | "tool-combat_start"
      | "tool-combat_attack"
      | "tool-combat_next_turn"
      | "tool-combat_end"
      | "tool-apply_condition"
      | "tool-remember_fact";
  }
>;

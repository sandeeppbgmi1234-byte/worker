import type { Automation } from "@prisma/client";

export interface CommentData {
  id: string;
  text: string;
  username: string;
  userId: string;
  timestamp: string;
}

export interface AutomationRule {
  id: string;
  triggers: string[];
  matchType: "CONTAINS" | "EXACT";
  actionType: string;
  replyMessage: string;
  useVariables: boolean;
}

export interface MatchResult {
  matched: boolean;
  automation: Automation;
  matchedTrigger?: string;
}

export interface ExecutionStatus {
  status: "SUCCESS" | "FAILED" | "ASK_TO_FOLLOW_SENT";
}

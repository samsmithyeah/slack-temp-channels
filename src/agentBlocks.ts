import type { KnownBlock } from "@slack/types";
import type { AgentPlan } from "./services/agentPlanner";

const SLACK_SECTION_CHAR_LIMIT = 3000;

/** Split long text into multiple section blocks, each within Slack's limit. */
export function textSectionBlocks(text: string): KnownBlock[] {
  if (text.length <= SLACK_SECTION_CHAR_LIMIT) {
    return [{ type: "section", text: { type: "mrkdwn", text } }] as KnownBlock[];
  }

  const blocks: KnownBlock[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SLACK_SECTION_CHAR_LIMIT) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: remaining },
      } as unknown as KnownBlock);
      break;
    }
    // Split at the last newline before the limit
    let splitAt = remaining.lastIndexOf("\n", SLACK_SECTION_CHAR_LIMIT);
    if (splitAt <= 0) splitAt = SLACK_SECTION_CHAR_LIMIT;
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: remaining.slice(0, splitAt) },
    } as unknown as KnownBlock);
    remaining = remaining.slice(splitAt + 1);
  }
  return blocks;
}

export function planBlocks(plan: AgentPlan, planId: string): KnownBlock[] {
  const stepsText = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n");

  return [
    ...textSectionBlocks(`*AI Agent Plan*\n\n${plan.summary}`),
    ...(plan.steps.length > 0 ? textSectionBlocks(`*Steps:*\n${stepsText}`) : []),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Accept" },
          style: "primary",
          action_id: "agent_plan_accept",
          value: planId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Decline" },
          style: "danger",
          action_id: "agent_plan_decline",
          value: planId,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Refine" },
          action_id: "agent_plan_refine",
          value: planId,
        },
      ],
    },
  ] as KnownBlock[];
}

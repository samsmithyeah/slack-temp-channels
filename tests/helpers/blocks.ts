import type { AnyBlock } from "@slack/types";

interface InputBlock {
  type: "input";
  block_id: string;
  optional?: boolean;
  element: Record<string, unknown>;
  label: Record<string, unknown>;
}

export function findInputBlock(blocks: AnyBlock[], blockId: string): InputBlock {
  const block = blocks.find((b) => b.type === "input" && "block_id" in b && b.block_id === blockId);
  if (!block) throw new Error(`Block ${blockId} not found`);
  return block as unknown as InputBlock;
}

export function getBlockIds(blocks: AnyBlock[]): string[] {
  return blocks
    .filter((b): b is AnyBlock & { block_id: string } => "block_id" in b)
    .map((b) => b.block_id);
}

/** Shared shape for Bolt action handler `body` with trigger_id and actions. */
export interface ActionBody {
  trigger_id: string;
  user?: { id: string };
  channel?: { id: string };
  actions?: Array<{ type?: string; value?: string }>;
}

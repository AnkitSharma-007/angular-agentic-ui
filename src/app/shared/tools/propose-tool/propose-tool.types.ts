import type { CustomToolParameter } from '../../../core/custom-tools/custom-tool.types';

// The tool definition the agent proposes — structurally a `CustomToolSpec`
// without the id/timestamps the service fills in at registration time.
export interface ProposeToolDraft {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly CustomToolParameter[];
  readonly responseTemplate: string;
}

// `proposeTool` args are exactly the draft the model hands us.
export type ProposeToolArgs = ProposeToolDraft;

// What the model receives after the user's decision. Delivered through the
// interrupt `select` path as `{ selected: ProposeToolSelection }`, so the loop
// short-circuits without ever running the (defensive) executor.
export interface ProposeToolSelection {
  readonly registered: boolean;
  readonly name: string;
  readonly description: string;
}

export interface ProposeToolResult {
  readonly selected: ProposeToolSelection;
}

import type { ToolDescriptor } from '../../../core/registry/tool-descriptor';
import { customToolDraftSchema } from '../../../core/custom-tools/custom-tool.types';
import { ProposeToolCardComponent } from './propose-tool-card';
import { PROPOSE_TOOL_META } from './propose-tool.manifest';
import type { ProposeToolArgs, ProposeToolResult } from './propose-tool.types';

// Model-authored proposals are validated with the same strict contract as the
// tool builder: identifier-shaped tool/parameter names, bounded strings, a
// parameter cap, and a byte-capped response template. (M9)
const proposeToolArgsSchema = customToolDraftSchema;

// Defensive stub — never actually invoked. proposeTool is interruptive, so the
// user's approve/reject/select decision arrives via InterruptService and the
// agent loop short-circuits before any executor runs.
async function proposeToolExecutor(args: ProposeToolArgs): Promise<ProposeToolResult> {
  return {
    selected: { registered: false, name: args.name, description: args.description },
  };
}

export const proposeToolDescriptor: ToolDescriptor<ProposeToolArgs, ProposeToolResult> = {
  ...PROPOSE_TOOL_META,
  argsSchema: proposeToolArgsSchema,
  component: ProposeToolCardComponent,
  execute: proposeToolExecutor,
};

import { z } from 'zod';
import type { ToolDescriptor } from '../../../core/registry/tool-descriptor';
import { ProposeToolCardComponent } from './propose-tool-card';
import { PROPOSE_TOOL_META } from './propose-tool.manifest';
import type { ProposeToolArgs, ProposeToolResult } from './propose-tool.types';

const parameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().min(1),
  required: z.boolean(),
});

const proposeToolArgsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.array(parameterSchema).max(12),
  responseTemplate: z.string().min(1),
});

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

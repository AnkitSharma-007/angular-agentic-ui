import type { ToolManifest, ToolMeta } from '../../../core/registry/tool-descriptor';
import type { ProposeToolArgs, ProposeToolResult } from './propose-tool.types';

export const PROPOSE_TOOL_NAME = 'proposeTool';

// proposeTool is interactive: the executor never runs. The user reviews the
// proposed definition and either approves it (registering a real, callable
// custom tool and resolving via `select`) or rejects with a note.
export const PROPOSE_TOOL_META: ToolMeta = {
  name: PROPOSE_TOOL_NAME,
  description:
    'Propose a brand-new tool for the user to review, approve, and register. The user is the executor; nothing runs until they approve.',
  declaration: {
    name: PROPOSE_TOOL_NAME,
    description:
      'When no existing tool can fulfil the user\'s request, draft a new tool definition and call proposeTool instead of fabricating results. ' +
      'The user reviews the draft (and may edit it) then approves or rejects. ' +
      'On approval you receive `{ selected: { registered: true, name } }` and the new tool becomes callable on the very next round — call it then. ' +
      'On rejection you receive `{ rejected: true, reason }`; revise or choose another approach. ' +
      'Synthesized tools return only a templated JSON response you define — they never touch real systems, so design the responseTemplate to return realistic, useful mock data.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description:
            'camelCase function name: letters, digits, underscores; must start with a letter or underscore; ≤64 chars. Must not collide with an existing tool.',
        },
        description: {
          type: 'STRING',
          description:
            'One clear sentence describing what the tool does. You will read this later to decide when to call the tool.',
        },
        parameters: {
          type: 'ARRAY',
          description: 'The input parameters the tool accepts (may be empty).',
          items: {
            type: 'OBJECT',
            description: 'A single tool parameter.',
            properties: {
              name: {
                type: 'STRING',
                description: 'Parameter identifier (same naming rules as the tool name).',
              },
              type: {
                type: 'STRING',
                enum: ['string', 'number', 'boolean'],
                description: 'Parameter value type.',
              },
              description: {
                type: 'STRING',
                description: 'What this parameter means / how to fill it.',
              },
              required: {
                type: 'BOOLEAN',
                description: 'Whether the parameter must be supplied on every call.',
              },
            },
            required: ['name', 'type', 'description', 'required'],
          },
        },
        responseTemplate: {
          type: 'STRING',
          description:
            'A JSON template for the tool response. Use {{paramName}} placeholders that are replaced with the call arguments (values are JSON-encoded; missing args become null). It MUST parse as valid JSON after substitution. ' +
            'Example: {"summary": "Weather for {{city}} on {{date}}", "tempC": 27, "rainChance": 0.1}.',
        },
      },
      required: ['name', 'description', 'parameters', 'responseTemplate'],
    },
  },
  interruptive: true,
  interruptReason:
    'Review the proposed tool. Approve to register it (you can edit it first), or reject with a note so the agent can revise.',
};

export const proposeToolManifest: ToolManifest<ProposeToolArgs, ProposeToolResult> = {
  ...PROPOSE_TOOL_META,
  load: () => import('./propose-tool.descriptor').then((m) => m.proposeToolDescriptor),
};

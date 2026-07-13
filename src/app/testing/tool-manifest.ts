import { z } from 'zod';

import type {
  FunctionDeclaration,
  ToolDescriptor,
  ToolManifest,
} from '../core/registry/tool-descriptor';

function stubDeclaration(name: string): FunctionDeclaration {
  return { name, description: `${name} stub`, parameters: { type: 'OBJECT', properties: {} } };
}

export function makeToolDescriptor(
  name: string,
  overrides: Partial<ToolDescriptor> = {},
): ToolDescriptor {
  return {
    name,
    description: `${name} stub`,
    declaration: stubDeclaration(name),
    argsSchema: z.object({}),
    component: null as unknown as ToolDescriptor['component'],
    execute: async () => ({}),
    ...overrides,
  };
}

export function defineToolManifest(
  name: string,
  options: { load?: () => Promise<ToolDescriptor>; singleton?: boolean } = {},
): ToolManifest {
  const declaration = stubDeclaration(name);
  return {
    name,
    description: `${name} stub`,
    declaration,
    ...(options.singleton !== undefined ? { singleton: options.singleton } : {}),
    load: options.load ?? (async () => makeToolDescriptor(name, { declaration })),
  };
}

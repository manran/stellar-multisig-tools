export const TOOL_PATHS = ['/contracts', '/treasury', '/address-book', '/agent-access'] as const;

export type ToolPath = (typeof TOOL_PATHS)[number];

// Return targets are limited to these four local tools. Ignore external URLs and other routes.
export function toolReturnPath(value: string | null): ToolPath | null {
  return TOOL_PATHS.find((path) => path === value) ?? null;
}

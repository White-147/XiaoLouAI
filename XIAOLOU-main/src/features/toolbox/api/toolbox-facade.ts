import type { createToolboxService } from "./toolbox";

export type ToolboxServiceContract = ReturnType<typeof createToolboxService>;

export function createToolboxFacade(toolboxService: ToolboxServiceContract) {
  const {
    getToolboxCapabilities,
    getCapabilities,
    translateText,
    generateStoryboardGrid25,
    reverseVideoPrompt,
    runToolboxCapability,
  } = toolboxService;

  return {
    getToolboxCapabilities,
    getCapabilities,
    translateText,
    generateStoryboardGrid25,
    reverseVideoPrompt,
    runToolboxCapability,
  };
}

import type { ListTasksOptions, Task } from "./jobs-types";

export type JobsServiceContract = {
  listTasks: (projectId?: string, type?: string, options?: ListTasksOptions) => Promise<{ items: Task[] }>;
  getTask: (taskId: string) => Promise<Task>;
  dismissTask: (taskId: string) => Promise<{ deleted: boolean; taskId: string }>;
  clearTasks: (projectId?: string, type?: string) => Promise<{ removedCount: number }>;
};

export function createJobsFacade(jobsService: JobsServiceContract) {
  const dismissTask = (taskId: string) => {
    return jobsService.dismissTask(taskId);
  };

  return {
    listTasks(projectId?: string, type?: string, options?: ListTasksOptions) {
      return options === undefined
        ? jobsService.listTasks(projectId, type)
        : jobsService.listTasks(projectId, type, options);
    },
    getTask(taskId: string) {
      return jobsService.getTask(taskId);
    },
    dismissTask,
    deleteTask(taskId: string) {
      return dismissTask(taskId);
    },
    clearTasks(projectId?: string, type?: string) {
      return jobsService.clearTasks(projectId, type);
    },
  };
}

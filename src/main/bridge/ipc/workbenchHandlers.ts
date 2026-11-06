import { ipcMain } from 'electron';
import { z } from 'zod';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { updateProjectRules, bindActiveProject, createActiveProject, listActiveProjects, renameActiveProject, detachActiveProject, continueActiveProject } from '../../services/projectService';
import { getOwnedArtifactDiff, getTaskResults, getWorkingDirectoryDiff, getTaskChanges, getTaskChangeDiff } from '../../services/taskResultsService';

export function registerWorkbenchHandlers() {
  const id = z.string().trim().min(1).max(200);
  ipcMain.handle(KAIRO_INVOKE.projectUpdateRules, (_, value) => {
    const input=z.object({projectId:id,rules:z.string().max(100000),memory:z.string().max(100000)}).strict().parse(value);
    return updateProjectRules(input.projectId,input.rules,input.memory);
  });
  ipcMain.handle(KAIRO_INVOKE.projectRename, (_, value) => {
    const input = z.object({ projectId: id, name: z.string().trim().min(1).max(100) }).strict().parse(value);
    return renameActiveProject(input.projectId, input.name);
  });
  ipcMain.handle(KAIRO_INVOKE.projectDetach, (_, value) => detachActiveProject(id.parse(value)));
  ipcMain.handle(KAIRO_INVOKE.projectContinue, (_, value) => {
    const input = z.object({ projectId: id, name: z.string().trim().min(1).max(100), rootPath: z.string().min(1).max(4000) }).strict().parse(value);
    return continueActiveProject(input.projectId, input.name, input.rootPath);
  });
  ipcMain.handle(KAIRO_INVOKE.projectList, () => listActiveProjects());
  ipcMain.handle(KAIRO_INVOKE.projectCreate, (_event, input) => {
    const value = z.object({ name: z.string().trim().min(1).max(100), rootPath: z.string().min(1).max(4000) }).strict().parse(input);
    return createActiveProject(value.name, value.rootPath);
  });
  ipcMain.handle(KAIRO_INVOKE.projectBind, (_event, input) => bindActiveProject(id.parse(input)));
  ipcMain.handle(KAIRO_INVOKE.chatGetTaskChanges, (_, input) => getTaskChanges(id.parse(input)));
  ipcMain.handle(KAIRO_INVOKE.chatGetTaskChangeDiff, (_, input) => {
    const value = z.object({ sessionId: id, path: z.string().min(1).max(32768),runId:id.optional() }).strict().parse(input);
    return getTaskChangeDiff(value.sessionId, value.path,value.runId);
  });
  ipcMain.handle(KAIRO_INVOKE.chatGetTaskResults, (_event, input) => getTaskResults(id.parse(input)));
  ipcMain.handle(KAIRO_INVOKE.chatGetArtifactDiff, (_event, input) => getOwnedArtifactDiff(id.parse(input)));
  ipcMain.handle(KAIRO_INVOKE.chatGetWorkingDiff, (_event, input) => getWorkingDirectoryDiff(id.parse(input)));
}

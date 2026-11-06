import fs from 'node:fs';
import type {KairoPilotConfig} from '../../shared/contracts';
import {getPromptWorkspaceLayout} from '../workspace/layout';
export function ensureWorkspaceDirectories(workspace:string){
 const layout=getPromptWorkspaceLayout(workspace);
 for(const directory of [layout.workspaceRoot,layout.memoryDir,layout.skillsDir,layout.tasksDir,layout.artifactsDir,layout.imagesDir,layout.mediaDir])fs.mkdirSync(directory,{recursive:true});
}
export function stripRuntimeInstructions(config:KairoPilotConfig):KairoPilotConfig{
 return {...config,workbench:config.workbench?{...config.workbench,instructions:''}:undefined};
}

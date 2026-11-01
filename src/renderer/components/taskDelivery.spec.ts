import {expect,it} from 'vitest';
import type {TaskResults,TaskArtifact,VerificationRecord} from '../../shared/contracts';
import {deliveryForRun} from './taskDelivery';
const artifact=(id:string,runId:string,path:string):TaskArtifact=>({id,runId,path,sessionId:'task',toolCallId:id,operation:'modified',createdAt:1,diffAvailable:true,availability:'available',beforeHash:'a',afterHash:'b'});
const verification=(id:string,runId:string,status:VerificationRecord['status']):VerificationRecord=>({id,runId,status,sessionId:'task',toolCallId:id,command:'test',cwd:'/test',createdAt:1,stdout:'',stderr:''});
it('separates this round from previous successful checks and artifacts',()=>{
 const results:TaskResults={artifacts:[artifact('new','now','/a'),artifact('old','before','/b')],verifications:[verification('prior','before','passed')]};
 const view=deliveryForRun(results,'now');expect(view.artifacts.map(item=>item.id)).toEqual(['new']);expect(view.verificationStatus).toBe('unverified');expect(view.historyVerifications).toHaveLength(1);expect(view.changes[0].runIds).toEqual(['now']);
});
it('shows the latest state of each file while retaining all operations in its change summary',()=>{
 const latest={...artifact('2','now','/a'),beforeHash:'b',afterHash:'c',availability:'missing' as const};
 const view=deliveryForRun({artifacts:[latest,artifact('1','now','/a')],verifications:[]},'now');expect(view.artifacts).toEqual([latest]);expect(view.changes[0].artifactIds).toEqual(['1','2']);expect(view.unavailableCount).toBe(1);
});
it('does not present denied or interrupted verification output as passing',()=>{
 const view=deliveryForRun({artifacts:[],verifications:[{...verification('v','now','passed'),outputAvailable:false}]},'now');expect(view.verificationStatus).toBe('interrupted');
});

import {describe,it,expect} from 'vitest';
import {normalizeProvider} from './configModelUtils';
import type {ProviderConfig} from '../../shared/contracts';
const provider:ProviderConfig={provider:'custom',baseUrl:'http://localhost:1234/v1',apiKey:'',model:[{id:'local',name:'Local'}]};
describe('current provider contract',()=>{
 it('accepts an explicit provider and model array',()=>{expect(normalizeProvider(provider,'fixture').model).toEqual(provider.model);});
 it('rejects alternate model structures, missing provider types and empty model lists',()=>{
  for(const value of [{...provider,model:{list:provider.model}},{...provider,provider:undefined},{...provider,provider:'unknown'},{...provider,model:[]},{...provider,model:[{id:'local'}]}]) {
   expect(()=>normalizeProvider(value as unknown as ProviderConfig,'openai')).toThrow();
  }
 });
});

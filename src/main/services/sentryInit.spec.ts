import {afterEach, describe, expect, it, vi} from 'vitest';
const state=vi.hoisted(()=>({init:vi.fn()}));
vi.mock('@sentry/electron/main',()=>({init:state.init}));
vi.mock('electron',()=>({app:{getVersion:()=> 'test'}}));
import {initSentry} from './sentryInit';
afterEach(()=>{vi.unstubAllEnvs();state.init.mockReset();});
describe('error reporting privacy',()=>{
 it('does not initialize without a DSN',()=>{vi.stubEnv('KAIROPILOT_SENTRY_DSN','');initSentry();expect(state.init).not.toHaveBeenCalled();});
 it('keeps only release metadata and redacted exception counts',()=>{
  vi.stubEnv('KAIROPILOT_SENTRY_DSN','synthetic');initSentry();
  const options=state.init.mock.calls[0][0];
  const safe=options.beforeSend({event_id:'event',release:'test',level:'error',exception:{values:[{type:'synthetic private data',value:'password=synthetic',stacktrace:{frames:[{filename:'/private/synthetic'}]}}]},message:'synthetic secret',breadcrumbs:[{data:{token:'synthetic'}}],extra:{prompt:'synthetic'},request:{url:'synthetic'},user:{email:'synthetic'}});
  expect(JSON.stringify(safe)).not.toContain('synthetic');expect(safe.exception.values).toEqual([{type:'Error',value:'[redacted]'}]);expect(options.sendDefaultPii).toBe(false);
 });
});

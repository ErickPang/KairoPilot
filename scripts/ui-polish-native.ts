import {app,BrowserWindow} from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const output=process.env.KAIROPILOT_UI_POLISH_OUTPUT!;
if(!output)throw new Error('Use the isolated UI polish runner.');
app.setPath('userData',path.join(output,'chromium'));
app.whenReady().then(async()=>{
  const checks:string[]=[],metrics:unknown[]=[];
  const assert=(condition:unknown,label:string)=>{if(!condition)throw new Error(label);checks.push(label);};
  const window=new BrowserWindow({width:1440,height:940,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const errors:string[]=[];window.webContents.on('console-message',(details)=>{if(details.level==='error')errors.push(details.message);});
  const js=(source:string)=>window.webContents.executeJavaScript(source);
  const wait=(condition:string)=>js(`new Promise(resolve=>{const end=Date.now()+12000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},30);})`);
  const click=(selector:string)=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture=async(name:string)=>{await new Promise(resolve=>setTimeout(resolve,180));fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());};
  const type=(selector:string,value:string)=>js(`{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
  try{
    await window.loadFile(path.join(output,'index.html'),{query:{'workbench-preview':'completed'}});
    assert(await wait(`document.querySelector('[data-nav-tab=settings]')`),'actual workbench mounts with synthetic bridge');
    await click('[data-nav-tab=settings]');assert(await wait(`document.querySelector('[data-settings-section=general]')`),'settings navigation opens');
    await click('[data-settings-section=general]');assert(await wait(`document.querySelector('.settings-panel [role=combobox]')`),'general settings load');
    for(const theme of ['light','dark']){
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const width of [1440,980]){
        window.setContentSize(width,900);await new Promise(resolve=>setTimeout(resolve,150));
        const measure=await js(`(()=>{const main=document.querySelector('.main-content-settings'),header=main.querySelector('.config-title'),r=header.getBoundingClientRect(),content=main.getBoundingClientRect();return {theme:${JSON.stringify(theme)},width:innerWidth,titleOffset:r.top-content.top,overflow:main.scrollWidth>main.clientWidth+1};})()`);
        metrics.push(measure);assert(measure.titleOffset>=20&&measure.titleOffset<=32&&!measure.overflow,`settings title uses one compact top inset: ${theme} ${width}`);
        await capture(`settings-${theme}-${width}`);
      }
      await click('.settings-panel [role=combobox]');assert(await wait(`document.querySelector('[data-select-popover]')`),'themed selector opens');
      assert(await js(`parseFloat(getComputedStyle(document.querySelector('[data-select-popover]')).borderRadius)>=18&&parseFloat(getComputedStyle(document.querySelector('.custom-select-trigger')).borderRadius)>=12`),'selector and popover use rounded shared controls');
      await capture(`selector-${theme}`);await js(`document.querySelector('[data-select-popover]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    }
    window.setContentSize(1440,900);await click('[data-settings-section=skills]');
    assert(await wait(`document.querySelectorAll('.capability-item').length===6`),'public and workbench skills share the installed list');
    assert(await js(`!document.querySelector('.skills-overview-grid,.skill-section-panel,.skill-installed-toolbar')`),'old overview cards and folding groups are removed');
    for(const theme of ['light','dark']){
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const width of [1440,980,760]){
        window.setContentSize(width,900);await new Promise(resolve=>setTimeout(resolve,160));
        const measure=await js(`(()=>{const grid=document.querySelector('.capability-grid'),rows=[...grid.children].map(el=>el.getBoundingClientRect()),main=document.querySelector('.skill-library').closest('.main-content');return {theme:${JSON.stringify(theme)},width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,heights:rows.map(r=>r.height),overflow:main.scrollWidth>main.clientWidth+1};})()`);
        metrics.push(measure);assert(!measure.overflow&&measure.heights.every((height:number)=>height<95)&&measure.columns===(width>=980?2:1),`skill rows adapt without overflow: ${theme} ${width}`);
        await capture(`skills-${theme}-${width}`);
      }
    }
    await type('.capability-search input','公开关键词');assert(await wait(`document.querySelectorAll('.capability-item').length===1`),'installed skill search filters names and descriptions');
    await type('.capability-search input','no-such-skill');assert(await wait(`!document.querySelector('.capability-item')&&document.querySelector('.empty-state')`),'search empty state appears');
    await type('.capability-search input','');assert(await wait(`document.querySelectorAll('.capability-item').length===6`),'clearing search restores all skills');
    await click('[data-skill-id=fixture-0] button');assert(await wait(`document.querySelector('[data-dialog-kind=skill-details]')`),'skill row opens full details');
    assert(await js(`document.querySelector('[data-dialog-kind=skill-details] pre').textContent.includes('执行前核对用户目标与授权')`),'full skill instructions remain available');
    await js(`[...document.querySelectorAll('[data-dialog-kind=skill-details] button')].find(el=>el.textContent==='回滚').click()`);assert(await wait(`document.documentElement.dataset.rollback==='true'`),'rollback remains reachable in details');
    await capture('skill-details');await click('[data-dialog-kind=skill-details] .close-btn');
    await click('.capability-add');assert(await wait(`document.querySelector('[role=dialog]')`),'header Add opens existing import flow');await capture('skill-import');await click('[role=dialog] .close-btn');
    await click('.capability-actions button[aria-label="添加市场来源"]');assert(await wait(`document.querySelector('[role=dialog]')`),'source control opens source configuration');await click('[role=dialog] .close-btn');
    await click('[data-skill-id=fixture-0] button');await js(`[...document.querySelectorAll('[data-dialog-kind=skill-details] button')].find(el=>el.textContent.includes('卸载')).click()`);
    assert(await wait(`document.querySelector('.skill-install-modal')`),'uninstall keeps the existing explicit confirmation flow');
    await js(`[...document.querySelectorAll('[role=dialog] .modal-actions button')].find(el=>el.textContent.includes('卸载')).click()`);
    assert(await wait(`!document.querySelector('[data-skill-id=fixture-0]')&&document.querySelectorAll('.capability-item').length===5`),'confirmed uninstall refreshes the installed list');
    window.setContentSize(1440,900);await click('[data-settings-section=plugins]');
    assert(await wait(`document.querySelectorAll('.plugin-library .capability-item').length===6`),'plugins use the shared compact installed list');
    for(const theme of ['light','dark']){
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      for(const width of [1440,760]){
        window.setContentSize(width,900);await new Promise(resolve=>setTimeout(resolve,130));
        const measure=await js(`(()=>{const grid=document.querySelector('.plugin-library .capability-grid'),main=grid.closest('.main-content');return {page:'plugins',theme:${JSON.stringify(theme)},width:innerWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:main.scrollWidth>main.clientWidth+1};})()`);
        metrics.push(measure);assert(!measure.overflow&&measure.columns===(width===1440?2:1),`plugin layout matches skills: ${theme} ${width}`);await capture(`plugins-${theme}-${width}`);
      }
    }
    await type('.plugin-library .capability-search input','不存在的插件');assert(await wait(`!document.querySelector('.plugin-library .capability-item')&&document.querySelector('.plugin-library .empty-state')`),'plugin search has an empty result state');
    await type('.plugin-library .capability-search input','plugin-fixture-0');assert(await wait(`document.querySelectorAll('.plugin-library .capability-item').length===1`),'plugin search matches plugin ids');await type('.plugin-library .capability-search input','');
    await click('[data-plugin-id=web_search] button');assert(await wait(`document.querySelector('[data-dialog-kind=plugin-details]')`),'built-in tool details remain available');
    assert(await js(`!document.querySelector('[data-dialog-kind=plugin-details] .btn-danger')`),'built-in capabilities cannot be uninstalled');await click('[data-dialog-kind=plugin-details] .close-btn');
    const pluginButton=(text:string)=>js(`[...document.querySelectorAll('[data-dialog-kind=plugin-details] .modal-actions button')].find(el=>el.textContent===${JSON.stringify(text)}).click()`);
    await click('[data-plugin-id=plugin-fixture-0] button');assert(await wait(`document.querySelector('[data-dialog-kind=plugin-details] .plugin-capability-summary')`),'plugin details keep tool, permission and risk information');await capture('plugin-details');
    await pluginButton('禁用');assert(await wait(`document.querySelector('[data-plugin-id=plugin-fixture-0] .capability-status[aria-label="已禁用"]')`),'plugin disable updates its visible status');
    await click('[data-plugin-id=plugin-fixture-0] button');await pluginButton('启用');assert(await wait(`document.querySelector('[data-plugin-id=plugin-fixture-0] .capability-status[aria-label="已启用"]')`),'plugin enable remains available');
    await click('[data-plugin-id=plugin-fixture-0] button');await pluginButton('回滚');assert(await wait(`document.documentElement.dataset.pluginRollback==='true'`),'plugin rollback remains available');
    assert(await wait(`document.querySelector('[data-plugin-id=plugin-fixture-0] button')&&document.querySelector('[data-dialog-kind=plugin-details] [aria-busy=false]')`),'plugin refresh finishes after rollback');await click('[data-dialog-kind=plugin-details] .close-btn');
    await click('[data-plugin-id=plugin-fixture-0] button');await pluginButton('更新');assert(await wait(`document.querySelector('[data-dialog-kind=plugin-review]')`),'plugin update still opens an installation review');await click('[data-dialog-kind=plugin-review] .close-btn');
    await click('.plugin-library .capability-add');assert(await wait(`document.querySelector('[data-dialog-kind=plugin-review]')`),'plugin import still opens an installation review');await click('[data-dialog-kind=plugin-review] .close-btn');
    await click('.plugin-library .capability-icon-button[aria-label="插件来源"]');assert(await wait(`document.querySelector('[data-dialog-kind=plugin-sources]')`),'plugin source field is moved out of the main list');await type('[data-dialog-kind=plugin-sources] input','https://synthetic.invalid/plugins.json');await click('[data-dialog-kind=plugin-sources] .modal-actions button');assert(await wait(`!document.querySelector('[data-dialog-kind=plugin-sources]')`),'reviewed source loading returns to the list');
    await click('[data-plugin-id=plugin-fixture-0] button');await pluginButton('卸载');assert(await wait(`document.querySelector('[data-dialog-kind=confirm-action]')`),'plugin uninstall still requires explicit confirmation');await click('[data-dialog-kind=confirm-action] .btn-danger');assert(await wait(`!document.querySelector('[data-plugin-id=plugin-fixture-0]')`),'confirmed plugin uninstall refreshes the list');
    const verifyScroll=async(selector:string,label:string)=>{
      assert(await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return el.scrollHeight>el.clientHeight+10;})()`),label+' has real overflow');
      await js(`document.querySelector(${JSON.stringify(selector)}).scrollTop=120`);
      assert(await wait(`document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-scroll-active')`),label+' shows its scrollbar on actual scrolling');
      const width=await js(`document.querySelector(${JSON.stringify(selector)}).clientWidth`);
      assert(await js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}),'::-webkit-scrollbar-thumb').backgroundColor!=='rgba(0, 0, 0, 0)'`),label+' uses a visible thumb while scrolling');
      await new Promise(resolve=>setTimeout(resolve,1200));
      assert(await js(`!document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-scroll-active')&&getComputedStyle(document.querySelector(${JSON.stringify(selector)}),'::-webkit-scrollbar-thumb').backgroundColor==='rgba(0, 0, 0, 0)'`),label+' hides its thumb after inactivity');
      assert(await js(`document.querySelector(${JSON.stringify(selector)}).clientWidth===${width}`),label+' keeps layout stable when the thumb hides');
      await js(`document.querySelector(${JSON.stringify(selector)}).scrollTop=0`);assert(await wait(`document.querySelector(${JSON.stringify(selector)}).hasAttribute('data-scroll-active')`),label+' shows its thumb again on the next scroll');
    };
    await js(`document.documentElement.dataset.pluginCount='28'`);await click('.plugin-library .capability-icon-button[aria-label="刷新"]');assert(await wait(`document.querySelectorAll('.plugin-library .capability-item').length>20`),'long plugin fixture loads');await verifyScroll('.plugin-library .config-content','plugin list');await capture('plugins-scroll-active');
    for(const count of [1,3,24]){
      window.setContentSize(1440,900);await window.loadFile(path.join(output,'index.html'),{query:{'workbench-preview':'completed','model-count':String(count)}});
      assert(await wait(`document.querySelector('[data-nav-tab=settings]')`),'model fixture workbench loads');await click('[data-nav-tab=settings]');assert(await wait(`document.querySelector('[data-settings-section=model]')`),'model fixture settings open');await click('[data-settings-section=model]');
      assert(await wait(`document.querySelectorAll('.config-page-section .config-card').length===${count}`),'model list displays '+count+' providers');
      const measure=await js(`(()=>{const content=document.querySelector('.config-content-standalone'),main=content.closest('.main-content'),outer=main.closest('.workspace-panel-main');return {page:'models',count:${count},overflow:content.scrollHeight>content.clientHeight+1,outerOverflow:outer.scrollHeight>outer.clientHeight+1,gutter:getComputedStyle(content).scrollbarGutter};})()`);
      metrics.push(measure);assert(measure.overflow===(count===24)&&!measure.outerOverflow&&measure.gutter==='auto','model list only scrolls when its content does not fit: '+count);await capture('models-'+count);
      if(count===24)await verifyScroll('.config-content-standalone','model list');
    }
    window.setContentSize(980,520);await click('[data-settings-section=general]');assert(await wait(`document.querySelector('.settings-panel [role=combobox]')`),'general settings remain accessible in short windows');await click('.settings-panel [role=combobox]');assert(await wait(`document.querySelector('.custom-select-options')`),'short-window selector opens');await verifyScroll('.custom-select-options','selector menu');
    await js(`document.querySelector('[data-select-popover]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await verifyScroll('.settings-sidebar-menu','settings navigation');
    await click('[data-settings-section=skills]');assert(await wait(`document.querySelector('[data-skill-id=fixture-1]')`),'long skill fixture opens from the same list');await click('[data-skill-id=fixture-1] button');assert(await wait(`document.querySelector('[data-dialog-kind=skill-details] .skill-card-code')`),'long skill body opens in the shared dialog');await verifyScroll('[data-dialog-kind=skill-details] .skill-card-code','dialog code');
    await js(`(()=>{const el=document.querySelector('[data-dialog-kind=skill-details] .skill-card-code'),r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.right-1,clientY:r.top+10}));})()`);await new Promise(resolve=>setTimeout(resolve,1200));
    assert(await js(`document.querySelector('[data-dialog-kind=skill-details] .skill-card-code').hasAttribute('data-scroll-active')`),'scrollbar remains visible while its thumb is held');await js(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);await new Promise(resolve=>setTimeout(resolve,1200));assert(await js(`!document.querySelector('[data-dialog-kind=skill-details] .skill-card-code').hasAttribute('data-scroll-active')`),'releasing the scrollbar restores automatic hiding');await capture('dialog-scroll-idle');
    assert(errors.length===0,'renderer reports no errors');
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({success:true,checks,metrics,errors},null,2));app.exit(0);
  }catch(error){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({success:false,error:error instanceof Error?error.message:String(error),checks,metrics,errors},null,2));app.exit(1);}
});

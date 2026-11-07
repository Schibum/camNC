// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
export default async function run(page, { baseURL, outputDir }) {
 const output=outputDir;
 const report={suite:'Sketch basics pointer regressions',cases:[],errors:[],consoleErrors:[]};
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
 let current;
 const check=(name,passed,detail)=>{current.checks.push({name,passed,detail});if(!passed)throw Error(name);};
 const setup=async(name)=>{
  await page.goto(new URL('/cam', baseURL).href);
  await page.getByRole('button',{name:/^New design Sketch/}).click();
  const canvas=page.getByTestId('cad-canvas');await canvas.waitFor();
  current.jobId=new URL(page.url()).pathname.split('/')[2];
  const read=async()=>page.evaluate(async id=>{const moduleUrl=performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>name.includes('/src/cam/jobDb.ts')).at(-1);if(!moduleUrl)throw Error('No observed jobDb module');const {getJob}=await import(moduleUrl);return(await getJob(id))?.design?.draft;},current.jobId);
  const settle=async()=>{await page.waitForFunction(()=>{const status=document.querySelector('.cad-status')?.textContent;return status&&!/Checking|Saving/.test(status)&&document.querySelector('.cad-editor')?.getAttribute('aria-busy')!=='true';});};
  const screen=(x,y)=>canvas.evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},[x,y]);
  const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
  const key=async(key)=>canvas.press(key);
  const stop=async()=>{await key('Escape');await key('Escape');};
  const select=async()=>{await page.getByRole('button',{name:'Select (Esc)',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=menu]').length===0);};
  const snap=async(enabled)=>{const button=page.getByRole('button',{name:enabled?'Snap off':'Snap on',exact:true});if(await button.count())await button.click();};
  const tool=async(name)=>{await select();const family=/arc/i.test(name)||name==='Conic'?'Arc tools':/rectangle/i.test(name)?'Rectangle tools':'Spline tools';const compact=await page.getByRole('button',{name:'Drawing tools',exact:true}).count();await page.getByRole('button',{name:compact?'Drawing tools':family,exact:true}).click();await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=menu]').length===0);};
  const line=async(x1,y1,x2,y2)=>{await select();await key('l');await click(x1,y1);await click(x2,y2);await stop();};
  const circle=async(x,y,r)=>{await select();await key('c');await click(x,y);await click(x+r,y);await stop();};
  const drag=async(x,y,tx,ty,shift=false)=>{const a=await screen(x,y),b=await screen(tx,ty);if(shift)await page.keyboard.down('Shift');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();if(shift)await page.keyboard.up('Shift');await settle();};
  const undo=async()=>{await page.getByRole('button',{name:'Undo (Ctrl or Command Z)',exact:true}).click();await settle();};
  const redo=async()=>{await page.getByRole('button',{name:'Redo (Ctrl or Command Shift Z)',exact:true}).click();await settle();};
  const sketch=async()=>(await read()).parts[0].sketch;
  const state=async()=>({status:await page.locator('.cad-status').innerText(),fill:await canvas.locator('[data-sketch-region]').count(),canFinish:await page.getByRole('button',{name:/Finish sketch/}).isEnabled(),alerts:await page.locator('[role=alert]').allTextContents()});
  await page.getByRole('textbox',{name:'Part name',exact:true}).fill(name);await page.getByRole('textbox',{name:'Part name',exact:true}).press('Enter');await settle();
  return{canvas,read,settle,screen,click,key,stop,select,snap,tool,line,circle,drag,undo,redo,sketch,state};
 };
 const points=s=>new Map(s.entities.filter(e=>e.type==='point').map(e=>[e.id,e]));
 const curves=s=>s.entities.filter(e=>e.type!=='point');
 const near=(p,x,y)=>!!p&&Math.hypot(p.x-x,p.y-y)<.05;
 const run=async(name,fn)=>{current={name,checks:[]};report.cases.push(current);try{const ui=await setup(name);await fn(ui);current.final=await ui.read();current.state=await ui.state();}catch(error){current.failure=String(error);current.url=page.url();await page.screenshot({path:`${output}/app-final-basics-${report.cases.length}-failure.png`});}};

 await run('Connected lines, three-point arc, and standalone tangent arc',async ui=>{
  await ui.tool('Arc (A)');await ui.stop();check('Drawing menu remembers Arc after Select',await page.getByRole('button',{name:'Arc (A)',exact:true}).count()===1);
  await ui.tool('Tangent arc (Shift+A)');await ui.stop();check('Drawing menu remembers Tangent arc after Select',await page.getByRole('button',{name:'Tangent arc (Shift+A)',exact:true}).count()===1);
  await ui.key('l');await ui.click(20,20);await ui.click(100,20);await ui.key('a');await ui.click(130,50);await ui.click(120,25);await ui.key('l');await ui.click(130,100);await ui.stop();await ui.settle();
  let source=await ui.sketch(),lines=source.entities.filter(e=>e.type==='line'),arcs=source.entities.filter(e=>e.type==='arc'),map=points(source);
  check('L→A→L creates two lines and one arc',lines.length===2&&arcs.length===1,{lines:lines.length,arcs:arcs.length});
  check('Resumed line begins at the clicked arc end',near(map.get(lines[1].startId),130,50));
  await ui.tool('Tangent arc (Shift+A)');await ui.click(130,100);await ui.click(100,130);await ui.click(50,130);await ui.stop();await ui.settle();source=await ui.sketch();lines=source.entities.filter(e=>e.type==='line');arcs=source.entities.filter(e=>e.type==='arc');map=points(source);
  check('Standalone tangent arc starts from an existing endpoint and Line resumes',lines.length===3&&arcs.length===2&&near(map.get(lines[2].startId),100,130));
  check('Tangent arc and resumed line retain tangency',source.constraints.filter(c=>c.type==='tangent').length>=2,source.constraints.filter(c=>c.type==='tangent'));
  await page.screenshot({path:`${output}/app-final-basics-chain.png`});
 });

 await run('Circle with one explicit rim point trims the entire circle',async ui=>{
  await ui.circle(70,80,25);await ui.key('Shift+s');await ui.click(95,80);await ui.stop();await ui.settle();const before=await ui.sketch(),circle=before.entities.find(e=>e.type==='circle'),point=before.entities.find(e=>e.type==='point'&&e.standalone);
  check('Placed rim point retains point-on-circle intent',!!point&&before.constraints.some(c=>c.type==='pointOnCircle'&&c.pointId===point.id));
  await ui.key('m');await ui.click(70,105);await ui.stop();await ui.settle();const after=await ui.sketch();
  check('One boundary leaves no circle or arc',curves(after).length===0);
  check('Standalone rim point keeps its identity while implicit center is removed',after.entities.some(e=>e.id===point.id)&&!after.entities.some(e=>e.id===circle.centerId));
  await ui.undo();check('Undo restores the original circle and rim-point graph',JSON.stringify((await ui.sketch()).entities)===JSON.stringify(before.entities));await ui.redo();
  await page.screenshot({path:`${output}/app-final-basics-circle-one-point.png`});
 });

 await run('Circle with two rim points trims to a half arc, then to a quarter',async ui=>{
  await ui.circle(70,80,40);await ui.key('Shift+s');await ui.click(110,80);await ui.click(30,80);await ui.stop();await ui.settle();const before=await ui.sketch(),rim=before.entities.filter(e=>e.type==='point'&&e.standalone);
  await ui.key('m');await ui.click(70,120);await ui.stop();await ui.settle();let after=await ui.sketch(),arc=after.entities.find(e=>e.type==='arc');
  check('Two opposite rim points leave a true semicircular arc',!!arc&&Math.abs((arc.endAngle-arc.startAngle)-Math.PI)<1e-5,arc);
  check('Both original rim point IDs survive',rim.length===2&&rim.every(p=>after.entities.some(e=>e.id===p.id)));
  await ui.key('Shift+s');await ui.click(70,40);await ui.stop();await ui.settle();const middle=(await ui.sketch()).entities.find(e=>e.type==='point'&&e.standalone&&near(e,70,40));
  check('Added internal arc point is independently retained',!!middle);
  await ui.key('m');await ui.click(98.2842712475,51.7157287525);await ui.stop();await ui.settle();after=await ui.sketch();arc=after.entities.find(e=>e.type==='arc');
  check('Further point-aware trim leaves a true quarter arc',!!arc&&Math.abs((arc.endAngle-arc.startAngle)-Math.PI/2)<1e-5,arc);
  check('Quarter arc retains the added point as its endpoint and all standalone points',!!arc&&[arc.startId,arc.endId].includes(middle.id)&&after.entities.filter(e=>e.type==='point'&&e.standalone).length===3);
  await page.screenshot({path:`${output}/app-final-basics-circle-quarter.png`});
 });

 await run('Line with an explicit midpoint trims one half and preserves horizontal intent',async ui=>{
  await ui.line(20,40,180,40);await ui.key('Shift+s');await ui.click(100,40);await ui.stop();await ui.settle();const before=await ui.sketch(),line=before.entities.find(e=>e.type==='line'),middle=before.entities.find(e=>e.type==='point'&&e.standalone);
  check('Middle point has a persistent midpoint relation',!!middle&&before.constraints.some(c=>c.type==='midpoint'&&c.pointId===middle.id));
  await ui.key('m');await ui.click(140,40);await ui.stop();await ui.settle();const after=await ui.sketch(),retained=after.entities.find(e=>e.id===line.id),map=points(after);
  check('Only the clicked half disappears and retained endpoint IDs stay stable',retained?.startId===line.startId&&retained?.endId===middle.id&&near(map.get(retained.endId),100,40));
  check('Horizontal remains and old midpoint equation is removed',after.constraints.some(c=>c.type==='horizontal'&&c.entityId===line.id)&&!after.constraints.some(c=>c.type==='midpoint'&&c.pointId===middle.id));
  await ui.undo();check('One Undo restores pre-trim source graph',JSON.stringify((await ui.sketch()).entities)===JSON.stringify(before.entities));await ui.redo();
  await page.screenshot({path:`${output}/app-final-basics-line-midpoint.png`});
 });

 await run('Dragging endpoints creates a persistent join that follows both lines',async ui=>{
  await ui.snap(false);await ui.line(20,20,70,50);await ui.line(130,90,180,50);await ui.snap(true);await ui.settle();const before=await ui.sketch(),lines=before.entities.filter(e=>e.type==='line');
  await ui.drag(70,50,129,91);let source=await ui.sketch(),map=points(source);
  check('Near-target endpoint drag adds coincidence using original IDs',source.constraints.some(c=>c.type==='coincident'&&[c.pointAId,c.pointBId].includes(lines[0].endId)&&[c.pointAId,c.pointBId].includes(lines[1].startId)));
  check('Joined endpoints reach the same position',near(map.get(lines[0].endId),130,90)&&near(map.get(lines[1].startId),130,90));
  await ui.drag(130,90,145,110);source=await ui.sketch();map=points(source);
  check('Dragging the joint moves both source endpoints',near(map.get(lines[0].endId),145,110)&&near(map.get(lines[1].startId),145,110));
  await page.screenshot({path:`${output}/app-final-basics-persistent-drag-join.png`});
  await ui.undo();source=await ui.sketch();map=points(source);check('One Undo restores the joined position without removing the relation',near(map.get(lines[0].endId),130,90)&&source.constraints.some(c=>c.type==='coincident'));
  await ui.undo();source=await ui.sketch();check('Second Undo removes only the join command and restores the disconnected source',JSON.stringify(source.entities)===JSON.stringify(before.entities)&&source.constraints.length===before.constraints.length);
 });

 await run('Window and crossing marquee selection with additive Shift',async ui=>{
  await ui.snap(false);await ui.line(30,50,60,50);await ui.line(10,70,120,70);await ui.line(170,50,210,50);await ui.settle();const before=await ui.sketch(),lines=before.entities.filter(e=>e.type==='line');
  await ui.drag(20,40,80,80);await page.screenshot({path:`${output}/app-final-basics-window-selection.png`});await ui.key('Delete');await ui.settle();let source=await ui.sketch();
  check('Left-to-right window selects only the completely contained line',curves(source).length===2&&!source.entities.some(e=>e.id===lines[0].id)&&source.entities.some(e=>e.id===lines[1].id));
  await ui.undo();await ui.drag(80,80,20,40);await page.screenshot({path:`${output}/app-final-basics-crossing-selection.png`});await ui.key('Delete');await ui.settle();source=await ui.sketch();
  check('Right-to-left crossing selects both intersecting lines',curves(source).length===1&&source.entities.some(e=>e.id===lines[2].id));
  await ui.undo();await page.keyboard.down('Shift');await ui.click(190,50);await page.keyboard.up('Shift');await ui.drag(20,40,80,80,true);await ui.key('Delete');await ui.settle();source=await ui.sketch();
  check('Shift adds window results to the existing distant line selection',curves(source).length===1&&source.entities.some(e=>e.id===lines[1].id));
  await ui.undo();check('One Undo restores both deleted curves without endpoint cascade',JSON.stringify((await ui.sketch()).entities)===JSON.stringify(before.entities));
 });

 await run('Closed regions remain gray with nested circles, overlaps, and open geometry',async ui=>{
  await ui.key('g');await ui.click(10,10);await ui.click(220,140);await ui.stop();await ui.circle(70,70,40);await ui.line(180,155,235,160);await ui.settle();
  const fillAt=(x,y)=>ui.canvas.evaluate((svg,p)=>[...svg.querySelectorAll('[data-sketch-region]')].some(path=>path.isPointInFill(new DOMPoint(p[0],-p[1]))),[x,y]);
  check('Rectangle body and inner circular face both shade while an unrelated line is open',await fillAt(25,25)&&await fillAt(70,70),await ui.state());
  check('Open extra geometry keeps strict CAM Finish blocked',!(await ui.state()).canFinish);
  await ui.circle(70,70,20);await ui.circle(205,80,45);await ui.settle();
  check('Nested circles all remain gray as independent bounded CAD faces',await fillAt(70,70)&&await fillAt(70,100)&&await fillAt(70,120));
  check('Overlapping rectangle/circle faces shade inside and outside the rectangle',await fillAt(205,80)&&await fillAt(240,80));
  check('Detached line does not manufacture a filled region',!await fillAt(210,155));
  await page.screenshot({path:`${output}/app-final-basics-regions-nested-overlap-open.png`});
 });

 await run('Rectangle multi-corner fillet shares R12 and accepts one Undo',async ui=>{
  await ui.key('g');await ui.click(20,20);await ui.click(180,120);await ui.stop();await ui.settle();const original=await ui.sketch();
  const corner=original.entities.find(e=>e.type==='point'&&near(e,180,120)),start=await ui.screen(180,120),target=await ui.screen(190,125);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});
  try{await page.waitForFunction(id=>{const p=document.querySelector(`circle.cad-point[data-entity-id="${id}"]`);return p&&Math.abs(Number(p.getAttribute('cx'))-190)<.05&&Math.abs(Number(p.getAttribute('cy'))+125)<.05;},corner.id);check('Solved closed-region preview stays gray while the real point drag is still held',await ui.canvas.locator('[data-sketch-region]').count()>0);await page.screenshot({path:`${output}/app-final-basics-region-during-drag.png`});}finally{await page.mouse.up();}await ui.settle();await ui.undo();
  check('Point drag remains one Undo without changing source identities',JSON.stringify((await ui.sketch()).entities)===JSON.stringify(original.entities));
  await ui.key('Control+a');await ui.key('Shift+f');await ui.settle();check('Fillet preview does not publish source geometry',JSON.stringify((await ui.sketch()).entities)===JSON.stringify(original.entities));
  await ui.key('Enter');const radius=page.getByRole('textbox',{name:'Fillet radius',exact:true});check('Enter focuses the shared radius field',await radius.evaluate(e=>e===document.activeElement));await radius.fill('12');await radius.press('Enter');await ui.settle();let source=await ui.sketch();
  const arcs=source.entities.filter(e=>e.type==='arc');check('All four fillets share radius12 and one driving dimension',arcs.length===4&&arcs.every(arc=>Math.abs(arc.radius-12)<.001)&&source.constraints.filter(c=>c.type==='radius').length===1&&source.constraints.filter(c=>c.type==='equal').length===3);
  check('Filleted rectangle remains closed, shaded, and CAM-valid',(await ui.state()).fill>0&&(await ui.state()).canFinish,await ui.state());await page.screenshot({path:`${output}/app-final-basics-four-fillets-r12.png`});
  await ui.undo();source=await ui.sketch();check('One Undo restores original sharp rectangle UUIDs and constraints',JSON.stringify(source.entities)===JSON.stringify(original.entities)&&JSON.stringify(source.constraints)===JSON.stringify(original.constraints));await ui.redo();
 });
 return report;
}

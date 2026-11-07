// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
export default async function run(page, { baseURL, outputDir }) {
 const output=outputDir;
 const report={suite:'Responsive sketch tool families',checks:[],widths:[],errors:[],consoleErrors:[]};
 page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
 const check=(name,passed,detail)=>{report.checks.push({name,passed,detail});if(!passed)throw Error(name);};
 const canvas=()=>page.getByTestId('cad-canvas');
 const select=async()=>{await page.getByRole('button',{name:'Select (Esc)',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=menu]').length===0);};
 const resize=async width=>{await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>{const e=document.querySelector('.cad-toolbar');return e&&e.dataset.toolbarLayout===(e.clientWidth<720?'compact':'families');});};
 const inspect=async width=>{
  const state=await page.locator('.cad-toolbar').evaluate(header=>{const bounds=header.getBoundingClientRect(),drawing=header.querySelector('.cad-drawing-tools');return{width:bounds.width,height:bounds.height,layout:header.dataset.toolbarLayout,overflow:header.scrollWidth>header.clientWidth,drawingOverflow:drawing.scrollWidth>drawing.clientWidth,buttons:[...header.querySelectorAll('button')].map(button=>{const box=button.getBoundingClientRect();return{name:button.getAttribute('aria-label'),x:box.x,right:box.right,width:box.width,visible:box.width>0&&box.height>0,inside:box.x>=bounds.x-.5&&box.right<=bounds.right+.5&&box.y>=bounds.y-.5&&box.bottom<=bounds.bottom+.5};})};});
  report.widths.push({viewport:width,...state});
  check(`At ${width}px all session actions remain visible and inside the toolbar`,state.buttons.filter(button=>/Undo|Redo|Cancel|Finish/.test(button.name)).every(button=>button.visible&&button.inside),state);
  check(`At ${width}px the toolbar remains one row without clipping`,Math.abs(state.height-40)<1&&!state.overflow&&!state.drawingOverflow,state);
  if(state.layout==='families'){
   check(`At ${width}px sketch families and separate Fillet/Trim are available`,(await page.getByRole('button',{name:'Rectangle tools',exact:true}).count())===1&&(await page.getByRole('button',{name:'Arc tools',exact:true}).count())===1&&(await page.getByRole('button',{name:'Spline tools',exact:true}).count())===1&&(await page.getByRole('button',{name:'Sketch fillet (Shift+F)',exact:true}).count())===1&&(await page.getByRole('button',{name:'Trim (M)',exact:true}).count())===1&&(await page.getByRole('button',{name:'Drawing tools',exact:true}).count())===0);
  }else check(`At ${width}px compact drawing and modify menus replace the families`,await page.getByRole('button',{name:'Drawing tools',exact:true}).count()===1&&await page.getByRole('button',{name:'Modify tools',exact:true}).count()===1);
  return state;
 };
 try{
  await page.goto(new URL('/cam', baseURL).href);await page.getByRole('button',{name:/^New design Sketch/}).click();await canvas().waitFor();
  await page.getByRole('textbox',{name:'Part name',exact:true}).fill('Responsive toolbar fixture');await page.getByRole('textbox',{name:'Part name',exact:true}).press('Enter');
  await resize(1920);await inspect(1920);
  await page.getByRole('button',{name:'Trim tools',exact:true}).click();
  for(const name of ['Trim (M)','Extend (X)'])check(`Trim family contains ${name}`,await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name,exact:true}).count()===1);
  await page.keyboard.press('Escape');
  for(const name of ['Offset (O)','Mirror'])check(`Wide toolbar exposes ${name}`,await page.getByRole('button',{name,exact:true}).count()===1);
  await page.getByRole('button',{name:'Arc tools',exact:true}).click();
  for(const name of ['Arc (A)','Tangent arc (Shift+A)','Conic'])check(`Arc family contains ${name}`,await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name,exact:true}).count()===1);
  check('Arc family does not contain Spline',await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Spline',exact:true}).count()===0);
  await page.screenshot({animations:'disabled',path:`${output}/app-final-responsive-1920-arc-menu.png`});
  await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Tangent arc (Shift+A)',exact:true}).click();await select();
  await resize(1280);await inspect(1280);check('Tangent arc remains the Arc family primary after resizing',await page.getByRole('button',{name:'Tangent arc (Shift+A)',exact:true}).count()===1);
  await page.getByRole('button',{name:'Spline tools',exact:true}).click();
  for(const name of ['Spline','Bezier','Spline control point'])check(`Spline family contains ${name}`,await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name,exact:true}).count()===1);
  check('Spline family does not contain Conic',await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Conic',exact:true}).count()===0);
  await page.screenshot({animations:'disabled',path:`${output}/app-final-responsive-1280-spline-menu.png`});await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Bezier',exact:true}).click();await select();
  for(const width of [955,673,520]){await resize(width);await inspect(width);await page.mouse.move(40,40);await page.screenshot({animations:'disabled',path:`${output}/app-final-responsive-${width}.png`});}
  await page.getByRole('button',{name:'Drawing tools',exact:true}).click();await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Conic',exact:true}).click();await select();
  await resize(1920);await inspect(1920);check('Expanding restores Conic in Arc and Bezier in Spline independently',await page.getByRole('button',{name:'Conic',exact:true}).count()===1&&await page.getByRole('button',{name:'Bezier',exact:true}).count()===1);
  await canvas().press('r');await canvas().press('Escape');check('Keyboard R updates only Rectangle family to Center rectangle',await page.getByRole('button',{name:'Center rectangle (R)',exact:true}).count()===1&&await page.getByRole('button',{name:'Conic',exact:true}).count()===1&&await page.getByRole('button',{name:'Bezier',exact:true}).count()===1);
  await page.getByRole('button',{name:'Arc tools',exact:true}).focus();await page.keyboard.press('ArrowDown');await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Arc (A)',exact:true}).waitFor();await page.keyboard.press('End');await page.locator('[role=menu][data-state=open]').getByRole('menuitem',{name:'Conic',exact:true}).press('Enter');await select();
  check('Keyboard opens and activates the Arc menu without changing unrelated family memory',await page.getByRole('button',{name:'Conic',exact:true}).count()===1&&await page.getByRole('button',{name:'Bezier',exact:true}).count()===1);
  await page.mouse.move(40,40);await page.screenshot({animations:'disabled',path:`${output}/app-final-responsive-1920-remembered.png`});
 }catch(error){report.failure=String(error);report.url=page.url();await page.screenshot({animations:'disabled',path:`${output}/app-final-responsive-failure.png`});}
 return report;
}

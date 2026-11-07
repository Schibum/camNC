// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
import path from 'node:path';
export default async function run(page, { baseURL, outputDir }) {
 const result={case:"conic",checks:[]};
 const canvas=()=>page.getByTestId("cad-canvas");
 const world=async(x,y)=>canvas().evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},[x,y]);
 const click=async(x,y)=>{const p=await world(x,y);await page.mouse.click(p.x,p.y);};
 const drag=async(x,y,tx,ty)=>{const p=await world(x,y),q=await world(tx,ty);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:12});await page.mouse.up();};
 const points=()=>canvas().locator("circle.cad-point").evaluateAll(list=>list.map(e=>({id:e.getAttribute("data-entity-id"),x:Number(e.getAttribute("cx")),y:-Number(e.getAttribute("cy")),fill:e.getAttribute("fill")})));
 await page.goto(new URL('/cam', baseURL).href);await page.getByRole("button",{name:/^New design Sketch/}).click();await canvas().waitFor();
 await page.getByRole("textbox",{name:"Part name",exact:true}).fill("Conic study");await page.getByRole("textbox",{name:"Part name",exact:true}).press("Enter");await page.getByRole("button",{name:"Snap on",exact:true}).click();
 await page.getByRole("button",{name:"Arc tools",exact:true}).click();await page.getByRole("menuitem",{name:"Conic",exact:true}).click();
 await click(20,20);await click(120,20);await click(70,80);
 const rho=page.getByRole("textbox",{name:"Conic rho",exact:true});await rho.waitFor();if(!await rho.evaluate(e=>e===document.activeElement))throw Error("Conic rho did not autofocus");result.checks.push("rho autofocus");
 await rho.fill("0.7");await rho.press("Enter");await page.getByRole("button",{name:"Edit conic rho: 0.7",exact:true}).waitFor();result.checks.push("rho0.7 applied");
 await drag(70,80,70,100);await page.waitForFunction(()=>[...document.querySelectorAll("circle.cad-point")].some(e=>Math.abs(Number(e.getAttribute("cx"))-70)<.01&&Math.abs(Number(e.getAttribute("cy"))+100)<.01),null,{timeout:10000});result.controlDrag=await points();result.checks.push("control drag");
 await page.getByRole("button",{name:"Edit conic rho: 0.7",exact:true}).dblclick();await rho.fill("0.6");await rho.press("Enter");await page.getByRole("button",{name:"Edit conic rho: 0.6",exact:true}).waitFor();await canvas().press("Control+z");await page.getByRole("button",{name:"Edit conic rho: 0.7",exact:true}).waitFor();await canvas().press("Control+Shift+z");await page.getByRole("button",{name:"Edit conic rho: 0.6",exact:true}).waitFor();result.checks.push("existing rho edit Undo Redo");
 await canvas().press("l");await click(120,20);await click(20,20);await canvas().press("Escape");await page.getByRole("button",{name:"✓ Finish sketch",exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector(".cad-toolbar button[aria-label='✓ Finish sketch']")?.hasAttribute("disabled"),null,{timeout:10000});
 if(await canvas().locator("[data-sketch-region]").count()!==1)throw Error("Conic profile has no closed region");result.checks.push("closed conic region");
 await page.screenshot({path:path.join(outputDir, 'app-conic-final-closed.png')});
 await page.getByRole("button",{name:"✓ Finish sketch",exact:true}).click();await page.waitForURL(/\/boards/);result.checks.push("Finish accepted");await page.getByRole("link",{name:"1 Design",exact:true}).click();await canvas().waitFor();await page.getByRole("button",{name:"Edit conic rho: 0.6",exact:true}).waitFor();await canvas().locator("[data-sketch-region]").waitFor();if(await canvas().locator("[data-sketch-region]").count()!==1)throw Error("Conic source region lost on reentry");result.checks.push("source reentry");await page.screenshot({path:path.join(outputDir, 'app-conic-final-reentered.png')});result.url=page.url();result.status=await page.getByRole("contentinfo").textContent();return result;
}

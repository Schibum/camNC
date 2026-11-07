// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
import path from 'node:path';
export default async function run(page, { baseURL, outputDir }) {
 const canvas=()=>page.getByTestId("cad-canvas");
 const world=async(x,y)=>canvas().evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},[x,y]);
 const click=async(x,y)=>{const p=await world(x,y);await page.mouse.click(p.x,p.y);};
 const drag=async(x,y,tx,ty)=>{const p=await world(x,y),q=await world(tx,ty);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:12});await page.mouse.up();};
 const points=()=>canvas().locator("circle.cad-point").evaluateAll(list=>list.map(e=>({id:e.getAttribute("data-entity-id"),x:Number(e.getAttribute("cx")),y:-Number(e.getAttribute("cy")),fill:e.getAttribute("fill")})));
 const tool=async(name)=>{await page.getByRole("button",{name:"Spline tools",exact:true}).click();await page.getByRole("menuitem",{name,exact:true}).click();await page.getByRole("menu",{name:"Spline tools",exact:true}).waitFor({state:"hidden"});};
 await page.goto(new URL('/cam', baseURL).href);await page.getByRole("button",{name:/^New design Sketch/}).click();await canvas().waitFor();
 await page.getByRole("textbox",{name:"Part name",exact:true}).fill("Bezier study");await page.getByRole("textbox",{name:"Part name",exact:true}).press("Enter");await page.getByRole("button",{name:"Snap on",exact:true}).click();await tool("Bezier");
 for(const [x,y] of [[20,20],[45,90],[95,65],[130,20]])await click(x,y);const end=await world(130,20);await page.mouse.dblclick(end.x,end.y);await canvas().locator("[data-control-polygon]").waitFor();let before=await points();if(before.filter(p=>p.fill==="#fff").length!==4)throw Error("Bezier did not expose four white controls");
 const handle=before.find(p=>Math.hypot(p.x-45,p.y-90)<.02);await drag(45,90,40,105);await page.waitForFunction(id=>{const e=document.querySelector(`circle.cad-point[data-entity-id="${id}"]`);return e&&Math.abs(Number(e.getAttribute("cy"))+105)<.02;},handle.id);let after=await points();for(const p of before){if(p.id===handle.id)continue;const q=after.find(q=>q.id===p.id);if(!q||Math.hypot(p.x-q.x,p.y-q.y)>.02)throw Error("Other Bezier control moved");}
 await page.screenshot({path:path.join(outputDir, 'app-bezier-control-edited.png')});
 await tool("Spline control point");await click(67.5,85);

 await page.waitForFunction(()=>[...document.querySelectorAll("circle.cad-point")].filter(e=>e.getAttribute("fill")==="#fff").length===5);await page.screenshot({path:path.join(outputDir, 'app-bezier-polygon-added-control.png')});
 await canvas().press("Control+z");await page.waitForFunction(()=>[...document.querySelectorAll("circle.cad-point")].filter(e=>e.getAttribute("fill")==="#fff").length===4);await canvas().press("Control+Shift+z");await page.waitForFunction(()=>[...document.querySelectorAll("circle.cad-point")].filter(e=>e.getAttribute("fill")==="#fff").length===5);
 await canvas().press("l");await click(130,20);await click(20,20);await canvas().press("Escape");await page.waitForFunction(()=>document.querySelector(".cad-finish")&&!document.querySelector(".cad-finish").disabled,null,{timeout:10000});if(await canvas().locator("[data-sketch-region]").count()!==1)throw Error("Bezier closed source region missing");await page.screenshot({path:path.join(outputDir, 'app-bezier-final-closed.png')});
 await page.getByRole("button",{name:"✓ Finish sketch",exact:true}).click();await page.waitForURL(/\/boards/);await page.getByRole("link",{name:"1 Design",exact:true}).click();await canvas().waitFor();await canvas().locator("[data-control-polygon]").waitFor();await canvas().locator("[data-sketch-region]").waitFor();if(await canvas().locator("[data-sketch-region]").count()!==1)throw Error("Bezier source lost on reentry");await page.screenshot({path:path.join(outputDir, 'app-bezier-final-reentered.png')});
}

// Real-pointer browser regression recipe; see ../README.md for coverage and run instructions.
import path from 'node:path';
export default async function run(page, { baseURL, outputDir }) {
 const canvas=()=>page.getByTestId("cad-canvas");
 const world=async(x,y)=>canvas().evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},[x,y]);
 const click=async(x,y)=>{const p=await world(x,y);await page.mouse.click(p.x,p.y);};
 await page.goto(new URL('/cam', baseURL).href);await page.getByRole("button",{name:/^New design Sketch/}).click();await canvas().waitFor();
 await page.getByRole("textbox",{name:"Part name",exact:true}).fill("Closed spline study");await page.getByRole("textbox",{name:"Part name",exact:true}).press("Enter");await page.getByRole("button",{name:"Snap on",exact:true}).click();
 await page.getByRole("button",{name:"Spline tools",exact:true}).click();await page.getByRole("menuitem",{name:"Spline",exact:true}).click();
 for(const [x,y] of [[50,20],[100,50],[60,100],[20,65],[50,20]])await click(x,y);const end=await world(50,20);await page.mouse.dblclick(end.x,end.y);await canvas().locator("[data-sketch-region]").waitFor();
 if(await canvas().locator(".cad-entity").count()!==1)throw Error("Closed spline should be one analytic curve");
 const source=await world(50,20),target=await world(45,10);await page.mouse.move(source.x,source.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();await page.waitForFunction(()=>[...document.querySelectorAll("circle.cad-point")].some(e=>Math.hypot(Number(e.getAttribute("cx"))-45,-Number(e.getAttribute("cy"))-10)<.02));await canvas().locator("[data-sketch-region]").waitFor();await page.screenshot({path:path.join(outputDir, 'app-spline-periodic-seam-edited.png')});
 await page.getByRole("button",{name:"✓ Finish sketch",exact:true}).click();await page.waitForURL(/\/boards/);await page.getByRole("link",{name:"1 Design",exact:true}).click();await canvas().locator("[data-sketch-region]").waitFor();if(await canvas().locator(".cad-entity").count()!==1)throw Error("Periodic source changed on reentry");await page.screenshot({path:path.join(outputDir, 'app-spline-periodic-reentered.png')});
}

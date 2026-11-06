export function selectPosition(rect:{left:number;right:number;top:number;bottom:number;width:number},viewport:{width:number;height:number},preferred:'top'|'bottom',align:'start'|'end'='start'){
 const gap=6,pad=10;const width=Math.min(Math.max(rect.width,220),Math.max(1,viewport.width-pad*2));
 const above=Math.max(0,rect.top-pad-gap),below=Math.max(0,viewport.height-rect.bottom-pad-gap);
 const placement=preferred==='top'?(above>=240||above>below?'top':'bottom'):(below>=240||below>=above?'bottom':'top');
 const maxHeight=Math.max(1,Math.min(340,placement==='top'?above:below));
 return {left:Math.max(pad,Math.min(align==='end'?rect.right-width:rect.left,viewport.width-width-pad)),width,maxHeight,top:placement==='bottom'?Math.max(pad,rect.bottom+gap):undefined,bottom:placement==='top'?viewport.height-rect.top+gap:undefined,placement};
}

import { chromium } from 'playwright';
const file = process.argv[2];
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1600,height:1400},deviceScaleFactor:1})).newPage();
await p.goto('file://' + file, {waitUntil:'load'});
await p.waitForTimeout(6000);
const out = await p.evaluate(() => {
  const res = [];
  const walk = (el, depth, path) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.tagName !== 'SPAN') return;
    const cs = getComputedStyle(el);
    const txt = Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
    res.push([depth, el.tagName, path,
      Math.round(r.width*100)/100+'x'+Math.round(r.height*100)/100+'@'+Math.round(r.x*100)/100+','+Math.round(r.y*100)/100,
      cs.position, cs.display, cs.borderRadius, cs.padding, cs.margin, cs.border, cs.background.slice(0,120),
      cs.font, cs.color, cs.letterSpacing, cs.gap, cs.flex, cs.top+'|'+cs.right+'|'+cs.bottom+'|'+cs.left,
      cs.width+'|'+cs.height, cs.backdropFilter, cs.boxShadow.slice(0,140), cs.overflow, cs.alignItems, cs.justifyContent,
      cs.gridTemplateColumns, cs.textAlign, cs.boxSizing,
      JSON.stringify(txt)].join(' :: '));
    let i = 0;
    for (const c of el.children) walk(c, depth+1, path+'/'+c.tagName+'['+(i++)+']');
  };
  walk(document.body, 0, 'body');
  return res.join('\n');
});
console.log(out);
await b.close();

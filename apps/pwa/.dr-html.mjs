import { chromium } from 'playwright';
const file = process.argv[2];
const sel = process.argv[3];
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1600,height:1400}})).newPage();
await p.goto('file://' + file, {waitUntil:'load'});
await p.waitForTimeout(6000);
const out = await p.evaluate((sel) => {
  const path = sel.split('/').slice(1);
  let el = document.body;
  for (const seg of path) {
    const m = seg.match(/^(\w+|svg)\[(\d+)\]$/);
    el = el.children[Number(m[2])];
  }
  return el.outerHTML;
}, sel);
console.log(out);
await b.close();

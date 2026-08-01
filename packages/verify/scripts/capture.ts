import { capture } from "../src/capture.ts";

const [url, outPath, vp, selector] = process.argv.slice(2);
if (!url || !outPath || !vp) {
  console.error("Usage: capture <url> <outPath> <WxH> [selector]");
  process.exit(2);
}
const viewportMatch = /^(\d+)x(\d+)$/.exec(vp);
const w = Number(viewportMatch?.[1]);
const h = Number(viewportMatch?.[2]);
if (!viewportMatch || !Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0) {
  console.error(`Invalid viewport ${vp}`);
  process.exit(2);
}

const result = await capture({
  url,
  outPath,
  viewportSize: { width: w, height: h },
  selector,
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

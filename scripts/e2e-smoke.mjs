#!/usr/bin/env node
// Smoke: health/pricing/manifest/supported + gateway helpers (no DB, no network).
import app from "../src/worker.ts";
import { parseRange, parsePosting } from "../gateway/nntp-gateway.mjs";

const env = { PAY_TO: "1DHBH964yuvJnneuUe7EKFpVyJK1Vkz8Y4", RATE_LIMIT_PER_MIN: "0" };
const checks = [
  ["/health", 200],
  ["/pricing", 200],
  ["/api/manifest", 200],
  ["/supported", 307],
  ["/facilitator/supported", 200],
];
let fail = 0;
for (const [path, want] of checks) {
  const res = await app.request(path, {}, env);
  const ok = res.status === want;
  console.log(`${ok ? "ok" : "FAIL"} ${path} -> ${res.status} (want ${want})`);
  if (!ok) fail++;
}
const j = await (await app.request("/pricing", {}, env)).json();
console.log(`prices: groupCreate=${j.prices.groupCreate} postDefault=${j.prices.postDefault} relay=${j.prices.relay}`);
if (JSON.stringify(parseRange("1-3", 5)) !== "[1,2,3]") {
  console.log("FAIL parseRange");
  fail++;
}
if (parsePosting("Newsgroups: bsv.devs\nSubject: t\n\nb").group !== "bsv.devs") {
  console.log("FAIL parsePosting");
  fail++;
}
console.log(fail === 0 ? "smoke: PASS" : `smoke: ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);

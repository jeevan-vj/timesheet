import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const severity=['low','medium','high','protected'];
const matches=(file,group)=>group.exact.includes(file)||group.prefixes.some((prefix)=>file.startsWith(prefix));
export function classifyRisk(files,policy){let current='low';for(const file of files){let fileRisk=matches(file,policy.low)?'low':policy.default;for(const candidate of ['medium','high','protected'])if(matches(file,policy[candidate])&&severity.indexOf(candidate)>severity.indexOf(fileRisk))fileRisk=candidate;if(severity.indexOf(fileRisk)>severity.indexOf(current))current=fileRisk;if(current==='protected')break;}return current;}
export function loadPolicy(policyPath=new URL('./risk-policy.json',import.meta.url)){return JSON.parse(fs.readFileSync(policyPath,'utf8'));}
async function main(){const self=fileURLToPath(import.meta.url);if(process.argv[1]&&path.resolve(process.argv[1])!==path.resolve(self))return;let files=process.argv.slice(2).filter(Boolean);if(!files.length&&!process.stdin.isTTY){let input='';for await(const chunk of process.stdin)input+=chunk;files=input.split(/\r?\n/).filter(Boolean);}process.stdout.write(`${classifyRisk(files,loadPolicy())}\n`);}
await main();

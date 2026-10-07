import fs from "node:fs";
import readline from "node:readline";

const file = process.argv[2];
if (!file) throw new Error("Usage: node diagnose-phase7c-sideway-counterfactual.mjs <live-sideway-decisions.jsonl>");
if (!fs.existsSync(file)) throw new Error(`Audit file not found: ${file}`);

const now = Date.now();
const all = [];
const input = fs.createReadStream(file,{encoding:"utf8"});
const lines = readline.createInterface({input,crlfDelay:Infinity});

function finite(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function condMap(raw){
  const rows=Array.isArray(raw?.entryConditions?.conditions)?raw.entryConditions.conditions:[];
  return new Map(rows.map(r=>[String(r?.id??""),{
    enabled:r?.enabled===true,
    mandatory:r?.mandatory===true,
    status:String(r?.status??""),
    observed:r?.observed??null
  }]).filter(([id])=>id));
}
function initialEval(row){
  if(row.event==="ENTRY_STRATEGY_CONDITIONS_PASS") return true;
  return row.event==="ENTRY_STRATEGY_CONDITION_BLOCK" && String(row.raw?.phase??"").toUpperCase()!=="FINAL_GATE";
}
for await (const line of lines){
  if(!line.trim()) continue;
  let p; try{p=JSON.parse(line);}catch{continue;}
  const timestamp=finite(p?.timestamp);
  if(timestamp===null || timestamp>now || timestamp<now-90*24*60*60_000) continue;
  all.push({
    timestamp,
    event:String(p?.event??"UNKNOWN"),
    raw:p?.raw&&typeof p.raw==="object"?p.raw:{}
  });
}

const conditionIds=[
  "rangingRegime",
  "recommendedModeSideway",
  "minimumRegimeConfidence",
  "supplyDemandRange",
  "rangeEdge",
  "m5Confirmation"
];
const variants=[
  {name:"BASELINE_ALL_6", disabled:new Set()},
  {name:"NO_RECOMMENDED_MODE", disabled:new Set(["recommendedModeSideway"])},
  {name:"NO_M5_CONFIRMATION", disabled:new Set(["m5Confirmation"])},
  {name:"NO_RECOMMENDED_AND_M5", disabled:new Set(["recommendedModeSideway","m5Confirmation"])},
  {name:"NO_RANGING_KEEP_RECOMMENDED", disabled:new Set(["rangingRegime"])}
];

function dedupeInitial(windowRows){
  const byClose=new Map();
  let fallback=0;
  for(const row of windowRows.filter(initialEval)){
    const close=finite(row.raw?.closeTime);
    const key=close!==null?`C:${close}`:`F:${row.timestamp}:${fallback++}`;
    const prev=byClose.get(key);
    if(!prev || row.timestamp>=prev.timestamp) byClose.set(key,row);
  }
  return [...byClose.values()];
}
function variantPass(row,variant){
  const map=condMap(row.raw);
  if(!map.size) return false;
  for(const id of conditionIds){
    const c=map.get(id);
    if(!c) return false;
    const effectivelyEnabled=c.mandatory || (c.enabled && !variant.disabled.has(id));
    if(effectivelyEnabled && c.status!=="PASS") return false;
  }
  return true;
}
function fmtPct(n,d){return d?(100*n/d).toFixed(2):"0.00";}

function downstreamFor(closeTime,windowRows){
  const related=windowRows.filter(r=>finite(r.raw?.closeTime)===closeTime);
  return related.filter(r=>[
    "ENTRY_PLAN_BLOCK",
    "ENTRY_STRATEGY_CONDITION_BLOCK",
    "ENTRY_FINAL_GATE_BLOCK",
    "ENTRY_FINAL_PLAN_BLOCK",
    "ENTRY_AUTO_LOT_BLOCK",
    "ENTRY_SUBMIT",
    "ENTRY_FILLED"
  ].includes(r.event));
}
function blockDetail(row){
  if(row.event==="ENTRY_PLAN_BLOCK" || row.event==="ENTRY_FINAL_PLAN_BLOCK"){
    return {
      reason:row.raw?.plan?.reason??row.raw?.reason??null,
      stopDistance:row.raw?.plan?.stopDistance??row.raw?.plan?.structuralStopDistance??null,
      side:row.raw?.side??null,
      plan:row.raw?.plan??null
    };
  }
  if(row.event==="ENTRY_AUTO_LOT_BLOCK"){
    return {
      reason:row.raw?.validation?.reason??row.raw?.validation?.reasonCode??row.raw?.reason??null,
      stopDistance:row.raw?.stopDistance??null,
      recommendedLot:row.raw?.validation?.recommendedLot??row.raw?.preview?.recommendedLot??null,
      validation:row.raw?.validation??null
    };
  }
  return {reason:row.raw?.reason??null};
}

for(const days of [7,30,90]){
  const cutoff=now-days*24*60*60_000;
  const windowRows=all.filter(r=>r.timestamp>=cutoff);
  const evals=dedupeInitial(windowRows);
  console.log(`SIDEWAY_CF_${days}D_EVALS=${evals.length}`);

  for(const variant of variants){
    const passed=evals.filter(row=>variantPass(row,variant));
    console.log(`SIDEWAY_CF_${days}D_${variant.name}_PASS=${passed.length}`);
    console.log(`SIDEWAY_CF_${days}D_${variant.name}_RATE_PERCENT=${fmtPct(passed.length,evals.length)}`);

    if(variant.name==="BASELINE_ALL_6"){
      for(let i=0;i<passed.length;i+=1){
        const row=passed[i];
        const close=finite(row.raw?.closeTime);
        console.log(`SIDEWAY_CF_${days}D_BASELINE_PASS_${i+1}=${new Date(row.timestamp).toISOString()}|CLOSE=${close}|SIDE=${row.raw?.side??"NA"}`);
        if(close!==null){
          const downstream=downstreamFor(close,windowRows);
          for(let j=0;j<downstream.length;j+=1){
            const d=downstream[j];
            console.log(`SIDEWAY_CF_${days}D_BASELINE_PASS_${i+1}_DOWNSTREAM_${j+1}=${d.event}|DETAIL=${JSON.stringify(blockDetail(d))}`);
          }
        }
      }
    }
  }

  // Conditional selectivity inside regime-eligible rows.
  const regimeRows=evals.filter(row=>{
    const m=condMap(row.raw);
    return m.get("rangingRegime")?.status==="PASS" &&
           m.get("recommendedModeSideway")?.status==="PASS";
  });
  const m5Pass=regimeRows.filter(row=>condMap(row.raw).get("m5Confirmation")?.status==="PASS");
  const edgePass=regimeRows.filter(row=>condMap(row.raw).get("rangeEdge")?.status==="PASS");
  const rangePass=regimeRows.filter(row=>condMap(row.raw).get("supplyDemandRange")?.status==="PASS");
  const confPass=regimeRows.filter(row=>condMap(row.raw).get("minimumRegimeConfidence")?.status==="PASS");
  console.log(`SIDEWAY_CF_${days}D_REGIME_ELIGIBLE=${regimeRows.length}`);
  console.log(`SIDEWAY_CF_${days}D_REGIME_ELIGIBLE_M5_PASS=${m5Pass.length}`);
  console.log(`SIDEWAY_CF_${days}D_REGIME_ELIGIBLE_RANGE_EDGE_PASS=${edgePass.length}`);
  console.log(`SIDEWAY_CF_${days}D_REGIME_ELIGIBLE_SUPPLY_RANGE_PASS=${rangePass.length}`);
  console.log(`SIDEWAY_CF_${days}D_REGIME_ELIGIBLE_CONFIDENCE_PASS=${confPass.length}`);
}

console.log("SIDEWAY_CF_READ_ONLY=TRUE");
console.log("SIDEWAY_CF_STATUS=PASS");

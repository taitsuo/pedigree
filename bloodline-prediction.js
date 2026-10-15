'use strict';
// Ghidra Bloodlines_2026-10-11: conditional on local catalogue order, IID CRT and usual SSE rounding.
const BloodlinePrediction=(()=>{
const F = Math.fround;
const C = new Float32Array(new Uint32Array([0x38000100]).buffer)[0];
function nativeRange(k, lo, hi) {
  const x = F(F(F(k) * C) * F(hi - lo + 1));
  const r = x >= 2147483648 || x < -2147483648 ? -2147483648 : Math.trunc(x);
  return lo + Math.min(r, hi - lo);
}
function chanceCount(chance) {
  if (chance >= 100) return 32768;
  if (chance < 1) return 0;
  let n = 0;
  for (let k = 0; k < 32768; k++) n += nativeRange(k, 1, 100) <= chance;
  return n;
}
function nearestEven(x) {
  const n = Math.floor(x), d = x - n;
  return d < .5 ? n : d > .5 ? n + 1 : n % 2 === 0 ? n : n + 1;
}
function halfStat(q) { return -(nearestEven(F(F(-.5) - F(q))) >> 1) | 0; }
function branchProbabilities(maternalStat, paternalStat) {
  const bonus = halfStat(maternalStat) + halfStat(paternalStat);
  const inheritanceCount = chanceCount(80 - bonus), h = inheritanceCount / 32768;
  return {maternalStat, paternalStat, bonus, inheritanceChanceArgument: 80-bonus,
    inheritanceCount, maternalDirect:h/2, paternalDirect:h/2, randomBranch:1-h,
    skipFirstGivenRandom:chanceCount(bonus)/32768};
}
const catalog=[{"name":"Wild","weight":300,"fullCount":13153,"skipFirstCount":0},{"name":"Brave","weight":50,"fullCount":2252,"skipFirstCount":3626},{"name":"Careful","weight":50,"fullCount":2209,"skipFirstCount":3679},{"name":"Timid","weight":50,"fullCount":2253,"skipFirstCount":3712},{"name":"Bold","weight":50,"fullCount":2273,"skipFirstCount":3794},{"name":"Hardy","weight":50,"fullCount":2200,"skipFirstCount":3797},{"name":"Stout","weight":50,"fullCount":2232,"skipFirstCount":3720},{"name":"Ambitious","weight":50,"fullCount":2251,"skipFirstCount":3777},{"name":"Resolute","weight":25,"fullCount":1127,"skipFirstCount":1953},{"name":"Fierce","weight":25,"fullCount":1158,"skipFirstCount":1930},{"name":"Savage","weight":25,"fullCount":1171,"skipFirstCount":1954},{"name":"Alpha","weight":10,"fullCount":489,"skipFirstCount":826}];
const branchCache=new Map();
function branches(a,b){if(![a,b].every(q=>typeof q==='number'&&Number.isFinite(q)&&q>=0&&q<=100))throw Error('Lineage stats unavailable');const key=a+','+b;if(!branchCache.has(key)){if(branchCache.size>=32)branchCache.delete(branchCache.keys().next().value);branchCache.set(key,Object.freeze(branchProbabilities(a,b)))}return branchCache.get(key)}
function outcomes(m,f,a,b){const x=branches(a,b),h=1-x.randomBranch;const alias=n=>n==='Unstable'?'Fierce':n;const result=catalog.map(r=>({name:alias(r.name),p:h/2*(Number(alias(r.name)===alias(m))+Number(alias(r.name)===alias(f)))+x.randomBranch*((1-x.skipFirstGivenRandom)*r.fullCount+x.skipFirstGivenRandom*r.skipFirstCount)/32768}));for(const name of new Set([m,f]))if(!result.some(r=>r.name===alias(name)))result.push({name,p:h/2*(Number(name===m)+Number(name===f))});return result}
return Object.freeze({branches,outcomes,catalog,halfStat});})();

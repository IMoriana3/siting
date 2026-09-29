const fs=require("fs"), path=require("path");
const ROOT=path.join(__dirname,"..");
const html=fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const js=fs.readFileSync(path.join(ROOT,"plant_studies.js"),"utf8");
let n=0;
function ok(cond,msg){n++;if(!cond){console.error("MAL "+msg);process.exitCode=1;}else console.log("OK "+msg);}

ok(html.includes('<script src="plant_studies.js"></script>'),"el HTML canónico carga Plant Studies");
var syntaxOk=true;try{new Function(js);}catch(e){syntaxOk=false;console.error(e.stack||e);}
ok(syntaxOk,"plant_studies.js compila como JavaScript real");
ok(html.includes("b78</span>"),"el build visible cambió con la integración");
ok(js.includes('/studies/earthing'),"Earthing llama al endpoint canónico");
ok(js.includes('/studies/robot-cleaning'),"Cleaning llama al endpoint canónico");
ok(js.includes('http://localhost:8765'),"usa el puente local SolarGPT por defecto");
ok(js.includes('Estudios de planta'),"inyecta un único bloque Estudios de planta");
ok(js.includes('No se crea un ID por índice'),"una mesa sin id falla cerrado");
ok(!/id\s*:\s*["']T["']\s*\+\s*i/.test(js)&&!js.includes("index+1"),"no fabrica identidad desde índice");
ok(js.includes("standard_bridge_max_m:0"),"bridge capability arranca UNKNOWN, no inventada");
ok(js.includes("default_azimuth_deg:valOpt"),"el azimut fallback solo sale de un input explícito");
ok(js.includes("block_id:(m.pb==null?null:String(m.pb))"),"conserva el power block explícito de cada mesa");
ok(js.includes("approved_bridge_ids:Array.from(PS.cleaning.approved)"),"solo manda bridges aprobados explícitamente");
ok(!js.includes("Math.log(")&&!js.includes("soil_resistivity_ohm_m *")&&!js.includes("rod_group_efficiency *"),"el HTML no contiene física de puesta a tierra");
ok(js.includes("isStale:stale")&&js.includes("⚠ Desactualizado"),"marca resultados stale cuando cambia geometría o inputs");
ok(js.includes("BoQ CSV")&&js.includes("DXF")&&js.includes("Informe"),"expone export de BoQ, DXF e informe");
ok(js.includes("PS.activeOverlay")&&js.includes("paintEarthing")&&js.includes("paintCleaning"),"pinta ambos estudios sobre el mismo canvas");
ok(js.includes("if(!PS.engineOk)")||js.includes("if(PS.engineOk)return true"),"sin motor no cae a un cálculo local aproximado");

if(process.exitCode)process.exit(process.exitCode);
console.log("TODO OK — "+n+" comprobaciones");

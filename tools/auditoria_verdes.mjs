/* ¿PUEDE ALGÚN PASO DE CI SALIR CON 0 SIN HABER MEDIDO NADA?
 *
 * Sale del hallazgo de Siting: cuatro pasos imprimían «No se ha medido nada.
 * Esto no es un verde» y salían con 0, así que en la página de checks se veían
 * igual que los que sí medían. Entre ellos el careo del terreno contra el 3D
 * —200.000 muestras bit a bit— que NUNCA había corrido en CI.
 *
 * LA PRIMERA VERSIÓN DE ESTE CRIBADO SALIÓ CASI LIMPIA, Y ERA MENTIRA: veía
 * 3 ficheros de los 17 pasos de SolarGPTfull porque sólo buscaba `node X.mjs`
 * y `python3 X.py` sueltos. Se le escapaban pytest, los `bash tests/correr.sh`,
 * los bloques de PowerShell y los `working-directory`. Un cribado que no mira
 * es el mismo defecto que viene a buscar.
 *
 * LAS CINCO FORMAS DE SALIR VERDE SIN MIRAR, que es lo que se busca:
 *   1. GUARDA QUE RINDE 0     — «falta el hermano» y `exit(0)`   (Siting, hoy)
 *   2. BUCLE DE CERO VUELTAS  — recorre argv[2:] y no le dan nada (#741)
 *   3. TRAGADO EXPLÍCITO      — `|| true`, `continue-on-error`, `set +e` suelto
 *   4. SUITE QUE NO RECOGE    — pytest con todo deseleccionado o skipped
 *   5. INVOCA LO QUE NO HAY   — el fichero no existe y el shell lo perdona
 *
 * uso:  node auditoria_verdes.mjs [repo...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
/* EL LECTOR DE YAML. Se hace con `python3` + PyYAML y no con un `js-yaml` de
   npm, para no meter una dependencia nueva: PyYAML ya viene en los runners de
   GitHub y este mismo repo corre Python en CI.
   Si no esta, el auditor sale con rc = 2 —«no comprobado»— y NO con 0. Sale
   diciendolo, que es lo que exige a los demas. */
function leeYaml(f) {
  const r = spawnSync('python3', ['-c',
    'import sys,yaml,json; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout, default=str)', f],
    { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').pop() || 'python3/PyYAML no disponible');
  return JSON.parse(r.stdout);
}
{
  const r = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log('SIN AUDITORIA: no hay python3 con PyYAML, no se ha leido ningun workflow.');
    console.log('No se ha mirado nada. Esto no es un verde.');
    process.exit(2);   // 2 = no comprobado, no 0
  }
}

/* La base es el directorio que contiene este repo, para que funcione igual en
   CI que en local. Los repos son los hermanos que ESTEN: en CI solo hay los
   que se clonan, y auditar «los ocho» cuando hay dos seria justo el cero
   falso que esto persigue — por eso el informe publica cuantos ha mirado. */
const BASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANDIDATOS = ['Cobertura-Zigbee', 'cobertura-zigbee', 'Siting', 'siting', 'SCADA', 'scada',
  'SolarGPTfull', 'Gemelo-digital', 'gemelo-digital', 'Proyectos', 'proyectos',
  'factiun-cartera', 'cobertura-rf-fv'];
const REPOS = process.argv.slice(2).length ? process.argv.slice(2)
  : CANDIDATOS.filter(r => fs.existsSync(path.join(BASE, r, '.github/workflows')));

const INCAPAZ = /(no se ha medido|no se ha comprobado|no es un verde|sin medida|sin careo|falta |faltan |no hay |no existe|no encontr|sin hermano|no se pudo|se salta|omit|skip|not found|missing|no se puede)/i;
const EXITO   = /(todo ok|todo bien|ok —|ok -|sin fallos|correcto|verde|0 fallos|todas? .* ok)/i;

/* ── 1 · SACAR LOS PASOS DE VERDAD, con working-directory resuelto ───────── */
function pasosDe(raiz) {
  const dir = path.join(raiz, '.github/workflows');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const w of fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    let d; try { d = leeYaml(path.join(dir, w)); }
    catch (e) { out.push({ wf: w, nombre: '(YAML ilegible)', run: '', wd: '', err: e.message }); continue; }
    const wdGlobal = d.defaults?.run?.['working-directory'] || '';
    for (const [jn, j] of Object.entries(d.jobs || {})) {
      const wdJob = j.defaults?.run?.['working-directory'] || wdGlobal;
      /* LA MATRIZ. Sin esto, un paso `node tools/${{ matrix.banco }}` no resuelve
         a nada y los 36 bancos del job `navegador` de cobertura salian como
         «ningun paso de CI los alcanza» — un hallazgo FALSO, y de los caros:
         invita a «arreglar» algo que ya funciona. Se vio careandolo contra la
         corrida real, donde salen como `visor · test_afbt_rayos.mjs · Ayora`. */
      const inc = j.strategy?.matrix?.include || [];
      const ejes = Object.entries(j.strategy?.matrix || {}).filter(([k]) => k !== 'include' && Array.isArray(j.strategy.matrix[k]));
      const combos = inc.length ? inc : (ejes.length ? ejes[0][1].map(v => ({ [ejes[0][0]]: v })) : [null]);
      for (const s of (j.steps || [])) {
        if (!s.run) continue;
        for (const c of combos) {
          const run = c ? String(s.run).replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, k) => (c[k] ?? '')) : s.run;
          out.push({
            wf: w, job: jn, nombre: (c && c.nombre) || s.name || jn, run,
            wd: s['working-directory'] || wdJob,
            cont: s['continue-on-error'] === true,
            shell: s.shell || j.defaults?.run?.shell || '',
            deMatriz: !!c,
          });
          if (!c) break;
        }
      }
    }
  }
  return out;
}

/* ── 2 · QUÉ FICHEROS TOCA UN PASO, siguiendo los .sh y LOS GLOBS ────────── */
/* EL GLOB NO ES UN DETALLE. La primera version de esta columna decia que Siting
   tocaba 13 de sus 19 bancos y que factiun tocaba 0 de 17 — falso en los dos
   casos: los dos los corren ENTEROS con `for f in tests/test_*.js`. Un numero
   de cobertura equivocado es peor que no tenerlo, porque invita a «arreglar»
   algo que no esta roto. Asi que los globs se expanden. */
const RE_GLOB = /(?:^|[\s;&|($`])((?:[\w./-]*\/)?test_[\w.*-]*\*[\w.*-]*)/g;
function expandeGlob(raiz, wd, pat) {
  /* DOS BASES, no una. Los `correr.sh` hacen `cd "$RAIZ"` nada mas empezar, asi
     que sus globs son relativos a la RAIZ del repo y no a `tests/`, que es
     donde vive el script. Con una sola base, Siting salia con 13 de 19 bancos
     tocados y factiun con 0 de 17 — los dos falsos, porque los dos los corren
     enteros. */
  const base = path.basename(pat);
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const out = new Set();
  for (const b of [wd || '', '']) {
    const dir = path.join(raiz, b, path.dirname(pat));
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (re.test(f)) out.add(path.join(dir, f));
  }
  return [...out];
}
const RE_CMD = /(?:^|[\s;&|($`])(?:node|python3?|bash|sh|pwsh|powershell)\s+(?:--?[\w-]+\s+)*([\w./-]+\.(?:mjs|cjs|js|py|sh|ps1))/g;
function ficheros(raiz, run, wd, vistos = new Set(), prof = 0) {
  const out = [];
  /* pytest <dir> alcanza TODOS los test_* de ese arbol: si no, SolarGPTfull
     salia con 0 de 28 bancos tocados, que es otro cero falso. */
  for (const m2 of run.matchAll(/pytest\s+(?:-[\w-]+\s+)*([\w./-]+)\/?/g)) {
    const dir = path.join(raiz, wd || '', m2[1]);
    if (!fs.existsSync(dir)) continue;
    const pila = [dir];
    while (pila.length) {
      const d = pila.pop();
      let ent; try { ent = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ent) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) pila.push(f);
        else if (/^test_.*\.py$/.test(e.name)) out.push({ rel: path.relative(raiz, f), abs: f, porGlob: true });
      }
    }
  }
  let g; RE_GLOB.lastIndex = 0;
  while ((g = RE_GLOB.exec(run)))
    for (const abs of expandeGlob(raiz, wd, g[1])) out.push({ rel: path.relative(raiz, abs), abs, porGlob: true });
  let m; RE_CMD.lastIndex = 0;
  while ((m = RE_CMD.exec(run))) {
    const rel = m[1];
    /* LOS `cd` DEL PROPIO BLOQUE. SCADA hace `cd fichas` y luego invoca
       `../tools/tcu-toolbox/make_seguimiento.py`: sin esto, el fichero «no
       existe» y la cobertura del auditor se quedaba en el 75 % — o sea, un
       falso «INVOCA LO QUE NO HAY». Se prueban como bases todos los `cd` que
       aparezcan en el bloque, ademas del working-directory y la raiz. */
    const cds = [...String(run).matchAll(/^\s*cd\s+([\w./-]+)/gm)].map(x => x[1]);
    const cand = [path.join(raiz, wd || '', rel), path.join(raiz, rel),
                  ...cds.map(c => path.join(raiz, wd || '', c, rel))];
    const f = cand.find(c => fs.existsSync(c));
    out.push({ rel, abs: f || null });
    /* si es un .sh, se sigue dentro: ahí viven los bancos de verdad */
    if (f && /\.sh$/.test(f) && prof < 2 && !vistos.has(f)) {
      vistos.add(f);
      out.push(...ficheros(raiz, fs.readFileSync(f, 'utf8'), path.dirname(path.relative(raiz, f)), vistos, prof + 1));
    }
  }
  return out;
}

/* ── 3 · LOS CINCO PATRONES ──────────────────────────────────────────────── */
function analizaFichero(abs) {
  const L = fs.readFileSync(abs, 'utf8').split('\n');
  const h = [];
  for (let i = 0; i < L.length; i++) {
    const l = L[i], ctx = L.slice(Math.max(0, i - 5), i + 3).join(' ');
    // 1 · guarda que rinde 0
    if (/(process\.)?exit\(0\)|sys\.exit\(0\)|^\s*exit 0\b/.test(l)
        && INCAPAZ.test(ctx) && !EXITO.test(ctx) && i < L.length - 5)
      h.push(['GUARDA RINDE 0', i + 1, l.trim().slice(0, 70)]);
    // 2 · bucle sobre argv que puede dar cero vueltas sin quejarse
    if (/(process\.argv\.slice\(2\)|sys\.argv\[1:\])/.test(l) && /for |\.forEach|\.map\(|in /.test(l)) {
      const todo = L.join('\n');
      if (!/argv.{0,40}length\s*(===?|<|==)\s*0|len\(sys\.argv\)\s*<|argv\[1:\]\s*or\b|si no hay|sin plantas|sin argumentos/i.test(todo))
        h.push(['BUCLE ARGV SIN GUARDA', i + 1, l.trim().slice(0, 70)]);
    }
  }
  return h;
}

/* ── 4 · INFORME ─────────────────────────────────────────────────────────── */
/* ══ LA MEDIDA DEL PROPIO AUDITOR ═══════════════════════════════════════════
   Esto existe porque la primera version de este cribado salio casi limpia y
   era mentira: veia 3 ficheros de los 17 pasos de SolarGPTfull, porque solo
   buscaba `node X.mjs` y `python3 X.py` sueltos. O sea, exactamente el defecto
   que viene a buscar, en si mismo.
   Asi que publica lo que ha MIRADO: cuantos pasos, cuantos comandos, cuantos
   resolvio a un fichero real, y cuantos ficheros de prueba tiene el repo que
   el auditor no ha llegado a tocar. Con piso: por debajo, sale en rojo. */
function ficherosDePrueba(raiz) {
  const out = [];
  for (const d of ['tools', 'tests']) {
    const dir = path.join(raiz, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (/^test_/.test(f)) out.push(path.join(dir, f));
  }
  return out;
}
const PISO_COBERTURA = 0.90;   // de los comandos citados, cuantos resuelve
const PISO_PASOS = 1;          // un repo con CI tiene al menos un paso con `run`

const filas = [];
for (const repo of REPOS) {
  const raiz = path.join(BASE, repo);
  const pasos = pasosDe(raiz);
  const hall = [];
  const fichVistos = new Set();
  let nCmd = 0, nResueltos = 0;
  for (const p of pasos) {
    if (p.err) { hall.push({ tipo: 'YAML ILEGIBLE', donde: p.wf, det: p.err, paso: p.nombre }); continue; }
    // 3 · tragado explícito
    if (p.cont) hall.push({ tipo: 'TRAGADO', donde: 'continue-on-error', det: '', paso: p.nombre });
    for (const t of (p.run.match(/\|\|\s*true|\|\|\s*:\s*$/gm) || []))
      hall.push({ tipo: 'TRAGADO', donde: t.trim(), det: '', paso: p.nombre });
    // 4 · pytest
    if (/pytest/.test(p.run) && !/-W error|--strict|-x\b/.test(p.run))
      hall.push({ tipo: 'PYTEST', donde: 'sin --strict-markers ni -x', det: '', paso: p.nombre });
    // 1,2,5 · por fichero
    for (const f of ficheros(raiz, p.run, p.wd)) {
      if (!f.porGlob) nCmd++;
      if (!f.abs) { hall.push({ tipo: 'INVOCA LO QUE NO HAY', donde: f.rel, det: '', paso: p.nombre }); continue; }
      if (!f.porGlob) nResueltos++;
      if (fichVistos.has(f.abs)) continue;
      fichVistos.add(f.abs);
      for (const [tipo, ln, txt] of analizaFichero(f.abs))
        hall.push({ tipo, donde: path.relative(raiz, f.abs) + ':' + ln, det: txt, paso: p.nombre });
    }
  }
  const prueba = ficherosDePrueba(raiz);
  const tocados = prueba.filter(f => fichVistos.has(f)).length;
  filas.push({ repo, pasos: pasos.length, fich: fichVistos.size, hall,
               nCmd, nResueltos, prueba: prueba.length, tocados, vistos: fichVistos });
}

console.log('¿PUEDE ALGÚN PASO DE CI SALIR CON 0 SIN HABER MEDIDO?\n');
const TIPOS = ['GUARDA RINDE 0', 'BUCLE ARGV SIN GUARDA', 'INVOCA LO QUE NO HAY', 'TRAGADO', 'PYTEST', 'YAML ILEGIBLE'];
console.log('  repo                 pasos  fich ' + TIPOS.map(t => t.slice(0, 9).padStart(10)).join(''));
for (const f of filas) {
  const c = TIPOS.map(t => f.hall.filter(h => h.tipo === t).length);
  console.log('  %s %s %s %s', f.repo.padEnd(20), String(f.pasos).padStart(5), String(f.fich).padStart(5),
    c.map((n, i) => (n ? String(n) + ' ⚠' : '·').padStart(10)).join(''));
}
for (const f of filas) {
  if (!f.hall.length) continue;
  console.log('\n══ ' + f.repo + ' ══');
  const porTipo = {};
  for (const h of f.hall) (porTipo[h.tipo] ||= []).push(h);
  for (const t of TIPOS) for (const h of (porTipo[t] || []))
    console.log('  [%s] %s\n      %s%s', t, h.donde, h.det ? h.det + '\n      ' : '', 'paso: ' + h.paso.slice(0, 60));
}
/* ══ Y LO QUE EL AUDITOR HA MIRADO DE VERDAD ═══════════════════════════════ */
console.log('\n══ LO QUE ESTE AUDITOR HA MIRADO ══\n');
console.log('  repo                 pasos  comandos  resueltos  cobertura   ficheros test_*');
console.log('                                                               tocados / hay');
let malAud = [];
for (const f of filas) {
  const cob = f.nCmd ? f.nResueltos / f.nCmd : 1;
  const flojo = f.pasos < PISO_PASOS || (f.nCmd > 0 && cob < PISO_COBERTURA);
  console.log('  %s %s %s %s %s %s%s',
    f.repo.padEnd(20), String(f.pasos).padStart(5), String(f.nCmd).padStart(9),
    String(f.nResueltos).padStart(10), ((cob * 100).toFixed(0) + ' %').padStart(10),
    (f.tocados + ' / ' + f.prueba).padStart(16), flojo ? '  ⚠' : '');
  if (flojo) malAud.push(f.repo + ' (cobertura ' + (cob * 100).toFixed(0) + ' %, ' + f.pasos + ' pasos)');
}
console.log('');
console.log('  «cobertura» = de los ficheros que los pasos CITAN, cuántos ha resuelto a un');
console.log('  fichero real. Es lo que falló la primera vez: 3 de 17 pasos en SolarGPTfull.');
console.log('');
console.log('  «ficheros test_* tocados / hay» mide cuántos bancos del repo alcanza un');
console.log('  paso de CI. NO lleva piso a propósito: un número bajo puede ser un');
console.log('  hallazgo sobre el repo O un fallo del cribado, y hasta hoy ha sido las');
console.log('  dos cosas. Antes de llamarlo hallazgo, CAREARLO contra una corrida real.');
console.log('');
console.log('  Historia de esta columna, que es su mejor aviso: dijo «Siting 13 de 19»');
console.log('  (falso: el corredor los corre los 19, pero por un glob), «factiun 0 de');
console.log('  17» (falso, lo mismo), «SolarGPT 0 de 28» (falso: pytest recorre el');
console.log('  árbol) y «cobertura 33 de 63, 30 que nadie corre» (falso: van en la');
console.log('  matriz del job del visor, y en la corrida real salen como');
console.log('  «visor · test_afbt_rayos.mjs · Ayora»). Cuatro números equivocados antes');
console.log('  de uno bueno, y los cuatro parecían hallazgos.');

/* y CUALES son los que nadie corre, que es el hallazgo */
if (process.env.SIN_TOCAR) {
  for (const f of filas) {
    const falt = ficherosDePrueba(path.join(BASE, f.repo)).filter(x => !f.vistos.has(x));
    if (!falt.length) continue;
    console.log('\n  ' + f.repo + ' — ' + falt.length + ' banco(s) que ningún paso de CI alcanza:');
    for (const x of falt) console.log('      ' + path.relative(path.join(BASE, f.repo), x));
  }
}

console.log('\n  ESTO ES EL CRIBADO. Cada hallazgo se confirma DISPARÁNDOLO — un cribado');
console.log('  que no se comprueba tiene el mismo defecto que viene a buscar.');

if (malAud.length) {
  console.log('\n  ⚠ EL AUDITOR NO HA MIRADO LO SUFICIENTE EN: ' + malAud.join(' · '));
  console.log('  Un cribado que sale limpio sin haber mirado es el defecto que persigue.');
  process.exit(1);
}

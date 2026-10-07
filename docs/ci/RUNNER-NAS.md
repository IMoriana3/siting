# CI de IMoriana3/siting en el NAS

Decisión del propietario (2026-10-07): el repo pasa a **privado** y su CI corre en el runner propio del Synology DS923+. Los minutos de GitHub de la cuenta están bloqueados por facturación desde el 2026-09-11, y un repo privado no los tiene gratis.

**Job que se mueve:** `node` (`.github/workflows/tests.yml`), el único del workflow.

## Cómo funciona
- `runs-on` sale de la variable de repositorio **`RUNNER_TESTS`**. Si no está puesta, el job va a `ubuntu-latest`.
- Un PR que viniera de un fork nunca va al NAS. Con el repo privado no se dará, pero la guarda no estorba.
- **Clon del hermano (cobertura-zigbee, también privado):** usa el secreto **`REPOS_TOKEN`**. Sin él se intenta un clon anónimo, que falla con el repo privado. En ese caso los careos que lo necesitan salen como NO COMPROBADO (rc = 2), que no es verde.

## Alta, en este orden
Es el mismo montaje que los de SolarGPTfull, scada y cobertura-zigbee. Una cuenta personal no puede compartir un runner entre repos, así que este lleva su propio contenedor.

1. En File Station, crea `/volume1/docker/github-runner-siting/runner` y, dentro, la subcarpeta `config`.
2. En `IMoriana3/siting` → *Settings* → *Actions* → *Runners* → **New self-hosted runner** (Linux x64). Copia el `--token`, que caduca en 1 hora.
3. En *Container Manager* → *Proyecto* → **Crear**:
   - nombre `github-runner-siting`, ruta `/volume1/docker/github-runner-siting`;
   - pega `docs/ci/docker-compose.nas.yml` y pon el token.
4. Cuando `ds923-nas-siting` salga en **Idle**, crea la variable `RUNNER_TESTS` = `nas`.
5. Crea el secreto `REPOS_TOKEN` (ver abajo).

## `REPOS_TOKEN`: el token para clonar los repos hermanos privados
Hace falta un **fine-grained personal access token** de GitHub:
- *Settings* de tu cuenta → *Developer settings* → *Fine-grained tokens* → **Generate new token**.
- **Repository access:** *Only select repositories* → los repos que se clonan entre sí: `cobertura-zigbee`, `scada`, `siting`, `proyectos` y `cobertura-rf-fv`.
- **Permissions:** *Repository permissions → Contents → Read-only*. Nada más.
- Caducidad: la que prefieras. Cuando caduque, los careos saldrán NO COMPROBADO hasta renovarlo.

El mismo token se guarda como secreto `REPOS_TOKEN` en cada repo que clona a otro: siting, scada, cobertura-zigbee y SolarGPTfull. Ruta: *Settings → Secrets and variables → Actions → Secrets → New repository secret*.

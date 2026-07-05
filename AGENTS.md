# admiral-flagship

`admiral-flagship` es la consola administrativa web de Admiral.

Hace:

- autentica operadores.
- muestra estado, nodos, apps, instancias, backups y jobs.
- delega acciones a `admirald` mediante API.

No hace:

- tocar base de datos directo.
- ejecutar infraestructura.
- contener lógica de negocio propia.

Reglas:

- BFF delgado.
- sin build step.
- sin npm.
- sin duplicar a `admiralctl`.

## Pre-commit

Ejecutar estos comandos antes de cada commit:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
black --check --diff app/ tests/ dev_run.py run.py
ruff check app/ tests/ dev_run.py run.py
flake8 app/ tests/ dev_run.py run.py
pytest tests/ -v
```

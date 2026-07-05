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
pip install -e .
black --check --diff .
ruff check .
flake8 .
pytest tests/ -v
```

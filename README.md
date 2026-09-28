# 💰 Control de Gastos

Aplicación web sencilla para llevar el control de tus ingresos y gastos personales.
Funciona completamente en el navegador (HTML, CSS y JavaScript, sin servidor ni
dependencias) y se adapta a la pantalla del celular.

## Funciones

- **Registrar movimientos**: ingresos y gastos con fecha, monto, categoría
  (Comida, Transporte, Casa, Ocio, Salud, Otros) y una nota opcional.
- **Saldo del mes**: muestra el total de ingresos, gastos y el saldo del mes seleccionado.
- **Cambiar de mes** con las flechas ‹ ›; el enlace «Ir al mes actual» te regresa al mes de hoy.
- **Gráfico de gastos por categoría** con el monto y el porcentaje de cada una.
- **Editar y borrar** cualquier movimiento.
- **Guardado automático** en el navegador (`localStorage`): los datos siguen ahí al cerrar y volver a abrir.
- **Exportar a CSV** (compatible con Excel) el mes visible o todos los movimientos.

## Cómo usarla

1. **Abre la app** en la dirección de GitHub Pages (ver abajo) o abriendo `index.html`
   directamente en el navegador.
2. **Agrega un movimiento**:
   - Elige **Gasto** o **Ingreso**.
   - Revisa la **fecha** (por defecto, hoy).
   - Escribe el **monto**. Puedes usar coma o punto para los decimales: `1250,50`, `1.250,50` o `1250.50`.
   - Elige la **categoría** y, si quieres, escribe una **nota**.
   - Pulsa **Agregar**.
3. **Consulta el resumen**: arriba verás los ingresos, gastos y el saldo del mes
   (en verde si es positivo, en naranja si es negativo). Usa las flechas para ver otros meses.
4. **Revisa el gráfico** «Gastos por categoría» para ver en qué se va tu dinero ese mes.
5. **Edita o borra**: en la lista de movimientos pulsa **Editar** (el formulario se llena
   con los datos; cambia lo necesario y pulsa **Guardar cambios**, o **Cancelar**) o
   **Borrar** (pide confirmación).
6. **Exporta**: pulsa **Exportar mes (CSV)** para descargar los movimientos del mes
   visible, o **Exportar todo** para descargar el historial completo.

### Sobre el archivo CSV

- Columnas: `Fecha;Tipo;Categoría;Monto;Nota`.
- Usa **punto y coma** como separador y **coma decimal**, que es lo que espera Excel
  configurado en español, por lo que se abre directamente con doble clic.
- Los gastos aparecen con monto **negativo** y los ingresos **positivo**, así puedes
  sumar la columna para obtener el saldo.
- Si tu Excel está en inglés y todo aparece en una sola columna, usa
  *Datos → Texto en columnas* (o *Datos → Desde texto/CSV*) y elige el punto y coma como separador.

### Importante sobre tus datos

- Los datos se guardan **solo en el navegador y dispositivo** donde los registras;
  no se envían a ningún servidor. El celular y la computadora tienen datos separados.
- Si borras los datos de navegación del sitio o usas modo incógnito, los movimientos se pierden.
  Exporta a CSV de vez en cuando como respaldo.

### Instalarla en el celular (opcional)

Abre la app en el navegador del celular y usa **«Agregar a pantalla de inicio»**
(Chrome: menú ⋮; Safari: botón Compartir). Quedará como un ícono más.

## Publicar con GitHub Pages

El repositorio incluye el flujo `.github/workflows/pages.yml`, que publica el sitio
automáticamente cada vez que se hace *push* a la rama `main`.

1. Sube estos archivos a la rama `main` (por ejemplo, fusionando el *pull request*).
2. En GitHub, ve a **Settings → Pages**.
3. En **Build and deployment → Source**, elige **GitHub Actions**.
4. Ve a la pestaña **Actions**, abre «Publicar en GitHub Pages» y pulsa
   **Run workflow** (o simplemente haz un nuevo *push* a `main`).
5. Al terminar, la app estará disponible en:
   `https://ismaelron.github.io/control-gastos/`

> Alternativa sin Actions: en **Settings → Pages** elige *Deploy from a branch*,
> rama `main` y carpeta `/ (root)`.

## Estructura del proyecto

```
index.html                    Estructura de la página
styles.css                    Estilos (adaptados a celular y modo oscuro)
app.js                        Lógica: movimientos, gráfico, guardado y exportación
.nojekyll                     Indica a GitHub Pages que sirva los archivos tal cual
.github/workflows/pages.yml   Publicación automática en GitHub Pages
```

## Probar en tu computadora

No hace falta instalar nada: abre `index.html` con doble clic. Si prefieres un
servidor local:

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

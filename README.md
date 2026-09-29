# 💰 Control de Gastos

Aplicación web para llevar el control de tus ingresos y gastos personales.
Funciona en el navegador (HTML, CSS y JavaScript, sin servidor propio) y se adapta
a la pantalla del celular.

**Abrir la app:** https://ismaelron.github.io/control-gastos/

## Funciones

- **Botón «+»** para agregar un gasto o ingreso: monto, categoría (con íconos grandes),
  fecha y una nota opcional.
- **Saldo del mes** con el total de ingresos y gastos. Cambias de mes con las flechas ‹ ›.
- **Presupuesto mensual**: defines cuánto quieres gastar al mes (y, si quieres, por
  categoría) y la app te muestra cuánto te queda, cuánto puedes gastar por día y te avisa
  si te pasas.
- **Gráfico de gastos por categoría**.
- **Buscar y filtrar** movimientos por texto, por tipo (gastos o ingresos) y por categoría.
- **Editar y borrar**: toca un movimiento para cambiarlo o borrarlo. Si borras por error,
  pulsa **Deshacer**.
- **Cuenta con Google** (opcional, ver abajo): tus datos quedan guardados en tu cuenta y
  los ves igual en el celular y en la computadora. También funciona sin conexión y
  sincroniza al volver a tener internet.
- **Exportar a Excel (CSV)** el mes visible o todos los movimientos.

## Cómo usarla

1. **Entra con Google** (si las cuentas están activadas): pulsa **Entrar con Google**
   en el aviso de arriba o en el botón redondo de la esquina superior derecha.
   - Si ya tenías movimientos guardados en ese navegador, la app te pregunta si quieres
     subirlos a tu cuenta.
2. **Agrega un movimiento** con el botón **+** (abajo a la derecha):
   - Elige **Gasto** o **Ingreso**.
   - Escribe el **monto**. Sirven `25000`, `25.000`, `1250,50` o `1250.50`.
   - Toca la **categoría**.
   - Revisa la **fecha** (por defecto, hoy) y, si quieres, escribe una **nota**.
   - Pulsa **Guardar**.
3. **Define tu presupuesto**: en la tarjeta «Presupuesto del mes», pulsa
   **Definir presupuesto**. Escribe el total para el mes y, si quieres, abre
   «Presupuesto por categoría» para poner un límite a cada una.
4. **Consulta tus movimientos**: la lista está agrupada por día. Usa el buscador 🔍 o
   los botones de filtro (Gastos / Ingresos / categorías).
5. **Edita o borra** tocando un movimiento de la lista.
6. **Exporta**: en el botón redondo de arriba a la derecha → «Exportar a Excel (CSV)».

### Sobre el archivo CSV

- Columnas: `Fecha;Tipo;Categoría;Monto;Nota`.
- Usa **punto y coma** como separador y **coma decimal**, que es lo que espera Excel
  en español, así que se abre con doble clic.
- Los gastos aparecen en **negativo** y los ingresos en **positivo**.

### Instalarla en el celular

Abre la app en el navegador del celular y usa **«Agregar a pantalla de inicio»**
(Chrome: menú ⋮; Safari: botón Compartir). Quedará como un ícono más.

---

## Activar las cuentas de usuario (Firebase)

Sin este paso la app funciona igual, pero guarda los datos **solo en el navegador** de
cada dispositivo. Para que se guarden en una cuenta de Google, hay que crear un proyecto
gratuito en Firebase (el servicio de Google que guarda los datos). Se hace una sola vez
y toma unos 10 minutos.

### 1. Crear el proyecto

1. Entra en https://console.firebase.google.com con tu cuenta de Google.
2. Pulsa **Crear un proyecto** (o «Agregar proyecto»).
3. Ponle un nombre, por ejemplo `control-gastos`, y continúa.
4. Cuando pregunte por Google Analytics, puedes **desactivarlo** (no hace falta).
   Pulsa **Crear proyecto** y espera a que termine.

### 2. Activar el inicio de sesión con Google

1. En el menú de la izquierda: **Compilación → Authentication** (o «Seguridad →
   Authentication») → **Comenzar**.
2. En la pestaña **Método de acceso** (Sign-in method), elige **Google**.
3. Activa el interruptor **Habilitar**, elige tu correo como «correo de asistencia»
   y pulsa **Guardar**.
4. Ve a la pestaña **Configuración** (Settings) → **Dominios autorizados** →
   **Agregar dominio** y escribe: `ismaelron.github.io`

### 3. Crear la base de datos

1. En el menú de la izquierda: **Compilación → Firestore Database** →
   **Crear base de datos**.
2. Elige una ubicación cercana (por ejemplo `southamerica-east1` o la que sugiera)
   y el **modo de producción**. Pulsa **Crear**.
3. Cuando termine, entra en la pestaña **Reglas** (Rules), **borra todo** lo que haya
   y pega el contenido del archivo [`firestore.rules`](firestore.rules) de este
   repositorio. Pulsa **Publicar**.
   - Estas reglas hacen que cada persona solo pueda ver y cambiar **sus propios datos**.

### 4. Obtener la configuración y pegarla en la app

1. Pulsa el engranaje ⚙️ junto a «Descripción general del proyecto» →
   **Configuración del proyecto**.
2. Abajo, en **Tus apps**, pulsa el ícono web **`</>`**.
3. Escribe un apodo (por ejemplo `web`) y pulsa **Registrar app**. No hace falta
   activar Firebase Hosting.
4. Verás un código con `const firebaseConfig = { ... }`. Copia lo que va entre llaves
   (`apiKey`, `authDomain`, `projectId`, etc.).
5. En GitHub, abre el archivo [`firebase-config.js`](firebase-config.js), pulsa el
   lápiz ✏️ para editarlo y cambia la última línea:

   ```js
   window.FIREBASE_CONFIG = null;
   ```

   por tus datos, por ejemplo:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "control-gastos-xxxx.firebaseapp.com",
     projectId: "control-gastos-xxxx",
     storageBucket: "control-gastos-xxxx.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

6. Pulsa **Commit changes**. En uno o dos minutos la app se actualiza sola
   (lo puedes ver en la pestaña **Actions**) y aparecerá el botón **Entrar con Google**.

> Estos datos de configuración **no son secretos** (identifican tu proyecto y cualquiera
> que abra la página los puede ver). Lo que protege la información de cada usuario son
> las reglas del paso 3.

### Si algo falla

- **«Este sitio no está autorizado en Firebase»**: falta el paso 2.4 (dominio autorizado).
- **«Firebase rechazó el guardado»**: revisa que pegaste y publicaste las reglas del paso 3.3.
- **No aparece el botón de Google**: revisa que `firebase-config.js` quedó bien escrito
  (con llaves `{ }`, comillas y comas) y que terminó la publicación en **Actions**.

El plan gratuito de Firebase (Spark) alcanza de sobra para uso personal o familiar.

---

## Publicar con GitHub Pages

El flujo `.github/workflows/pages.yml` publica el sitio automáticamente cada vez que hay
cambios en la rama `main`. La primera vez hay que elegir en **Settings → Pages →
Source** la opción **GitHub Actions** (ya está hecho en este repositorio).

## Estructura del proyecto

```
index.html                    Estructura de la página
styles.css                    Estilos (celular, computadora y modo oscuro)
app.js                        Lógica: movimientos, presupuesto, filtros, gráfico y exportación
cloud.js                      Conexión con Firebase (inicio de sesión y base de datos)
firebase-config.js            Configuración de tu proyecto de Firebase
firestore.rules               Reglas de seguridad de la base de datos
firebase.json                 Configuración para probar con los emuladores de Firebase
.github/workflows/pages.yml   Publicación automática en GitHub Pages
```

## Probar en tu computadora

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

Para probar las cuentas sin tocar el proyecto real se pueden usar los
[emuladores de Firebase](https://firebase.google.com/docs/emulator-suite)
(`firebase emulators:start --project demo-gastos`) y abrir la página con
`window.__FIREBASE_EMULATORS__ = true` definido antes de cargar la app.

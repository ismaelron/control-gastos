# 💰 Control de Gastos

Aplicación web para llevar el control de tus ingresos y gastos personales.
Funciona en el navegador (HTML, CSS y JavaScript, sin servidor propio) y se adapta
a la pantalla del celular.

**Abrir la app:** https://ismaelron.github.io/control-gastos/

## Funciones

La app tiene cuatro pestañas (abajo en la pantalla):

- **🏠 Inicio**: el mes actual.
  - Saldo del mes, con ingresos y gastos comparados con el mes anterior.
  - Saldo de cada cuenta (efectivo, banco, tarjeta…).
  - Presupuesto: cuánto te queda y cuánto puedes gastar por día.
  - Movimientos fijos que aún faltan en el mes.
  - Gráfico de gastos por categoría, con la diferencia respecto al mes anterior.
  - Lista de movimientos con buscador y filtros por tipo, categoría y cuenta.
- **📊 Resumen**: el año completo.
  - Ingresos, gastos y ahorro del año, y qué porcentaje de tus ingresos ahorraste.
  - Gráfico mes a mes y tabla con el detalle.
  - En qué categorías gastaste más.
- **🎯 Metas**: metas de ahorro (un viaje, un fondo de emergencia…).
  - Registras lo que vas apartando y ves tu avance.
  - Si pones fecha límite, te dice cuánto ahorrar cada mes para llegar.
- **⚙️ Ajustes**:
  - Tu cuenta y la opción de compartir.
  - Presupuesto.
  - Categorías propias (nombre, ícono y color).
  - Cuentas y billeteras.
  - Movimientos fijos.
  - Instalar la app.
  - Exportar a Excel (CSV).

Además:

- **Botón «+»** para registrar un gasto, un ingreso o una **transferencia** entre tus
  cuentas (por ejemplo, pagar la tarjeta desde el banco).
- **Movimientos fijos**: el arriendo, el sueldo o las suscripciones se registran solos cada
  mes en el día que elijas. Puedes crearlos desde Ajustes o marcando «Repetir cada mes»
  al registrar un movimiento.
- **Cuenta con Google**: tus datos quedan guardados en tu cuenta y los ves igual en el
  celular y en la computadora. También funciona sin conexión y se sincroniza al volver a
  tener internet.
- **Finanzas compartidas**: invita a tu pareja o a tu familia con un enlace. Cada persona
  entra con su propia cuenta de Google y todos ven y registran en el mismo «libro».
- **Instalable**: se agrega a la pantalla de inicio como una app, con su propio ícono, y
  abre sin conexión.

## Cómo usarla

1. **Entra con Google** con el botón del aviso de arriba (o en ⚙️ Ajustes → Tu cuenta).
   También puedes **entrar con correo y contraseña** (útil en la app instalada en iPhone).
   Si ya entrabas con Google, crea tu contraseña en ⚙️ Ajustes → Tu cuenta y usarás la
   misma cuenta con los mismos datos.
   - Si ya tenías movimientos guardados en ese navegador, la app te pregunta si quieres
     subirlos a tu cuenta.
2. **Registra un movimiento** con el botón **+** (abajo a la derecha):
   - Elige **Gasto**, **Ingreso** o **Transferencia**. Transferencia aparece solo si tienes
     más de una cuenta.
   - Escribe el **monto**. Sirven `25000`, `25.000`, `1250,50` o `1250.50`.
   - Toca la **categoría**.
   - Elige la **cuenta**, si tienes varias.
   - Revisa la **fecha** y, si quieres, escribe una **nota**.
   - Marca **Repetir cada mes** si es un gasto o ingreso fijo.
   - Pulsa **Guardar**.
3. **Edita o borra** tocando un movimiento de la lista. Si borras por error, pulsa **Deshacer**.
4. **Personaliza** en ⚙️ Ajustes:
   - **Presupuesto**: el total del mes y, si quieres, un límite por categoría.
   - **Categorías**: crea las tuyas (por ejemplo, Mascotas 🐶) o cambia nombre, ícono y color.
     Cada una puede ser para gastos, para ingresos o para ambos.
   - **Cuentas y billeteras**: crea Efectivo, Banco, Tarjeta… con su saldo inicial. Para una
     tarjeta de crédito con deuda, escribe el saldo con signo menos (`-150000`).
   - **Movimientos fijos**: crea, pausa o borra los que se registran solos cada mes.
5. **Metas**: en 🎯 Metas pulsa **Nueva meta**, ponle nombre, monto y (opcional) fecha límite.
   Usa **Aportar** o **Retirar** para registrar lo que apartas.
6. **Exporta** en ⚙️ Ajustes → «Exportar a Excel (CSV)».

### Compartir con otra persona

1. En ⚙️ Ajustes → **Compartir**, pulsa **Invitar a alguien**.
2. Envía el enlace: puedes copiarlo o mandarlo por WhatsApp. El enlace vence en 7 días.
3. La otra persona abre el enlace, entra con **su** cuenta de Google y acepta unirse.

Desde ese momento, los dos ven y registran en el mismo libro. En cada movimiento aparece
el nombre de quién lo registró.

- Cada persona conserva además su libro personal. Se cambia de libro en Ajustes →
  Compartir → «Libro que estás viendo».
- El dueño del libro puede quitar a un miembro. Un miembro puede salir cuando quiera.

### Sobre el archivo CSV

- Columnas: `Fecha;Tipo;Categoría;Cuenta;Monto;Nota`.
- Usa **punto y coma** como separador y **coma decimal**, que es lo que espera Excel
  en español, así que se abre con doble clic.
- Los gastos aparecen en **negativo** y los ingresos en **positivo**. Las transferencias
  indican las cuentas de origen y de destino.

### Instalarla en el celular o la computadora

En ⚙️ Ajustes → **Instalar la app**:

- En Chrome y Edge aparece un botón **Instalar**.
- En iPhone (Safari), usa el botón **Compartir** y luego **Agregar a pantalla de inicio**.

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

### 2b. Activar el inicio con correo y contraseña

Sirve para quien no puede entrar con Google. Por ejemplo, en la app instalada en un
iPhone, al abrir el enlace dentro de WhatsApp o Instagram, o con cuentas de Google
supervisadas (Family Link).

1. En **Authentication → Método de acceso**, pulsa **Agregar proveedor nuevo**.
2. Elige **Correo electrónico/contraseña**, activa el primer interruptor y pulsa **Guardar**.
   El segundo interruptor, «Vínculo de correo electrónico», no hace falta.

Quien ya entra con Google puede crear una contraseña para la misma cuenta en
⚙️ Ajustes → Tu cuenta → **Crear contraseña**.

### 3. Crear la base de datos

1. En el menú de la izquierda: **Compilación → Firestore Database** →
   **Crear base de datos**.
2. Elige una ubicación cercana (por ejemplo `southamerica-east1` o la que sugiera)
   y el **modo de producción**. Pulsa **Crear**.
3. Cuando termine, entra en la pestaña **Reglas** (Rules), **borra todo** lo que haya
   y pega el contenido del archivo [`firestore.rules`](firestore.rules) de este
   repositorio. Pulsa **Publicar**.
   - Estas reglas hacen que cada persona solo pueda ver y cambiar **sus propios datos**
     y los de los libros compartidos en los que es miembro.

> **Cuando una actualización cambie `firestore.rules`**, vuelve a copiar y publicar las
> reglas en Firebase **antes** de publicar la nueva versión de la app. Si no, Firebase
> rechazará los cambios con el mensaje «Firebase rechazó el cambio».

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
index.html                    Estructura de la página (pestañas y hojas)
styles.css                    Estilos (celular, computadora y modo oscuro)
core.js                       Cálculos: montos, saldos, fijos y CSV
ui.js                         Formularios, avisos y gráficos
app.js                        Lógica de la app y de cada pestaña
cloud.js                      Conexión con Firebase (sesión, libros e invitaciones)
firebase-config.js            Configuración de tu proyecto de Firebase
firestore.rules               Reglas de seguridad de la base de datos
sw.js, manifest.webmanifest   Instalación como app y modo sin conexión
icons/                        Íconos de la app
firebase.json                 Configuración para probar con los emuladores de Firebase
.github/workflows/pages.yml   Publicación automática en GitHub Pages
```

### Cómo se guardan los datos en Firebase

- `books/{libro}`: nombre, dueño, miembros, presupuesto, categorías y cuentas.
- `books/{libro}/movements`: movimientos del libro.
- `books/{libro}/recurring`: movimientos fijos del libro.
- `books/{libro}/goals`: metas del libro.
- `invites/{código}`: invitaciones para unirse a un libro.
- `users/{uid}`: el libro que cada persona tiene abierto.

Cada persona tiene un libro personal (con el mismo id que su usuario). Los datos de la
versión anterior (`users/{uid}/movements`) se copian a ese libro la primera vez que la
persona inicia sesión con esta versión.

## Probar en tu computadora

```bash
python3 -m http.server 8000
# y abre http://localhost:8000
```

Para probar las cuentas sin tocar el proyecto real se pueden usar los
[emuladores de Firebase](https://firebase.google.com/docs/emulator-suite)
(`firebase emulators:start --project demo-gastos`) y abrir la página con
`window.__FIREBASE_EMULATORS__ = true` definido antes de cargar la app.

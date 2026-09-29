// Configuración de Firebase (cuentas de usuario y guardado en la nube).
//
// Mientras esto quede en `null`, la app funciona sin cuentas y guarda los datos
// solo en este navegador. Para activar las cuentas, sigue la guía del README y
// reemplaza `null` por los datos de tu proyecto, por ejemplo:
//
// window.FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "mi-proyecto.firebaseapp.com",
//   projectId: "mi-proyecto",
//   storageBucket: "mi-proyecto.firebasestorage.app",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123"
// };
//
// Estos datos no son secretos: identifican tu proyecto. Lo que protege la
// información de cada usuario son las reglas de `firestore.rules`.
window.FIREBASE_CONFIG = null;

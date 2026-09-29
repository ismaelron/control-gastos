// Conexión con Firebase: inicio de sesión con Google y guardado en Firestore.
// Solo se carga si firebase-config.js tiene una configuración.
//
// Estructura de datos en Firestore:
//   users/{uid}                      -> { budget, categoryBudgets }  (ajustes)
//   users/{uid}/movements/{id}       -> { type, date, amount, category, note, createdAt }

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

export async function initCloud(config, handlers) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);
  const {
    getAuth, GoogleAuthProvider, onAuthStateChanged,
    signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
    connectAuthEmulator
  } = authMod;
  const {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch,
    terminate, clearIndexedDbPersistence, connectFirestoreEmulator
  } = fsMod;

  const app = appMod.initializeApp(config);
  const auth = getAuth(app);
  auth.languageCode = 'es';
  // Caché local: la app sigue funcionando sin conexión y sincroniza al volver.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });

  // Solo para pruebas locales con los emuladores de Firebase.
  if (window.__FIREBASE_EMULATORS__) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  let uid = null;
  let unsubscribers = [];

  function stopListening() {
    unsubscribers.forEach((fn) => fn());
    unsubscribers = [];
  }

  function movementsCol() {
    return collection(db, 'users', uid, 'movements');
  }

  function movementData(m) {
    return {
      type: m.type,
      date: m.date,
      amount: m.amount,
      category: m.category,
      note: m.note || '',
      createdAt: m.createdAt || Date.now()
    };
  }

  // Las escrituras se aplican al instante en pantalla (caché local) y se
  // envían al servidor en segundo plano; por eso no se esperan las promesas.
  function background(promise) {
    promise.catch((err) => handlers.onError(err));
  }

  return {
    // Empieza a escuchar la sesión y los datos del usuario.
    start() {
      getRedirectResult(auth).catch((err) => handlers.onError(err));

      onAuthStateChanged(auth, (user) => {
        stopListening();
        uid = user ? user.uid : null;
        handlers.onUser(user ? {
          uid: user.uid,
          name: user.displayName || '',
          email: user.email || '',
          photo: user.photoURL || ''
        } : null);
        if (!user) return;

        unsubscribers.push(onSnapshot(
          movementsCol(),
          { includeMetadataChanges: true },
          (snap) => {
            const list = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
            handlers.onMovements(list, {
              pending: snap.metadata.hasPendingWrites,
              fromCache: snap.metadata.fromCache
            });
          },
          (err) => handlers.onError(err)
        ));

        unsubscribers.push(onSnapshot(
          doc(db, 'users', uid),
          (snap) => handlers.onSettings(snap.exists() ? snap.data() : {}),
          (err) => handlers.onError(err)
        ));
      });
    },

    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err && err.code === 'auth/popup-blocked') {
          await signInWithRedirect(auth, provider);
        } else if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
          // El usuario cerró la ventana: no es un error.
        } else {
          throw err;
        }
      }
    },

    async signOut() {
      stopListening();
      await signOut(auth);
      // Borra la copia local de los datos para no dejarlos en un equipo compartido.
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch (e) { /* no es grave */ }
    },

    save(m) {
      background(setDoc(doc(movementsCol(), m.id), movementData(m)));
    },

    remove(id) {
      background(deleteDoc(doc(movementsCol(), id)));
    },

    saveSettings(settings) {
      background(setDoc(doc(db, 'users', uid), {
        budget: settings.budget || 0,
        categoryBudgets: settings.categoryBudgets || {}
      }));
    },

    // Sube varios movimientos de una vez (máx. 500 por lote en Firestore).
    importMany(list) {
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        list.slice(i, i + 400).forEach((m) => batch.set(doc(movementsCol(), m.id), movementData(m)));
        background(batch.commit());
      }
    }
  };
}

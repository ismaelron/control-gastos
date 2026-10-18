// Conexión con Firebase: inicio de sesión con Google y datos en Firestore.
// Solo se carga si firebase-config.js tiene una configuración.
//
// Estructura de datos:
//   users/{uid}                        -> { activeBook }
//   books/{bookId}                     -> ajustes del libro: nombre, dueño, miembros,
//                                         presupuesto, categorías y cuentas
//   books/{bookId}/movements/{id}      -> movimientos
//   books/{bookId}/recurring/{id}      -> movimientos fijos (mensuales)
//   books/{bookId}/goals/{id}          -> metas de ahorro
//   invites/{code}                     -> invitaciones para unirse a un libro
//
// Cada usuario tiene un libro personal con id = su uid. Un libro puede tener
// varios miembros (finanzas compartidas).
//
// Versiones anteriores guardaban en users/{uid}/movements; al primer inicio
// de sesión esos datos se copian al libro personal.

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const INVITE_DAYS = 7;

export async function initCloud(config, handlers) {
  const [appMod, authMod, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);
  const {
    getAuth, GoogleAuthProvider, onAuthStateChanged,
    signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile,
    sendPasswordResetEmail, updatePassword, reauthenticateWithPopup,
    connectAuthEmulator
  } = authMod;
  const {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
    writeBatch, query, where, arrayUnion, arrayRemove, deleteField, increment,
    Timestamp, terminate, clearIndexedDbPersistence, connectFirestoreEmulator
  } = fs;

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

  let user = null;
  let bookId = null;
  let bookUnsubs = [];
  let globalUnsubs = [];

  const bookRef = (id) => doc(db, 'books', id || bookId);
  const sub = (name) => collection(db, 'books', bookId, name);
  const subDoc = (name, id) => doc(db, 'books', bookId, name, id);

  function stop(list) {
    list.forEach((fn) => fn());
    list.length = 0;
  }

  // Las escrituras se aplican al instante en pantalla (caché local) y se
  // envían al servidor en segundo plano; por eso no se esperan.
  function background(promise) {
    promise.catch((err) => handlers.onError(err));
    return promise;
  }

  // Nombre elegido al crear una cuenta con correo, mientras Firebase lo guarda.
  let pendingName = '';

  function memberInfo(u) {
    return { name: u.displayName || pendingName || '', email: u.email || '', photo: u.photoURL || '' };
  }

  function publicUser(u) {
    return {
      uid: u.uid,
      name: u.displayName || pendingName || '',
      email: u.email || '',
      photo: u.photoURL || '',
      hasPassword: u.providerData.some((p) => p.providerId === 'password'),
      hasGoogle: u.providerData.some((p) => p.providerId === 'google.com')
    };
  }

  function clean(obj) {
    const out = {};
    Object.keys(obj).forEach((k) => {
      if (obj[k] !== undefined && k !== 'id') out[k] = obj[k];
    });
    return out;
  }

  function movementData(m) {
    const d = {
      type: m.type,
      date: m.date,
      amount: m.amount,
      note: m.note || '',
      createdAt: m.createdAt || Date.now(),
      createdBy: m.createdBy || user.uid
    };
    if (m.type === 'transferencia') {
      d.account = m.account || '';
      d.toAccount = m.toAccount || '';
    } else {
      d.category = m.category;
      if (m.account) d.account = m.account;
    }
    if (m.recurringId) d.recurringId = m.recurringId;
    return d;
  }

  // Crea el libro personal la primera vez (copiando los datos de la versión anterior).
  async function ensurePersonalBook(u) {
    const ref = bookRef(u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      // Mantiene actualizados nombre y foto del usuario en el libro.
      const info = memberInfo(u);
      const cur = (snap.data().memberInfo || {})[u.uid] || {};
      if (cur.name !== info.name || cur.photo !== info.photo || cur.email !== info.email) {
        background(updateDoc(ref, { ['memberInfo.' + u.uid]: info }));
      }
      return;
    }
    let legacy = {};
    try {
      const old = await getDoc(doc(db, 'users', u.uid));
      if (old.exists()) legacy = old.data();
    } catch (e) { /* sin datos anteriores */ }

    const first = (u.displayName || pendingName || '').trim().split(' ')[0];
    await setDoc(ref, {
      name: first ? 'Finanzas de ' + first : 'Mis finanzas',
      owner: u.uid,
      members: [u.uid],
      memberInfo: { [u.uid]: memberInfo(u) },
      budget: typeof legacy.budget === 'number' ? legacy.budget : 0,
      categoryBudgets: legacy.categoryBudgets || {},
      createdAt: Date.now()
    });

    const oldMovs = await getDocs(collection(db, 'users', u.uid, 'movements')).catch(() => null);
    if (oldMovs && !oldMovs.empty) {
      const docs = oldMovs.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => {
          const data = d.data();
          data.createdBy = u.uid;
          batch.set(doc(db, 'books', u.uid, 'movements', d.id), data);
        });
        await batch.commit();
      }
    }
  }

  function openBook(id) {
    stop(bookUnsubs);
    bookId = id;
    handlers.onBookChange(id);

    bookUnsubs.push(onSnapshot(bookRef(id), (snap) => {
      if (!snap.exists()) return;
      handlers.onBook(Object.assign({ id: snap.id }, snap.data()));
    }, (err) => {
      // Si ya no es miembro (lo quitaron del libro), vuelve al libro personal.
      if (err && err.code === 'permission-denied' && id !== user.uid) {
        handlers.onError({ code: 'book-removed' });
        switchBook(user.uid);
      } else {
        handlers.onError(err);
      }
    }));

    bookUnsubs.push(onSnapshot(sub('movements'), { includeMetadataChanges: true }, (snap) => {
      const list = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      handlers.onMovements(list, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
    }, (err) => { if (err.code !== 'permission-denied') handlers.onError(err); }));

    bookUnsubs.push(onSnapshot(sub('recurring'), (snap) => {
      handlers.onRecurring(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
    }, (err) => { if (err.code !== 'permission-denied') handlers.onError(err); }));

    bookUnsubs.push(onSnapshot(sub('goals'), (snap) => {
      handlers.onGoals(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
    }, (err) => { if (err.code !== 'permission-denied') handlers.onError(err); }));
  }

  function switchBook(id) {
    background(setDoc(doc(db, 'users', user.uid), { activeBook: id }, { merge: true }));
    openBook(id);
  }

  async function setupUser(u) {
    await ensurePersonalBook(u);
    let active = u.uid;
    try {
      const prefs = await getDoc(doc(db, 'users', u.uid));
      if (prefs.exists() && prefs.data().activeBook) active = prefs.data().activeBook;
    } catch (e) { /* usa el personal */ }
    if (active !== u.uid) {
      // Comprueba que sigue siendo miembro de ese libro.
      const ok = await getDoc(bookRef(active)).then((s) => s.exists(), () => false);
      if (!ok) active = u.uid;
    }

    globalUnsubs.push(onSnapshot(
      query(collection(db, 'books'), where('members', 'array-contains', u.uid)),
      (snap) => handlers.onBooks(snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || 'Libro',
        owner: d.data().owner,
        members: (d.data().members || []).length
      }))),
      (err) => handlers.onError(err)
    ));

    openBook(active);
  }

  return {
    // Empieza a escuchar la sesión y los datos del usuario.
    start() {
      getRedirectResult(auth).catch((err) => handlers.onError(err));

      onAuthStateChanged(auth, (u) => {
        stop(bookUnsubs);
        stop(globalUnsubs);
        user = u;
        bookId = null;
        handlers.onUser(u ? publicUser(u) : null);
        if (!u) return;
        setupUser(u).catch((err) => {
          handlers.onError(err);
          // Sin conexión: abre el libro personal con los datos guardados en el equipo.
          if (!bookId && user === u) openBook(u.uid);
        });
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

    // ---------- Correo y contraseña ----------
    // Alternativa para donde Google no deja iniciar sesión (app instalada en
    // iPhone, navegadores dentro de otras apps, cuentas supervisadas).
    async signInWithEmail(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },

    async createAccount(name, email, password) {
      pendingName = name;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
    },

    resetPassword(email) {
      auth.languageCode = 'es';
      return sendPasswordResetEmail(auth, email);
    },

    // Agrega una contraseña a la cuenta actual (por ejemplo, creada con Google).
    async addPassword(password) {
      const u = auth.currentUser;
      try {
        await updatePassword(u, password);
      } catch (err) {
        // Si la sesión es antigua, Firebase pide confirmar la identidad con Google.
        if (!err || err.code !== 'auth/requires-recent-login') throw err;
        await reauthenticateWithPopup(u, new GoogleAuthProvider());
        await updatePassword(u, password);
      }
      await u.reload();
      handlers.onUserInfo(publicUser(auth.currentUser));
    },

    async signOut() {
      stop(bookUnsubs);
      stop(globalUnsubs);
      await signOut(auth);
      // Borra la copia local de los datos para no dejarlos en un equipo compartido.
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch (e) { /* no es grave */ }
    },

    currentBook() { return bookId; },

    // ---------- Movimientos ----------
    saveMovement(m) {
      return background(setDoc(subDoc('movements', m.id), movementData(m)));
    },
    deleteMovement(id) {
      return background(deleteDoc(subDoc('movements', id)));
    },
    saveMovements(list) {
      const out = [];
      for (let i = 0; i < list.length; i += 400) {
        const batch = writeBatch(db);
        list.slice(i, i + 400).forEach((m) => batch.set(subDoc('movements', m.id), movementData(m)));
        out.push(background(batch.commit()));
      }
      return Promise.all(out);
    },

    // ---------- Ajustes del libro ----------
    updateBook(patch) {
      return background(updateDoc(bookRef(), clean(patch)));
    },

    // ---------- Fijos ----------
    saveRecurring(r) {
      return background(setDoc(subDoc('recurring', r.id), clean(r)));
    },
    deleteRecurring(id) {
      return background(deleteDoc(subDoc('recurring', id)));
    },
    // Registra instancias de fijos y avanza su último mes, todo junto.
    applyRecurring(movs, lastMonths) {
      const batch = writeBatch(db);
      movs.forEach((m) => batch.set(subDoc('movements', m.id), movementData(m)));
      Object.keys(lastMonths).forEach((id) => batch.update(subDoc('recurring', id), { lastMonth: lastMonths[id] }));
      return background(batch.commit());
    },

    // ---------- Metas ----------
    saveGoal(g) {
      return background(setDoc(subDoc('goals', g.id), clean(g)));
    },
    deleteGoal(id) {
      return background(deleteDoc(subDoc('goals', id)));
    },
    addToGoal(id, delta) {
      return background(updateDoc(subDoc('goals', id), { saved: increment(delta) }));
    },

    // ---------- Compartir ----------
    switchBook,

    async createInvite(bookName) {
      const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
      let code = '';
      const rnd = crypto.getRandomValues(new Uint8Array(12));
      rnd.forEach((b) => { code += alphabet[b % alphabet.length]; });
      await setDoc(doc(db, 'invites', code), {
        bookId,
        bookName: bookName || 'Libro',
        createdBy: user.uid,
        createdByName: user.displayName || user.email || '',
        createdAt: Date.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 864e5)
      });
      return code;
    },

    async getInvite(code) {
      const snap = await getDoc(doc(db, 'invites', code));
      if (!snap.exists()) return null;
      const d = snap.data();
      if (d.expiresAt && d.expiresAt.toMillis() < Date.now()) return null;
      return { code, bookId: d.bookId, bookName: d.bookName, createdByName: d.createdByName };
    },

    async joinBook(invite) {
      await updateDoc(bookRef(invite.bookId), {
        members: arrayUnion(user.uid),
        ['memberInfo.' + user.uid]: memberInfo(user),
        joinCode: invite.code
      });
      switchBook(invite.bookId);
    },

    async leaveBook(id) {
      if (id === bookId) switchBook(user.uid);
      await updateDoc(bookRef(id), {
        members: arrayRemove(user.uid),
        ['memberInfo.' + user.uid]: deleteField()
      });
    },

    removeMember(uid) {
      return background(updateDoc(bookRef(), {
        members: arrayRemove(uid),
        ['memberInfo.' + uid]: deleteField()
      }));
    }
  };
}

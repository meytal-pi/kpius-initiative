// =====================================================================
//  Firebase settings — see SETUP.md
//  Paste the config object from the Firebase console below
//  (Project settings → Your apps → Web app → "Config").
//  While this is null the app runs in LOCAL mode (no sync between devices).
// =====================================================================

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDxDpMsLGtSPuslvuP_zzRI9nL61lJzHBo",
  authDomain: "kpius-initiative.firebaseapp.com",
  databaseURL: "https://kpius-initiative-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kpius-initiative",
  storageBucket: "kpius-initiative.firebasestorage.app",
  messagingSenderId: "549565371162",
  appId: "1:549565371162:web:933eb5dda2d43e8e7552a3"
};

/* Example (yours will have different values):
window.FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "my-initiative.firebaseapp.com",
  databaseURL: "https://my-initiative-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "my-initiative",
  storageBucket: "my-initiative.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/

// Table (room) code: leave this as null. Each device asks for the code once and remembers it,
// so the code is never stored in these public files.
window.DEFAULT_ROOM = null;

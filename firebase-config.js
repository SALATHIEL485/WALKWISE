/**
 * ============================================================================
 * WALKWISE CANE — FIREBASE REALTIME CONFIGURATION & LISTENERS (COMPAT BUNDLE)
 * ============================================================================
 * Connected to Project: walkwise-381be
 * Realtime DB: https://walkwise-381be-default-rtdb.asia-southeast1.firebasedatabase.app/
 * Works on file:// protocol, localhost, and web servers without CORS errors.
 */

const firebaseConfig = {
  apiKey: "AIzaSyCDdL1RH6ICpx0g8hlxLTTlyB82sjmo0dA",
  authDomain: "walkwise-381be.firebaseapp.com",
  projectId: "walkwise-381be",
  storageBucket: "walkwise-381be.firebasestorage.app",
  messagingSenderId: "248625134583",
  appId: "1:248625134583:web:378312711f60d2be048cf2",
  measurementId: "G-SQQLT5985L",
  databaseURL: "https://walkwise-381be-default-rtdb.asia-southeast1.firebasedatabase.app"
};

let database = null;

function checkEmActive(data) {
  if (data === null || data === undefined) return false;
  if (typeof data !== "object") {
    return data === true || data === "true" || data === 1 || data === "1" || String(data).toLowerCase() === "true";
  }
  const keys = Object.keys(data);
  for (const k of keys) {
    if (k.toLowerCase() === "embutton" || k.toLowerCase() === "em_button" || k.toLowerCase() === "emergency") {
      const val = data[k];
      if (val === true || val === "true" || val === 1 || val === "1" || String(val).toLowerCase() === "true") {
        return true;
      }
    }
  }
  return false;
}

function initFirebaseRealtime(onDataUpdate, onEmergencyAlert) {
  try {
    if (typeof firebase === "undefined") {
      console.error("❌ Firebase SDK not loaded yet.");
      return false;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    database = firebase.database();
    console.log("🔥 Connected to Firebase RTDB (Asia Southeast 1):", firebaseConfig.databaseURL);

    // 1. Listen to root node "/"
    database.ref("/").on("value", (snapshot) => {
      const data = snapshot.val();
      console.log("🔥 Live Firebase Data Snapshot:", data);

      if (data) {
        if (typeof onDataUpdate === "function") {
          onDataUpdate(data);
        }

        const isEmActive = checkEmActive(data);
        if (isEmActive && typeof onEmergencyAlert === "function") {
          console.log("🚨 EmButton is TRUE in Firebase! Triggering Emergency Alert!");
          const latVal = data.lat !== undefined ? data.lat : (data.latitude || 12.456);
          const lngVal = data.long !== undefined ? data.long : (data.lng || data.longitude || 13.567);
          onEmergencyAlert({
            type: "Emergency Button Pressed on WalkWise Cane!",
            lat: parseFloat(latVal),
            lng: parseFloat(lngVal),
            time: new Date().toLocaleString()
          });
        }
      }
    }, (error) => {
      console.error("❌ Firebase RTDB Read Error:", error);
    });

    // 2. Direct listener on "EmButton" node
    database.ref("EmButton").on("value", (snapshot) => {
      const val = snapshot.val();
      console.log("🚨 EmButton Live Value:", val);
      if (checkEmActive(val) && typeof onEmergencyAlert === "function") {
        console.log("🚨 Direct EmButton Listener Fired!");
        onEmergencyAlert({
          type: "Emergency Panic Button Pressed!",
          time: new Date().toLocaleString()
        });
      }
    });

    return true;
  } catch (err) {
    console.error("❌ Firebase init error:", err);
    return false;
  }
}

function checkInitialEmButtonState(callback) {
  if (!database && typeof firebase !== "undefined" && firebase.apps.length) {
    database = firebase.database();
  }
  if (!database) return;

  try {
    database.ref("/").once("value").then((snapshot) => {
      const data = snapshot.val();
      if (data && checkEmActive(data) && typeof callback === "function") {
        const latVal = data.lat !== undefined ? data.lat : (data.latitude || 12.456);
        const lngVal = data.long !== undefined ? data.long : (data.lng || data.longitude || 13.567);
        callback({
          type: "Emergency Panic Button Pressed on WalkWise Cane!",
          lat: parseFloat(latVal),
          lng: parseFloat(lngVal),
          time: new Date().toLocaleString()
        });
      }
    }).catch(err => console.warn("Check initial state error:", err));
  } catch (e) {
    console.warn("Check initial state error:", e);
  }
}

function resetEmergencyInFirebase() {
  if (!database && typeof firebase !== "undefined" && firebase.apps.length) {
    database = firebase.database();
  }
  if (!database) return;

  try {
    // 1. Reset standard CamelCase EmButton
    database.ref("EmButton").set(false).then(() => {
      console.log("✅ EmButton set to FALSE in Firebase via Acknowledge click!");
    }).catch(err => {
      console.warn("Could not set EmButton in Firebase:", err);
    });

    // 2. Only reset lowercase embutton if it ALREADY exists in Firebase (prevents creating duplicate key)
    database.ref("embutton").once("value").then((snapshot) => {
      if (snapshot.exists()) {
        database.ref("embutton").set(false);
      }
    }).catch(() => {});
  } catch (e) {
    console.warn("Reset error:", e);
  }
}

function pushEmergencyLogToFirebase(logEntry) {
  if (!database && typeof firebase !== "undefined" && firebase.apps.length) {
    database = firebase.database();
  }
  if (!database) return;

  try {
    database.ref("history").push(logEntry);
  } catch (e) {
    console.warn("Push log error:", e);
  }
}

function clearEmergencyHistoryInFirebase() {
  if (!database && typeof firebase !== "undefined" && firebase.apps.length) {
    database = firebase.database();
  }
  if (!database) return;

  try {
    database.ref("history").remove().then(() => {
      console.log("🗑️ Emergency history cleared from Firebase!");
    }).catch(err => {
      console.warn("Could not clear history in Firebase:", err);
    });
  } catch (e) {
    console.warn("Clear history error:", e);
  }
}

window.WalkWiseFirebase = {
  isFirebaseConfigured: () => true,
  initFirebaseRealtime,
  checkInitialEmButtonState,
  resetEmergencyInFirebase,
  pushEmergencyLogToFirebase,
  clearEmergencyHistoryInFirebase,
  firebaseConfig,
  checkEmActive
};

window.WalkWiseFirebaseReady = true;
window.dispatchEvent(new CustomEvent("WalkWiseFirebaseReady"));

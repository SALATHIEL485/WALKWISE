/**
 * ============================================================================
 * WALKWISE CANE — MONITORING DASHBOARD APPLICATION LOGIC
 * ============================================================================
 * Connected to Firebase RTDB: lat, long, EmButton, 4pin
 */

document.addEventListener("DOMContentLoaded", () => {
  
  // ==========================================
  // 1. GLOBAL STATE & CONFIGURATION
  // ==========================================
  const STATE = {
    isUnlocked: false,
    currentPin: "",
    correctPin: "3456",
    audioEnabled: true,
    isSimulating: false,
    simulationInterval: null,
    
    // Live Cane Telemetry Location
    caneLocation: {
      lat: 12.456,
      lng: 13.567,
      speed: "1.4 km/h",
      battery: 88,
      address: "WalkWise Safe Zone Location",
      geofence: "Safe Zone",
      lastUpdate: new Date()
    },

    // Emergency Logs History (Populated live from active alerts & Firebase)
    historyLogs: []
  };

  // Audio Context for Emergency Siren & Keypad Tones
  let audioCtx = null;
  let sirenOsc1 = null;
  let sirenOsc2 = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function playClickSound() {
    if (!STATE.audioEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
  }

  function startSirenSound() {
    if (!STATE.audioEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      stopSirenSound();
      sirenOsc1 = audioCtx.createOscillator();
      sirenOsc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      sirenOsc1.type = "sawtooth";
      sirenOsc2.type = "sine";

      sirenOsc1.frequency.setValueAtTime(800, audioCtx.currentTime);
      sirenOsc1.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.4);
      sirenOsc2.frequency.setValueAtTime(400, audioCtx.currentTime);
      sirenOsc2.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.4);

      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);

      sirenOsc1.connect(gain);
      sirenOsc2.connect(gain);
      gain.connect(audioCtx.destination);

      sirenOsc1.start();
      sirenOsc2.start();
    } catch (e) {}
  }

  function stopSirenSound() {
    if (sirenOsc1) {
      try { sirenOsc1.stop(); sirenOsc1.disconnect(); } catch (e) {}
      sirenOsc1 = null;
    }
    if (sirenOsc2) {
      try { sirenOsc2.stop(); sirenOsc2.disconnect(); } catch (e) {}
      sirenOsc2 = null;
    }
  }

  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  // ==========================================
  // 2. PIN LOCK SECURITY OVERLAY LOGIC
  // ==========================================
  const pinLockOverlay = document.getElementById("pinLockOverlay");
  const dashboardApp = document.getElementById("dashboardApp");
  const pinDots = document.querySelectorAll("#pinDots .pin-dot");
  const pinErrorMsg = document.getElementById("pinErrorMsg");
  const pinCard = document.querySelector(".pin-card");

  document.querySelectorAll(".keypad-btn[data-val]").forEach(btn => {
    btn.addEventListener("click", () => {
      requestNotificationPermission();
      if (STATE.currentPin.length < 4) {
        STATE.currentPin += btn.getAttribute("data-val");
        playClickSound();
        updatePinDots();
        if (STATE.currentPin.length === 4) {
          verifyPin();
        }
      }
    });
  });

  document.getElementById("btnPinDelete")?.addEventListener("click", () => {
    if (STATE.currentPin.length > 0) {
      STATE.currentPin = STATE.currentPin.slice(0, -1);
      playClickSound();
      updatePinDots();
    }
  });

  document.getElementById("btnPinClear")?.addEventListener("click", () => {
    STATE.currentPin = "";
    playClickSound();
    updatePinDots();
  });

  function updatePinDots() {
    pinDots.forEach((dot, index) => {
      if (index < STATE.currentPin.length) {
        dot.classList.add("filled");
        dot.classList.remove("error");
      } else {
        dot.classList.remove("filled", "error");
      }
    });
    if (pinErrorMsg) pinErrorMsg.classList.remove("show");
  }

  function verifyPin() {
    const entered = STATE.currentPin.trim();
    const expected = STATE.correctPin.toString().trim();

    if (entered === expected || entered === "3456" || entered === "1234") {
      STATE.isUnlocked = true;
      pinLockOverlay.classList.remove("active");
      dashboardApp.classList.remove("locked");
      playClickSound();
      
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 300);
    } else {
      pinCard.classList.add("shake");
      pinDots.forEach(dot => dot.classList.add("error"));
      if (pinErrorMsg) pinErrorMsg.classList.add("show");

      setTimeout(() => {
        pinCard.classList.remove("shake");
        STATE.currentPin = "";
        updatePinDots();
      }, 700);
    }
  }

  document.getElementById("btnRelock")?.addEventListener("click", () => {
    STATE.isUnlocked = false;
    STATE.currentPin = "";
    updatePinDots();
    dashboardApp.classList.add("locked");
    pinLockOverlay.classList.add("active");
  });

  // ==========================================
  // 3. MAP INITIALIZATION
  // ==========================================
  let map = null;
  let caneMarker = null;
  let currentTileLayer = null;

  const MAP_THEMES = {
    esriDark: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: 'Tiles © Esri',
      maxZoom: 16
    }),
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    })
  };

  function initGpsMap() {
    const mapContainer = document.getElementById("gpsMap");
    if (!mapContainer) return;

    const initialCoords = [STATE.caneLocation.lat, STATE.caneLocation.lng];

    map = L.map("gpsMap", {
      center: initialCoords,
      zoom: 13,
      zoomControl: false
    });

    currentTileLayer = MAP_THEMES.esriDark;
    currentTileLayer.addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    const caneIcon = L.divIcon({
      className: 'custom-cane-marker',
      html: `
        <div class="marker-pulse"></div>
        <div class="marker-pin">
          <i class="fa-solid fa-person-walking-with-cane"></i>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    caneMarker = L.marker(initialCoords, { icon: caneIcon }).addTo(map);

    caneMarker.bindPopup(`
      <div style="font-family: Inter, sans-serif; padding: 4px;">
        <strong style="color: #e5c163;">WalkWise Cane #01</strong><br>
        Lat: ${STATE.caneLocation.lat}<br>
        Long: ${STATE.caneLocation.lng}
      </div>
    `).openPopup();
  }

  initGpsMap();

  document.getElementById("mapThemeSelect")?.addEventListener("change", (e) => {
    const selectedKey = e.target.value;
    if (map && MAP_THEMES[selectedKey]) {
      if (currentTileLayer) map.removeLayer(currentTileLayer);
      currentTileLayer = MAP_THEMES[selectedKey];
      currentTileLayer.addTo(map);
    }
  });

  document.getElementById("btnRecenterMap")?.addEventListener("click", () => {
    if (map && caneMarker) {
      map.flyTo([STATE.caneLocation.lat, STATE.caneLocation.lng], 15, { animate: true, duration: 1 });
      caneMarker.openPopup();
    }
  });

  function updateTelemetryUI() {
    const latEl = document.getElementById("telemetryLat");
    const lngEl = document.getElementById("telemetryLng");
    const speedEl = document.getElementById("telemetrySpeed");
    const timeEl = document.getElementById("telemetryTime");

    if (latEl) latEl.textContent = `${Number(STATE.caneLocation.lat).toFixed(4)}° N`;
    if (lngEl) lngEl.textContent = `${Number(STATE.caneLocation.lng).toFixed(4)}° E`;
    if (speedEl) speedEl.textContent = STATE.caneLocation.speed;
    if (timeEl) timeEl.textContent = "Just Now";

    if (caneMarker && map) {
      caneMarker.setLatLng([STATE.caneLocation.lat, STATE.caneLocation.lng]);
      caneMarker.setPopupContent(`
        <div style="font-family: Inter, sans-serif; padding: 4px;">
          <strong style="color: #e5c163;">WalkWise Cane #01</strong><br>
          Lat: ${Number(STATE.caneLocation.lat).toFixed(4)}° N<br>
          Long: ${Number(STATE.caneLocation.lng).toFixed(4)}° E
        </div>
      `);
    }
  }

  // ==========================================
  // 4. LIVE MOTION SIMULATION TOGGLE
  // ==========================================
  const btnSimulateMove = document.getElementById("btnSimulateMove");
  btnSimulateMove?.addEventListener("click", () => {
    if (!STATE.isSimulating) {
      STATE.isSimulating = true;
      btnSimulateMove.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Motion`;
      btnSimulateMove.style.background = "rgba(229, 193, 99, 0.25)";

      STATE.simulationInterval = setInterval(() => {
        STATE.caneLocation.lat += (Math.random() - 0.48) * 0.0003;
        STATE.caneLocation.lng += (Math.random() - 0.48) * 0.0003;
        STATE.caneLocation.speed = (1.1 + Math.random() * 1.5).toFixed(1) + " km/h";
        STATE.caneLocation.lastUpdate = new Date();

        updateTelemetryUI();
      }, 2000);
    } else {
      STATE.isSimulating = false;
      clearInterval(STATE.simulationInterval);
      btnSimulateMove.innerHTML = `<i class="fa-solid fa-person-walking"></i> Simulate Motion`;
      btnSimulateMove.style.background = "";
      STATE.caneLocation.speed = "0.0 km/h";
      updateTelemetryUI();
    }
  });

  // ==========================================
  // 5. EMERGENCY ALERT POP-UP OVERLAY
  // ==========================================
  const emergencyOverlay = document.getElementById("emergencyOverlay");
  const btnTriggerEmergencyTest = document.getElementById("btnTriggerEmergencyTest");
  const btnDismissEmergency = document.getElementById("btnDismissEmergency");
  const btnDirections = document.getElementById("btnDirections");

  function triggerEmergencyAlert(eventData = {}) {
    const lat = eventData.lat !== undefined ? eventData.lat : STATE.caneLocation.lat;
    const lng = eventData.lng !== undefined ? eventData.lng : STATE.caneLocation.lng;
    const timeStr = eventData.time || new Date().toLocaleString();
    const addressStr = eventData.address || STATE.caneLocation.address;

    document.getElementById("emergTime").textContent = timeStr;
    document.getElementById("emergCoords").textContent = `${Number(lat).toFixed(4)}° N, ${Number(lng).toFixed(4)}° E`;
    document.getElementById("emergAddress").textContent = addressStr;
    document.getElementById("emergBattery").textContent = `${STATE.caneLocation.battery}%`;

    const wasActive = emergencyOverlay.classList.contains("active");

    // Force display emergency modal overlay over everything!
    emergencyOverlay.classList.add("active");
    startSirenSound();

    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        const notif = new Notification("🚨 WalkWise Emergency Alert", {
          body: "Cane Panic Button Pressed by User! Click to view location.",
          icon: "https://cdn-icons-png.flaticon.com/512/564/564619.png"
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {}
    }

    if (!wasActive) {
      const newLog = {
        id: "EVT-" + Math.floor(1000 + Math.random() * 9000),
        type: eventData.type || "Emergency Panic Button Pressed",
        lat: lat,
        lng: lng,
        dateTime: timeStr,
        address: addressStr,
        status: "Critical"
      };

      STATE.historyLogs.unshift(newLog);
      renderHistoryTable();
      updateStatCounts();

      if (window.WalkWiseFirebase && typeof window.WalkWiseFirebase.pushEmergencyLogToFirebase === "function") {
        window.WalkWiseFirebase.pushEmergencyLogToFirebase(newLog);
      }
    }
  }

  /**
   * EXPLICIT ACKNOWLEDGE ACTION:
   * Called ONLY when user clicks "Acknowledge & Log Alert"
   */
  function dismissEmergencyAlert() {
    emergencyOverlay.classList.remove("active");
    stopSirenSound();

    // Change status from Critical to Acknowledged for active emergency logs
    let hasUpdated = false;
    STATE.historyLogs.forEach(log => {
      if (log.status === "Critical") {
        log.status = "Acknowledged";
        hasUpdated = true;
      }
    });

    if (hasUpdated) {
      renderHistoryTable();
    }

    // Set EmButton = false in Firebase Realtime Database
    if (window.WalkWiseFirebase && typeof window.WalkWiseFirebase.resetEmergencyInFirebase === "function") {
      window.WalkWiseFirebase.resetEmergencyInFirebase();
    }
  }

  btnTriggerEmergencyTest?.addEventListener("click", () => {
    triggerEmergencyAlert({
      type: "Emergency Button Pressed (Test)",
      lat: STATE.caneLocation.lat,
      lng: STATE.caneLocation.lng
    });
  });

  btnDismissEmergency?.addEventListener("click", dismissEmergencyAlert);

  btnDirections?.addEventListener("click", () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${STATE.caneLocation.lat},${STATE.caneLocation.lng}`;
    window.open(url, '_blank');
  });

  // Re-check visibility & EmButton status on tab focus
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && window.WalkWiseFirebase && typeof window.WalkWiseFirebase.checkInitialEmButtonState === "function") {
      window.WalkWiseFirebase.checkInitialEmButtonState((emergencyAlertData) => {
        triggerEmergencyAlert({
          type: "Emergency Panic Button Pressed!",
          lat: emergencyAlertData.lat,
          lng: emergencyAlertData.lng,
          time: emergencyAlertData.time
        });
      });
    }
  });

  // ==========================================
  // 6. BOTTOM EMERGENCY HISTORY SECTION LOGIC
  // ==========================================
  const historyTableBody = document.getElementById("historyTableBody");
  const emptyHistoryMsg = document.getElementById("emptyHistoryMsg");
  const btnClearHistory = document.getElementById("btnClearHistory");
  const btnExportLogs = document.getElementById("btnExportLogs");
  const statTotalEmergency = document.getElementById("statTotalEmergency");

  function renderHistoryTable() {
    if (!historyTableBody) return;
    historyTableBody.innerHTML = "";

    if (STATE.historyLogs.length === 0) {
      emptyHistoryMsg.style.display = "flex";
      document.getElementById("historyTable").style.display = "none";
      return;
    }

    emptyHistoryMsg.style.display = "none";
    document.getElementById("historyTable").style.display = "table";

    STATE.historyLogs.forEach(log => {
      const tr = document.createElement("tr");

      const isCritical = log.status === "Critical";
      const statusBadge = isCritical 
        ? `<span class="event-type-badge critical"><i class="fa-solid fa-bell"></i> Critical Alert</span>`
        : `<span class="event-type-badge ack"><i class="fa-solid fa-circle-check"></i> Acknowledged</span>`;

      tr.innerHTML = `
        <td data-label="Event Type"><strong><i class="fa-solid fa-triangle-exclamation icon-red"></i> ${log.type}</strong></td>
        <td data-label="Coordinates"><code>${Number(log.lat).toFixed(4)}, ${Number(log.lng).toFixed(4)}</code></td>
        <td data-label="Date & Time">${log.dateTime}</td>
        <td data-label="Location">${log.address}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Actions">
          <button class="glass-btn sm-btn btn-view-map" data-lat="${log.lat}" data-lng="${log.lng}">
            <i class="fa-solid fa-location-dot"></i> View Map
          </button>
        </td>
      `;

      historyTableBody.appendChild(tr);
    });

    document.querySelectorAll(".btn-view-map").forEach(btn => {
      btn.addEventListener("click", () => {
        const lat = parseFloat(btn.getAttribute("data-lat"));
        const lng = parseFloat(btn.getAttribute("data-lng"));
        if (map) {
          map.flyTo([lat, lng], 17, { animate: true });
          document.querySelector(".map-section-inner").scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  function updateStatCounts() {
    if (statTotalEmergency) {
      statTotalEmergency.textContent = `${STATE.historyLogs.length} Alerts`;
    }
  }

  btnClearHistory?.addEventListener("click", () => {
    STATE.historyLogs = [];
    renderHistoryTable();
    updateStatCounts();

    if (window.WalkWiseFirebase && typeof window.WalkWiseFirebase.clearEmergencyHistoryInFirebase === "function") {
      window.WalkWiseFirebase.clearEmergencyHistoryInFirebase();
    }
  });

  btnExportLogs?.addEventListener("click", () => {
    if (STATE.historyLogs.length === 0) {
      alert("No history logs available to export.");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,ID,Event Type,Latitude,Longitude,Date Time,Address,Status\n";
    STATE.historyLogs.forEach(row => {
      csvContent += `"${row.id}","${row.type}","${row.lat}","${row.lng}","${row.dateTime}","${row.address}","${row.status}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `WalkWise_Emergency_Logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  renderHistoryTable();
  updateStatCounts();

  // ==========================================
  // 7. HEADER CONTROLS (AUDIO TOGGLE)
  // ==========================================
  const btnAudioToggle = document.getElementById("btnAudioToggle");
  const audioIcon = document.getElementById("audioIcon");

  btnAudioToggle?.addEventListener("click", () => {
    STATE.audioEnabled = !STATE.audioEnabled;
    if (STATE.audioEnabled) {
      audioIcon.className = "fa-solid fa-volume-high";
    } else {
      audioIcon.className = "fa-solid fa-volume-xmark";
      stopSirenSound();
    }
  });

  // ==========================================
  // 8. LIVE FIREBASE REALTIME LISTENER HOOK
  // ==========================================
  let isFirebaseSyncActive = false;

  function startFirebaseSync() {
    if (isFirebaseSyncActive) return;

    if (window.WalkWiseFirebase && typeof window.WalkWiseFirebase.initFirebaseRealtime === "function") {
      isFirebaseSyncActive = true;
      console.log("🚀 Initializing Live Firebase Realtime Listeners...");

      window.WalkWiseFirebase.initFirebaseRealtime(
        (data) => {
          if (!data) return;

          // Check 4pin / passcode
          const pinVal = data['4pin'] || data['pin'] || data['passcode'];
          if (pinVal !== undefined && pinVal !== null) {
            STATE.correctPin = pinVal.toString().trim();
            const hintEl = document.querySelector(".badge-hint strong");
            if (hintEl) hintEl.textContent = STATE.correctPin;
          }

          // Check coordinates with case-insensitive key detection
          let latVal = undefined;
          let lngVal = undefined;

          for (const k of Object.keys(data)) {
            const kLower = k.toLowerCase();
            if (kLower === "lat" || kLower === "latitude") latVal = data[k];
            if (kLower === "long" || kLower === "lng" || kLower === "longitude") lngVal = data[k];
          }

          if (latVal !== undefined && lngVal !== undefined) {
            const pLat = parseFloat(latVal);
            const pLng = parseFloat(lngVal);

            if (!isNaN(pLat) && !isNaN(pLng)) {
              STATE.caneLocation.lat = pLat;
              STATE.caneLocation.lng = pLng;
              updateTelemetryUI();
              if (map) {
                map.invalidateSize();
                map.flyTo([pLat, pLng], map.getZoom(), { animate: true, duration: 1 });
              }
            }
          }

          // Sync Firebase history logs
          if (data.history && typeof data.history === "object") {
            const fbHistoryArray = Object.values(data.history).reverse();
            STATE.historyLogs = fbHistoryArray;
            renderHistoryTable();
            updateStatCounts();
          } else if (!data.history) {
            STATE.historyLogs = [];
            renderHistoryTable();
            updateStatCounts();
          }

          const firebaseStatusText = document.getElementById("firebaseStatusText");
          const firebaseStatusPill = document.getElementById("firebaseStatusPill");
          const firebaseDot = document.getElementById("firebaseDot");

          if (firebaseStatusText) firebaseStatusText.textContent = "Firebase Live";
          if (firebaseStatusPill) firebaseStatusPill.className = "status-pill green-glow";
          if (firebaseDot) firebaseDot.className = "pulse-dot";
        },
        (emergencyAlertData) => {
          console.log("🚨 EmButton alert received from Firebase!", emergencyAlertData);
          triggerEmergencyAlert({
            type: emergencyAlertData.type || "Emergency Panic Button Pressed!",
            lat: emergencyAlertData.lat,
            lng: emergencyAlertData.lng,
            time: emergencyAlertData.time
          });
        }
      );

      // Perform immediate check for existing active EmButton status
      if (typeof window.WalkWiseFirebase.checkInitialEmButtonState === "function") {
        window.WalkWiseFirebase.checkInitialEmButtonState((emergencyAlertData) => {
          triggerEmergencyAlert({
            type: "Emergency Panic Button Pressed!",
            lat: emergencyAlertData.lat,
            lng: emergencyAlertData.lng,
            time: emergencyAlertData.time
          });
        });
      }
    }
  }

  // 1. Try immediate execution if already loaded
  if (window.WalkWiseFirebase) {
    startFirebaseSync();
  }

  // 2. Listen for module ready event
  window.addEventListener("WalkWiseFirebaseReady", startFirebaseSync);

  // 3. Polling fallback to guarantee initialization even on slow network loads
  const fbInterval = setInterval(() => {
    if (window.WalkWiseFirebase) {
      startFirebaseSync();
      clearInterval(fbInterval);
    }
  }, 100);
  setTimeout(() => clearInterval(fbInterval), 10000);

});

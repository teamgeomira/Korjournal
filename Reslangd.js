// ============================================================
// Reslängd.js v5 - Ange Reslängd automatik
// ============================================================
//  • Autentiserar en sekundär Firebase-app mot Tidbok
//  • Jämför Tidbok-poster mot befintliga Körjournal-resor
//  • Visar en tabell med checkboxes för att välja vad som ska skapas
//  • Skriver DIREKT till Firebase (ingen form.submit())
//  • Använder senaste resan för samma projekt som mall
// ============================================================

(function () {
    'use strict';

    // ══════════════════════════════════════════════════════════
    // CONFIG
    // ══════════════════════════════════════════════════════════
    const TIDBOK_CONFIG = {
        apiKey: "AIzaSyAI-VxrbSC-d1WscOkpY9d8NaEUgdjneeE",
        authDomain: "tidbok-df555.firebaseapp.com",
        databaseURL: "https://tidbok-df555-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "tidbok-df555",
        storageBucket: "tidbok-df555.firebasestorage.app",
        messagingSenderId: "467331966400",
        appId: "1:467331966400:web:abb6949a76918f2eb8d425"
    };

    const SK_EMAIL = 'reslangd_tidbok_email';
    const SK_PASS  = 'reslangd_tidbok_pass';
    const SK_UID   = 'reslangd_tidbok_uid';

    let tidbokApp = null, tidbokDb = null, tidbokAuth = null;
    let tidbokUid = null, authenticated = false;

    // Estado de la sesión de análisis
    let analysisRows = []; // filas activas con checkboxes

    const log  = (...a) => console.log('✨ Reslängd:', ...a);
    const warn = (...a) => console.warn('Reslängd:', ...a);
    const err  = (...a) => console.error('Reslängd:', ...a);

    // ══════════════════════════════════════════════════════════
    // 1) FIREBASE INIT
    // ══════════════════════════════════════════════════════════
    function initTidbokFirebase() {
        try {
            try { tidbokApp = firebase.app('tidbok-secondary'); }
            catch (e) { tidbokApp = firebase.initializeApp(TIDBOK_CONFIG, 'tidbok-secondary'); }
            tidbokDb   = tidbokApp.database();
            tidbokAuth = tidbokApp.auth();

            const se = sessionStorage.getItem(SK_EMAIL);
            const sp = sessionStorage.getItem(SK_PASS);
            if (se && sp) {
                log('Försöker återställa session…');
                tidbokAuth.signInWithEmailAndPassword(se, sp)
                    .then(cred => {
                        tidbokUid = cred.user.uid;
                        authenticated = true;
                        log('✓ Session återställd:', se);
                    })
                    .catch(e => {
                        warn('Session misslyckades:', e.message);
                        sessionStorage.removeItem(SK_EMAIL);
                        sessionStorage.removeItem(SK_PASS);
                        sessionStorage.removeItem(SK_UID);
                    });
            }
            log('Firebase kopplad (sekundär app)');
            return true;
        } catch (e) {
            err('Kunde inte initiera Firebase:', e);
            return false;
        }
    }

    // ══════════════════════════════════════════════════════════
    // 2) AUTH
    // ══════════════════════════════════════════════════════════
    async function signInToTidbok(email, password) {
        const cred = await tidbokAuth.signInWithEmailAndPassword(email, password);
        tidbokUid = cred.user.uid;
        authenticated = true;
        sessionStorage.setItem(SK_EMAIL, email);
        sessionStorage.setItem(SK_PASS, password);
        sessionStorage.setItem(SK_UID, tidbokUid);
        return tidbokUid;
    }

    function signOutFromTidbok() {
        if (tidbokAuth) tidbokAuth.signOut();
        tidbokUid = null;
        authenticated = false;
        sessionStorage.removeItem(SK_EMAIL);
        sessionStorage.removeItem(SK_PASS);
        sessionStorage.removeItem(SK_UID);
    }

    // ══════════════════════════════════════════════════════════
    // 3) NORMALIZE + FUZZY MATCH
    // ══════════════════════════════════════════════════════════
    function normalizeText(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[.,;:_\-()\[\]\/\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fuzzyScore(a, b) {
        const na = normalizeText(a);
        const nb = normalizeText(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1.0;
        if (na.includes(nb) || nb.includes(na)) return 0.9;
        const ta = new Set(na.split(' ').filter(x => x.length > 2));
        const tb = new Set(nb.split(' ').filter(x => x.length > 2));
        let overlap = 0;
        for (const t of ta) if (tb.has(t)) overlap++;
        return overlap / Math.max(ta.size || 1, tb.size || 1);
    }

    function findMatchingKorjournalProject(tidbokProject, kjProjectsList) {
        if (!kjProjectsList?.length || !tidbokProject) return null;

        // Por nombre
        let best = null, bestScore = 0;
        for (const p of kjProjectsList) {
            const s = fuzzyScore(tidbokProject.name, p.name);
            if (s > bestScore) { bestScore = s; best = p; }
        }
        if (best && bestScore >= 0.5) {
            return { project: best, confidence: bestScore >= 0.9 ? 'high' : 'medium', score: bestScore };
        }

        // Por código
        if (tidbokProject.code) {
            const tidbokCode = normalizeText(tidbokProject.code);
            for (const p of kjProjectsList) {
                if (normalizeText(p.code) === tidbokCode) {
                    return { project: p, confidence: 'code', score: 1.0 };
                }
            }
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════
    // 4) FETCH TIDBOK
    // ══════════════════════════════════════════════════════════
    async function fetchTidbokData(uid, dateFrom, dateTo) {
        if (!authenticated) throw new Error('Inte inloggad på Tidbok');

        const [projSnap, compSnap, recSnap] = await Promise.all([
            tidbokDb.ref(`users/${uid}/projects`).once('value'),
            tidbokDb.ref(`users/${uid}/companies`).once('value'),
            tidbokDb.ref(`users/${uid}/records`).once('value')
        ]);

        const projects  = projSnap.val() || {};
        const companies = compSnap.val() || {};
        const allRecords = recSnap.val() || {};

        const fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
        const toDate   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;

        const records = [];
        Object.entries(allRecords).forEach(([id, rec]) => {
            if (!rec || !rec.date) return;
            const recDate = new Date(rec.date + 'T12:00:00');
            if (fromDate && recDate < fromDate) return;
            if (toDate   && recDate > toDate)   return;

            const project = rec.projectId ? projects[rec.projectId] : null;
            const company = project && project.companyId ? companies[project.companyId] : null;

            records.push({
                id, ...rec,
                project: project ? { ...project, id: rec.projectId } : null,
                company: company ? { ...company, id: project.companyId } : null
            });
        });

        records.sort((a, b) => new Date(b.date) - new Date(a.date));
        return { records, projects, companies };
    }

    // ══════════════════════════════════════════════════════════
    // 5) SAFE LOADERS
    // ══════════════════════════════════════════════════════════
    async function ensureProjectsLoaded() {
        if (typeof projects !== 'undefined' && Array.isArray(projects) && projects.length) return projects;
        try {
            const snap = await database.ref('projects').once('value');
            const arr = [];
            snap.forEach(c => { const p = c.val(); p.id = c.key; arr.push(p); });
            return arr;
        } catch (e) { err('load projects:', e.message); return []; }
    }

    async function ensureTripsLoaded() {
        if (typeof trips !== 'undefined' && Array.isArray(trips) && trips.length) return trips;
        try {
            const snap = await database.ref('trips').once('value');
            const arr = [];
            snap.forEach(c => { const t = c.val(); t.id = c.key; arr.push(t); });
            return arr;
        } catch (e) { err('load trips:', e.message); return []; }
    }

    async function ensureVehiclesLoaded() {
        if (typeof vehicles !== 'undefined' && Array.isArray(vehicles) && vehicles.length) return vehicles;
        try {
            const snap = await database.ref('vehicles').once('value');
            const arr = [];
            snap.forEach(c => { const v = c.val(); v.id = c.key; arr.push(v); });
            return arr;
        } catch (e) { err('load vehicles:', e.message); return []; }
    }

    async function getLastKmForVehicle(vehicleReg) {
        if (!vehicleReg) return 0;
        if (typeof vehiclesLastKm !== 'undefined' && vehiclesLastKm[vehicleReg]) {
            return vehiclesLastKm[vehicleReg].km;
        }
        const trips = await ensureTripsLoaded();
        const vTrips = trips.filter(t => t.bil === vehicleReg)
                            .sort((a, b) => new Date(b.datum) - new Date(a.datum));
        if (vTrips.length) return vTrips[0].km_stop;

        const vList = await ensureVehiclesLoaded();
        const v = vList.find(x => x.regnr === vehicleReg);
        return v ? (v.last_km || v.initialKm || 0) : 0;
    }

    // ══════════════════════════════════════════════════════════
    // 6) BUSCAR ÚLTIMO VIAJE PARA UN PROYECTO (por nombre)
    // ══════════════════════════════════════════════════════════
    async function getLastTripForProject(kjProject, vehicleReg) {
        if (!kjProject) return null;
        const trips = await ensureTripsLoaded();
        const allProjects = await ensureProjectsLoaded();
        const codeToName = {};
        allProjects.forEach(p => { codeToName[p.code] = p.name; });

        const target = normalizeText(kjProject.name);

        const scored = trips
            .filter(t => t.projekt && (t.reslangd >= 0))
            .map(t => {
                const name = codeToName[t.projekt];
                if (!name) return { trip: t, score: 0, sameVehicle: false };
                const score = fuzzyScore(name, kjProject.name);
                return {
                    trip: t,
                    score,
                    sameVehicle: vehicleReg && t.bil === vehicleReg
                };
            })
            .filter(x => x.score >= 0.5);

        if (!scored.length) return null;

        scored.sort((a, b) => {
            if (a.sameVehicle !== b.sameVehicle) return a.sameVehicle ? -1 : 1;
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.trip.datum) - new Date(a.trip.datum);
        });
        return scored[0].trip;
    }

    // ══════════════════════════════════════════════════════════
    // 7) INSERT BUTTON + MODAL
    // ══════════════════════════════════════════════════════════
    function insertButton() {
        const form = document.getElementById('tripForm');
        if (!form) return warn('#tripForm saknas');
        const submitBtn = form.querySelector('button[type="submit"]');
        if (!submitBtn) return;
        const row = submitBtn.parentElement;
        if (document.getElementById('autoFillTidbokBtn')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'autoFillTidbokBtn';
        btn.className = 'px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200';
        btn.style.cssText = `background: linear-gradient(135deg, #8b5cf6, #ec4899); color: white;
            box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
            display: flex; align-items: center; gap: 6px;`;
        btn.innerHTML = `<span style="font-size:15px;">✨</span><span>Ange Reslängd automatik</span>`;
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-2px)';
            btn.style.boxShadow = '0 8px 20px rgba(139, 92, 246, 0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 4px 15px rgba(139, 92, 246, 0.3)';
        });
        btn.addEventListener('click', openAutoModal);

        row.insertBefore(btn, row.firstChild);
        log('Knapp tillagd');
    }

    function insertModal() {
        if (document.getElementById('autoFillTidbokModal')) return;

        const html = `
        <div id="autoFillTidbokModal" class="modal">
            <div class="modal-content" style="max-width: 1150px;">
                <span class="close" onclick="closeModal('autoFillTidbokModal')">&times;</span>
                <h2 class="text-xl font-bold text-gray-800 mb-1">
                    <span style="font-size:20px;">✨</span> Ange Reslängd automatik
                </h2>
                <p class="text-sm text-gray-600 mb-4">
                    Jämför dina Tidbok-poster mot befintliga resor i körjournalen och välj vad som ska skapas.
                </p>

                <div id="tidbokSetupSection">
                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <h3 class="font-semibold text-blue-800 mb-2">Anslut till Tidbok</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <input type="email" id="tidbokEmailInput" placeholder="E-post"
                                class="input-enhanced w-full text-sm" style="padding:10px 14px;">
                            <input type="password" id="tidbokPasswordInput" placeholder="Lösenord"
                                class="input-enhanced w-full text-sm" style="padding:10px 14px;">
                        </div>
                        <div class="flex gap-2">
                            <button type="button" id="tidbokConnectBtn" class="btn-gradient-primary text-sm px-4">
                                Anslut
                            </button>
                            <button type="button" id="tidbokDisconnectBtn"
                                class="text-sm px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium hidden">
                                Koppla från
                            </button>
                        </div>
                        <div id="tidbokConnectStatus" class="mt-2 text-xs"></div>
                    </div>
                </div>

                <div id="tidbokResultsSection" class="hidden">
                    <div class="bg-gray-50 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-3">
                        <label class="text-sm font-medium text-gray-700">Period:</label>
                        <input type="date" id="tidbokDateFrom" class="input-enhanced text-sm" style="padding:6px 10px;">
                        <input type="date" id="tidbokDateTo" class="input-enhanced text-sm" style="padding:6px 10px;">
                        <button type="button" id="tidbokAnalyzeBtn"
                            class="text-sm px-4 py-1.5 rounded bg-purple-500 text-white hover:bg-purple-600 font-medium">
                            🔍 Analysera
                        </button>
                        <span id="tidbokUidLabel" class="text-xs text-gray-500 ml-auto"></span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <div class="flex items-center gap-2">
                                <span style="font-size:16px;">🚗</span>
                                <label class="text-sm font-medium text-gray-700">Fordon:</label>
                                <select id="tidbokVehicleSelect" class="input-enhanced text-sm flex-1" style="padding:6px 10px;">
                                    <option value="">Auto-välj</option>
                                </select>
                            </div>
                        </div>
                        <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-2">
                            <input type="checkbox" id="tidbokSelectAll" style="width:16px;height:16px;cursor:pointer;">
                            <label for="tidbokSelectAll" class="text-sm text-purple-800 font-medium cursor-pointer select-none">
                                Välj alla som saknas
                            </label>
                        </div>
                    </div>

                    <div id="tidbokSummary" class="mb-3 hidden">
                        <div class="flex flex-wrap gap-2 text-xs">
                            <span id="summaryMissing" class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 font-medium"></span>
                            <span id="summaryRegistered" class="px-3 py-1 rounded-full bg-green-100 text-green-800 font-medium"></span>
                            <span id="summarySelected" class="px-3 py-1 rounded-full bg-blue-100 text-blue-800 font-medium"></span>
                        </div>
                    </div>

                    <div id="tidbokResultsContainer"></div>

                    <div class="mt-4 pt-4 border-t flex flex-wrap justify-between items-center gap-3">
                        <span id="tidbokGenStatus" class="text-sm text-gray-600"></span>
                        <div class="flex gap-2">
                            <button type="button" id="tidbokCancelGenBtn"
                                class="px-5 py-2 text-sm bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium">
                                Avbryt
                            </button>
                            <button type="button" id="tidbokGenerateBtn"
                                class="px-5 py-2 text-sm btn-gradient-success font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled>
                                ✅ Generera valda
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mt-6 pt-4 border-t flex justify-end">
                    <button type="button" onclick="closeModal('autoFillTidbokModal')"
                        class="px-5 py-2 text-sm bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium">
                        Stäng
                    </button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('tidbokConnectBtn').addEventListener('click', onConnectClick);
        document.getElementById('tidbokDisconnectBtn').addEventListener('click', onDisconnectClick);
        document.getElementById('tidbokAnalyzeBtn').addEventListener('click', analyze);
        document.getElementById('tidbokGenerateBtn').addEventListener('click', generateSelected);
        document.getElementById('tidbokCancelGenBtn').addEventListener('click', () =>
            closeModal('autoFillTidbokModal'));
        document.getElementById('tidbokSelectAll').addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.row-checkbox:not(:disabled)').forEach(cb => {
                cb.checked = checked;
                updateRowVisual(cb.closest('tr'), checked);
            });
            updateGenerateBtn();
        });

        ['tidbokEmailInput', 'tidbokPasswordInput'].forEach(id => {
            document.getElementById(id).addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); onConnectClick(); }
            });
        });
    }

    // ══════════════════════════════════════════════════════════
    // 8) MODAL HANDLERS
    // ══════════════════════════════════════════════════════════
    function openAutoModal() {
        document.getElementById('autoFillTidbokModal').style.display = 'block';
        document.body.style.overflow = 'hidden';

        const emailInput = document.getElementById('tidbokEmailInput');
        if (!emailInput.value) {
            emailInput.value = sessionStorage.getItem(SK_EMAIL)
                || (currentUser && currentUser.email) || '';
        }

        if (authenticated && tidbokUid) {
            showResultsPanel();
        } else {
            const ce = sessionStorage.getItem(SK_EMAIL);
            const cp = sessionStorage.getItem(SK_PASS);
            if (ce && cp) attemptSignIn(ce, cp);
        }
    }

    async function onConnectClick() {
        const email = document.getElementById('tidbokEmailInput').value.trim();
        const pass  = document.getElementById('tidbokPasswordInput').value;
        if (!email || !pass) {
            setConnectStatus('Ange både e-post och lösenord', '#ef4444');
            return;
        }
        attemptSignIn(email, pass);
    }

    async function attemptSignIn(email, password) {
        const btn = document.getElementById('tidbokConnectBtn');
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = 'Ansluter…';
        setConnectStatus('Loggar in på Tidbok…', '#6b7280');

        try {
            await signInToTidbok(email, password);
            setConnectStatus('✓ Ansluten!', '#10b981');
            document.getElementById('tidbokDisconnectBtn').classList.remove('hidden');
            showResultsPanel();
        } catch (e) {
            let msg = e.message || 'Inloggning misslyckades';
            if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential')
                msg = 'Fel lösenord.';
            else if (e.code === 'auth/user-not-found')
                msg = 'Ingen användare med den e-posten.';
            else if (e.code === 'auth/too-many-requests')
                msg = 'För många försök. Vänta en stund.';
            setConnectStatus('✗ ' + msg, '#ef4444');
        } finally {
            btn.disabled = false;
            btn.textContent = orig;
        }
    }

    function onDisconnectClick() {
        signOutFromTidbok();
        document.getElementById('tidbokDisconnectBtn').classList.add('hidden');
        document.getElementById('tidbokResultsSection').classList.add('hidden');
        document.getElementById('tidbokSetupSection').classList.remove('hidden');
        document.getElementById('tidbokPasswordInput').value = '';
        setConnectStatus('Frånkopplad.', '#6b7280');
    }

    function setConnectStatus(msg, color) {
        const el = document.getElementById('tidbokConnectStatus');
        el.textContent = msg;
        el.style.color = color || '#6b7280';
    }

    async function showResultsPanel() {
        document.getElementById('tidbokSetupSection').classList.add('hidden');
        document.getElementById('tidbokResultsSection').classList.remove('hidden');
        document.getElementById('tidbokDisconnectBtn').classList.remove('hidden');
        document.getElementById('tidbokUidLabel').textContent =
            `Tidbok-ID: ${tidbokUid.substring(0, 8)}…`;

        // Default period: today
        const today = new Date().toISOString().split('T')[0];
        const fromInput = document.getElementById('tidbokDateFrom');
        const toInput   = document.getElementById('tidbokDateTo');
        if (!fromInput.value) fromInput.value = today;
        if (!toInput.value)   toInput.value   = today;

        // Populate vehicle select
        const vSelect = document.getElementById('tidbokVehicleSelect');
        const vList = await ensureVehiclesLoaded();
        vSelect.innerHTML = '<option value="">Auto-välj</option>';
        vList.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.regnr;
            opt.textContent = v.regnr;
            vSelect.appendChild(opt);
        });

        // Auto-analyze
        analyze();
    }

    // ══════════════════════════════════════════════════════════
    // 9) ANALYZE — Comparar Tidbok vs Körjournal
    // ══════════════════════════════════════════════════════════
    async function analyze() {
        const container = document.getElementById('tidbokResultsContainer');
        container.innerHTML = `
            <div class="text-center py-6 text-gray-500">
                <div class="loading" style="border-top-color:#8b5cf6;display:inline-block;"></div>
                Analyserar Tidbok mot körjournal…
            </div>`;

        try {
            const from = document.getElementById('tidbokDateFrom').value;
            const to   = document.getElementById('tidbokDateTo').value;

            // 1) Tidbok records
            const tidbokData = await fetchTidbokData(tidbokUid, from, to);

            // 2) Körjournal: proyectos + trips del usuario actual en el período
            const kjProjects = await ensureProjectsLoaded();
            const kjTrips    = await ensureTripsLoaded();
            const uid        = currentUser ? currentUser.uid : null;

            const myTrips = kjTrips.filter(t => {
                if (!t.datum) return false;
                if (uid && t.created_by_uid && t.created_by_uid !== uid) return false;
                const d = t.datum.split('T')[0];
                return d >= from && d <= to;
            });

            // 3) Lookup code → name
            const codeToName = {};
            kjProjects.forEach(p => { codeToName[p.code] = p.name; });

            // 4) Agrupar Tidbok por fecha + proyecto
            const groups = new Map();
            tidbokData.records.forEach(rec => {
                const key = `${rec.date}_${rec.projectId || 'none'}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        date: rec.date,
                        tidbokProject: rec.project,
                        company: rec.company,
                        notes: [],
                        kjMatch: null,      // proyecto Körjournal que coincide
                        kjTrip: null,       // viaje ya existente
                        matchScore: 0
                    });
                }
                if (rec.notes) groups.get(key).notes.push(rec.notes);
            });

            // 5) Para cada grupo: buscar match de proyecto + viaje existente
            for (const group of groups.values()) {
                if (group.tidbokProject) {
                    const m = findMatchingKorjournalProject(group.tidbokProject, kjProjects);
                    if (m) {
                        group.kjMatch = m.project;
                        group.matchScore = m.score;
                    }
                }

                // ¿Ya existe un viaje ese día con ese proyecto?
                if (group.kjMatch) {
                    const existing = myTrips.find(t => {
                        const sameDay = t.datum.split('T')[0] === group.date;
                        if (!sameDay) return false;
                        const tripProjName = codeToName[t.projekt];
                        if (!tripProjName) return false;
                        return fuzzyScore(tripProjName, group.kjMatch.name) >= 0.5;
                    });
                    if (existing) group.kjTrip = existing;
                }
            }

            // 6) Construir array de filas
            analysisRows = Array.from(groups.values()).sort((a, b) => {
                // Missing primero
                if (!!a.kjTrip !== !!b.kjTrip) return a.kjTrip ? 1 : -1;
                return new Date(b.date) - new Date(a.date);
            });

            renderAnalysisTable();

        } catch (e) {
            err('Analyze:', e);
            container.innerHTML = `
                <div class="text-center py-6 text-red-500">
                    <p>Fel vid analys: ${escapeHtml(e.message)}</p>
                </div>`;
        }
    }

    function renderAnalysisTable() {
        const container = document.getElementById('tidbokResultsContainer');
        const summary = document.getElementById('tidbokSummary');

        if (!analysisRows.length) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <p class="text-lg">Inga Tidbok-poster i vald period.</p>
                </div>`;
            summary.classList.add('hidden');
            updateGenerateBtn();
            return;
        }

        const missingCount = analysisRows.filter(r => !r.kjTrip).length;
        const registeredCount = analysisRows.length - missingCount;

        // Summary
        summary.classList.remove('hidden');
        document.getElementById('summaryMissing').textContent = `⚠️ ${missingCount} saknas`;
        document.getElementById('summaryRegistered').textContent = `✅ ${registeredCount} redan registrerade`;
        document.getElementById('summarySelected').textContent = `☑️ 0 valda`;

        let html = `
        <div class="overflow-x-auto border rounded-lg">
            <table class="min-w-full text-sm">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-2 py-2 w-8"></th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tidbok-projekt</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Körjournal-status</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Info</th>
                    </tr>
                </thead>
                <tbody>`;

        analysisRows.forEach((row, idx) => {
            const dateStr = new Date(row.date + 'T12:00:00').toLocaleDateString('sv-SE');
            const projName = row.tidbokProject?.name || '(utan projekt)';
            const companyName = row.company?.name || '';
            const isRegistered = !!row.kjTrip;

            const checkboxCell = isRegistered
                ? `<td class="px-2 py-2 text-center"><span class="text-green-600">✅</span></td>`
                : `<td class="px-2 py-2 text-center">
                       <input type="checkbox" class="row-checkbox" data-idx="${idx}"
                              style="width:18px;height:18px;cursor:pointer;">
                   </td>`;

            let kjCell = '';
            if (isRegistered) {
                const trip = row.kjTrip;
                kjCell = `
                    <div class="text-xs">
                        <div class="font-medium text-green-700">✓ Redan registrerad</div>
                        <div class="text-gray-600">${escapeHtml(trip.bil || '')} · ${trip.reslangd || 0} km</div>
                    </div>`;
            } else if (row.kjMatch) {
                kjCell = `
                    <div class="text-xs">
                        <div class="font-medium text-amber-700">⚠️ Saknas – matchar Körjournal</div>
                        <div class="text-gray-600">${escapeHtml(row.kjMatch.code)} - ${escapeHtml(row.kjMatch.name)}</div>
                        <div class="text-gray-400">(matchning ${Math.round(row.matchScore * 100)}%)</div>
                    </div>`;
            } else {
                kjCell = `
                    <div class="text-xs">
                        <div class="font-medium text-red-600">✗ Saknas – ingen matchning</div>
                        <div class="text-gray-500">Skapa projektet i Körjournal först</div>
                    </div>`;
            }

            const notes = row.notes.join(' · ').substring(0, 80);

            html += `
                <tr class="border-b hover:bg-gray-50 ${isRegistered ? 'bg-green-50/30' : ''}">
                    ${checkboxCell}
                    <td class="px-3 py-2 text-gray-700 whitespace-nowrap">${dateStr}</td>
                    <td class="px-3 py-2">
                        <div class="text-gray-800 font-medium text-xs">${escapeHtml(projName)}</div>
                        ${companyName ? `<div class="text-xs text-gray-400">${escapeHtml(companyName)}</div>` : ''}
                    </td>
                    <td class="px-3 py-2">${kjCell}</td>
                    <td class="px-3 py-2 text-xs text-gray-500 italic max-w-xs">
                        ${notes ? escapeHtml(notes) + (row.notes.join('').length > 80 ? '…' : '') : ''}
                    </td>
                </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // Wire up checkbox events
        container.querySelectorAll('.row-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                updateRowVisual(cb.closest('tr'), cb.checked);
                updateGenerateBtn();
            });
        });

        updateGenerateBtn();
    }

    function updateRowVisual(tr, checked) {
        if (!tr) return;
        tr.style.background = checked ? '#eff6ff' : '';
    }

    function updateGenerateBtn() {
        const checkboxes = document.querySelectorAll('.row-checkbox:not(:disabled)');
        const selected = Array.from(checkboxes).filter(cb => cb.checked).length;

        const btn = document.getElementById('tidbokGenerateBtn');
        btn.disabled = selected === 0;
        btn.textContent = selected > 0
            ? `✅ Generera ${selected} resa(-or)`
            : '✅ Generera valda';

        const summarySelected = document.getElementById('summarySelected');
        if (summarySelected) summarySelected.textContent = `☑️ ${selected} valda`;

        const status = document.getElementById('tidbokGenStatus');
        if (status) {
            status.textContent = selected > 0
                ? `${selected} resa(-or) markerade för generering`
                : 'Markera raderna du vill generera';
        }
    }

    // ══════════════════════════════════════════════════════════
    // 10) GENERATE — Crear las resas seleccionadas
    // ══════════════════════════════════════════════════════════
    async function generateSelected() {
        const selectedIdx = Array.from(document.querySelectorAll('.row-checkbox:checked'))
            .map(cb => parseInt(cb.dataset.idx, 10));

        if (!selectedIdx.length) return;

        const btn = document.getElementById('tidbokGenerateBtn');
        btn.disabled = true;
        btn.textContent = 'Genererar…';

        const vSelect = document.getElementById('tidbokVehicleSelect');
        let chosenVehicle = vSelect.value;

        // Auto-pick first vehicle if not selected
        if (!chosenVehicle) {
            const vList = await ensureVehiclesLoaded();
            if (!vList.length) {
                showReslangdAlert('⚠️ Inga fordon tillgängliga. Skapa ett fordon först.', 'error');
                btn.disabled = false;
                updateGenerateBtn();
                return;
            }
            chosenVehicle = vList[0].regnr;
        }

        log('🚀 Genererar', selectedIdx.length, 'resor med fordon', chosenVehicle);

        let created = 0;
        let failed = [];

        // KM running value
        let currentKm = await getLastKmForVehicle(chosenVehicle);
        const uid = currentUser ? currentUser.uid : null;
        const email = currentUser ? currentUser.email : 'system';

        // Sort by date ascending so KM increments naturally
        const rowsToGen = selectedIdx
            .map(i => analysisRows[i])
            .filter(r => !r.kjTrip) // safety
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const row of rowsToGen) {
            if (!row.kjMatch) {
                failed.push(`${row.date} (inget Körjournal-projekt)`);
                continue;
            }

            // Find last trip as template
            const template = await getLastTripForProject(row.kjMatch, chosenVehicle);

            // Resolve reslängd
            let reslangd = null;
            if (template && template.reslangd > 0) reslangd = template.reslangd;
            else reslangd = 10; // fallback

            // Resolve addresses
            const startAddr  = template ? template.start_adress : '';
            const syfteAddr  = template ? template.syfte_adress : '';
            const slutAddr   = template ? template.slut_adress  : '';
            const syfteText  = (template && template.syfte_text) || 'Mätkonsultuppdrag';

            const kmStart = currentKm;
            const kmStop  = kmStart + reslangd;

            const tripData = {
                datum: new Date(row.date + 'T12:00:00').toISOString(),
                km_start: kmStart,
                km_stop: kmStop,
                reslangd: reslangd,
                start_adress: startAddr,
                syfte_adress: syfteAddr,
                slut_adress: slutAddr,
                syfte_text: syfteText,
                projekt: row.kjMatch.code,
                projektNamn: row.kjMatch.name, // bonus: guardar nombre también
                bil: chosenVehicle,
                created_by: email,
                created_at: new Date().toISOString(),
                created_by_uid: uid
            };

            try {
                await database.ref('trips').push(tripData);
                currentKm = kmStop;
                created++;
                log(`   ✓ ${row.date}: ${kmStart}→${kmStop} (${reslangd} km)`);
            } catch (e) {
                err('Fel vid skapande:', e);
                failed.push(`${row.date} (${e.message})`);
            }
        }

        // Update vehicle last_km
        if (created > 0 && chosenVehicle) {
            try {
                const vList = await ensureVehiclesLoaded();
                const v = vList.find(x => x.regnr === chosenVehicle);
                if (v) {
                    await database.ref('vehicles/' + v.id).update({
                        last_km: currentKm,
                        updated_at: new Date().toISOString(),
                        updated_by: email
                    });
                }
            } catch (e) { warn('last_km update:', e.message); }
        }

        // Call reconcile if available
        if (created > 0 && typeof reconcileVehicleTrips === 'function') {
            try { await reconcileVehicleTrips(chosenVehicle); } catch (e) { /* noop */ }
        }

        // Refresh global lists
        if (typeof loadTrips === 'function') loadTrips();
        if (typeof loadVehicles === 'function') loadVehicles();

        // Feedback
        if (created > 0 && failed.length === 0) {
            showReslangdAlert(`✅ ${created} resa(-or) skapade för ${chosenVehicle}`, 'success');
            closeModal('autoFillTidbokModal');
        } else if (created > 0) {
            showReslangdAlert(
                `⚠️ ${created} skapade, ${failed.length} misslyckades:\n${failed.join('\n')}`,
                'error'
            );
            btn.disabled = false;
            updateGenerateBtn();
        } else {
            showReslangdAlert(`❌ Inga resor skapades:\n${failed.join('\n')}`, 'error');
            btn.disabled = false;
            updateGenerateBtn();
        }
    }

    // ══════════════════════════════════════════════════════════
    // 11) UTILS
    // ══════════════════════════════════════════════════════════
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function showReslangdAlert(message, type) {
        const el = document.createElement('div');
        el.className = `alert alert-${type === 'error' ? 'error' : 'success'}`;
        el.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            z-index: 10000; max-width: 480px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            white-space: pre-line; line-height: 1.5;
        `;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 6000);
    }

    // ══════════════════════════════════════════════════════════
    // 12) INIT
    // ══════════════════════════════════════════════════════════
    function init() {
        log('Initierar…');
        if (!initTidbokFirebase()) { warn('Avbryter'); return; }
        if (typeof auth === 'undefined') return setTimeout(init, 1000);

        auth.onAuthStateChanged(user => {
            if (!user) return;
            log('Användare:', user.email);

            setTimeout(() => {
                insertButton();
                insertModal();

                const ce = sessionStorage.getItem(SK_EMAIL);
                const cp = sessionStorage.getItem(SK_PASS);
                if (ce && cp && !authenticated) {
                    tidbokAuth.signInWithEmailAndPassword(ce, cp)
                        .then(cred => {
                            tidbokUid = cred.user.uid;
                            authenticated = true;
                            log('✓ Auto-inloggad på Tidbok');
                        })
                        .catch(() => {
                            sessionStorage.removeItem(SK_EMAIL);
                            sessionStorage.removeItem(SK_PASS);
                            sessionStorage.removeItem(SK_UID);
                        });
                }
            }, 800);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
    } else {
        setTimeout(init, 500);
    }

    // ══════════════════════════════════════════════════════════
    // 13) API
    // ══════════════════════════════════════════════════════════
    window.ReslangdAutomatik = {
        open: openAutoModal,
        getUid: () => tidbokUid,
        isAuthenticated: () => authenticated,
        signOut: signOutFromTidbok,
        getAnalysis: () => analysisRows,
        debug: async () => {
            const p = await ensureProjectsLoaded();
            const t = await ensureTripsLoaded();
            const v = await ensureVehiclesLoaded();
            const r = {
                tidbok: { uid: tidbokUid, auth: authenticated },
                counts: { projects: p.length, trips: t.length, vehicles: v.length },
                currentUser: currentUser ? { uid: currentUser.uid, email: currentUser.email } : null
            };
            console.log(r);
            return r;
        }
    };

    log('Modul laddad. Väntar på auth…');
})();
// ============================================================
// project-updater.js v2 - Auto-cascade + UI para reparar
// ============================================================

(function () {
    'use strict';

    const log  = (...a) => console.log('🔗 project-updater:', ...a);
    const warn = (...a) => console.warn('project-updater:', ...a);
    const err  = (...a) => console.error('project-updater:', ...a);

    let hooked = false;
    let db     = null;

    // ══════════════════════════════════════════════════════════
    // INIT
    // ══════════════════════════════════════════════════════════
    function init() {
        if (typeof database === 'undefined') return setTimeout(init, 400);
        db = database;

        if (typeof window.saveProject !== 'function') return setTimeout(init, 500);
        if (typeof projects === 'undefined') return setTimeout(init, 500);

        hookSaveProject();
        injectOrphanButton();
    }

    // ══════════════════════════════════════════════════════════
    // HOOK saveProject (cascade futuro)
    // ══════════════════════════════════════════════════════════
    function hookSaveProject() {
        if (hooked) return;
        const original = window.saveProject;

        window.saveProject = async function (e) {
            const projectId = document.getElementById('projectId').value;
            const newCode   = (document.getElementById('projectCode').value || '').trim().toUpperCase();
            const newName   = (document.getElementById('projectName').value || '').trim();

            let oldCode = null, oldName = null;
            if (projectId && Array.isArray(projects)) {
                const old = projects.find(p => p.id === projectId);
                if (old) { oldCode = old.code; oldName = old.name; }
            }

            const codeChanged = !!(projectId && oldCode && oldCode !== newCode);
            const nameChanged = !!(projectId && oldName && oldName !== newName);

            // Confirmar al usuario si cambia el código
            if (codeChanged) {
                const ok = confirm(
                    `⚠️  Du ändrar projektkoden från "${oldCode}" till "${newCode}".\n\n` +
                    `Alla sparade resor med den gamla koden uppdateras automatiskt.\n\n` +
                    `Fortsätt?`
                );
                if (!ok) return;
            }

            const result = original.apply(this, arguments);

            if (codeChanged || nameChanged) {
                setTimeout(() => cascadeUpdate({
                    oldCode, newCode, oldName, newName, codeChanged, nameChanged
                }), 1100);
            }

            return result;
        };

        hooked = true;
        log('✅ Hook aplicado a saveProject');
    }

    // ══════════════════════════════════════════════════════════
    // CASCADE
    // ══════════════════════════════════════════════════════════
    async function cascadeUpdate({ oldCode, newCode, oldName, newName, codeChanged, nameChanged }) {
        log('🔄 Cascade start:', oldCode, '→', newCode);
        const summary = { trips: 0, defaults: 0, localStorage: false };

        if (codeChanged) {
            try {
                const snap = await db.ref('trips').once('value');
                const updates = {};
                let count = 0;
                snap.forEach(child => {
                    const t = child.val();
                    if (t && t.projekt === oldCode) {
                        updates[`trips/${child.key}/projekt`] = newCode;
                        if (newName) updates[`trips/${child.key}/projektNamn`] = newName;
                        count++;
                    }
                });
                if (count) {
                    await db.ref().update(updates);
                    summary.trips = count;
                    log(`   ✓ ${count} resor uppdaterade`);
                }
            } catch (e) { err('trips:', e); }
        }

        if (codeChanged) {
            try {
                const snap = await db.ref('userDefaults').once('value');
                const updates = {};
                let count = 0;
                snap.forEach(child => {
                    const d = child.val();
                    if (d && d.projekt === oldCode) {
                        updates[`userDefaults/${child.key}/projekt`] = newCode;
                        count++;
                    }
                });
                if (count) {
                    await db.ref().update(updates);
                    summary.defaults = count;
                }
            } catch (e) { err('userDefaults:', e); }
        }

        if (codeChanged) {
            try {
                const raw = localStorage.getItem('vehicleJournalConfig');
                if (raw) {
                    const lc = JSON.parse(raw);
                    if (lc.defaults && lc.defaults.projectValue === oldCode) {
                        lc.defaults.projectValue = newCode;
                        localStorage.setItem('vehicleJournalConfig', JSON.stringify(lc));
                        summary.localStorage = true;
                    }
                }
            } catch (e) { /* noop */ }
        }

        try {
            if (typeof loadProjects === 'function') loadProjects();
            if (typeof loadTrips === 'function') loadTrips();
            if (typeof updateTripsDisplay === 'function') updateTripsDisplay();
        } catch (e) { /* noop */ }

        const msgs = [];
        if (summary.trips)      msgs.push(`${summary.trips} resor`);
        if (summary.defaults)   msgs.push(`${summary.defaults} standardprojekt`);
        if (summary.localStorage) msgs.push('lokal cache');

        if (msgs.length) {
            showAlert('🔄 Uppdatering klar:\n• ' + msgs.join('\n• '), 'success');
        }
        log('🔄 Cascade klar');
    }

    // ══════════════════════════════════════════════════════════
    // FIND ORPHANS
    // ══════════════════════════════════════════════════════════
    async function findOrphans() {
        const [tripsSnap, projSnap] = await Promise.all([
            db.ref('trips').once('value'),
            db.ref('projects').once('value')
        ]);

        const validCodes = new Set();
        projSnap.forEach(c => {
            const p = c.val();
            if (p && p.code) validCodes.add(p.code);
        });

        const byCode = {}; // { codigoHuerfano: [trips] }
        tripsSnap.forEach(c => {
            const t = c.val();
            if (t && t.projekt && !validCodes.has(t.projekt)) {
                if (!byCode[t.projekt]) byCode[t.projekt] = [];
                byCode[t.projekt].push({
                    id: c.key,
                    datum: t.datum ? t.datum.split('T')[0] : '',
                    bil: t.bil,
                    projekt: t.projekt,
                    syfte: t.syfte_text
                });
            }
        });
        return byCode;
    }

    // ══════════════════════════════════════════════════════════
    // REMAP
    // ══════════════════════════════════════════════════════════
    async function remapOrphans(oldCode, newCode) {
        if (!oldCode || !newCode) {
            warn('Användning: ProjectUpdater.remap("GAMMAL", "NY")');
            return 0;
        }
        const snap = await db.ref('trips').once('value');
        const updates = {};
        let count = 0;
        snap.forEach(c => {
            const t = c.val();
            if (t && t.projekt === oldCode) {
                updates[`trips/${c.key}/projekt`] = newCode;
                count++;
            }
        });

        if (!count) { log('Inga resor med "' + oldCode + '"'); return 0; }
        if (!confirm(`Uppdatera ${count} resa(-or) från "${oldCode}" till "${newCode}"?`)) return 0;

        await db.ref().update(updates);
        log(`✅ ${count} resor omappade`);
        showAlert(`✅ ${count} resor uppdaterade till "${newCode}"`, 'success');

        if (typeof loadTrips === 'function') loadTrips();
        return count;
    }

    // ══════════════════════════════════════════════════════════
    // BOTÓN VISUAL: "Reparera föräldralösa"
    // ══════════════════════════════════════════════════════════
    function injectOrphanButton() {
        const projectForm = document.getElementById('projectForm');
        if (!projectForm) return;
        if (document.getElementById('repairOrphansBtn')) return;

        const actionsRow = projectForm.querySelector('button[type="submit"]')?.parentElement;
        if (!actionsRow) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'repairOrphansBtn';
        btn.className = 'px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors';
        btn.style.cssText = 'display:flex;align-items:center;gap:6px;';
        btn.innerHTML = '🔧 Reparera föräldralösa';
        btn.title = 'Uppdatera resor som refererar till gamla projektkoder';

        btn.addEventListener('click', openRepairModal);

        // Insertar antes del botón "Rensa"
        const cleanBtn = Array.from(actionsRow.querySelectorAll('button'))
            .find(b => /Rensa/i.test(b.textContent));
        if (cleanBtn) actionsRow.insertBefore(btn, cleanBtn);
        else actionsRow.insertBefore(btn, actionsRow.firstChild);

        log('Botón "Reparera föräldralösa" añadido');
    }

    // ══════════════════════════════════════════════════════════
    // MODAL REPAIR
    // ══════════════════════════════════════════════════════════
    async function openRepairModal() {
        // Eliminar modal previo
        document.getElementById('orphanModal')?.remove();

        const orphans = await findOrphans();
        const orphanCodes = Object.keys(orphans);

        // Lista de proyectos actuales para el dropdown
        let projOptions = '<option value="">— Välj projekt —</option>';
        if (Array.isArray(projects)) {
            projects.forEach(p => {
                projOptions += `<option value="${escapeHtml(p.code)}">${escapeHtml(p.code)} - ${escapeHtml(p.name)}</option>`;
            });
        }

        const html = `
        <div id="orphanModal" class="modal" style="display:block;">
            <div class="modal-content" style="max-width: 800px;">
                <span class="close" onclick="document.getElementById('orphanModal').remove()">&times;</span>
                <h2 class="text-xl font-bold text-gray-800 mb-2">
                    🔧 Reparera föräldralösa resor
                </h2>
                <p class="text-sm text-gray-600 mb-4">
                    Dessa resor refererar till projektkoder som inte längre finns i systemet.
                    Mappa om dem till nuvarande projekt.
                </p>

                ${orphanCodes.length === 0 ? `
                    <div class="text-center py-8">
                        <div style="font-size:56px;">✅</div>
                        <p class="text-lg font-medium text-green-700 mt-2">Inga föräldralösa resor!</p>
                        <p class="text-sm text-gray-500 mt-1">Alla resor har en giltig projektkod.</p>
                    </div>
                ` : `
                    <div class="mb-4 max-h-64 overflow-y-auto border rounded-lg">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 sticky top-0">
                                <tr>
                                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Gammal kod</th>
                                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Antal resor</th>
                                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mappa till</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${orphanCodes.map(code => `
                                    <tr class="border-b" data-old-code="${escapeHtml(code)}">
                                        <td class="px-3 py-2">
                                            <span class="font-mono text-red-600 font-medium">${escapeHtml(code)}</span>
                                        </td>
                                        <td class="px-3 py-2">
                                            <span class="text-gray-700">${orphans[code].length}</span>
                                        </td>
                                        <td class="px-3 py-2">
                                            <select class="orphan-remap-select input-enhanced text-sm w-full"
                                                    data-old-code="${escapeHtml(code)}">
                                                ${projOptions}
                                            </select>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div class="flex justify-end gap-3">
                        <button type="button" onclick="document.getElementById('orphanModal').remove()"
                                class="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg font-medium">
                            Avbryt
                        </button>
                        <button type="button" id="orphanRepairConfirmBtn"
                                class="px-4 py-2 text-sm btn-gradient-primary font-medium">
                            🔧 Reparera valda
                        </button>
                    </div>
                `}
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        const confirmBtn = document.getElementById('orphanRepairConfirmBtn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const selects = document.querySelectorAll('.orphan-remap-select');
                let totalFixed = 0;

                for (const sel of selects) {
                    const oldCode = sel.dataset.oldCode;
                    const newCode = sel.value;
                    if (!newCode) continue;

                    const snap = await db.ref('trips').once('value');
                    const updates = {};
                    let count = 0;
                    snap.forEach(c => {
                        const t = c.val();
                        if (t && t.projekt === oldCode) {
                            updates[`trips/${c.key}/projekt`] = newCode;
                            count++;
                        }
                    });
                    if (count > 0) {
                        await db.ref().update(updates);
                        totalFixed += count;
                        log(`✓ ${count} resor: "${oldCode}" → "${newCode}"`);
                    }
                }

                document.getElementById('orphanModal')?.remove();

                if (totalFixed > 0) {
                    showAlert(`✅ ${totalFixed} resa(-or) reparerade`, 'success');
                    if (typeof loadTrips === 'function') loadTrips();
                    if (typeof updateTripsDisplay === 'function') updateTripsDisplay();
                } else {
                    showAlert('ℹ️ Inga resor reparerades', 'error');
                }
            });
        }
    }

    // ══════════════════════════════════════════════════════════
    // UTILS
    // ══════════════════════════════════════════════════════════
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function showAlert(message, type) {
        const el = document.createElement('div');
        el.className = `alert alert-${type === 'error' ? 'error' : 'success'}`;
        el.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            z-index: 10000; max-width: 420px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            white-space: pre-line; line-height: 1.5;
        `;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 4500);
    }

    // ══════════════════════════════════════════════════════════
    // INIT AUTO
    // ══════════════════════════════════════════════════════════
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
    } else {
        setTimeout(init, 1200);
    }

    // ══════════════════════════════════════════════════════════
    // API PÚBLICA
    // ══════════════════════════════════════════════════════════
    window.ProjectUpdater = {
        findOrphans,
        remap: remapOrphans,
        cascade: cascadeUpdate,
        showRepair: openRepairModal,
        reset: () => { hooked = false; }
    };

    log('Laddad. Väntar på init…');

})();
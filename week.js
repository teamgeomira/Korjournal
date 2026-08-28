// week.js
// Añade funcionalidad para registrar una semana completa de viajes con los mismos datos

(function() {
    // Esperar a que el DOM esté listo y las variables globales existan
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof database === 'undefined' || typeof auth === 'undefined') {
            console.error('Firebase no está inicializado. No se puede cargar week.js');
            return;
        }

        insertWeekButtonAndModal();
        setupWeekModalEvents();
    });

    function insertWeekButtonAndModal() {
        // Buscar el contenedor del formulario de registro de viaje
        const tripFormContainer = document.querySelector('.stat-card.mb-8'); // El que contiene "Registrera resa"
        if (!tripFormContainer) {
            console.error('No se encontró el contenedor del formulario de viaje');
            return;
        }

        // Crear botón "Registrera vecka" debajo del formulario
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-end mt-4';
        buttonContainer.innerHTML = `
            <button id="weekRegisterBtn" class="px-5 py-2 text-sm btn-gradient-success font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Registrera vecka
            </button>
        `;
        const form = tripFormContainer.querySelector('form');
        if (form) {
            form.parentNode.insertBefore(buttonContainer, form.nextSibling);
        } else {
            tripFormContainer.appendChild(buttonContainer);
        }

        // Crear el modal HTML
        const modalHTML = `
        <div id="weekModal" class="modal">
            <div class="modal-content">
                <span id="weekModalClose" class="close">&times;</span>
                <h2 class="text-xl font-bold text-gray-800 mb-6">Registrera vecka</h2>
                <form id="weekForm">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label for="weekVehicle" class="block text-sm font-medium text-gray-700 mb-2 required-field">Fordon</label>
                            <select id="weekVehicle" required class="input-enhanced w-full">
                                <option value="">Välj fordon</option>
                            </select>
                        </div>
                        <div>
                            <label for="weekProject" class="block text-sm font-medium text-gray-700 mb-2">Projekt</label>
                            <select id="weekProject" class="input-enhanced w-full">
                                <option value="">Inget projekt</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                            <label for="weekStartDate" class="block text-sm font-medium text-gray-700 mb-2 required-field">Startdatum</label>
                            <input type="date" id="weekStartDate" required class="input-enhanced w-full">
                        </div>
                        <div>
                            <label for="weekEndDate" class="block text-sm font-medium text-gray-700 mb-2 required-field">Slutdatum</label>
                            <input type="date" id="weekEndDate" required class="input-enhanced w-full">
                        </div>
                        <div>
                            <label for="weekDailyKm" class="block text-sm font-medium text-gray-700 mb-2 required-field">Reslängd per dag (km)</label>
                            <input type="number" id="weekDailyKm" required min="0.1" step="0.1" class="input-enhanced w-full">
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                            <label for="weekStartAddress" class="block text-sm font-medium text-gray-700 mb-2 required-field">Resans start, adress</label>
                            <select id="weekStartAddress" required class="input-enhanced w-full">
                                <option value="">Välj startadress...</option>
                            </select>
                        </div>
                        <div>
                            <label for="weekSyfteAddress" class="block text-sm font-medium text-gray-700 mb-2 required-field">Ärende/Plats/Syfte</label>
                            <select id="weekSyfteAddress" required class="input-enhanced w-full">
                                <option value="">Välj syfteadress...</option>
                            </select>
                        </div>
                        <div>
                            <label for="weekEndAddress" class="block text-sm font-medium text-gray-700 mb-2 required-field">Resans slut, adress</label>
                            <select id="weekEndAddress" required class="input-enhanced w-full">
                                <option value="">Välj slutadress...</option>
                            </select>
                        </div>
                    </div>
                    <div class="mb-4">
                        <label for="weekPurpose" class="block text-sm font-medium text-gray-700 mb-2 required-field">Anteckningar (förare, tankning etc.)</label>
                        <select id="weekPurpose" required class="input-enhanced w-full">
                            <option value="">Välj syfte...</option>
                            <option value="Mätkonsultuppdrag">Mätkonsultuppdrag</option>
                            <option value="Mätkonsultuppdrag och tankning">Mätkonsultuppdrag och tankning</option>
                            <option value="Projektbesök">Projektbesök</option>
                            <option value="Möte">Möte</option>
                            <option value="Kundbesök">Kundbesök</option>
                            <option value="Leverans">Leverans</option>
                            <option value="Inköp">Inköp</option>
                            <option value="Service">Service</option>
                            <option value="Annat">Annat</option>
                        </select>
                        <div id="weekAnnatContainer" class="mt-2 hidden">
                            <input type="text" id="weekAnnatText" placeholder="Ange ditt eget syfte..." class="input-enhanced w-full">
                        </div>
                    </div>
                    <div class="flex items-center mb-4">
                        <label class="toggle-switch">
                            <input type="checkbox" id="weekIncludeWeekends" checked>
                            <span class="toggle-slider"></span>
                        </label>
                        <span class="ml-3 text-sm text-gray-700 font-medium">Inkludera helger (lördag & söndag)</span>
                    </div>
                    <div class="flex justify-end gap-3">
                        <button type="button" id="weekCancelBtn" class="px-5 py-2 text-sm bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg font-medium transition-colors">Avbryt</button>
                        <button type="submit" class="px-5 py-2 text-sm btn-gradient-primary font-medium">Generera resor</button>
                    </div>
                </form>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    function setupWeekModalEvents() {
        const modal = document.getElementById('weekModal');
        const form = document.getElementById('weekForm');
        const btn = document.getElementById('weekRegisterBtn');
        const closeBtn = document.getElementById('weekModalClose');
        const cancelBtn = document.getElementById('weekCancelBtn');

        if (!modal || !form || !btn) return;

        // Función para cerrar el modal
        function closeModal() {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }

        // Abrir modal
        btn.addEventListener('click', function() {
            populateWeekSelects();
            setDefaultWeekDates();
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';
        });

        // Cerrar con la X
        if (closeBtn) closeBtn.addEventListener('click', closeModal);

        // Cerrar con el botón Avbryt
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        // Cerrar al hacer clic fuera del contenido
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });

        // Manejar cambio de propósito (Annat)
        document.getElementById('weekPurpose').addEventListener('change', function() {
            const annatContainer = document.getElementById('weekAnnatContainer');
            if (this.value === 'Annat') {
                annatContainer.classList.remove('hidden');
                document.getElementById('weekAnnatText').required = true;
            } else {
                annatContainer.classList.add('hidden');
                document.getElementById('weekAnnatText').required = false;
            }
        });

        // Envío del formulario
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            generateWeekTrips();
        });
    }

    function populateWeekSelects() {
        // Vehículos
        const vehicleSelect = document.getElementById('weekVehicle');
        if (vehicleSelect) {
            const currentValue = vehicleSelect.value;
            vehicleSelect.innerHTML = '<option value="">Välj fordon</option>';
            if (typeof vehicles !== 'undefined' && vehicles.length > 0) {
                vehicles.forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v.regnr;
                    opt.textContent = v.regnr;
                    vehicleSelect.appendChild(opt);
                });
            }
            if (currentValue) vehicleSelect.value = currentValue;
        }

        // Proyectos
        const projectSelect = document.getElementById('weekProject');
        if (projectSelect) {
            const currentValue = projectSelect.value;
            projectSelect.innerHTML = '<option value="">Inget projekt</option>';
            if (typeof projects !== 'undefined' && projects.length > 0) {
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.code;
                    opt.textContent = `${p.code} - ${p.name}`;
                    projectSelect.appendChild(opt);
                });
            }
            if (currentValue) projectSelect.value = currentValue;
        }

        // Direcciones (para los tres campos)
        const addressSelects = ['weekStartAddress', 'weekSyfteAddress', 'weekEndAddress'];
        addressSelects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Välj adress...</option>';
                if (typeof addresses !== 'undefined' && addresses.length > 0) {
                    addresses.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = a.full;
                        opt.textContent = a.full;
                        select.appendChild(opt);
                    });
                }
                if (currentValue) select.value = currentValue;
            }
        });
    }

    function setDefaultWeekDates() {
        const now = new Date();
        const day = now.getDay(); // 0=domingo, 1=lunes...
        // Calcular el lunes de la semana actual
        const mondayOffset = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);

        const startInput = document.getElementById('weekStartDate');
        const endInput = document.getElementById('weekEndDate');
        if (startInput) {
            startInput.value = formatDateInput(monday);
        }
        if (endInput) {
            endInput.value = formatDateInput(friday);
        }
    }

    function formatDateInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function generateWeekTrips() {
        const vehicleReg = document.getElementById('weekVehicle').value;
        const startDateStr = document.getElementById('weekStartDate').value;
        const endDateStr = document.getElementById('weekEndDate').value;
        const dailyKm = parseFloat(document.getElementById('weekDailyKm').value);
        const startAddress = document.getElementById('weekStartAddress').value;
        const syfteAddress = document.getElementById('weekSyfteAddress').value;
        const endAddress = document.getElementById('weekEndAddress').value;
        const project = document.getElementById('weekProject').value || '';
        const purposeSelect = document.getElementById('weekPurpose');
        let purpose = purposeSelect.value;
        if (purpose === 'Annat') {
            purpose = document.getElementById('weekAnnatText').value.trim();
        }
        const includeWeekends = document.getElementById('weekIncludeWeekends').checked;

        // Validaciones
        if (!vehicleReg || !startDateStr || !endDateStr || isNaN(dailyKm) || dailyKm <= 0 || !startAddress || !syfteAddress || !endAddress || !purpose) {
            alert('Vänligen fyll i alla obligatoriska fält och se till att reslängden är större än 0.');
            return;
        }

        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        if (startDate > endDate) {
            alert('Startdatum måste vara före slutdatum.');
            return;
        }

        // Obtener el último KM del vehículo
        let lastKm = 0;
        if (typeof vehiclesLastKm !== 'undefined' && vehiclesLastKm[vehicleReg]) {
            lastKm = vehiclesLastKm[vehicleReg].km;
        } else {
            const vehicle = (typeof vehicles !== 'undefined') ? vehicles.find(v => v.regnr === vehicleReg) : null;
            if (vehicle) {
                lastKm = vehicle.last_km || vehicle.initialKm || 0;
            }
        }

        // Construir lista de días
        const days = [];
        let currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay();
            if (!includeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }
            days.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (days.length === 0) {
            alert('Inga dagar valda (alla är helger eller intervallet är tomt).');
            return;
        }

        if (!confirm(`Generera ${days.length} resor för ${vehicleReg} med ${dailyKm} km per dag?`)) {
            return;
        }

        // Generar viajes
        let createdCount = 0;
        let currentKm = lastKm;

        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            const startKm = currentKm;
            const stopKm = startKm + dailyKm;
            const tripData = {
                datum: date.toISOString(),
                km_start: startKm,
                km_stop: stopKm,
                reslangd: dailyKm,
                start_adress: startAddress,
                syfte_adress: syfteAddress,
                slut_adress: endAddress,
                syfte_text: purpose,
                projekt: project,
                bil: vehicleReg,
                created_by: currentUser ? currentUser.email : 'system',
                created_at: new Date().toISOString(),
                created_by_uid: currentUser ? currentUser.uid : null
            };

            try {
                await database.ref('trips').push(tripData);
                createdCount++;
                currentKm = stopKm;
            } catch (error) {
                console.error('Error al guardar viaje:', error);
                alert(`Error al guardar viaje para ${date.toLocaleDateString('sv-SE')}: ${error.message}`);
                return;
            }
        }

        // Actualizar el último KM del vehículo
        if (createdCount > 0) {
            const vehicle = (typeof vehicles !== 'undefined') ? vehicles.find(v => v.regnr === vehicleReg) : null;
            if (vehicle) {
                await database.ref('vehicles/' + vehicle.id).update({
                    last_km: currentKm,
                    updated_at: new Date().toISOString(),
                    updated_by: currentUser ? currentUser.email : 'system'
                });
            }
            // Ejecutar reconciliación si existe
            if (typeof reconcileVehicleTrips === 'function') {
                await reconcileVehicleTrips(vehicleReg);
            }
        }

        alert(`${createdCount} resor skapade för ${vehicleReg} från ${formatDateDisplay(startDate)} till ${formatDateDisplay(endDate)}. Totalt ${createdCount * dailyKm} km.`);
        
        // Cerrar modal y refrescar vista
        const modal = document.getElementById('weekModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
        // Actualizar listas si existen las funciones
        if (typeof loadTrips === 'function') loadTrips();
        if (typeof loadVehicles === 'function') loadVehicles();
        if (typeof updateStatistics === 'function') updateStatistics();
    }

    function formatDateDisplay(date) {
        return date.toLocaleDateString('sv-SE');
    }

})();
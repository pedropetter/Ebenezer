const STORAGE_KEY = 'ebenezer_bookings_v1';
const STATUS_STORAGE_KEY = 'ebenezer_booking_status_v1';
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
const SUPABASE_TABLE = 'ebenezer_bookings';
const WHATSAPP_NUMBER = '5524998840803';
const DEFAULT_BARBER = 'Marcos Reis - Fundador';
const MONTHS = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const ALL_SLOTS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const SERVICE_META = {
  'Corte Classico - R$ 40': { duration: '~45 min', price: 'R$ 40' },
  'Barba Completa - R$ 35': { duration: '~35 min', price: 'R$ 35' },
  'Corte + Barba - R$ 70': { duration: '~70 min', price: 'R$ 70' },
  'Pigmentacao - R$ 60': { duration: '~60 min', price: 'R$ 60' },
  'Pacote da Casa - R$ 110': { duration: '~90 min', price: 'R$ 110' }
};
const BOOKING_STATUSES = {
  confirmado: 'Confirmado',
  atendimento: 'Em atendimento',
  finalizado: 'Finalizado',
  faltou: 'Faltou'
};

const today = new Date();
today.setHours(0, 0, 0, 0);

let bookings = {};
let bookingStatuses = {};
let selectedDate = null;
let selectedSlot = null;
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let refreshInterval = null;
let toastTimer = null;
let introDismissed = false;

function readJSONStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function writeJSONStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(error);
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, duration = 2400) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function todayStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dismissIntro() {
  if (introDismissed) return;
  introDismissed = true;

  const overlay = document.getElementById('introOverlay');
  if (!overlay) {
    document.body.classList.remove('intro-active');
    return;
  }

  overlay.classList.add('is-leaving');
  const cleanup = () => {
    document.body.classList.remove('intro-active');
    overlay.remove();
  };
  overlay.addEventListener('animationend', cleanup, { once: true });
}

function startIntro() {
  const overlay = document.getElementById('introOverlay');
  const skipButton = document.getElementById('skipIntroBtn');
  if (!overlay) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = prefersReducedMotion ? 450 : 3000;

  if (skipButton) {
    skipButton.addEventListener('click', dismissIntro);
  }

  setTimeout(dismissIntro, duration);
}

function formatHumanDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function formatShortDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function setSyncStatus(state, text) {
  const badge = document.getElementById('syncBadge');
  const label = document.getElementById('syncText');
  if (badge) badge.setAttribute('data-state', state);
  if (label) label.textContent = text;
}

function hasSupabaseConfig() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes('COLE_AQUI') &&
    !SUPABASE_ANON_KEY.includes('COLE_AQUI')
  );
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function readLocalBookings() {
  return readJSONStorage(STORAGE_KEY, {});
}

function writeLocalBookings(data) {
  writeJSONStorage(STORAGE_KEY, data);
}

function rowsToBookings(rows) {
  const mapped = {};
  rows.forEach(row => {
    if (!mapped[row.booking_date]) mapped[row.booking_date] = {};
    mapped[row.booking_date][row.slot] = {
      name: row.name,
      phone: row.phone,
      barber: row.barber,
      service: row.service
    };
  });
  return mapped;
}

async function readSupabaseBookings() {
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=booking_date,slot,name,phone,barber,service&booking_date=gte.${todayStr()}&order=booking_date.asc,slot.asc`;
  const response = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase read error: ${response.status}`);
  }

  return rowsToBookings(await response.json());
}

async function insertSupabaseBooking(dateStr, slot, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify([{
      booking_date: dateStr,
      slot,
      name: data.name,
      phone: data.phone,
      barber: data.barber,
      service: data.service
    }])
  });

  if (response.ok) return { ok: true };

  const errorText = await response.text().catch(() => '');
  const isConflict = response.status === 409 || errorText.includes('duplicate key');
  return { ok: false, conflict: isConflict, errorText };
}

async function readStoredBookings() {
  if (hasSupabaseConfig()) {
    const remote = await readSupabaseBookings();
    writeLocalBookings(remote);
    return remote;
  }
  return readLocalBookings();
}

async function writeStoredBookings(data) {
  writeLocalBookings(data);
}

function purgeOldDates(data) {
  const cleaned = {};
  const now = todayStr();
  Object.keys(data || {}).forEach(dateStr => {
    if (dateStr >= now) cleaned[dateStr] = data[dateStr];
  });
  return cleaned;
}

function buildStatusKey(dateStr, slot) {
  return `${dateStr}|${slot}`;
}

function normalizeStatus(status) {
  return BOOKING_STATUSES[status] ? status : 'confirmado';
}

function pruneBookingStatuses() {
  const validKeys = new Set();
  Object.keys(bookings || {}).forEach(dateStr => {
    Object.keys(bookings[dateStr] || {}).forEach(slot => {
      validKeys.add(buildStatusKey(dateStr, slot));
    });
  });

  const next = {};
  Object.keys(bookingStatuses || {}).forEach(key => {
    if (validKeys.has(key)) next[key] = normalizeStatus(bookingStatuses[key]);
  });
  bookingStatuses = next;
  writeJSONStorage(STATUS_STORAGE_KEY, bookingStatuses);
}

async function loadBookings() {
  setSyncStatus('syncing', hasSupabaseConfig() ? 'Sincronizando agenda online...' : 'Carregando agenda local...');
  try {
    const raw = await readStoredBookings();
    bookings = purgeOldDates(raw);
    writeLocalBookings(bookings);
    pruneBookingStatuses();
    setSyncStatus('synced', hasSupabaseConfig() ? 'Agenda online conectada' : 'Agenda local pronta');
  } catch (error) {
    console.error(error);
    bookings = purgeOldDates(readLocalBookings());
    writeLocalBookings(bookings);
    pruneBookingStatuses();
    setSyncStatus('error', 'Nao foi possivel sincronizar agora');
  }
  renderAdminPanel();
}

function isSlotTaken(dateStr, slot) {
  return Boolean(bookings[dateStr] && bookings[dateStr][slot]);
}

function isSlotExpired(dateStr, slot) {
  if (dateStr !== todayStr()) return false;
  const [hours, minutes] = slot.split(':').map(Number);
  const slotDate = new Date();
  slotDate.setHours(hours, minutes, 0, 0);
  return slotDate <= new Date();
}

function getSlotsForDate(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (date.getDay() === 0) return [];
  if (date.getDay() === 6) return ALL_SLOTS.filter(slot => slot <= '17:00');
  return ALL_SLOTS.slice();
}

function initBookingUI() {
  const textPanel = document.querySelector('.booking-text');
  const bookingPanel = document.querySelector('.booking-form');

  if (textPanel) {
    const copy = textPanel.querySelector('p');
    const cta = textPanel.querySelector('.btn-primary span');
    if (copy) {
      copy.textContent = 'Agora esse site tambem tem agenda real. O cliente escolhe a data, ve os horarios livres, reserva o slot e ja sai com a confirmacao pronta no WhatsApp com atendimento direto do Marcos Reis e a pegada raiz da barbearia.';
    }
    if (cta) cta.textContent = 'Escolher Horario';
  }

  if (!bookingPanel) return;

  bookingPanel.innerHTML = `
    <div class="form-title">Agenda com disponibilidade real</div>
    <div class="sync-badge" id="syncBadge" data-state="syncing">
      <span class="sync-dot"></span>
      <span id="syncText">Carregando agenda...</span>
    </div>
    <div id="calendar">
      <div class="cal-header">
        <button class="cal-nav" id="prevMonth" type="button">&#8249;</button>
        <div class="cal-month" id="calMonth">-</div>
        <button class="cal-nav" id="nextMonth" type="button">&#8250;</button>
      </div>
      <div class="cal-grid" id="calGrid"></div>
    </div>
    <div class="slots-label">Horarios Disponiveis</div>
    <div id="slotsArea">
      <div class="slot-empty">Selecione uma data no calendario</div>
    </div>
    <div class="summary-box" id="bookingSummary"></div>
    <div class="form-group">
      <label class="form-label">Seu Nome</label>
      <input type="text" class="form-input" id="clientName" placeholder="Como devemos chamar voce?">
    </div>
    <div class="form-group">
      <label class="form-label">WhatsApp</label>
      <input type="tel" class="form-input" id="clientPhone" placeholder="(24) 9 0000-0000">
    </div>
    <div class="form-group">
      <label class="form-label">Atendimento</label>
      <div class="fixed-barber-card">
        <span class="fixed-barber-label">Barbeiro da casa</span>
        <strong>${DEFAULT_BARBER}</strong>
        <small>Corte, barba e finalizacao com atendimento direto de quem toca a barbearia.</small>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Servico</label>
      <select class="form-select" id="serviceSelect">
        <option value="">Selecione o servico</option>
        <option value="Corte Classico - R$ 40">Corte Classico - R$ 40</option>
        <option value="Barba Completa - R$ 35">Barba Completa - R$ 35</option>
        <option value="Corte + Barba - R$ 70">Corte + Barba - R$ 70</option>
        <option value="Pigmentacao - R$ 60">Pigmentacao - R$ 60</option>
        <option value="Pacote da Casa - R$ 110">Pacote da Casa - R$ 110</option>
      </select>
    </div>
    <button class="form-submit" id="confirmBookingBtn" type="button">Confirmar Agendamento</button>
    <div class="booking-success" id="bookingSuccess">
      <div class="success-icon">OK</div>
      <div class="success-title">Horario reservado</div>
      <p class="success-text" id="successText"></p>
      <div style="margin-top:1rem;">
        <a href="#" id="successWhatsApp" target="_blank" class="btn-primary" style="display:inline-flex;font-size:0.68rem;padding:0.9rem 1.4rem;">
          <span>Confirmar no WhatsApp</span>
        </a>
      </div>
    </div>
  `;
}

function injectAdminUI() {
  const footerLists = document.querySelectorAll('.footer-links');
  const navList = footerLists[1];
  if (navList && !document.getElementById('openAdminPanel')) {
    const item = document.createElement('li');
    item.innerHTML = '<a href="#painel" id="openAdminPanel" class="admin-open-link">Painel da Agenda</a>';
    navList.insertBefore(item, navList.lastElementChild);
  }

  if (!document.getElementById('adminOverlay')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="admin-overlay" id="adminOverlay" aria-hidden="true">
        <div class="admin-shell">
          <div class="admin-shell-head">
            <div>
              <div class="admin-kicker">Area interna</div>
              <div class="admin-title">Painel da Agenda</div>
              <p class="admin-copy">Aqui ficam os agendamentos feitos neste HTML. Voce pode filtrar, acompanhar status e abrir rapido a conversa do cliente no WhatsApp.</p>
            </div>
            <button type="button" class="admin-close" id="closeAdminPanel" aria-label="Fechar painel">X</button>
          </div>
          <div class="admin-filters">
            <div class="form-group">
              <label class="form-label" for="adminScope">Vista</label>
              <select class="form-select" id="adminScope">
                <option value="all">Tudo</option>
                <option value="today">Hoje</option>
                <option value="upcoming">Proximos dias</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="adminStatus">Status</label>
              <select class="form-select" id="adminStatus">
                <option value="all">Todos</option>
                <option value="confirmado">Confirmado</option>
                <option value="atendimento">Em atendimento</option>
                <option value="finalizado">Finalizado</option>
                <option value="faltou">Faltou</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="adminSearch">Busca</label>
              <input type="text" class="form-input" id="adminSearch" placeholder="Cliente ou servico">
            </div>
          </div>
          <div class="admin-stats" id="adminStats"></div>
          <div class="admin-bookings-list" id="adminBookingsList"></div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
    `);
  }
}

function renderCalendar() {
  const monthLabel = document.getElementById('calMonth');
  const grid = document.getElementById('calGrid');
  if (!monthLabel || !grid) return;

  monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  grid.innerHTML = '';

  WEEKDAYS.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'cal-weekday';
    cell.textContent = day;
    grid.appendChild(cell);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let index = 0; index < firstDay; index += 1) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(viewYear, viewMonth, day);
    date.setHours(0, 0, 0, 0);
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');

    cell.className = 'cal-day';
    cell.textContent = day;

    if (date.getTime() === today.getTime()) cell.classList.add('today');

    if (date.getDay() === 0) {
      cell.classList.add('sunday');
    } else if (date < today) {
      cell.classList.add('past');
    } else {
      cell.classList.add('available');
      cell.addEventListener('click', () => selectDate(dateStr));
    }

    if (selectedDate === dateStr) {
      cell.classList.add('selected');
    }

    grid.appendChild(cell);
  }
}

async function selectDate(dateStr) {
  selectedDate = dateStr;
  selectedSlot = null;
  const success = document.getElementById('bookingSuccess');
  if (success) success.classList.remove('show');
  renderCalendar();
  updateBookingSummary();
  setSyncStatus('syncing', 'Verificando horarios...');
  try {
    bookings = purgeOldDates(await readStoredBookings());
    writeLocalBookings(bookings);
    setSyncStatus('synced', hasSupabaseConfig() ? 'Horarios atualizados online' : 'Horarios atualizados');
  } catch (error) {
    console.error(error);
    setSyncStatus('error', 'Nao foi possivel atualizar agora');
  }
  renderSlots();
  renderAdminPanel();
}

function renderSlots() {
  const slotsArea = document.getElementById('slotsArea');
  if (!slotsArea) return;

  if (!selectedDate) {
    slotsArea.innerHTML = '<div class="slot-empty">Selecione uma data no calendario</div>';
    return;
  }

  const slots = getSlotsForDate(selectedDate);
  if (!slots.length) {
    slotsArea.innerHTML = '<div class="slot-empty">Domingo fechado para agendamento</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'slots-grid';

  slots.forEach(slot => {
    const taken = isSlotTaken(selectedDate, slot);
    const expired = isSlotExpired(selectedDate, slot);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot';
    button.textContent = slot;

    if (selectedSlot === slot && !taken && !expired) {
      button.classList.add('slot-selected');
    }

    if (taken || expired) {
      button.classList.add('slot-taken');
      button.disabled = true;
      button.title = taken ? 'Horario ja reservado' : 'Horario encerrado para hoje';
    } else {
      button.addEventListener('click', () => selectSlot(slot));
    }

    grid.appendChild(button);
  });

  slotsArea.innerHTML = '';
  slotsArea.appendChild(grid);
}

function selectSlot(slot) {
  selectedSlot = slot;
  const success = document.getElementById('bookingSuccess');
  if (success) success.classList.remove('show');
  renderSlots();
  updateBookingSummary();
}

function updateBookingSummary() {
  const summary = document.getElementById('bookingSummary');
  const service = document.getElementById('serviceSelect');
  if (!summary || !service) return;

  const pieces = [];
  const hasSelection = Boolean((selectedDate && selectedSlot) || service.value);

  if (selectedDate && selectedSlot) {
    pieces.push(`Data: <strong>${formatHumanDate(selectedDate)}</strong> as <strong>${selectedSlot}</strong>`);
  }

  if (hasSelection) {
    pieces.push(`Barbeiro: <strong>${escapeHtml(DEFAULT_BARBER)}</strong>`);
  }

  if (service.value) {
    const meta = SERVICE_META[service.value];
    if (meta) {
      pieces.push(`Servico: <strong>${escapeHtml(service.value)}</strong> · ${meta.duration} · <strong>${meta.price}</strong>`);
    } else {
      pieces.push(`Servico: <strong>${escapeHtml(service.value)}</strong>`);
    }
  }

  if (!pieces.length) {
    summary.style.display = 'none';
    summary.innerHTML = '';
    return;
  }

  summary.style.display = 'block';
  summary.innerHTML = pieces.join('<br>');
}

function buildBookingWhatsAppUrl(data) {
  const message = [
    'Ola! Acabei de fazer um agendamento na Ebenezer Barbearia.',
    '',
    `Nome: ${data.name}`,
    `WhatsApp: ${data.phone}`,
    `Barbeiro: ${data.barber}`,
    `Servico: ${data.service}`,
    `Data: ${formatHumanDate(data.date)}`,
    `Horario: ${data.slot}`,
    '',
    'Quero confirmar meu horario.'
  ].join('\n');

  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

async function reserveBooking(dateStr, slot, data) {
  if (hasSupabaseConfig()) {
    const result = await insertSupabaseBooking(dateStr, slot, data);
    if (!result.ok) {
      if (result.conflict) return { ok: false, conflict: true };
      throw new Error(result.errorText || 'Supabase error');
    }
    bookings = purgeOldDates(await readStoredBookings());
    writeLocalBookings(bookings);
    return { ok: true };
  }

  if (!bookings[dateStr]) bookings[dateStr] = {};
  bookings[dateStr][slot] = data;
  await writeStoredBookings(bookings);
  return { ok: true };
}

async function confirmBooking() {
  const button = document.getElementById('confirmBookingBtn');
  const name = document.getElementById('clientName').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  const barber = DEFAULT_BARBER;
  const service = document.getElementById('serviceSelect').value;

  if (!name) {
    showToast('Informe seu nome');
    return;
  }
  if (!phone) {
    showToast('Informe seu WhatsApp');
    return;
  }
  if (!service) {
    showToast('Selecione o servico');
    return;
  }
  if (!selectedDate || !selectedSlot) {
    showToast('Selecione data e horario');
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    bookings = purgeOldDates(await readStoredBookings());

    if (isSlotTaken(selectedDate, selectedSlot) || isSlotExpired(selectedDate, selectedSlot)) {
      renderSlots();
      showToast('Esse horario nao esta mais disponivel', 3200);
      return;
    }

    const result = await reserveBooking(selectedDate, selectedSlot, {
      name,
      phone,
      barber,
      service
    });

    if (!result.ok && result.conflict) {
      bookings = purgeOldDates(await readStoredBookings());
      renderSlots();
      renderAdminPanel();
      showToast('Esse horario acabou de ser reservado', 3200);
      return;
    }

    bookingStatuses[buildStatusKey(selectedDate, selectedSlot)] = 'confirmado';
    writeJSONStorage(STATUS_STORAGE_KEY, bookingStatuses);

    const waUrl = buildBookingWhatsAppUrl({
      name,
      phone,
      barber,
      service,
      date: selectedDate,
      slot: selectedSlot
    });

    document.getElementById('successText').textContent = `${name}, seu horario das ${selectedSlot} em ${formatHumanDate(selectedDate)} ficou reservado para ${service} com ${barber}.`;
    document.getElementById('successWhatsApp').href = waUrl;
    document.getElementById('bookingSuccess').classList.add('show');

    setSyncStatus('synced', hasSupabaseConfig() ? 'Agenda online atualizada' : 'Horario reservado');
    renderSlots();
    renderAdminPanel();
    showToast('Agendamento confirmado');

    setTimeout(() => {
      window.location.href = waUrl;
    }, 250);
  } catch (error) {
    console.error(error);
    setSyncStatus('error', 'Falha ao salvar agendamento');
    showToast('Nao foi possivel salvar agora', 3200);
  } finally {
    button.disabled = false;
    button.textContent = 'Confirmar Agendamento';
  }
}

function getBookingEntries() {
  const entries = [];
  Object.keys(bookings || {}).forEach(dateStr => {
    Object.keys(bookings[dateStr] || {}).forEach(slot => {
      const item = bookings[dateStr][slot] || {};
      entries.push({
        date: dateStr,
        slot,
        name: item.name || '',
        phone: item.phone || '',
        barber: item.barber || '',
        service: item.service || '',
        status: normalizeStatus(bookingStatuses[buildStatusKey(dateStr, slot)])
      });
    });
  });
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

function filterAdminBookings(entries) {
  const scope = document.getElementById('adminScope').value;
  const status = document.getElementById('adminStatus').value;
  const search = document.getElementById('adminSearch').value.trim().toLowerCase();
  const todayValue = todayStr();

  return entries.filter(entry => {
    const scopeMatch =
      scope === 'all' ||
      (scope === 'today' && entry.date === todayValue) ||
      (scope === 'upcoming' && entry.date > todayValue);
    const statusMatch = status === 'all' || entry.status === status;
    const haystack = `${entry.name} ${entry.phone} ${entry.barber} ${entry.service}`.toLowerCase();
    const searchMatch = !search || haystack.includes(search);
    return scopeMatch && statusMatch && searchMatch;
  });
}

function buildClientWhatsAppUrl(entry) {
  const phoneNumber = String(entry.phone || '').replace(/\D/g, '');
  const target = !phoneNumber
    ? WHATSAPP_NUMBER
    : (phoneNumber.startsWith('55') ? phoneNumber : `55${phoneNumber}`);
  const message = [
    `Ola ${entry.name || ''},`,
    `seu horario na Ebenezer Barbearia esta registrado para ${formatHumanDate(entry.date)} as ${entry.slot}.`,
    `Servico: ${entry.service}.`,
    `Barbeiro: ${entry.barber}.`
  ].join('\n');
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}

function renderAdminStats() {
  const container = document.getElementById('adminStats');
  if (!container) return;

  const entries = getBookingEntries();
  const todayEntries = entries.filter(entry => entry.date === todayStr());
  const upcomingEntries = entries.filter(entry => entry.date > todayStr());
  const finalizedEntries = entries.filter(entry => entry.status === 'finalizado');
  const noShowEntries = entries.filter(entry => entry.status === 'faltou');

  container.innerHTML = `
    <div class="admin-stat">
      <div class="admin-stat-label">Hoje</div>
      <div class="admin-stat-value">${todayEntries.length}</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-label">Proximos</div>
      <div class="admin-stat-value">${upcomingEntries.length}</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-label">Finalizados</div>
      <div class="admin-stat-value">${finalizedEntries.length}</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-label">Faltou</div>
      <div class="admin-stat-value">${noShowEntries.length}</div>
    </div>
  `;
}

function renderAdminBookings() {
  const list = document.getElementById('adminBookingsList');
  if (!list) return;

  const entries = filterAdminBookings(getBookingEntries());
  if (!entries.length) {
    list.innerHTML = '<div class="admin-empty">Nenhum agendamento encontrado.</div>';
    return;
  }

  list.innerHTML = entries.map(entry => `
    <div class="admin-booking-row">
      <div class="admin-booking-head">
        <div>
          <div class="admin-booking-name">${escapeHtml(entry.name)}</div>
          <div class="admin-booking-service">${escapeHtml(entry.service)} · ${escapeHtml(entry.barber)}</div>
        </div>
        <span class="admin-status-pill status-${entry.status}">${BOOKING_STATUSES[entry.status]}</span>
      </div>
      <div class="admin-booking-meta">
        <span class="admin-meta-chip">${escapeHtml(formatShortDate(entry.date))}</span>
        <span class="admin-meta-chip">${escapeHtml(entry.slot)}</span>
        <span class="admin-meta-chip">${escapeHtml(entry.phone || 'Sem numero')}</span>
      </div>
      <div class="admin-action-row">
        <button type="button" class="admin-action-btn${entry.status === 'confirmado' ? ' active' : ''}" data-status-date="${entry.date}" data-status-slot="${entry.slot}" data-status-value="confirmado">Confirmado</button>
        <button type="button" class="admin-action-btn${entry.status === 'atendimento' ? ' active' : ''}" data-status-date="${entry.date}" data-status-slot="${entry.slot}" data-status-value="atendimento">Em atendimento</button>
        <button type="button" class="admin-action-btn${entry.status === 'finalizado' ? ' active' : ''}" data-status-date="${entry.date}" data-status-slot="${entry.slot}" data-status-value="finalizado">Finalizado</button>
        <button type="button" class="admin-action-btn${entry.status === 'faltou' ? ' active' : ''}" data-status-date="${entry.date}" data-status-slot="${entry.slot}" data-status-value="faltou">Faltou</button>
        <a class="admin-link-btn" href="${buildClientWhatsAppUrl(entry)}" target="_blank" rel="noopener">WhatsApp</a>
      </div>
    </div>
  `).join('');
}

function renderAdminPanel() {
  renderAdminStats();
  renderAdminBookings();
}

function updateBookingStatus(dateStr, slot, status) {
  bookingStatuses[buildStatusKey(dateStr, slot)] = normalizeStatus(status);
  writeJSONStorage(STATUS_STORAGE_KEY, bookingStatuses);
  renderAdminPanel();
  showToast(`Status: ${BOOKING_STATUSES[normalizeStatus(status)]}`);
}

function openAdminPanel() {
  const overlay = document.getElementById('adminOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  loadBookings();
}

function closeAdminPanel() {
  const overlay = document.getElementById('adminOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function startRefreshLoop() {
  clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    const overlay = document.getElementById('adminOverlay');
    const adminOpen = overlay ? overlay.classList.contains('open') : false;
    if (!selectedDate && !adminOpen) return;
    try {
      bookings = purgeOldDates(await readStoredBookings());
      writeLocalBookings(bookings);
      pruneBookingStatuses();
      if (selectedDate) renderSlots();
      renderAdminPanel();
    } catch (error) {
      console.error(error);
    }
  }, 15000);
}

function bindEvents() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    if (viewMonth === 0) {
      viewMonth = 11;
      viewYear -= 1;
    } else {
      viewMonth -= 1;
    }
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    if (viewMonth === 11) {
      viewMonth = 0;
      viewYear += 1;
    } else {
      viewMonth += 1;
    }
    renderCalendar();
  });

  document.getElementById('confirmBookingBtn').addEventListener('click', confirmBooking);
  document.getElementById('serviceSelect').addEventListener('change', updateBookingSummary);
  document.getElementById('openAdminPanel').addEventListener('click', event => {
    event.preventDefault();
    openAdminPanel();
  });
  document.getElementById('closeAdminPanel').addEventListener('click', closeAdminPanel);
  document.getElementById('adminOverlay').addEventListener('click', event => {
    if (event.target === document.getElementById('adminOverlay')) {
      closeAdminPanel();
    }
  });
  document.getElementById('adminScope').addEventListener('change', renderAdminPanel);
  document.getElementById('adminStatus').addEventListener('change', renderAdminPanel);
  document.getElementById('adminSearch').addEventListener('input', renderAdminPanel);
  document.getElementById('adminBookingsList').addEventListener('click', event => {
    const button = event.target.closest('[data-status-value]');
    if (!button) return;
    updateBookingStatus(button.dataset.statusDate, button.dataset.statusSlot, button.dataset.statusValue);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAdminPanel();
  });

  window.addEventListener('storage', event => {
    if (![STORAGE_KEY, STATUS_STORAGE_KEY].includes(event.key)) return;
    loadBookings().then(() => {
      renderCalendar();
      renderSlots();
      updateBookingSummary();
    });
  });
}

(async () => {
  startIntro();
  bookingStatuses = readJSONStorage(STATUS_STORAGE_KEY, {});
  initBookingUI();
  injectAdminUI();
  bindEvents();
  await loadBookings();
  renderCalendar();
  renderSlots();
  updateBookingSummary();
  startRefreshLoop();
})();

// ============================================================================
// InvVentas Licor - Frontend Application
// Conectado al backend Node.js + MySQL
// ============================================================================

const API_BASE = window.location.origin + '/api';

// ============================================================================
// UTILIDADES HTTP
// ============================================================================
async function apiGet(endpoint) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const nocache = `${separator}_t=${Date.now()}`;
    const res = await fetch(`${API_BASE}${endpoint}${nocache}`, {
        credentials: 'include',
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    });
    return res.json();
}

async function apiPost(endpoint, data) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiPut(endpoint, data) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiPatch(endpoint, data) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiDelete(endpoint) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'DELETE', credentials: 'include'
    });
    return res.json();
}

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
let currentUser = null;
let productosCache = [];
let categoriasCache = [];
let sucursalesCache = [];
let rolesCache = [];
let proveedoresCache = [];

// Sucursal e inventario por sucursal
window.productosSucursalIds = new Set();
window.inventarioSucursalData = [];

// Punto de venta
const estadoVenta = { productos: [], total: 0 };

// Operador
let activeOperator = 'Carmelo';
let activeSucursal = 'Central';
let activeRole = 'gerente';
let sessionStartTime = null;
let inventarioFiltroKpi = 'todos';
let movStockOrigenGlobal = 0;
let movStockDestinoGlobal = 0;

// ============================================================================
// CONTROL DE CAJA ACTIVAS POR TURNO (GLOBAL STATE & FUNCTIONS)
// ============================================================================
window.arqueoActivo = null;

async function verificarArqueoActivo() {
    if (!window.currentUser) return;
    const userId = window.currentUser.id_usuario;
    const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
    const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
    const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;

    try {
        const data = await apiGet(`/arqueo/activo?id_usuario=${userId}&id_sucursal=${sucursalId}`);
        window.arqueoActivo = (data && data.id_arqueo) ? data : null;
        actualizarCajaUI();
    } catch (err) {
        console.error("Error al verificar arqueo activo:", err);
    }
}
window.verificarArqueoActivo = verificarArqueoActivo;

// Al iniciar sesión o recargar la página: si el usuario dejó una caja abierta (por ejemplo,
// cerró la pestaña sin hacer el arqueo), se mantiene abierta y se restaura su sucursal.
async function restaurarCajaAbierta() {
    if (!window.currentUser) return;
    try {
        const data = await apiGet(`/arqueo/activo?id_usuario=${window.currentUser.id_usuario}`);
        if (!data || !data.id_arqueo) {
            await verificarArqueoActivo();
            return;
        }

        window.arqueoActivo = data;

        if (data.sucursal && data.sucursal !== activeSucursal) {
            activeSucursal = data.sucursal;
            const optSuc = document.getElementById('card_operar_sucursal');
            if (optSuc) optSuc.textContent = activeSucursal;
            const selectSucur = document.getElementById('select_sucur');
            if (selectSucur) selectSucur.value = activeSucursal;
            const movOrigen = document.getElementById('mov_sucursal_origen');
            if (movOrigen) movOrigen.value = activeSucursal;

            await cargarProductosPorSucursal();
            renderizarTodoProductos();
            renderProductosCheckout();
            await cargarDashboard();
            if (typeof window.cargarComprasRealizadas === 'function') window.cargarComprasRealizadas();
        }

        // El gerente ya tiene sucursal de trabajo definida por la caja abierta
        if (window.currentUser.role === 'gerente') {
            sessionStorage.setItem('gerenteConfigurado', 'true');
        }

        actualizarCajaUI();
        if (typeof window.cargarVentasRealizadas === 'function') await window.cargarVentasRealizadas();
        if (typeof window.cargarGastosAprobados === 'function') await window.cargarGastosAprobados();

        const fechaApertura = data.fecha ? formatDate(data.fecha) : '';
        mostrarToast(`Tienes una caja abierta en la sucursal ${data.sucursal}${fechaApertura ? ` desde el ${fechaApertura}` : ''}. Se mantiene abierta: realiza el arqueo y ciérrala antes de salir.`, 'warning');
    } catch (err) {
        console.error('Error al restaurar caja abierta:', err);
    }
}
window.restaurarCajaAbierta = restaurarCajaAbierta;

// Advertir si se intenta cerrar la pestaña o recargar con la caja abierta
window.addEventListener('beforeunload', (e) => {
    if (window.currentUser && window.arqueoActivo) {
        e.preventDefault();
        e.returnValue = '';
    }
});

function actualizarCajaUI() {
    const isBoxOpen = !!window.arqueoActivo;

    // Overlay punto-venta
    const pvOverlay = document.getElementById("pv_caja_cerrada_overlay");
    const pvContenido = document.getElementById("pv_contenido_venta");
    if (pvOverlay && pvContenido) {
        pvOverlay.style.display = isBoxOpen ? "none" : "block";
        pvContenido.style.display = isBoxOpen ? "flex" : "none";
    }

    // Overlay gastos
    const gastosOverlay = document.getElementById("gastos_caja_cerrada_overlay");
    const gastosContenido = document.getElementById("gastos_contenido_panel");
    if (gastosOverlay && gastosContenido) {
        gastosOverlay.style.display = isBoxOpen ? "none" : "block";
        gastosContenido.style.display = isBoxOpen ? "grid" : "none";
    }

    // Overlay arqueo
    const arqueoOverlay = document.getElementById("arqueo_caja_cerrada_overlay");
    const arqueoContenido = document.getElementById("arqueo_contenido_panel");
    if (arqueoOverlay && arqueoContenido) {
        arqueoOverlay.style.display = isBoxOpen ? "none" : "block";
        arqueoContenido.style.display = isBoxOpen ? "grid" : "none";
    }

    // Bloquear y setear monto inicial en arqueo diario
    const inputMontoInicial = document.getElementById("arq_monto_inicial");
    const btnGuardarArqueo = document.getElementById("btn_guardar_arqueo");
    if (isBoxOpen) {
        if (inputMontoInicial) {
            inputMontoInicial.value = window.arqueoActivo.efectivo_inicial;
            inputMontoInicial.disabled = true;
        }
        if (btnGuardarArqueo) {
            btnGuardarArqueo.textContent = "Cerrar Caja (Realizar Arqueo)";
        }
    } else {
        if (inputMontoInicial) {
            inputMontoInicial.disabled = false;
        }
        if (btnGuardarArqueo) {
            btnGuardarArqueo.textContent = "Guardar Arqueo";
        }
    }
}
window.actualizarCajaUI = actualizarCajaUI;

async function abrirCaja(montoInicial) {
    if (isNaN(montoInicial) || montoInicial < 0) {
        alert("Por favor, ingrese un monto inicial válido.");
        return;
    }

    const userId = window.currentUser?.id_usuario || 1;
    const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
    const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
    const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;

    const payload = {
        fecha: getLocalDateString(),
        id_usuario: userId,
        id_sucursal: sucursalId,
        efectivo_inicial: montoInicial,
        ventas_efectivo: 0,
        gastos_aprobados: 0,
        efectivo_contado: montoInicial,
        observaciones: "Apertura de caja",
        estado: "Abierto"
    };

    try {
        const result = await apiPost('/arqueo', payload);
        if (result.error) {
            alert("Error al abrir caja: " + result.error);
            return;
        }

        alert("Caja abierta exitosamente. ¡Turno iniciado!");
        await verificarArqueoActivo();

        if (typeof window.cargarVentasRealizadas === 'function') {
            await window.cargarVentasRealizadas();
        }
        if (typeof window.cargarGastosAprobados === 'function') {
            await window.cargarGastosAprobados();
        }
    } catch (err) {
        console.error("Error al abrir caja:", err);
        alert("Error de conexión al abrir la caja.");
    }
}
window.abrirCaja = abrirCaja;

// ============================================================================
// TOAST / NOTIFICACIONES
// ============================================================================
(function () {
    // Crear el contenedor de toasts si no existe
    function getOrCreateContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    // Mapear un mensaje de alert para determinar su tipo
    function detectSeverity(message) {
        const msg = String(message).toLowerCase();
        if (msg.includes('éxito') || msg.includes('exito') || msg.includes('exitosamente') || msg.includes('guardado') || msg.includes('guardada') || msg.includes('creado') || msg.includes('creada') || msg.includes('modificado') || msg.includes('modificada') || msg.includes('eliminado') || msg.includes('eliminada') || msg.includes('procesada') || msg.includes('realizada') || msg.includes('realizado') || msg.includes('aprobada') || msg.includes('registrado') || msg.includes('registrada')) {
            return 'success';
        }
        if (msg.includes('por favor') || msg.includes('selecciona') || msg.includes('completa') || msg.includes('obligatorio') || msg.includes('menor al total') || msg.includes('ya existe') || msg.includes('no hay') || msg.includes('describa el motivo') || msg.includes('en curso') || msg.includes('requeridos') || msg.includes('debe ser')) {
            return 'warning';
        }
        if (msg.includes('error') || msg.includes('falló') || msg.includes('incorrecto') || msg.includes('rechazada')) {
            return 'error';
        }
        return 'info';
    }

    // Iconos SVG para cada tipo (Lucide icons style)
    const icons = {
        success: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>`,
        warning: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`,
        error: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`,
        info: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>`
    };

    // Función para mostrar el modal de éxito con el checkmark animado
    function showSuccessPopup(message) {
        const existing = document.getElementById('custom-success-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'custom-success-popup';
        popup.className = 'custom-success-popup';
        popup.innerHTML = `
            <div class="success-popup-card">
                <div class="success-icon-wrapper">
                    <svg class="success-checkmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle class="success-checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                        <path class="success-checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                    </svg>
                </div>
                <h3 class="success-popup-title">Operación Exitosa</h3>
                <p class="success-popup-message">${String(message).replace(/\n/g, '<br>')}</p>
                <button class="success-popup-btn" id="success-popup-btn">Aceptar</button>
            </div>
        `;

        document.body.appendChild(popup);

        // Forzar reflow y mostrar
        popup.offsetHeight;
        popup.classList.add('show');

        function closePopup() {
            if (!popup.classList.contains('show')) return;
            popup.classList.remove('show');
            popup.addEventListener('transitionend', () => {
                popup.remove();
            });
        }

        // Auto cerrar tras 3.5 segundos
        const autoTimeout = setTimeout(closePopup, 3500);

        // Cerrar al hacer clic en el botón
        popup.querySelector('#success-popup-btn').addEventListener('click', () => {
            clearTimeout(autoTimeout);
            closePopup();
        });

        // Cerrar al hacer clic fuera de la tarjeta
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                clearTimeout(autoTimeout);
                closePopup();
            }
        });
    }

    // Función principal para mostrar un Toast
    window.showToast = function (message, type = null) {
        if (!type) {
            type = detectSeverity(message);
        }
        if (type === 'danger') type = 'error';

        if (type === 'success') {
            showSuccessPopup(message);
            return;
        }

        const container = getOrCreateContainer();
        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${type}`;

        // Convertir saltos de línea \n a elementos HTML br para preservar el formato en recibos
        const formattedMessage = String(message).replace(/\n/g, '<br>');

        toast.innerHTML = `
            <div class="toast-icon">
                ${icons[type] || icons.info}
            </div>
            <div class="toast-message">${formattedMessage}</div>
            <button class="toast-close">&times;</button>
        `;

        container.appendChild(toast);

        // Forzar reflow para animación
        toast.offsetHeight;

        // Mostrar con animación
        toast.classList.add('show');

        // Función para remover con animación
        function removeToast() {
            if (toast.classList.contains('hide')) return;
            toast.classList.replace('show', 'hide');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            });
        }

        // Auto remove después de 5 segundos
        const autoTimeout = setTimeout(removeToast, 5000);

        // Click en cerrar
        toast.querySelector('.toast-close').addEventListener('click', () => {
            clearTimeout(autoTimeout);
            removeToast();
        });
    };

    // Sobrescribir window.alert nativo
    window.alert = function (message) {
        window.showToast(message);
    };
})();

function mostrarToast(texto, tipo = 'success') {
    if (window.showToast) {
        window.showToast(texto, tipo);
    }
}
window.mostrarMensajeOperar = mostrarToast;
window.mostrarToast = mostrarToast;

// ============================================================================
// FORMATEO
// ============================================================================
function formatDateTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

function getLocalDateString(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
window.getLocalDateString = getLocalDateString;

function getCleanLocalDate(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
window.getCleanLocalDate = getCleanLocalDate;

function formatDate(date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
        return date.substring(0, 10);
    }
    const d = date instanceof Date ? date : new Date(date);
    return getLocalDateString(d);
}

function obtenerSucursalActiva() {
    return activeSucursal || (currentUser && currentUser.sucursal) || 'Central';
}

async function cargarProductosPorSucursal() {
    const sucursalName = obtenerSucursalActiva();
    if (!sucursalName) {
        window.inventarioSucursalData = [];
        window.productosSucursalIds = new Set();
        return;
    }

    try {
        const inventarioData = await apiGet(`/inventario?sucursal=${encodeURIComponent(sucursalName)}`);
        window.inventarioSucursalData = Array.isArray(inventarioData) ? inventarioData : [];
        window.productosSucursalIds = new Set(window.inventarioSucursalData.map(item => String(item.id_producto)));
    } catch (err) {
        console.error('Error cargando inventario por sucursal:', err);
        window.inventarioSucursalData = [];
        window.productosSucursalIds = new Set();
    }
}

function productoDisponibleEnSucursal(prod) {
    return window.productosSucursalIds.has(String(prod.id));
}

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar usuario desde backend
    await apiPost('/auth/init', {});

    // Cargar datos PRIMERO (productos, categorías, etc)
    await cargarDatosIniciales();

    // Verificar sesión y cargar inventario de la sucursal asignada
    await verificarSesion();

    // Setup navegación y modals
    setupNavegacion();
    setupModals();

    // Iniciar actualización en tiempo real cada 5 segundos
    setInterval(actualizarDatosEnTiempoReal, 5000);
});

async function verificarSesion() {
    try {
        const data = await apiGet('/auth/session');
        if (data.loggedIn) {
            currentUser = data.user;
            window.currentUser = currentUser;
            activeOperator = currentUser.name;
            activeSucursal = currentUser.sucursal;
            activeRole = currentUser.role;
            sessionStartTime = formatDateTime(new Date());

            if (currentUser.role === 'gerente') {
                if (!sessionStorage.getItem('gerenteConfigurado')) {
                    sessionStorage.setItem('gerenteConfigurado', 'false');
                }
            } else {
                sessionStorage.setItem('gerenteConfigurado', 'true');
            }

            aplicarSesionUI();
            await cargarProductosPorSucursal();
            renderizarTodoProductos();
            renderProductosCheckout();
            await cargarDashboard();
            document.body.classList.remove('login-active');
            await restaurarCajaAbierta();
        } else {
            document.body.classList.add('login-active');
        }
    } catch (e) {
        console.error('Error verificando sesión:', e);
        document.body.classList.add('login-active');
    }
}

function onLoginSessionInit() {
    const hoy = getLocalDateString();
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.value = hoy;
    });

    if (typeof estadoVenta !== 'undefined') {
        estadoVenta.productos = [];
        estadoVenta.total = 0;
        if (typeof actualizarTablaVenta === 'function') {
            actualizarTablaVenta();
        }
    }

    const pagoCon = document.getElementById('pago_con');
    const vuelto = document.getElementById('vuelto');
    if (pagoCon) pagoCon.value = '';
    if (vuelto) vuelto.value = '';

    setTimeout(() => {
        if (typeof window.cargarVentasRealizadas === 'function') {
            window.cargarVentasRealizadas().then(() => {
                if (typeof window.recalcularVentasEfectivo === 'function') {
                    window.recalcularVentasEfectivo();
                }
                if (typeof window.calcularCuadre === 'function') {
                    window.calcularCuadre();
                }
            });
        }
    }, 100);
}

function aplicarSesionUI() {
    if (!currentUser) return;
    window.currentUser = currentUser;
    onLoginSessionInit();

    const selectSucur = document.getElementById('select_sucur');
    if (selectSucur && currentUser.sucursal) {
        const exists = Array.from(selectSucur.options).some(opt => opt.value === currentUser.sucursal);
        if (exists) {
            selectSucur.value = currentUser.sucursal;
        }
    }

    const movOrigen = document.getElementById('mov_sucursal_origen');
    if (movOrigen && currentUser.sucursal) {
        const exists = Array.from(movOrigen.options).some(opt => opt.value === currentUser.sucursal);
        if (exists) {
            movOrigen.value = currentUser.sucursal;
        }
    }

    const headerLabel = document.querySelector('.header .box_comp label');
    const headerRol = document.querySelector('.header .Cont_usuario .rol');

    if (headerLabel) headerLabel.textContent = currentUser.name;
    if (headerRol) {
        headerRol.textContent = currentUser.role;
        aplicarEstiloRol(headerRol, currentUser.role);
    }

    const compraUsuarioInput = document.getElementById("compra_usuario");
    if (compraUsuarioInput) {
        compraUsuarioInput.value = currentUser.name;
    }

    const optUsr = document.getElementById('card_operar_usuario');
    const optRol = document.getElementById('card_operar_rol');
    const optSuc = document.getElementById('card_operar_sucursal');
    const optInicio = document.getElementById('card_operar_inicio');

    if (optUsr) optUsr.textContent = currentUser.name;
    if (optRol) {
        const rolLabel = currentUser.role === 'gerente' ? 'Gerente' : currentUser.role === 'admin' ? 'Administrador' : 'Vendedor';
        optRol.textContent = rolLabel;
    }
    if (optSuc) optSuc.textContent = currentUser.sucursal;
    if (optInicio) optInicio.textContent = sessionStartTime;

    actualizarVisibilidadPorRol();
    actualizarVisibilidadAnulaciones();
    // La caja abierta se restaura con restaurarCajaAbierta() al final del login / verificación de sesión
}

function aplicarEstiloRol(element, role) {
    if (!element) return;
    if (role === 'gerente') {
        element.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.12))';
        element.style.color = '#d97706';
        element.style.border = '1px solid rgba(245,158,11,0.3)';
    } else if (role === 'admin') {
        element.style.background = 'rgba(56,189,248,0.15)';
        element.style.color = 'var(--color-acento)';
        element.style.border = 'none';
    } else {
        element.style.background = 'rgba(79,70,229,0.15)';
        element.style.color = '#818cf8';
        element.style.border = 'none';
    }
}
window.aplicarEstiloRolHeader = aplicarEstiloRol;

function actualizarVisibilidadPorRol() {
    const role = currentUser ? currentUser.role : activeRole;
    const navOperar = document.querySelector('.nav_button[data-section="operar"]');
    const navClientes = document.querySelector('.nav_button[data-section="clientes"]');

    if (navOperar) navOperar.style.display = (role === 'gerente') ? 'flex' : 'none';
    if (navClientes) navClientes.style.display = (role === 'gerente' || role === 'admin') ? 'flex' : 'none';
}
window.actualizarVisibilidadPorRol = actualizarVisibilidadPorRol;

function actualizarVisibilidadAnulaciones() {
    const role = currentUser ? currentUser.role : activeRole;
    const navAnul = document.getElementById('nav_anulaciones');
    if (navAnul) navAnul.style.display = (role === 'gerente' || role === 'admin') ? 'flex' : 'none';
}
window.actualizarVisibilidadAnulaciones = actualizarVisibilidadAnulaciones;

// ============================================================================
// LOGIN / LOGOUT
// ============================================================================
const loginForm = document.getElementById('login-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const btnVerContrasena = document.getElementById('btn-ver-contrasena');

if (btnVerContrasena && loginPassword) {
    btnVerContrasena.addEventListener('click', () => {
        loginPassword.type = loginPassword.type === 'password' ? 'text' : 'password';
        btnVerContrasena.style.opacity = loginPassword.type === 'text' ? '1' : '0.65';
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usuario = loginUsername.value.trim().toLowerCase();
        const contrasena = loginPassword.value.trim();

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, contrasena })
            });

            const data = await res.json();

            if (!res.ok) {
                mostrarToast(data.error || 'Error al iniciar sesión.', 'danger');
                return;
            }

            currentUser = data.user;
            window.currentUser = currentUser;
            activeOperator = currentUser.name;
            activeSucursal = currentUser.sucursal;
            activeRole = currentUser.role;
            sessionStartTime = formatDateTime(new Date());

            if (currentUser.role === 'gerente') {
                sessionStorage.setItem('gerenteConfigurado', 'false');
            } else {
                sessionStorage.setItem('gerenteConfigurado', 'true');
            }

            aplicarSesionUI();
            document.body.classList.remove('login-active');
            await cargarDatosIniciales();
            await cargarProductosPorSucursal();
            renderizarTodoProductos();
            renderProductosCheckout();

            const rolLabel = currentUser.role === 'gerente' ? 'Gerente' : currentUser.role === 'admin' ? 'Administrador' : 'Vendedor';
            mostrarToast(`¡Bienvenido, ${currentUser.name}! Rol: ${rolLabel}`, 'success');

            const btnInicio = document.querySelector('.nav_button[data-section="inicio"]');
            if (btnInicio) btnInicio.click();

            // Si quedó una caja abierta de una sesión anterior, mantenerla abierta
            await restaurarCajaAbierta();
        } catch (err) {
            console.error('Error en login:', err);
            mostrarToast('Error de conexión con el servidor.', 'danger');
        }
    });
}

// Cerrar sesión
const btnCerrarSesion = document.querySelector('.nav_button[data-section="cerrar-sesion"]');
const modalCerrarSesion = document.getElementById('modal_cerrar_sesion');
const btnConfirmarLogout = document.getElementById('btn_confirmar_logout');
const btnCancelarLogout = document.getElementById('btn_cancelar_logout');

if (btnCerrarSesion && modalCerrarSesion) {
    const clone = btnCerrarSesion.cloneNode(true);
    btnCerrarSesion.parentNode.replaceChild(clone, btnCerrarSesion);
    clone.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        // No permitir salir con la caja abierta (se consulta al servidor por si cambió)
        await verificarArqueoActivo();
        if (window.arqueoActivo) {
            mostrarToast('No puedes cerrar sesión con la caja abierta. Ve a "Arqueo de Caja", realiza el conteo y cierra la caja antes de salir.', 'warning');
            return;
        }
        modalCerrarSesion.classList.add('open');
    });

    if (btnConfirmarLogout) {
        btnConfirmarLogout.addEventListener('click', async () => {
            modalCerrarSesion.classList.remove('open');
            const logoutResult = await apiPost('/auth/logout', {});
            if (logoutResult && logoutResult.error) {
                mostrarToast(logoutResult.error, 'warning');
                await verificarArqueoActivo();
                return;
            }
            currentUser = null;
            window.currentUser = null;
            sessionStorage.removeItem('gerenteConfigurado');
            if (loginForm) loginForm.reset();
            document.body.classList.add('login-active');

            // Clean up state on logout
            if (typeof estadoVenta !== 'undefined') {
                estadoVenta.productos = [];
                estadoVenta.total = 0;
                if (typeof actualizarTablaVenta === 'function') {
                    actualizarTablaVenta();
                }
            }
            const pagoCon = document.getElementById('pago_con');
            const vuelto = document.getElementById('vuelto');
            if (pagoCon) pagoCon.value = '';
            if (vuelto) vuelto.value = '';
        });
    }

    if (btnCancelarLogout) {
        btnCancelarLogout.addEventListener('click', () => modalCerrarSesion.classList.remove('open'));
    }

    modalCerrarSesion.addEventListener('click', (e) => {
        if (e.target === modalCerrarSesion) modalCerrarSesion.classList.remove('open');
    });
}

// ============================================================================
// NAVEGACIÓN Y SIDEBAR
// ============================================================================
function setupNavegacion() {
    const sidebar = document.getElementById('sidebar');
    const btnSidebar = document.getElementById('btnMenuSidebar');
    const btnHeader = document.getElementById('btnMenuHeader');
    const navButtons = document.querySelectorAll('.nav_button[data-section]');
    const sections = document.querySelectorAll('.content-section');

    const toggleSidebar = () => sidebar.classList.toggle('expanded');
    btnSidebar?.addEventListener('click', toggleSidebar);
    btnHeader?.addEventListener('click', toggleSidebar);

    let pendingNavSectionId = null;
    let pendingNavButton = null;

    const navegarA = async (sectionId, targetButton) => {
        // Cargar datos base actualizados antes de navegar a cualquier sección
        try {
            await cargarDatosIniciales();
        } catch (e) {
            console.error("Error al actualizar datos iniciales durante navegación:", e);
        }

        // Validar restricción para Gerente
        if (currentUser && currentUser.role === 'gerente' && (sectionId === 'punto-venta' || sectionId === 'inventario')) {
            if (sessionStorage.getItem('gerenteConfigurado') !== 'true') {
                mostrarToast('Como Gerente, primero debes ir a la pestaña "Operar" para seleccionar un usuario y sucursal de trabajo.', 'warning');
                const btnOperar = document.querySelector('.nav_button[data-section="operar"]');
                if (btnOperar) {
                    sectionId = 'operar';
                    targetButton = btnOperar;
                }
            }
        }

        sections.forEach(s => s.classList.toggle('active', s.id === sectionId));
        navButtons.forEach(b => b.classList.toggle('active', b === targetButton));

        if (sectionId === 'punto-venta') {
            renderProductosCheckout();
        }

        const header = document.querySelector('header.header');
        header?.classList.toggle('hidden', sectionId !== 'inicio');

        if (sectionId !== 'inicio') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Cargar datos según sección
        if (sectionId === 'inicio') cargarDashboard();
        if (sectionId === 'inventario') cargarInventario();
        if (sectionId === 'productos') cargarProductos();
        if (sectionId === 'ventas') cargarHistorialVentas();
        if (sectionId === 'reportes') cargarReportesTab();
        if (sectionId === 'proveedores') cargarProveedores();
        if (sectionId === 'compras') cargarCompras();
        if (sectionId === 'anulaciones') cargarAnulaciones();
        if (sectionId === 'gastos') cargarGastos();
        if (sectionId === 'operar') setupOperar();
    };

    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            let sectionId = button.dataset.section;
            let targetButton = button;

            // Validar si sale de punto-venta con productos en el carrito
            const activeSection = document.querySelector('.content-section.active');
            const activeSectionId = activeSection ? activeSection.id : '';

            if (activeSectionId === 'punto-venta' && sectionId !== 'punto-venta') {
                if (estadoVenta && estadoVenta.productos && estadoVenta.productos.length > 0) {
                    document.getElementById('modal_alerta_venta_activa').classList.add('open');
                    return; // Bloquea la navegación por completo
                }
            }

            navegarA(sectionId, targetButton);
        });
    });

    // Eventos para el Modal de Alerta Venta Activa
    const modalAlertaVentaActiva = document.getElementById('modal_alerta_venta_activa');
    const btnEntendidoVentaActiva = document.getElementById('btn_entendido_venta_activa');

    if (btnEntendidoVentaActiva) {
        btnEntendidoVentaActiva.addEventListener('click', () => {
            modalAlertaVentaActiva.classList.remove('open');
        });
    }

    if (modalAlertaVentaActiva) {
        modalAlertaVentaActiva.addEventListener('click', (e) => {
            if (e.target === modalAlertaVentaActiva) {
                modalAlertaVentaActiva.classList.remove('open');
            }
        });
    }

    // Cerrar sidebar al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!sidebar.contains(e.target) && !btnSidebar?.contains(e.target) && !btnHeader?.contains(e.target) && sidebar.classList.contains('expanded')) {
            sidebar.classList.remove('expanded');
        }
    });
}

// ============================================================================
// MODALS
// ============================================================================
const mostAggProdu = document.getElementById('most_agg_produ');
const mostAviso = document.getElementById('most_aviso');

function setupModals() {
    document.addEventListener('click', (e) => {
        const target = e.target;

        // Botones de cierre que abren aviso de confirmación
        const closeButtons = ['regr_new_produ', 'regr_modify_produ', 'vol_v_venta', 'vol_v_compra',
            'vol_v_compra_hist', 'vol_v_gasto', 'regr_crear_usuario', 'regr_crear_categoria',
            'regr_editar_categoria', 'regr_solicitar_eliminar_producto', 'vol_v_prod_elim',
            'regr_solicitar_inactivar_proveedor', 'vol_v_prov_inact'];

        for (const id of closeButtons) {
            if (target.closest(`#${id}`)) {
                e.preventDefault();
                openMostAviso();
                return;
            }
        }

        // Confirmar cierre
        if (target.closest('#btn_aceptar')) {
            e.preventDefault();
            closeMostAviso();
            closeMostAggProdu();
            return;
        }
        if (target.closest('#btn_cancelar_aviso')) {
            e.preventDefault();
            closeMostAviso();
            return;
        }

        // Confirmar eliminación
        if (target.closest('#btn_confirmar_eliminar_aceptar')) {
            e.preventDefault();
            if (typeof callbackConfirmarEliminar === 'function') callbackConfirmarEliminar();
            cerrarConfirmacionEliminar();
            return;
        }
        if (target.closest('#btn_confirmar_eliminar_cancelar')) {
            e.preventDefault();
            cerrarConfirmacionEliminar();
            return;
        }

        // Cerrar al click fuera
        if (mostAggProdu && mostAggProdu.classList.contains('open') && target === mostAggProdu) closeMostAggProdu();
        if (mostAviso && mostAviso.classList.contains('open') && target === mostAviso) closeMostAviso();

        const modalCE = document.getElementById('modal_confirmar_eliminar');
        if (modalCE && modalCE.classList.contains('open') && target === modalCE) cerrarConfirmacionEliminar();
    });
}

function openMostAggProdu() { mostAggProdu?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeMostAggProdu() {
    mostAggProdu?.classList.remove('open');
    document.body.style.overflow = '';
}
function openMostAviso() { mostAviso?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeMostAviso() { mostAviso?.classList.remove('open'); document.body.style.overflow = ''; }

window.closeMostAggProdu = closeMostAggProdu;

function mostrarModal(modalId) {
    const allModals = ['modal_crear_producto', 'modal_modificar_producto', 'modal_ver_ventas',
        'modal_crear_usuario', 'modal_ver_factura_compra', 'modal_crear_categoria',
        'modal_editar_categoria', 'modal_solicitar_anulacion', 'modal_ver_compras',
        'modal_ver_gastos', 'modal_solicitar_eliminar_producto', 'modal_ver_producto_eliminar',
        'modal_solicitar_inactivar_proveedor', 'modal_ver_proveedor_inactivar'];

    allModals.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const selected = document.getElementById(modalId);
    if (selected) selected.style.display = 'block';
    openMostAggProdu();
}
window.mostrarModal = mostrarModal;

let callbackConfirmarEliminar = null;

function mostrarConfirmacionEliminar(titulo, mensaje, callback, textAceptar = 'Eliminar') {
    const modal = document.getElementById('modal_confirmar_eliminar');
    const titEl = document.getElementById('confirmar_eliminar_titulo');
    const msgEl = document.getElementById('confirmar_eliminar_mensaje');
    const btnAcept = document.getElementById('btn_confirmar_eliminar_aceptar');

    if (titEl) titEl.textContent = titulo;
    if (msgEl) msgEl.textContent = mensaje;
    if (btnAcept) btnAcept.textContent = textAceptar;
    callbackConfirmarEliminar = callback;

    if (modal) { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
window.mostrarConfirmacionEliminar = mostrarConfirmacionEliminar;

function cerrarConfirmacionEliminar() {
    const modal = document.getElementById('modal_confirmar_eliminar');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
    callbackConfirmarEliminar = null;
}
window.cerrarConfirmacionEliminar = cerrarConfirmacionEliminar;

// ============================================================================
// CARGA INICIAL DE DATOS
// ============================================================================
async function cargarDatosIniciales() {
    try {
        [categoriasCache, productosCache, sucursalesCache, rolesCache] = await Promise.all([
            apiGet('/categorias'),
            apiGet('/productos'),
            apiGet('/usuarios/sucursales'),
            apiGet('/usuarios/roles')
        ]);

        window.sucursalesCache = sucursalesCache;
        window.categoriasCache = categoriasCache;
        window.rolesCache = rolesCache;

        window.productosInventario = productosCache.map(p => ({
            id: String(p.id_producto),
            name: p.nombre,
            category: p.categoria,
            price: parseFloat(p.precio_venta),
            groupings: p.groupings || { Unidad: 1 },
            groupingDetails: p.groupingDetails || {},
            activo: p.estado === 'Activo',
            id_categoria: p.id_categoria,
            location: 'Mostrador'
        }));

        actualizarCategoriasEnUI();
        cargarUsuariosTabla();
        populateUserFormDropdowns();
        if (typeof renderizarTodoProductos === 'function') {
            renderizarTodoProductos();
        }
    } catch (err) {
        console.error('Error cargando datos iniciales:', err);
    }
}

// ============================================================================
// DASHBOARD
// ============================================================================
async function cargarDashboard() {
    try {
        const sucursal = activeSucursal || 'Central';
        const data = await apiGet(`/reportes/dashboard?sucursal=${encodeURIComponent(sucursal)}`);
        
        // 1. Actualizar las tarjetas KPI superiores
        const cards = document.querySelectorAll('.boxs_card .card_info h3');
        if (cards.length >= 4) {
            cards[0].textContent = `C$ ${parseFloat(data.ingresosHoy).toFixed(2)}`;
            cards[1].textContent = data.totalProductos;
            cards[2].textContent = `C$ ${parseFloat(data.valorInventario).toFixed(2)}`;
            cards[3].textContent = data.stockBajo;
        }

        // 2. Actualizar gráfico de Ventas de la Semana
        const maxVal = Math.max(...(data.ventasSemana || []).map(v => parseFloat(v.total) || 0), 100);
        const dayClasses = {
            2: 'lunes',
            3: 'martes',
            4: 'miercoles',
            5: 'jueves',
            6: 'viernes',
            7: 'sabado',
            1: 'domingo'
        };

        // Reiniciar todas las barras a cero
        Object.values(dayClasses).forEach(cls => {
            const barEl = document.querySelector(`.bar.${cls}`);
            if (barEl) {
                barEl.style.height = '0px';
                const spanEl = barEl.querySelector('span');
                if (spanEl) spanEl.textContent = '0';
            }
        });

        // Cargar las ventas reales
        (data.ventasSemana || []).forEach(v => {
            const cls = dayClasses[v.dia];
            const barEl = document.querySelector(`.bar.${cls}`);
            if (barEl) {
                const total = parseFloat(v.total) || 0;
                const height = (total / maxVal) * 200; // max height 200px
                barEl.style.height = `${height}px`;
                const spanEl = barEl.querySelector('span');
                if (spanEl) spanEl.textContent = Math.round(total);
            }
        });

        // 3. Actualizar Top 5 Productos más Vendidos (Gráfico de Dona y Leyenda)
        const topProducts = data.masVendidos || [];
        const totalUnits = topProducts.reduce((sum, p) => sum + (parseFloat(p.total_vendido) || 0), 0);
        const colors = ['#6C63FF', '#4DD0E1', '#2F3E46', '#2EC4B6', '#E0E0E0'];

        const donaEl = document.querySelector('.ulti_ventas .dona');
        if (donaEl) {
            if (totalUnits === 0) {
                donaEl.style.background = '#e2e8f0';
            } else {
                let cumulativePercentage = 0;
                const gradientSegments = [];
                topProducts.forEach((p, idx) => {
                    const pct = ((parseFloat(p.total_vendido) || 0) / totalUnits) * 100;
                    const nextPercentage = cumulativePercentage + pct;
                    gradientSegments.push(`${colors[idx]} ${cumulativePercentage.toFixed(1)}% ${nextPercentage.toFixed(1)}%`);
                    cumulativePercentage = nextPercentage;
                });
                if (cumulativePercentage < 100) {
                    gradientSegments.push(`#E2E8F0 ${cumulativePercentage.toFixed(1)}% 100%`);
                }
                donaEl.style.background = `conic-gradient(${gradientSegments.join(', ')})`;
            }
        }

        const leyendaEl = document.querySelector('.ulti_ventas .leyenda');
        if (leyendaEl) {
            if (topProducts.length === 0) {
                leyendaEl.innerHTML = '<div class="item">Sin ventas registradas</div>';
            } else {
                leyendaEl.innerHTML = topProducts.map((p, idx) => {
                    const pct = totalUnits > 0 ? ((parseFloat(p.total_vendido) || 0) / totalUnits) * 100 : 0;
                    return `
                        <div class="item">
                            <div class="color" style="background:${colors[idx]};"></div> 
                            ${p.nombre} (${pct.toFixed(0)}%)
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (e) { console.error('Error cargando dashboard:', e); }
}

// ============================================================================
// REPORTES Y ESTADÍSTICAS
// ============================================================================
let reportDataCache = []; // Almacena el detalle del reporte cargado actualmente
let reportUsuariosCache = []; // Almacena los usuarios para el filtro de reportes

function actualizarClientesPorSucursal() {
    const repSucursal = document.getElementById('rep_sucursal');
    const repCliente = document.getElementById('rep_cliente');
    if (!repSucursal || !repCliente) return;

    const sucursalVal = repSucursal.value || 'todas';
    const valActual = repCliente.value || 'todos';

    // Filtrar los usuarios según la sucursal seleccionada
    const usuariosFiltrados = reportUsuariosCache.filter(u => {
        if (u.estado !== 'Activo') return false;
        if (sucursalVal === 'todas') return true;
        return u.sucursal === sucursalVal || u.sucursal === 'Todas';
    });

    repCliente.innerHTML = '<option value="todos">Todos los Clientes</option>' +
        usuariosFiltrados.map(u => `<option value="${u.nombre_completo}">${u.nombre_completo}</option>`).join('');

    // Restaurar valor previo si sigue disponible
    if (valActual !== 'todos' && usuariosFiltrados.some(u => u.nombre_completo === valActual)) {
        repCliente.value = valActual;
    } else {
        repCliente.value = 'todos';
    }
}

async function cargarReportesTab() {
    const fechaFiltro = document.getElementById('rep_fecha_filtro');
    if (fechaFiltro && !fechaFiltro.value) {
        fechaFiltro.value = getLocalDateString(new Date());
    }

    // Cargar clientes/usuarios dinámicamente desde la base de datos
    try {
        reportUsuariosCache = await apiGet('/usuarios');
        actualizarClientesPorSucursal();
    } catch (e) {
        console.error('Error cargando usuarios en reportes:', e);
    }

    // Asegurar que los listeners se agreguen una sola vez
    const btnGenerar = document.getElementById('btn_generar_reporte');
    if (btnGenerar && !btnGenerar.dataset.listener) {
        btnGenerar.dataset.listener = 'true';
        btnGenerar.addEventListener('click', generarReporte);

        ['rep_tipo', 'rep_rango_tiempo', 'rep_cliente'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', generarReporte);
        });

        document.getElementById('rep_sucursal')?.addEventListener('change', () => {
            actualizarClientesPorSucursal();
            generarReporte();
        });

        document.getElementById('rep_fecha_filtro')?.addEventListener('change', filtrarFilasReporte);
        document.getElementById('buscar_reporte')?.addEventListener('input', filtrarFilasReporte);
    }

    await generarReporte();
}

async function generarReporte() {
    const tipo = document.getElementById('rep_tipo')?.value || 'ventas';
    const rango = document.getElementById('rep_rango_tiempo')?.value || 'hoy';
    const sucursal = document.getElementById('rep_sucursal')?.value || 'todas';
    const tbody = document.getElementById('tabla_reporte_body');
    const thead = document.getElementById('tabla_reporte_head');

    if (!tbody || !thead) return;

    const tableEl = document.getElementById('tabla_reporte');
    if (tableEl) {
        if (tipo === 'arqueo') {
            tableEl.classList.add('cierre-caja-table');
        } else {
            tableEl.classList.remove('cierre-caja-table');
        }
    }

    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 24px;">Cargando datos del reporte...</td></tr>`;

    // Calcular fechas del rango
    const hoy = new Date();
    const hoyStr = getLocalDateString(hoy);
    let fecha_inicio = '';
    let fecha_fin = hoyStr;

    if (rango === 'hoy') {
        fecha_inicio = hoyStr;
    } else if (rango === 'semana') {
        const haceUnaSemana = new Date();
        haceUnaSemana.setDate(hoy.getDate() - 7);
        fecha_inicio = getLocalDateString(haceUnaSemana);
    } else if (rango === 'mes') {
        const haceUnMes = new Date();
        haceUnMes.setDate(hoy.getDate() - 30);
        fecha_inicio = getLocalDateString(haceUnMes);
    }

    try {
        if (tipo === 'ventas') {
            // Mostrar visualizaciones de gráficos para Ventas
            const cardPagos = document.getElementById('card_grafico_pagos');
            const cardProductos = document.getElementById('card_grafico_productos');
            const gridReportes = document.querySelector('.grid_reportes');
            if (cardPagos) cardPagos.style.display = 'block';
            if (cardProductos) cardProductos.style.display = 'block';
            if (gridReportes) gridReportes.style.display = 'grid';

            // Cambiar textos KPI
            document.getElementById('kpi_ingresos_label').textContent = 'Ingresos Totales';
            document.getElementById('kpi_transacciones_label').textContent = 'Transacciones';
            document.getElementById('titulo_grafico_productos').textContent = 'Top 5 Productos Estrella';

            const clienteVal = document.getElementById('rep_cliente')?.value || 'todos';
            let url = `/reportes/ventas?sucursal=${sucursal}`;
            if (fecha_inicio) url += `&fecha_inicio=${fecha_inicio}`;
            if (fecha_fin) url += `&fecha_fin=${fecha_fin}`;
            if (clienteVal !== 'todos') url += `&vendedor=${encodeURIComponent(clienteVal)}`;

            const data = await apiGet(url);
            reportDataCache = data.ventas || [];

            // Actualizar KPIs
            const resumen = data.resumen || { totalMonto: 0, totalTransacciones: 0, porMetodo: {} };
            document.getElementById('kpi_ingresos').textContent = `C$ ${parseFloat(resumen.totalMonto).toFixed(2)}`;

            let efectivo = 0, tarjeta = 0, transferencia = 0;
            if (resumen.porMetodo['Efectivo']) efectivo = resumen.porMetodo['Efectivo'].monto;
            if (resumen.porMetodo['Tarjeta']) tarjeta = resumen.porMetodo['Tarjeta'].monto;
            if (resumen.porMetodo['Transferencia']) transferencia = resumen.porMetodo['Transferencia'].monto;
            const digital = tarjeta + transferencia;
            document.getElementById('kpi_ingresos_sub').textContent = `C$ ${efectivo.toFixed(2)} efectivo / C$ ${digital.toFixed(2)} digital`;

            document.getElementById('kpi_transacciones').textContent = resumen.totalTransacciones;
            const ticketProm = resumen.totalTransacciones > 0 ? (resumen.totalMonto / resumen.totalTransacciones) : 0;
            document.getElementById('kpi_transacciones_sub').textContent = `Ticket promedio: C$ ${ticketProm.toFixed(2)}`;

            // Renderizar gráfico de pagos stacked bar
            const totalPagos = (efectivo + tarjeta + transferencia) || 1;
            const pctEfe = ((efectivo / totalPagos) * 100).toFixed(0);
            const pctTar = ((tarjeta / totalPagos) * 100).toFixed(0);
            const pctTra = ((transferencia / totalPagos) * 100).toFixed(0);

            const graficoPagos = document.getElementById('grafico_pagos');
            if (graficoPagos) {
                graficoPagos.innerHTML = `
                    <div class="payment_bar_stacked">
                        <div class="payment_bar_segment efectivo" style="width: ${pctEfe}%;"></div>
                        <div class="payment_bar_segment tarjeta" style="width: ${pctTar}%;"></div>
                        <div class="payment_bar_segment transferencia" style="width: ${pctTra}%;"></div>
                    </div>
                    <div class="payment_legend">
                        <div class="payment_legend_item">
                            <span class="payment_dot efectivo"></span>
                            Efectivo
                            <strong>C$ ${efectivo.toFixed(2)} (${pctEfe}%)</strong>
                        </div>
                        <div class="payment_legend_item">
                            <span class="payment_dot tarjeta"></span>
                            Tarjeta
                            <strong>C$ ${tarjeta.toFixed(2)} (${pctTar}%)</strong>
                        </div>
                        <div class="payment_legend_item">
                            <span class="payment_dot transferencia"></span>
                            Transferencia
                            <strong>C$ ${transferencia.toFixed(2)} (${pctTra}%)</strong>
                        </div>
                    </div>
                `;
            }

            // Renderizar Top 5 Productos (desde dashboard)
            const dashboardData = await apiGet('/reportes/dashboard');
            const topProds = dashboardData.masVendidos || [];
            const graficoTop = document.getElementById('grafico_top_productos');
            if (graficoTop) {
                if (topProds.length === 0) {
                    graficoTop.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 0.875rem; padding: 24px;">No hay productos estrella en el periodo.</div>';
                } else {
                    const maxQty = Math.max(...topProds.map(p => parseFloat(p.total_vendido) || 1));
                    graficoTop.innerHTML = topProds.map((p, idx) => {
                        const qty = parseFloat(p.total_vendido) || 0;
                        const pct = ((qty / maxQty) * 100).toFixed(0);
                        return `
                            <div class="top_prod_card">
                                <span class="top_prod_badge">TOP ${idx + 1}</span>
                                <span class="top_prod_name">${p.nombre}</span>
                                <div class="top_prod_sales">
                                    <span>Ventas:</span>
                                    <strong>${qty} uds</strong>
                                </div>
                                <div class="top_prod_bar_bg">
                                    <div class="top_prod_bar_fill" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Establecer cabeceras tabla
            thead.innerHTML = `
                <tr>
                    <th>Venta</th>
                    <th>Fecha Realizada</th>
                    <th>Vendedor</th>
                    <th>Sucursal</th>
                    <th>Forma de Pago</th>
                    <th>Monto</th>
                    <th>Acciones</th>
                </tr>
            `;

        } else if (tipo === 'inventario') {
            // Ocultar visualizaciones para Inventario
            const gridReportes = document.querySelector('.grid_reportes');
            if (gridReportes) gridReportes.style.display = 'none';

            // Cambiar textos KPI
            document.getElementById('kpi_ingresos_label').textContent = 'Unidades Transferidas';
            document.getElementById('kpi_transacciones_label').textContent = 'Total Movimientos';

            const rawMovs = await apiGet('/inventario/movimientos');

            // Filtrar movimientos según rango de fechas y sucursal
            reportDataCache = rawMovs.filter(m => {
                const fMov = m.fecha ? getCleanLocalDate(m.fecha) : '';
                const matchInicio = fecha_inicio ? (fMov >= fecha_inicio) : true;
                const matchFin = fecha_fin ? (fMov <= fecha_fin) : true;
                const matchSuc = sucursal === 'todas' ? true :
                    (String(m.sucursal_origen).toLowerCase().trim() === sucursal.toLowerCase().trim() ||
                        String(m.sucursal_destino).toLowerCase().trim() === sucursal.toLowerCase().trim());
                return matchInicio && matchFin && matchSuc;
            });

            // Calcular KPIs
            const totalUnits = reportDataCache.reduce((sum, m) => sum + (parseInt(m.cantidad_unidades) || 0), 0);
            document.getElementById('kpi_ingresos').textContent = `${totalUnits} Uds`;
            document.getElementById('kpi_ingresos_sub').textContent = 'Unidades de stock transferidas';
            document.getElementById('kpi_transacciones').textContent = reportDataCache.length;
            document.getElementById('kpi_transacciones_sub').textContent = 'Transferencias de inventario registradas';

            // Establecer cabeceras tabla
            thead.innerHTML = `
                <tr>
                    <th>Movimiento</th>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Origen</th>
                    <th>Destino</th>
                    <th>Cantidad (Uds)</th>
                    <th>Operador</th>
                </tr>
            `;

        } else if (tipo === 'compras') {
            // Mostrar visualizaciones de gráficos para Compras
            const cardPagos = document.getElementById('card_grafico_pagos');
            const cardProductos = document.getElementById('card_grafico_productos');
            const gridReportes = document.querySelector('.grid_reportes');
            if (cardPagos) cardPagos.style.display = 'block';
            if (cardProductos) cardProductos.style.display = 'block';
            if (gridReportes) gridReportes.style.display = 'grid';

            // Cambiar textos KPI
            document.getElementById('kpi_ingresos_label').textContent = 'Inversión en Compras';
            document.getElementById('kpi_transacciones_label').textContent = 'Facturas Recibidas';
            document.getElementById('titulo_grafico_productos').textContent = 'Top Proveedores';

            const clienteVal = document.getElementById('rep_cliente')?.value || 'todos';
            const rawCompras = await apiGet('/compras');

            // Filtrar compras según rango de fechas, sucursal y comprador
            reportDataCache = rawCompras.filter(c => {
                const fComp = c.fecha ? getCleanLocalDate(c.fecha) : '';
                const matchInicio = fecha_inicio ? (fComp >= fecha_inicio) : true;
                const matchFin = fecha_fin ? (fComp <= fecha_fin) : true;
                const matchSuc = sucursal === 'todas' ? true : (String(c.sucursal).toLowerCase().trim() === sucursal.toLowerCase().trim());
                const matchComp = clienteVal === 'todos' ? true : (String(c.comprador || '').toLowerCase().trim() === clienteVal.toLowerCase().trim());
                return matchInicio && matchFin && matchSuc && matchComp;
            });

            // Calcular KPIs
            const totalInversion = reportDataCache.reduce((sum, c) => sum + (parseFloat(c.total) || 0), 0);
            document.getElementById('kpi_ingresos').textContent = `C$ ${totalInversion.toFixed(2)}`;
            document.getElementById('kpi_ingresos_sub').textContent = 'Inversión total en compras de mercadería';
            document.getElementById('kpi_transacciones').textContent = reportDataCache.length;
            document.getElementById('kpi_transacciones_sub').textContent = 'Facturas de proveedores registradas';

            // Renderizar método de pago de compras
            let efe = 0, tar = 0, tra = 0;
            reportDataCache.forEach(c => {
                const mp = String(c.metodo_pago).toLowerCase();
                const amt = parseFloat(c.total) || 0;
                if (mp.includes('efe')) efe += amt;
                else if (mp.includes('tar')) tar += amt;
                else tra += amt;
            });
            const totalPagosComp = (efe + tar + tra) || 1;
            const pctEfe = ((efe / totalPagosComp) * 100).toFixed(0);
            const pctTar = ((tar / totalPagosComp) * 100).toFixed(0);
            const pctTra = ((tra / totalPagosComp) * 100).toFixed(0);

            const graficoPagos = document.getElementById('grafico_pagos');
            if (graficoPagos) {
                graficoPagos.innerHTML = `
                    <div class="payment_bar_stacked">
                        <div class="payment_bar_segment efectivo" style="width: ${pctEfe}%;"></div>
                        <div class="payment_bar_segment tarjeta" style="width: ${pctTar}%;"></div>
                        <div class="payment_bar_segment transferencia" style="width: ${pctTra}%;"></div>
                    </div>
                    <div class="payment_legend">
                        <div class="payment_legend_item">
                            <span class="payment_dot efectivo"></span>
                            Efectivo
                            <strong>C$ ${efe.toFixed(2)} (${pctEfe}%)</strong>
                        </div>
                        <div class="payment_legend_item">
                            <span class="payment_dot tarjeta"></span>
                            Tarjeta
                            <strong>C$ ${tar.toFixed(2)} (${pctTar}%)</strong>
                        </div>
                        <div class="payment_legend_item">
                            <span class="payment_dot transferencia"></span>
                            Transferencia
                            <strong>C$ ${tra.toFixed(2)} (${pctTra}%)</strong>
                        </div>
                    </div>
                `;
            }

            // Top Proveedores
            const provMap = {};
            reportDataCache.forEach(c => {
                const name = c.proveedor || 'Desconocido';
                provMap[name] = (provMap[name] || 0) + (parseFloat(c.total) || 0);
            });
            const topProvs = Object.entries(provMap)
                .map(([name, total]) => ({ nombre: name, total }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 5);

            const graficoTop = document.getElementById('grafico_top_productos');
            if (graficoTop) {
                if (topProvs.length === 0) {
                    graficoTop.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 0.875rem; padding: 24px;">No hay compras en el periodo.</div>';
                } else {
                    const maxVal = Math.max(...topProvs.map(p => p.total || 1));
                    graficoTop.innerHTML = topProvs.map((p, idx) => {
                        const pct = ((p.total / maxVal) * 100).toFixed(0);
                        return `
                            <div class="top_prod_card">
                                <span class="top_prod_badge">TOP ${idx + 1}</span>
                                <span class="top_prod_name">${p.nombre}</span>
                                <div class="top_prod_sales">
                                    <span>Monto:</span>
                                    <strong>C$ ${p.total.toFixed(2)}</strong>
                                </div>
                                <div class="top_prod_bar_bg">
                                    <div class="top_prod_bar_fill" style="width: ${pct}%;"></div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Cabeceras compras
            thead.innerHTML = `
                <tr>
                    <th>Factura</th>
                    <th>Fecha</th>
                    <th>Proveedor</th>
                    <th>Sucursal</th>
                    <th>Comprador</th>
                    <th>Forma de Pago</th>
                    <th>Total</th>
                    <th>Acciones</th>
                </tr>
            `;
        } else if (tipo === 'arqueo') {
            // Ocultar visualizaciones
            const gridReportes = document.querySelector('.grid_reportes');
            if (gridReportes) gridReportes.style.display = 'none';

            // Cambiar textos KPI
            document.getElementById('kpi_ingresos_label').textContent = 'Efectivo Contado';
            document.getElementById('kpi_transacciones_label').textContent = 'Cierres de Caja';

            const clienteVal = document.getElementById('rep_cliente')?.value || 'todos';
            const rawArqueos = await apiGet('/arqueo');

            // Filtrar arqueos según rango de fechas, sucursal y usuario seleccionado
            reportDataCache = rawArqueos.filter(a => {
                const fArq = a.fecha ? getCleanLocalDate(a.fecha) : '';
                const matchInicio = fecha_inicio ? (fArq >= fecha_inicio) : true;
                const matchFin = fecha_fin ? (fArq <= fecha_fin) : true;
                const matchSuc = sucursal === 'todas' ? true : (String(a.sucursal).toLowerCase().trim() === sucursal.toLowerCase().trim());
                const matchUser = clienteVal === 'todos' ? true : (String(a.cajero).toLowerCase().trim() === clienteVal.toLowerCase().trim());
                return matchInicio && matchFin && matchSuc && matchUser;
            });

            // Calcular KPIs
            const totalContado = reportDataCache.reduce((sum, a) => sum + (parseFloat(a.efectivo_contado) || 0), 0);
            const totalDiferencia = reportDataCache.reduce((sum, a) => sum + (parseFloat(a.diferencia) || 0), 0);
            const cuadradas = reportDataCache.filter(a => a.estado === 'Cuadrada').length;
            const faltantes = reportDataCache.filter(a => a.estado === 'Faltante').length;
            const sobrantes = reportDataCache.filter(a => a.estado === 'Sobrante').length;

            document.getElementById('kpi_ingresos').textContent = `C$ ${totalContado.toFixed(2)}`;
            document.getElementById('kpi_ingresos_sub').textContent = `Diferencia total: C$ ${totalDiferencia >= 0 ? '+' : ''}${totalDiferencia.toFixed(2)}`;
            document.getElementById('kpi_transacciones').textContent = reportDataCache.length;
            document.getElementById('kpi_transacciones_sub').textContent = `Cuadradas: ${cuadradas} | Faltantes: ${faltantes} | Sobrantes: ${sobrantes}`;

            // Establecer cabeceras tabla
            thead.innerHTML = `
                <tr>
                    <th>ID Arqueo</th>
                    <th>Fecha</th>
                    <th>Cajero</th>
                    <th>Sucursal</th>
                    <th>Ef. Inicial</th>
                    <th>Vtas. Efectivo</th>
                    <th>Gastos</th>
                    <th>Esperado</th>
                    <th>Contado</th>
                    <th>Diferencia</th>
                    <th>Estado</th>
                </tr>
            `;
        }

        filtrarFilasReporte();

    } catch (err) {
        console.error('Error al generar reporte:', err);
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #ef4444; padding: 24px;">Error al obtener datos desde el servidor.</td></tr>`;
    }
}

function filtrarFilasReporte() {
    const tipo = document.getElementById('rep_tipo')?.value || 'ventas';
    const fechaFiltroVal = document.getElementById('rep_fecha_filtro')?.value || '';
    const buscarVal = document.getElementById('buscar_reporte')?.value.toLowerCase().trim() || '';
    const tbody = document.getElementById('tabla_reporte_body');

    if (!tbody) return;

    const filtered = reportDataCache.filter(item => {
        // 1. Filtrar por fecha exacta
        let itemFechaStr = '';
        if (item.fecha) {
            itemFechaStr = getCleanLocalDate(item.fecha);
        }
        const matchFecha = fechaFiltroVal ? (itemFechaStr === fechaFiltroVal) : true;

        // 2. Filtrar por texto de búsqueda
        let matchBuscar = true;
        if (buscarVal) {
            if (tipo === 'ventas') {
                const codigo = String(item.codigo_venta || item.id_venta).toLowerCase();
                const vendedor = String(item.vendedor || '').toLowerCase();
                const sucursal = String(item.sucursal || '').toLowerCase();
                const pago = String(item.metodo_pago || '').toLowerCase();
                matchBuscar = codigo.includes(buscarVal) || vendedor.includes(buscarVal) || sucursal.includes(buscarVal) || pago.includes(buscarVal);
            } else if (tipo === 'inventario') {
                const idMov = String(item.id_movimiento).toLowerCase();
                const prod = String(item.producto || '').toLowerCase();
                const orig = String(item.sucursal_origen || '').toLowerCase();
                const dest = String(item.sucursal_destino || '').toLowerCase();
                const op = String(item.usuario || '').toLowerCase();
                matchBuscar = idMov.includes(buscarVal) || prod.includes(buscarVal) || orig.includes(buscarVal) || dest.includes(buscarVal) || op.includes(buscarVal);
            } else if (tipo === 'compras') {
                const factura = String(item.numero_factura || item.id_compra).toLowerCase();
                const prov = String(item.proveedor || '').toLowerCase();
                const suc = String(item.sucursal || '').toLowerCase();
                const comp = String(item.comprador || '').toLowerCase();
                const pago = String(item.metodo_pago || '').toLowerCase();
                matchBuscar = factura.includes(buscarVal) || prov.includes(buscarVal) || suc.includes(buscarVal) || comp.includes(buscarVal) || pago.includes(buscarVal);
            } else if (tipo === 'arqueo') {
                const idArq = String(item.id_arqueo).toLowerCase();
                const cajero = String(item.cajero || '').toLowerCase();
                const suc = String(item.sucursal || '').toLowerCase();
                const estado = String(item.estado || '').toLowerCase();
                matchBuscar = idArq.includes(buscarVal) || cajero.includes(buscarVal) || suc.includes(buscarVal) || estado.includes(buscarVal);
            }
        }

        return matchFecha && matchBuscar;
    });

    if (filtered.length === 0) {
        let text = 'No se encontraron registros coincidentes.';
        if (fechaFiltroVal) {
            text = `No hay registros para la fecha ${fechaFiltroVal}.`;
        }
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 24px; font-weight: 500;">${text}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const fecha = item.fecha ? getCleanLocalDate(item.fecha) : '';

        if (tipo === 'ventas') {
            const estado = item.estado || 'Completada';
            const isAnulada = (estado === 'Anulada');
            const strikeStyle = isAnulada ? "text-decoration: line-through; opacity: 0.6;" : "";
            const totalVal = `C$ ${(parseFloat(item.total) || 0).toFixed(2)}`;

            return `
                <tr style="${strikeStyle}">
                    <td><strong>${item.codigo_venta || item.id_venta}</strong></td>
                    <td>${fecha}</td>
                    <td>${item.vendedor}</td>
                    <td>${item.sucursal}</td>
                    <td>${item.metodo_pago}</td>
                    <td style="color: ${isAnulada ? '#94a3b8' : 'green'}; font-weight: bold;">${totalVal}</td>
                    <td>
                        <button class="btn_observar_v" onclick="window.mostrarDetallesVenta('${item.id_venta}')">Observar venta</button>
                    </td>
                </tr>
            `;
        } else if (tipo === 'inventario') {
            return `
                <tr>
                    <td><strong>MOV-${String(item.id_movimiento).padStart(4, '0')}</strong></td>
                    <td>${fecha}</td>
                    <td>${item.producto}</td>
                    <td>${item.sucursal_origen}</td>
                    <td>${item.sucursal_destino}</td>
                    <td><strong>${item.cantidad_unidades}</strong> <span style="font-size: 11px; color: #64748b;">(${item.agrupacion})</span></td>
                    <td>${item.usuario}</td>
                </tr>
            `;
        } else if (tipo === 'compras') {
            const totalVal = `C$ ${(parseFloat(item.total) || 0).toFixed(2)}`;
            return `
                <tr>
                    <td><strong>${item.numero_factura || 'FC-' + item.id_compra}</strong></td>
                    <td>${fecha}</td>
                    <td>${item.proveedor}</td>
                    <td>${item.sucursal}</td>
                    <td>${item.comprador}</td>
                    <td>${item.metodo_pago}</td>
                    <td style="color: #4f46e5; font-weight: bold;">${totalVal}</td>
                    <td>
                        <button class="btn_observar_v" onclick="window.mostrarDetallesCompra('${item.id_compra}')">Observar compra</button>
                    </td>
                </tr>
            `;
        } else if (tipo === 'arqueo') {
            const inicial = `C$ ${(parseFloat(item.efectivo_inicial) || 0).toFixed(2)}`;
            const ventas = `C$ ${(parseFloat(item.ventas_efectivo) || 0).toFixed(2)}`;
            const gastos = `C$ ${(parseFloat(item.gastos_aprobados) || 0).toFixed(2)}`;
            const esperado = `C$ ${(parseFloat(item.efectivo_esperado) || 0).toFixed(2)}`;
            const contado = `C$ ${(parseFloat(item.efectivo_contado) || 0).toFixed(2)}`;
            const dif = parseFloat(item.diferencia) || 0;
            const diferenciaStr = `C$ ${dif.toFixed(2)}`;

            let colorDif = 'inherit';
            if (dif > 0.01) colorDif = '#d97706'; // Sobrante
            else if (dif < -0.01) colorDif = '#dc2626'; // Faltante
            else colorDif = '#16a34a'; // Cuadrada

            let badgeClass = 'neutral';
            if (item.estado === 'Cuadrada') badgeClass = 'success';
            else if (item.estado === 'Faltante') badgeClass = 'danger';
            else if (item.estado === 'Sobrante') badgeClass = 'warning';
            else if (item.estado === 'Abierto') badgeClass = 'info';

            return `
                <tr>
                    <td><strong>ARQ-${String(item.id_arqueo).padStart(4, '0')}</strong></td>
                    <td>${fecha}</td>
                    <td>${item.cajero}</td>
                    <td>${item.sucursal}</td>
                    <td>${inicial}</td>
                    <td>${ventas}</td>
                    <td>${gastos}</td>
                    <td>${esperado}</td>
                    <td style="font-weight: bold; color: #2563eb;">${contado}</td>
                    <td style="font-weight: bold; color: ${colorDif};">${diferenciaStr}</td>
                    <td><span class="badge_cuadre ${badgeClass}">${item.estado}</span></td>
                </tr>
            `;
        }
    }).join('');
}



// ============================================================================
// CATEGORÍAS
// ============================================================================
function actualizarCategoriasEnUI() {
    const categorias = categoriasCache.map(c => c.nombre);

    // Selectores
    ['crear_producto_categoria', 'modificar_producto_categoria'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            const val = sel.value;
            sel.innerHTML = '<option value="">Seleccionar</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
            if (val && categorias.includes(val)) sel.value = val;
        }
    });

    ['Selec_catego', 'cat_invent'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            const val = sel.value;
            sel.innerHTML = '<option value="">Seleccionar categoría</option>' + categorias.map(c => `<option value="${c}">${c}</option>`).join('');
            if (val && categorias.includes(val)) sel.value = val;
        }
    });

    // Botones POS
    const navBotton = document.querySelector('#punto-venta .nav_botton');
    if (navBotton) {
        navBotton.innerHTML = '<button class="cat_bot active" data-category="todos">Todos</button>' +
            categorias.map(c => `<button class="cat_bot" data-category="${c.toLowerCase()}">${c}</button>`).join('');

        navBotton.querySelectorAll('.cat_bot').forEach(boton => {
            boton.addEventListener('click', () => {
                navBotton.querySelectorAll('.cat_bot').forEach(b => b.classList.remove('active'));
                boton.classList.add('active');
                filtrarPorCategoria(boton.dataset.category);
            });
        });
    }

    // Lista de categorías
    const listaCat = document.getElementById('lista_categorias_usuarios');
    if (listaCat) {
        const defaultCats = ['Licores', 'Cervezas', 'Vinos', 'Cigarros', 'Bebidas', 'Snacks'];
        listaCat.innerHTML = categorias.map(c => {
            const esDefault = defaultCats.includes(c);
            const deleteBtn = !esDefault ? `<button type="button" onclick="eliminarCategoriaUI('${c}')" style="border:none;background:transparent;color:#ef4444;cursor:pointer;font-weight:bold;padding:0 2px;font-size:1rem;line-height:1;">×</button>` : '';
            return `<span class="badge_categoria" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:6px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:8px;">${c} ${deleteBtn}</span>`;
        }).join('');
    }

    // Select editar categoría
    const selectEditarCat = document.getElementById('select_editar_categoria');
    if (selectEditarCat) {
        selectEditarCat.innerHTML = '<option value="">Seleccionar categoría</option>' +
            categorias.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}
window.actualizarCategoriasEnUI = actualizarCategoriasEnUI;

// Formulario crear categoría
document.getElementById('form_crear_categoria')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('nueva_categoria_nombre');
    if (input && input.value.trim()) {
        const result = await apiPost('/categorias', { nombre: input.value.trim() });
        if (result.id_categoria) {
            mostrarToast(`¡Categoría "${input.value.trim()}" agregada!`, 'success');
            input.value = '';
            categoriasCache = await apiGet('/categorias');
            actualizarCategoriasEnUI();
            closeMostAggProdu();
        } else {
            mostrarToast(result.error || 'Error al crear categoría.', 'danger');
        }
    }
});

// Formulario editar categoría
document.getElementById('form_editar_categoria')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const select = document.getElementById('select_editar_categoria');
    const input = document.getElementById('editar_categoria_nombre');
    if (select && input && select.value && input.value.trim()) {
        const catVieja = select.value;
        const catObj = categoriasCache.find(c => c.nombre === catVieja);
        if (catObj) {
            const result = await apiPut(`/categorias/${catObj.id_categoria}`, { nombre: input.value.trim() });
            if (result.message) {
                mostrarToast(`Categoría editada: "${catVieja}" → "${input.value.trim()}"`, 'success');
                categoriasCache = await apiGet('/categorias');
                productosCache = await apiGet('/productos');
                actualizarCategoriasEnUI();
                closeMostAggProdu();
            } else mostrarToast(result.error, 'danger');
        }
    }
});

window.eliminarCategoriaUI = async function (nombre) {
    mostrarConfirmacionEliminar(
        '¿Eliminar Categoría?',
        `¿Estás seguro de que deseas eliminar la categoría "${nombre}"?`,
        async () => {
            const cat = categoriasCache.find(c => c.nombre === nombre);
            if (cat) {
                const result = await apiDelete(`/categorias/${cat.id_categoria}`);
                if (result.message) {
                    categoriasCache = await apiGet('/categorias');
                    actualizarCategoriasEnUI();
                    mostrarToast('Categoría eliminada.', 'success');
                } else mostrarToast(result.error, 'danger');
            }
        },
        'Eliminar'
    );
};

// Botones para abrir modals de categoría
document.getElementById('btn_agregar_categoria_prod')?.addEventListener('click', (e) => {
    e.preventDefault();
    mostrarModal('modal_crear_categoria');
    const input = document.getElementById('nueva_categoria_nombre');
    if (input) input.value = '';
});

document.getElementById('btn_editar_categoria_prod')?.addEventListener('click', (e) => {
    e.preventDefault();
    mostrarModal('modal_editar_categoria');
});

document.getElementById('select_editar_categoria')?.addEventListener('change', (e) => {
    const input = document.getElementById('editar_categoria_nombre');
    if (input) input.value = e.target.value;
});

// ============================================================================
// PRODUCTOS - Gestión
// ============================================================================
function renderizarTodoProductos() {
    renderMainProductsTable();
    renderRegisteredProductsTable();
    renderModificationList();
}
window.renderizarTodoProductos = renderizarTodoProductos;

function renderMainProductsTable() {
    const tbody = document.getElementById('tabla_gestion_productos_body');
    if (!tbody) return;

    const visibleProductos = (window.productosInventario || []);

    tbody.innerHTML = visibleProductos.map(prod => {
        const groupingsText = Object.entries(prod.groupings).map(([name, equiv]) =>
            `<span class="badge">${name} (${equiv} ud${equiv > 1 ? 's' : ''})</span>`).join(' ');
        const statusBadge = prod.activo 
            ? ' <span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:10px;font-weight:600;vertical-align:middle;margin-left:5px;">Activo</span>'
            : ' <span style="font-size:11px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:10px;font-weight:600;vertical-align:middle;margin-left:5px;">Inactivo</span>';
        const buttonText = prod.activo ? 'INACTIVAR' : 'ACTIVAR';

        return `<tr data-id="${prod.id}">
            <td><strong>${prod.name}${statusBadge}</strong></td>
            <td><div class="badges">${groupingsText}</div></td>
            <td>
                <button class="btn_modi_gestion_dinamico" data-id="${prod.id}">MODIFICAR</button>
                <button class="btn_eliminar_gestion_dinamico" data-id="${prod.id}">${buttonText}</button>
            </td>
        </tr>`;
    }).join('');
}

function renderRegisteredProductsTable() {
    const tbody = document.getElementById('tabla_registrados_productos_body');
    if (!tbody) return;

    const visibleProductos = (window.productosInventario || []);

    tbody.innerHTML = visibleProductos.map((prod, i) => {
        const groupingsText = Object.entries(prod.groupings).map(([name, equiv]) =>
            `<span class="badge">${name} (${equiv} ud${equiv > 1 ? 's' : ''})</span>`).join(' ');
        const statusBadge = prod.activo 
            ? ' <span style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 6px;border-radius:10px;font-weight:600;vertical-align:middle;margin-left:5px;">Activo</span>'
            : ' <span style="font-size:11px;background:#fee2e2;color:#dc2626;padding:2px 6px;border-radius:10px;font-weight:600;vertical-align:middle;margin-left:5px;">Inactivo</span>';
        const buttonText = prod.activo ? 'Inactivar' : 'Activar';

        return `<tr data-id="${prod.id}">
            <td>${i + 1}</td>
            <td><strong>${prod.name}${statusBadge}</strong></td>
            <td>${prod.category}</td>
            <td><div class="badges">${groupingsText}</div></td>
            <td><select class="ubicacion" onchange="cambiarUbicacionProducto('${prod.id}',this.value)">
                <option value="Mostrador" ${prod.location === 'Mostrador' ? 'selected' : ''}>Mostrador</option>
                <option value="Bodega" ${prod.location === 'Bodega' ? 'selected' : ''}>Bodega</option>
            </select></td>
            <td><button class="btn_delete btn_eliminar_registrado_dinamico" data-id="${prod.id}">${buttonText}</button></td>
        </tr>`;
    }).join('');
}

window.cambiarUbicacionProducto = function (id, val) {
    const prod = window.productosInventario?.find(p => p.id === id);
    if (prod) prod.location = val;
};

function renderModificationList(filter = '') {
    const list = document.getElementById('modificar_producto_list');
    if (!list) return;

    const filtered = (window.productosInventario || [])
        .filter(p =>
            p.name.toLowerCase().includes(filter.toLowerCase()) || p.category.toLowerCase().includes(filter.toLowerCase()));

    list.innerHTML = filtered.map(p =>
        `<div class="product_item" data-id="${p.id}"><div class="product_name">${p.name}</div><div class="product_category">${p.category}</div></div>`
    ).join('');

    list.querySelectorAll('.product_item').forEach(item => {
        item.addEventListener('click', () => {
            list.querySelectorAll('.product_item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            cargarFormularioModificar(item.dataset.id);
        });
    });
}

let selectedModProductId = null;

function cargarFormularioModificar(id) {
    const prod = window.productosInventario?.find(p => p.id === id);
    if (!prod) return;
    selectedModProductId = id;

    document.getElementById('modificar_producto_nombre').value = prod.name;
    document.getElementById('modificar_producto_precio').value = prod.price || '';
    document.getElementById('modificar_producto_categoria').value = prod.category;
    const ubicSel = document.getElementById('modificar_producto_ubicacion');
    if (ubicSel) ubicSel.value = prod.location || 'Bodega';

    const container = document.getElementById('modificar_producto_groupings');
    if (container) {
        container.querySelectorAll('.group_item_row').forEach(row => {
            const cb = row.querySelector("input[type='checkbox']");
            const gName = cb.dataset.group;
            const eqInput = row.querySelector('.group_equiv_input');

            if (gName === 'Unidad') { cb.checked = true; row.classList.add('active'); return; }

            if (prod.groupings && prod.groupings[gName] !== undefined) {
                cb.checked = true; row.classList.add('active');
                eqInput.value = prod.groupings[gName];
            } else {
                cb.checked = false; row.classList.remove('active');
            }
        });
    }
}

// Crear producto
document.getElementById('form_crear_producto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('crear_producto_nombre').value.trim();
    const precio = parseFloat(document.getElementById('crear_producto_precio').value);
    const categoriaName = document.getElementById('crear_producto_categoria').value;

    if (!nombre || isNaN(precio) || !categoriaName) { mostrarToast('Completa todos los campos.', 'warning'); return; }

    const catObj = categoriasCache.find(c => c.nombre === categoriaName);
    if (!catObj) { mostrarToast('Categoría no encontrada.', 'danger'); return; }

    const groupings = { Unidad: 1 };
    const container = document.getElementById('crear_producto_groupings');
    if (container) {
        container.querySelectorAll('.group_item_row').forEach(row => {
            const cb = row.querySelector("input[type='checkbox']");
            const gName = cb.dataset.group;
            const eqInput = row.querySelector('.group_equiv_input');
            if (gName !== 'Unidad' && cb.checked) groupings[gName] = parseInt(eqInput.value) || 1;
        });
    }

    const result = await apiPost('/productos', { nombre, id_categoria: catObj.id_categoria, precio_venta: precio, groupings });
    if (result.id_producto) {
        mostrarToast('¡Producto creado exitosamente!', 'success');
        productosCache = await apiGet('/productos');
        await cargarDatosIniciales();
        document.getElementById('form_crear_producto').reset();
    } else mostrarToast(result.error, 'danger');
});

// Modificar producto
document.getElementById('btn_guardar_modificacion_producto')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!selectedModProductId) { mostrarToast('Selecciona un producto.', 'warning'); return; }

    const nombre = document.getElementById('modificar_producto_nombre').value.trim();
    const precio = parseFloat(document.getElementById('modificar_producto_precio').value);
    const categoriaName = document.getElementById('modificar_producto_categoria').value;

    if (!nombre || isNaN(precio) || !categoriaName) { mostrarToast('Completa los campos.', 'warning'); return; }

    const catObj = categoriasCache.find(c => c.nombre === categoriaName);
    if (!catObj) { mostrarToast('Categoría no encontrada.', 'danger'); return; }

    const groupings = { Unidad: 1 };
    const container = document.getElementById('modificar_producto_groupings');
    if (container) {
        container.querySelectorAll('.group_item_row').forEach(row => {
            const cb = row.querySelector("input[type='checkbox']");
            const gName = cb.dataset.group;
            const eqInput = row.querySelector('.group_equiv_input');
            if (gName !== 'Unidad' && cb.checked) groupings[gName] = parseInt(eqInput.value) || 1;
        });
    }

    const result = await apiPut(`/productos/${selectedModProductId}`, {
        nombre, id_categoria: catObj.id_categoria, precio_venta: precio, groupings
    });

    if (result.message) {
        mostrarToast('¡Producto modificado exitosamente!', 'success');
        productosCache = await apiGet('/productos');
        await cargarDatosIniciales();
    } else mostrarToast(result.error, 'danger');
});

// Click en tabla gestión productos
document.getElementById('tabla_gestion_productos_body')?.addEventListener('click', async (e) => {
    const btnMod = e.target.closest('.btn_modi_gestion_dinamico');
    const btnElim = e.target.closest('.btn_eliminar_gestion_dinamico');

    if (btnMod) {
        e.preventDefault();
        mostrarModal('modal_modificar_producto');
        cargarFormularioModificar(btnMod.dataset.id);
    }

    if (btnElim) {
        e.preventDefault();
        await toggleEstadoProducto(btnElim.dataset.id);
    }
});

document.getElementById('tabla_registrados_productos_body')?.addEventListener('click', async (e) => {
    const btnElim = e.target.closest('.btn_eliminar_registrado_dinamico');
    if (btnElim) {
        e.preventDefault();
        await toggleEstadoProducto(btnElim.dataset.id);
    }
});

async function toggleEstadoProducto(id) {
    const result = await apiPatch(`/productos/${id}/estado`, {});
    if (result.message) {
        mostrarToast(result.message, 'success');
        productosCache = await apiGet('/productos');
        await cargarDatosIniciales();
    }
}

// Abrir modal agregar producto
document.getElementById('productos')?.addEventListener('click', (e) => {
    if (e.target.closest('#agg_new_prod')) { e.preventDefault(); mostrarModal('modal_crear_producto'); }
    if (e.target.closest('#btn_modi_gestion')) { e.preventDefault(); mostrarModal('modal_modificar_producto'); }
});

// Buscador de productos en gestión
document.getElementById('buscar_producto_gestion')?.addEventListener('input', () => {
    const query = document.getElementById('buscar_producto_gestion').value.toLowerCase().trim();
    const cat = document.getElementById('Selec_catego')?.value || '';
    const tbody = document.getElementById('tabla_gestion_productos_body');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(row => {
        const prodId = row.dataset.id;
        const prod = window.productosInventario?.find(p => p.id === prodId);
        if (!prod) return;
        const matchName = prod.name.toLowerCase().includes(query);
        const matchCat = !cat || prod.category.toLowerCase() === cat.toLowerCase();
        row.style.display = (matchName && matchCat) ? '' : 'none';
    });
});

document.getElementById('Selec_catego')?.addEventListener('change', () => {
    document.getElementById('buscar_producto_gestion')?.dispatchEvent(new Event('input'));
});

document.getElementById('buscar_producto_modificar')?.addEventListener('input', (e) => {
    renderModificationList(e.target.value);
});

// ============================================================================
// PUNTO DE VENTA (CHECKOUT)
// ============================================================================
async function renderProductosCheckout() {
    const container = document.getElementById('productos-container');
    if (!container) return;

    try {
        const activeSucursal = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        const inventarioData = await apiGet(`/inventario?sucursal=${activeSucursal}`);

        // Map to a dictionary for quick lookup of Mostrador stock
        const mostradorStockMap = {};
        inventarioData.forEach(item => {
            if (item.ubicacion === 'Mostrador') {
                mostradorStockMap[String(item.id_producto)] = (mostradorStockMap[String(item.id_producto)] || 0) + item.stock;
            }
        });

        const productosEnSucursal = new Set(inventarioData.map(item => String(item.id_producto)));

        container.innerHTML = (window.productosInventario || [])
            .filter(p => p.activo && productosEnSucursal.has(p.id))
            .map(p => {
                const stockMostrador = mostradorStockMap[p.id] || 0;

                let stockStatusHTML = `<span>${p.category}</span>`;
                let disabledClass = '';
                let opacityStyle = '';

                if (stockMostrador <= 0) {
                    stockStatusHTML = `<span style="color: #ef4444; font-weight: bold; background: #fee2e2; padding: 2px 8px; border-radius: 6px; display: inline-block;">⚠️ Relleno requerido</span>`;
                    disabledClass = ' producto-sin-stock';
                    opacityStyle = ' style="opacity: 0.65;"';
                } else {
                    stockStatusHTML = `<span style="color: #10b981; font-weight: bold; background: #e6f7ed; padding: 2px 8px; border-radius: 6px; display: inline-block;">${stockMostrador} uds en Mostrador</span>`;
                }

                return `
                    <div class="producto${disabledClass}" data-id="${p.id}" data-category="${p.category.toLowerCase()}" data-name="${p.name}" data-price="${p.price}" data-stock-mostrador="${stockMostrador}"${opacityStyle}>
                        <h3>${p.name}</h3>
                        <p>C$${p.price}</p>
                        ${stockStatusHTML}
                    </div>
                `;
            }).join('');
    } catch (err) {
        console.error("Error loading inventory for checkout:", err);
    }
}

const productosContainer = document.getElementById('productos-container');
productosContainer?.addEventListener('click', (e) => {
    const prod = e.target.closest('.producto');
    if (prod) {
        const stockMostrador = parseInt(prod.dataset.stockMostrador) || 0;
        if (stockMostrador <= 0) {
            mostrarToast('Este producto no tiene stock en Mostrador. Por favor realiza un Relleno desde Inventario.', 'warning');
            return;
        }
        agregarProductoVenta(prod);
    }
});

// Obtener el total de unidades de un producto ya agregado a la venta
const obtenerUnidadesEnVenta = (id) => {
    return estadoVenta.productos
        .filter(p => String(p.id) === String(id))
        .reduce((sum, p) => {
            const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
            const equiv = prodInv?.groupings?.[p.agrupacion] || 1;
            return sum + (p.cantidad * equiv);
        }, 0);
};

function agregarProductoVenta(el) {
    const id = el.dataset.id;
    const nombre = el.dataset.name;
    const precio = parseFloat(el.dataset.price);
    const stockMostrador = parseInt(el.dataset.stockMostrador) || 0;

    const existing = estadoVenta.productos.find(p => String(p.id) === String(id) && p.agrupacion === 'Unidad');
    const unidadesActuales = obtenerUnidadesEnVenta(id);

    if (existing) {
        const nuevaCantidad = existing.cantidad + 1;
        if (unidadesActuales + 1 > stockMostrador) {
            mostrarToast(`No puedes agregar más de este producto. Stock en Mostrador: ${stockMostrador} uds.`, 'warning');
            return;
        }
        existing.cantidad = nuevaCantidad;
    } else {
        if (unidadesActuales + 1 > stockMostrador) {
            mostrarToast(`No puedes agregar este producto. Stock en Mostrador: ${stockMostrador} uds.`, 'warning');
            return;
        }
        estadoVenta.productos.push({
            id, nombre, basePrice: precio, precio, agrupacion: 'Unidad', cantidad: 1,
            id_producto: parseInt(id)
        });
    }
    actualizarTablaVenta();
}

function actualizarTablaVenta() {
    const tbody = document.getElementById('tabla_ventas');
    const totalEl = document.getElementById('total_venta');
    if (!tbody) return;

    let hasExceededStock = false;

    if (estadoVenta.productos.length === 0) {
        tbody.innerHTML = '<tr id="fila_vacia"><td colspan="4" style="color:#94a3b8;padding:20px;text-align:center;">No hay productos en la venta</td></tr>';
        estadoVenta.total = 0;
    } else {
        tbody.innerHTML = estadoVenta.productos.map((p, i) => {
            const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
            let selectHTML = '';
            if (prodInv && prodInv.groupings) {
                const groups = Object.keys(prodInv.groupings);
                if (groups.length > 0) {
                    selectHTML = `<div style="margin-top:4px;display:flex;align-items:center;justify-content:center;">
                        <select class="venta_agrupacion_select" onchange="cambiarAgrupacion(${i},this.value)" style="padding:4px 8px;font-size:0.75rem;border-radius:6px;border:1px solid #cbd5e1;outline:none;background:#f8fafc;color:#334155;font-weight:600;cursor:pointer;width:100%;max-width:140px;text-align:center;">
                            ${groups.map(g => `<option value="${g}" ${p.agrupacion === g ? 'selected' : ''}>${g} (${prodInv.groupings[g]} ud${prodInv.groupings[g] > 1 ? 's' : ''})</option>`).join('')}
                        </select></div>`;
                }
            }

            const prodCard = document.querySelector(`.producto[data-id="${p.id}"]`);
            const stockMostrador = prodCard ? parseInt(prodCard.dataset.stockMostrador) || 0 : 0;
            const equiv = prodInv?.groupings?.[p.agrupacion] || 1;
            const itemTotalUnits = p.cantidad * equiv;

            let rowWarningStyle = '';
            if (itemTotalUnits > stockMostrador) {
                hasExceededStock = true;
                rowWarningStyle = ' style="background: #fef2f2;"';
            }

            const totalProd = p.precio * p.cantidad;
            return `<tr data-index="${i}"${rowWarningStyle}>
                <td><div style="font-weight:700;color:#0f172a;text-align:center;">${p.nombre}</div>${selectHTML}</td>
                <td><div class="box_edit">
                    <button class="bot_mod" onclick="cambiarCantidad(${i},-1)">-</button>
                    <input type="number" class="cant_input" value="${p.cantidad}" min="1" onchange="actualizarCantidadManual(${i},this.value)">
                    <button class="bot_mod" onclick="cambiarCantidad(${i},1)">+</button>
                </div></td>
                <td>C$${totalProd.toFixed(0)}</td>
                <td><button class="btn_eliminar" onclick="eliminarProductoVenta(${i})" title="Eliminar"><img src="img/borrar.png" alt="Eliminar"></button></td>
            </tr>`;
        }).join('');
        estadoVenta.total = estadoVenta.productos.reduce((s, p) => s + (p.precio * p.cantidad), 0);
    }

    if (totalEl) totalEl.textContent = `C$${estadoVenta.total.toFixed(0)}`;

    // Habilitar / Deshabilitar botón de pagar
    const btnPagar = document.getElementById('btn_pagar');
    if (btnPagar) {
        if (hasExceededStock || estadoVenta.productos.length === 0) {
            btnPagar.disabled = true;
            btnPagar.style.opacity = '0.5';
            btnPagar.style.cursor = 'not-allowed';
            btnPagar.style.background = 'linear-gradient(135deg, #94a3b8, #64748b)';
            btnPagar.title = hasExceededStock ? 'Hay productos con cantidades superiores al stock disponible en mostrador.' : 'No hay productos en la venta.';
        } else {
            btnPagar.disabled = false;
            btnPagar.style.opacity = '1';
            btnPagar.style.cursor = 'pointer';
            btnPagar.style.background = ''; // Resets to original template colors
            btnPagar.title = '';
        }
    }

    calcularCambioVenta();
}

window.cambiarCantidad = function (i, cambio) {
    const p = estadoVenta.productos[i];
    if (!p) return;

    const prodCard = document.querySelector(`.producto[data-id="${p.id}"]`);
    const stockMostrador = prodCard ? parseInt(prodCard.dataset.stockMostrador) || 0 : 0;

    const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
    const equiv = prodInv?.groupings?.[p.agrupacion] || 1;

    const nuevaCantidad = p.cantidad + cambio;
    if (nuevaCantidad < 1) return;

    const unidadesDeOtros = estadoVenta.productos
        .filter((x, idx) => idx !== i && String(x.id) === String(p.id))
        .reduce((sum, x) => {
            const xInv = window.productosInventario?.find(y => String(y.id) === String(x.id));
            const xEquiv = xInv?.groupings?.[x.agrupacion] || 1;
            return sum + (x.cantidad * xEquiv);
        }, 0);

    const totalUnidades = unidadesDeOtros + (nuevaCantidad * equiv);
    if (totalUnidades > stockMostrador) {
        mostrarToast(`No hay suficiente stock en Mostrador. Requerido: ${totalUnidades} uds, Disponible: ${stockMostrador} uds.`, 'warning');
        return;
    }

    p.cantidad = nuevaCantidad;
    actualizarTablaVenta();
};

window.actualizarCantidadManual = function (i, val) {
    const p = estadoVenta.productos[i];
    if (!p) return;

    const n = parseInt(val);
    if (!n || n <= 0) {
        actualizarTablaVenta();
        return;
    }

    const prodCard = document.querySelector(`.producto[data-id="${p.id}"]`);
    const stockMostrador = prodCard ? parseInt(prodCard.dataset.stockMostrador) || 0 : 0;

    const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
    const equiv = prodInv?.groupings?.[p.agrupacion] || 1;

    const unidadesDeOtros = estadoVenta.productos
        .filter((x, idx) => idx !== i && String(x.id) === String(p.id))
        .reduce((sum, x) => {
            const xInv = window.productosInventario?.find(y => String(y.id) === String(x.id));
            const xEquiv = xInv?.groupings?.[x.agrupacion] || 1;
            return sum + (x.cantidad * xEquiv);
        }, 0);

    const totalUnidades = unidadesDeOtros + (n * equiv);
    if (totalUnidades > stockMostrador) {
        mostrarToast(`No hay suficiente stock en Mostrador. Requerido: ${totalUnidades} uds, Disponible: ${stockMostrador} uds.`, 'warning');
        actualizarTablaVenta();
        return;
    }

    p.cantidad = n;
    actualizarTablaVenta();
};

window.cambiarAgrupacion = function (i, nuevaAgrup) {
    const p = estadoVenta.productos[i];
    if (!p) return;

    const prodCard = document.querySelector(`.producto[data-id="${p.id}"]`);
    const stockMostrador = prodCard ? parseInt(prodCard.dataset.stockMostrador) || 0 : 0;

    const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
    const equiv = prodInv?.groupings?.[nuevaAgrup] || 1;

    const unidadesDeOtros = estadoVenta.productos
        .filter((x, idx) => idx !== i && String(x.id) === String(p.id))
        .reduce((sum, x) => {
            const xInv = window.productosInventario?.find(y => String(y.id) === String(x.id));
            const xEquiv = xInv?.groupings?.[x.agrupacion] || 1;
            return sum + (x.cantidad * xEquiv);
        }, 0);

    const totalUnidades = unidadesDeOtros + (p.cantidad * equiv);
    if (totalUnidades > stockMostrador) {
        mostrarToast(`No hay suficiente stock en Mostrador para esta agrupación. Requerido: ${totalUnidades} uds, Disponible: ${stockMostrador} uds.`, 'warning');
        actualizarTablaVenta();
        return;
    }

    p.agrupacion = nuevaAgrup;
    const details = prodInv?.groupingDetails?.[nuevaAgrup];
    if (details && details.precio !== null && details.precio !== undefined) {
        p.precio = details.precio;
    } else {
        p.precio = p.basePrice * equiv;
    }
    actualizarTablaVenta();
};

window.eliminarProductoVenta = function (i) {
    estadoVenta.productos.splice(i, 1);
    actualizarTablaVenta();
};

function calcularCambioVenta() {
    const metodo = document.getElementById('metodo_pago')?.value || 'efectivo';
    const pagoInput = document.getElementById('pago_con');
    const vueltoInput = document.getElementById('vuelto');

    if (metodo !== 'efectivo') {
        if (pagoInput) pagoInput.value = estadoVenta.total > 0 ? estadoVenta.total.toFixed(0) : '';
        if (vueltoInput) vueltoInput.value = estadoVenta.total > 0 ? '0' : '';
        return;
    }

    const pago = parseFloat(pagoInput?.value) || 0;
    if (vueltoInput) vueltoInput.value = pago >= estadoVenta.total && pago > 0 ? (pago - estadoVenta.total).toFixed(0) : '';
}

document.getElementById('pago_con')?.addEventListener('input', calcularCambioVenta);
document.getElementById('metodo_pago')?.addEventListener('change', () => {
    const metodo = document.getElementById('metodo_pago').value;
    const pagoInput = document.getElementById('pago_con');
    if (metodo === 'efectivo') { pagoInput.disabled = false; pagoInput.value = ''; document.getElementById('vuelto').value = ''; }
    else { pagoInput.disabled = true; pagoInput.value = estadoVenta.total > 0 ? estadoVenta.total.toFixed(0) : ''; document.getElementById('vuelto').value = estadoVenta.total > 0 ? '0' : ''; }
});

window.filtrarPorCategoria = function (cat) {
    document.querySelectorAll('.producto').forEach(p => {
        if (p.getAttribute('data-inactivo') === 'true') { p.style.display = 'none'; return; }
        p.style.display = (cat === 'todos' || p.dataset.category === cat) ? 'flex' : 'none';
    });
};

// Pagar
document.getElementById('btn_pagar')?.addEventListener('click', async () => {
    if (estadoVenta.productos.length === 0) { mostrarToast('No hay productos en la venta.', 'warning'); return; }

    const metodo = document.getElementById('metodo_pago').value;
    let pago = parseFloat(document.getElementById('pago_con').value) || 0;
    if (metodo === 'efectivo' && pago < estadoVenta.total) { mostrarToast('El monto pagado es menor al total.', 'warning'); return; }
    if (metodo !== 'efectivo') pago = estadoVenta.total;

    if (!currentUser) { mostrarToast('Debes iniciar sesión.', 'danger'); return; }

    const sucursalObj = sucursalesCache.find(s => s.nombre === activeSucursal);

    const result = await apiPost('/ventas', {
        id_usuario: currentUser.id_usuario,
        id_sucursal: sucursalObj?.id_sucursal || 1,
        metodo_pago: metodo.charAt(0).toUpperCase() + metodo.slice(1),
        pago_recibido: pago,
        productos: estadoVenta.productos.map(p => {
            const prodInv = window.productosInventario?.find(x => String(x.id) === String(p.id));
            const details = prodInv?.groupingDetails?.[p.agrupacion];
            const equiv = details?.equivalencia || 1;
            const id_agrupacion = details?.id_agrupacion || null;
            return {
                id_producto: parseInt(p.id),
                id_agrupacion: id_agrupacion === 1 ? null : id_agrupacion,
                cantidad: p.cantidad,
                cantidad_unidades: p.cantidad * equiv,
                precio: p.precio
            };
        })
    });

    if (result.id_venta) {
        mostrarToast(`¡Venta ${result.codigo_venta} registrada! Total: C$${result.total}`, 'success');
        estadoVenta.productos = [];
        estadoVenta.total = 0;
        document.getElementById('pago_con').value = '';
        document.getElementById('vuelto').value = '';
        actualizarTablaVenta();
        await cargarDatosIniciales();
        await renderProductosCheckout();
        if (typeof window.cargarVentasRealizadas === 'function') {
            await window.cargarVentasRealizadas();
        }
    } else mostrarToast(result.error || 'Error al procesar venta.', 'danger');
});

document.getElementById('btn_cancelar')?.addEventListener('click', () => {
    if (estadoVenta.productos.length > 0) {
        document.getElementById('modal_confirmar_cancelar_venta').classList.add('open');
    } else {
        mostrarToast('No hay productos en la venta actual.', 'warning');
    }
});

// Eventos para el Modal de Confirmación de Cancelar Venta
const modalConfirmarCancelarVenta = document.getElementById('modal_confirmar_cancelar_venta');
const btnAceptarCancelarVenta = document.getElementById('btn_aceptar_cancelar_venta');
const btnCancelarCancelarVenta = document.getElementById('btn_cancelar_cancelar_venta');

if (btnAceptarCancelarVenta) {
    btnAceptarCancelarVenta.addEventListener('click', () => {
        estadoVenta.productos = [];
        estadoVenta.total = 0;

        const pagoConEl = document.getElementById('pago_con');
        if (pagoConEl) pagoConEl.value = '';

        const vueltoEl = document.getElementById('vuelto');
        if (vueltoEl) vueltoEl.value = '';

        actualizarTablaVenta();
        modalConfirmarCancelarVenta.classList.remove('open');
        mostrarToast('Venta cancelada exitosamente.', 'info');
    });
}

if (btnCancelarCancelarVenta) {
    btnCancelarCancelarVenta.addEventListener('click', () => {
        modalConfirmarCancelarVenta.classList.remove('open');
    });
}

if (modalConfirmarCancelarVenta) {
    modalConfirmarCancelarVenta.addEventListener('click', (e) => {
        if (e.target === modalConfirmarCancelarVenta) {
            modalConfirmarCancelarVenta.classList.remove('open');
        }
    });
}

// Buscador productos POS con Autocomplete y Estilo unificado
const initBuscadorAutocompletePOS = () => {
    const buscador = document.getElementById('buscador');
    const resultados = document.getElementById('resultados_busqueda_venta');
    if (!buscador || !resultados) return;

    const updateResults = () => {
        const query = buscador.value.toLowerCase().trim();
        if (!query) {
            resultados.style.display = 'none';
            return;
        }

        const productos = window.productosInventario || [];
        const filtrados = productos.filter(p =>
            p.activo && (p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query))
        );

        if (filtrados.length === 0) {
            resultados.innerHTML = `<div class="autocomplete-item-no-results">No se encontraron productos</div>`;
            resultados.style.display = 'block';
            return;
        }

        resultados.innerHTML = filtrados.map(prod => {
            const prodCard = document.querySelector(`.producto[data-id="${prod.id}"]`);
            const stock = prodCard ? parseInt(prodCard.dataset.stockMostrador) || 0 : 0;
            const stockLabel = stock <= 0 ?
                `<span style="color: #ef4444; font-weight: bold; background: #fee2e2; padding: 2px 8px; border-radius: 6px; font-size: 11px; float: right;">Relleno</span>` :
                `<span style="color: #10b981; font-weight: bold; background: #e6f7ed; padding: 2px 8px; border-radius: 6px; font-size: 11px; float: right;">${stock} uds</span>`;

            return `
                <div class="autocomplete-item" data-id="${prod.id}" data-name="${prod.name}">
                    <strong>${prod.name}</strong> <span style="font-size: 11px; color: #64748b; margin-left: 8px;">(${prod.category})</span>
                    ${stockLabel}
                </div>
            `;
        }).join('');

        resultados.style.display = 'block';

        // Click listener para agregar producto
        resultados.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const prodCard = document.querySelector(`.producto[data-id="${id}"]`);
                if (prodCard) {
                    const stockMostrador = parseInt(prodCard.dataset.stockMostrador) || 0;
                    if (stockMostrador <= 0) {
                        mostrarToast('Este producto no tiene stock en Mostrador. Por favor realiza un Relleno desde Inventario.', 'warning');
                        return;
                    }
                    agregarProductoVenta(prodCard);
                }
                buscador.value = '';
                resultados.style.display = 'none';

                // Mostrar todos los productos
                document.querySelectorAll('.producto').forEach(p => {
                    if (p.getAttribute('data-inactivo') === 'true') { p.style.display = 'none'; return; }
                    p.style.display = 'flex';
                });
            });
        });
    };

    buscador.addEventListener('input', (e) => {
        const busqueda = e.target.value.toLowerCase().trim();
        // Filtrar tarjetas en el grid
        document.querySelectorAll('.producto').forEach(p => {
            if (p.getAttribute('data-inactivo') === 'true') { p.style.display = 'none'; return; }
            p.style.display = p.dataset.name.toLowerCase().includes(busqueda) || !busqueda ? 'flex' : 'none';
        });
        updateResults();
    });

    buscador.addEventListener('focus', updateResults);

    document.addEventListener('click', (e) => {
        if (!buscador.contains(e.target) && !resultados.contains(e.target)) {
            resultados.style.display = 'none';
        }
    });
};

// Inicializar el buscador de caja
setTimeout(initBuscadorAutocompletePOS, 500);

// ============================================================================
// USUARIOS
// ============================================================================
let userRowBeingEdited = null;
let listadoUsuarios = [];

function populateUserFormDropdowns() {
    const regRol = document.getElementById('reg_rol');
    if (regRol && rolesCache.length > 0) {
        const valActual = regRol.value;
        regRol.innerHTML = rolesCache.map(r => `<option value="${r.nombre}">${r.nombre}</option>`).join('');
        if (valActual && Array.from(regRol.options).some(opt => opt.value === valActual)) {
            regRol.value = valActual;
        }
    }
    const regSuc = document.getElementById('reg_sucursal_usr');
    if (regSuc && sucursalesCache.length > 0) {
        const valActual = regSuc.value;
        regSuc.innerHTML = sucursalesCache.map(s => `<option value="${s.nombre}">${s.nombre}</option>`).join('');
        if (valActual && Array.from(regSuc.options).some(opt => opt.value === valActual)) {
            regSuc.value = valActual;
        }
    }
}

// Function populateSupplierFormDropdowns removed as branch selection is automatic

function renderUsuariosTabla(lista) {
    const tbody = document.getElementById('tabla_usuarios_body');
    if (!tbody) return;

    tbody.innerHTML = lista.map(u => {
        const rolClass = u.rol === 'Gerente' ? 'rol_gerente' : u.rol === 'Administrador' ? 'rol_admin' : 'rol_vendedor';
        const estadoClass = u.estado === 'Activo' ? 'estado_activo' : 'estado_inactivo';
        const actionBtn = u.estado === 'Activo' ? 'btn_desactivar' : 'btn_activar';
        const actionText = u.estado === 'Activo' ? 'Desactivar' : 'Activar';
        const ultimaSesion = u.ultima_sesion ? formatDateTime(u.ultima_sesion) : 'Sin sesión';

        return `<tr data-id="${u.id_usuario}" data-nombre="${u.nombre_completo}" data-usuario="${u.usuario}" data-rol="${u.rol}" data-sucursal="${u.sucursal || 'Todas'}" data-estado="${u.estado}">
            <td>${u.nombre_completo}</td>
            <td>${u.usuario}</td>
            <td>••••••••</td>
            <td><span class="${rolClass}">${u.rol}</span></td>
            <td><span class="badge_estado ${estadoClass}">${u.estado}</span></td>
            <td class="ultima-sesion">${ultimaSesion}</td>
            <td><div class="box_acciones">
                <button class="btn_editar" data-id="${u.id_usuario}" data-rol="${u.rol}" data-sucursal="${u.id_sucursal || ''}">Editar</button>
                <button class="btn_toggle_estado ${actionBtn}" data-id="${u.id_usuario}">${actionText}</button>
            </div></td>
        </tr>`;
    }).join('');
}

function aplicarFiltrosUsuarios() {
    const busqueda = document.getElementById('buscar_usuario_input')?.value.toLowerCase().trim() || '';
    const rol = document.getElementById('filtrar_rol_select')?.value || '';

    const filtrados = listadoUsuarios.filter(u => {
        const matchesBusqueda = !busqueda ||
            (u.nombre_completo && u.nombre_completo.toLowerCase().includes(busqueda)) ||
            (u.usuario && u.usuario.toLowerCase().includes(busqueda)) ||
            (u.sucursal && u.sucursal.toLowerCase().includes(busqueda));

        const matchesRol = !rol || u.rol === rol;

        return matchesBusqueda && matchesRol;
    });

    renderUsuariosTabla(filtrados);
}

async function cargarUsuariosTabla() {
    const tbody = document.getElementById('tabla_usuarios_body');
    if (!tbody) return;

    try {
        const [usuarios, stats] = await Promise.all([
            apiGet('/usuarios'),
            apiGet('/usuarios/stats')
        ]);

        listadoUsuarios = usuarios;
        aplicarFiltrosUsuarios();

        if (stats) {
            const kpiTotales = document.getElementById('stats_usuarios_totales');
            const kpiActivos = document.getElementById('stats_usuarios_activos');
            const kpiAdmins = document.getElementById('stats_usuarios_admins');
            const kpiClientes = document.getElementById('stats_usuarios_clientes');

            if (kpiTotales) kpiTotales.textContent = stats.total ?? 0;
            if (kpiActivos) kpiActivos.textContent = stats.activos ?? 0;
            if (kpiAdmins) kpiAdmins.textContent = stats.admins ?? 0;
            if (kpiClientes) kpiClientes.textContent = stats.vendedores ?? 0;
        }
    } catch (e) { console.error('Error cargando usuarios:', e); }
}

// Event listeners for filtering users
document.getElementById('buscar_usuario_input')?.addEventListener('input', aplicarFiltrosUsuarios);
document.getElementById('filtrar_rol_select')?.addEventListener('change', aplicarFiltrosUsuarios);

document.getElementById('btn_abrir_crear_usuario')?.addEventListener('click', (e) => {
    e.preventDefault();
    userRowBeingEdited = null;
    const form = document.querySelector('#modal_crear_usuario form');
    if (form) form.reset();
    document.querySelector('#modal_crear_usuario h1').textContent = 'Crear Usuario';
    document.getElementById('btn_guardar_usuario').textContent = 'Guardar Usuario';
    document.getElementById('reg_contrasena').required = true;

    // Set default sucursal visibility based on default selected role
    const groupSuc = document.getElementById('group_reg_sucursal');
    if (groupSuc) {
        const selectedRol = document.getElementById('reg_rol').value;
        groupSuc.style.display = selectedRol === 'Gerente' ? 'none' : 'block';
    }
    mostrarModal('modal_crear_usuario');
});

function asegurarSucursalSeleccionada() {
    const regRol = document.getElementById('reg_rol');
    const regSuc = document.getElementById('reg_sucursal_usr');
    if (regRol && regSuc && regRol.value !== 'Gerente' && !regSuc.value) {
        if (regSuc.options.length > 0) regSuc.selectedIndex = 0;
    }
}

// Listener para cambio de rol en el modal
document.getElementById('reg_rol')?.addEventListener('change', (e) => {
    const groupSuc = document.getElementById('group_reg_sucursal');
    if (groupSuc) {
        groupSuc.style.display = e.target.value === 'Gerente' ? 'none' : 'block';
    }
    asegurarSucursalSeleccionada();
});

// Guardar usuario (crear/editar)
document.querySelector('#modal_crear_usuario form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('reg_nombre').value.trim();
    const usuario = document.getElementById('reg_usuario').value.trim();
    const contrasena = document.getElementById('reg_contrasena').value;
    const rolText = document.getElementById('reg_rol').value;
    const sucursalText = document.getElementById('reg_sucursal_usr').value;

    if (!nombre || !usuario) { mostrarToast('Completa los campos obligatorios.', 'warning'); return; }

    const rolObj = rolesCache.find(r => r.nombre === rolText);
    let id_sucursal = null;

    if (rolText !== 'Gerente') {
        const sucObj = sucursalesCache.find(s => s.nombre === sucursalText);
        if (!sucObj) { mostrarToast('Selecciona una sucursal válida.', 'warning'); return; }
        id_sucursal = sucObj.id_sucursal;
    }

    if (userRowBeingEdited) {
        const result = await apiPut(`/usuarios/${userRowBeingEdited}`, {
            nombre_completo: nombre, usuario, contrasena: contrasena || '********',
            id_rol: rolObj?.id_rol || 3, id_sucursal
        });
        if (result.message) {
            mostrarToast('Usuario actualizado.', 'success');
            userRowBeingEdited = null;
            await cargarUsuariosTabla();
            closeMostAggProdu();
        } else {
            mostrarToast(result.error || 'Error al actualizar usuario.', 'danger');
        }
    } else {
        if (!contrasena) { mostrarToast('La contraseña es obligatoria.', 'warning'); return; }
        const result = await apiPost('/usuarios', {
            nombre_completo: nombre, usuario, contrasena,
            id_rol: rolObj?.id_rol || 3, id_sucursal
        });
        if (result.id_usuario) {
            mostrarToast('Usuario creado.', 'success');
            userRowBeingEdited = null;
            await cargarUsuariosTabla();
            closeMostAggProdu();
        } else {
            mostrarToast(result.error || 'Error al crear usuario.', 'danger');
        }
    }
});

// Tabla de usuarios: Editar y toggle estado
document.getElementById('tabla_usuarios_body')?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('.btn_editar');
    const btnToggle = e.target.closest('.btn_toggle_estado');

    if (btnEditar) {
        e.preventDefault();
        const tr = btnEditar.closest('tr');
        userRowBeingEdited = btnEditar.dataset.id;

        document.getElementById('reg_nombre').value = tr.dataset.nombre || tr.cells[0].textContent.trim();
        document.getElementById('reg_usuario').value = tr.dataset.usuario || tr.cells[1].textContent.trim();
        document.getElementById('reg_contrasena').value = '********';

        const rolVal = tr.dataset.rol || btnEditar.dataset.rol || tr.cells[3].textContent.trim();
        document.getElementById('reg_rol').value = rolVal;

        const groupSuc = document.getElementById('group_reg_sucursal');
        if (groupSuc) {
            groupSuc.style.display = rolVal === 'Gerente' ? 'none' : 'block';
        }

        const sucursalVal = tr.dataset.sucursal || '';
        const regSuc = document.getElementById('reg_sucursal_usr');
        if (regSuc) {
            regSuc.value = (sucursalVal === 'Todas' || !sucursalVal) ? '' : sucursalVal;
            if (rolVal !== 'Gerente') {
                asegurarSucursalSeleccionada();
            }
        }

        document.querySelector('#modal_crear_usuario h1').textContent = 'Editar Usuario';
        document.getElementById('btn_guardar_usuario').textContent = 'Guardar Cambios';
        document.getElementById('reg_contrasena').required = false;
        mostrarModal('modal_crear_usuario');
    }

    if (btnToggle) {
        e.preventDefault();
        const result = await apiPatch(`/usuarios/${btnToggle.dataset.id}/estado`, {});
        if (result.message) {
            mostrarToast(`${result.nombre}: ${result.estado}`, result.estado === 'Activo' ? 'success' : 'warning');
            await cargarUsuariosTabla();
        }
    }
});

// ============================================================================
// INVENTARIO
// ============================================================================
async function cargarInventario() {
    const tbody = document.getElementById('tabla_inventario_body');
    if (!tbody) return;

    try {
        const sucursal = document.getElementById('select_sucur')?.value || 'todas';
        const categoria = document.getElementById('cat_invent')?.value || '';
        const ubicacion = document.getElementById('ubica_i')?.value || '';
        const busqueda = document.getElementById('busc_inventario_input')?.value || '';

        let queryStr = `?sucursal=${sucursal}`;
        if (categoria) queryStr += `&categoria=${categoria}`;
        if (ubicacion) queryStr += `&ubicacion=${ubicacion}`;
        if (busqueda) queryStr += `&busqueda=${busqueda}`;

        const data = await apiGet(`/inventario${queryStr}`);

        let stockBajo = 0, vencidos = 0;
        const hoy = Date.now();
        const seisMeses = 6 * 30 * 24 * 60 * 60 * 1000;

        // Calcular KPIs sobre la data completa
        data.forEach(item => {
            if (item.stock <= item.stock_minimo) stockBajo++;
            if (item.fecha_vencimiento) {
                const vencDate = new Date(item.fecha_vencimiento).getTime();
                if (vencDate - hoy > 0 && vencDate - hoy <= seisMeses) vencidos++;
            }
        });

        const kpiStock = document.getElementById('inventario_kpi_stock_bajo');
        const kpiVenc = document.getElementById('inventario_kpi_vencimiento_proximo');
        if (kpiStock) kpiStock.textContent = stockBajo;
        if (kpiVenc) kpiVenc.textContent = vencidos;

        // Filtrar data para renderizar según el filtro KPI
        let dataFiltrada = data;
        if (inventarioFiltroKpi === 'stock-bajo') {
            dataFiltrada = data.filter(item => item.stock <= item.stock_minimo);
        } else if (inventarioFiltroKpi === 'vencimiento') {
            dataFiltrada = data.filter(item => {
                if (!item.fecha_vencimiento) return false;
                const vencDate = new Date(item.fecha_vencimiento).getTime();
                return (vencDate - hoy > 0 && vencDate - hoy <= seisMeses);
            });
        }

        if (dataFiltrada.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;font-weight:500;">No se encontraron productos con el filtro seleccionado.</td></tr>';
            return;
        }

        tbody.innerHTML = dataFiltrada.map(item => {
            const stockStyle = item.stock <= item.stock_minimo
                ? 'background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25);'
                : 'background:rgba(34,197,94,0.12);color:#166534;border:1px solid rgba(34,197,94,0.25);';
            const vencimiento = item.fecha_vencimiento ? formatDate(item.fecha_vencimiento) : 'Sin venc.';

            return `<tr>
                <td><strong>${item.producto}</strong></td>
                <td>${item.categoria}</td>
                <td>C$ ${parseFloat(item.precio_venta).toFixed(2)}</td>
                <td><span class="badge" style="${stockStyle} font-weight:700;font-size:0.825rem;padding:4px 10px;">${item.stock} uds <span style="font-size:0.65rem;font-weight:500;opacity:0.8;margin-left:2px;">(${item.sucursal})</span></span></td>
                <td>${item.ubicacion}</td>
                <td><span style="${vencimiento !== 'Sin venc.' ? 'color:#d97706;font-weight:600;' : ''}">${vencimiento}</span></td>
                <td><span class="badge" style="background:#e2e8f0;color:#475569;border:1px solid #cbd5e1;">${item.lote || 'N/A'}</span></td>
            </tr>`;
        }).join('');
    } catch (e) { console.error('Error cargando inventario:', e); }
}

// Filtros inventario
function resetKpiFilters() {
    inventarioFiltroKpi = 'todos';
    const detaStock = document.getElementById('deta_stock');
    const detaVenci = document.getElementById('deta_venci');
    if (detaStock) {
        detaStock.textContent = 'Ver detalles';
        detaStock.closest('.card_info').style.border = '';
    }
    if (detaVenci) {
        detaVenci.textContent = 'Ver detalles';
        detaVenci.closest('.card_info').style.border = '';
    }
}

// Event listeners para clic en detalles de las tarjetas KPI
document.getElementById('deta_stock')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (inventarioFiltroKpi === 'stock-bajo') {
        resetKpiFilters();
    } else {
        inventarioFiltroKpi = 'stock-bajo';
        const detaStock = document.getElementById('deta_stock');
        const detaVenci = document.getElementById('deta_venci');
        if (detaStock) {
            detaStock.textContent = 'Quitar filtro';
            detaStock.closest('.card_info').style.border = '2px solid #ef4444';
        }
        if (detaVenci) {
            detaVenci.textContent = 'Ver detalles';
            detaVenci.closest('.card_info').style.border = '';
        }
    }
    cargarInventario();
});

document.getElementById('deta_venci')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (inventarioFiltroKpi === 'vencimiento') {
        resetKpiFilters();
    } else {
        inventarioFiltroKpi = 'vencimiento';
        const detaStock = document.getElementById('deta_stock');
        const detaVenci = document.getElementById('deta_venci');
        if (detaVenci) {
            detaVenci.textContent = 'Quitar filtro';
            detaVenci.closest('.card_info').style.border = '2px solid #d97706';
        }
        if (detaStock) {
            detaStock.textContent = 'Ver detalles';
            detaStock.closest('.card_info').style.border = '';
        }
    }
    cargarInventario();
});

['busc_inventario_input', 'cat_invent', 'ubica_i', 'select_sucur'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        resetKpiFilters();
        cargarInventario();
    });
    document.getElementById(id)?.addEventListener('change', () => {
        resetKpiFilters();
        cargarInventario();
    });
});

// Tabs inventario
document.querySelectorAll('.tab_invent_btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab_invent_btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('tab_ver_inventario').style.display = tab === 'ver-inventario' ? 'block' : 'none';
        document.getElementById('tab_movimientos_inventario').style.display = tab === 'movimientos-inventario' ? 'block' : 'none';
        document.getElementById('tab_relleno_inventario').style.display = tab === 'relleno-inventario' ? 'block' : 'none';
        document.getElementById('inventario')?.classList.toggle('permitir-scroll', tab !== 'ver-inventario');
        if (tab === 'ver-inventario') cargarInventario();
        if (tab === 'movimientos-inventario') cargarMovimientos();
        if (tab === 'relleno-inventario' && typeof window.iniciarRellenoTab === 'function') window.iniciarRellenoTab();
    });
});

// Movimientos de inventario
async function cargarMovimientos() {
    // Inicializar valores de la pestaña de movimientos
    const movOrigen = document.getElementById('mov_sucursal_origen');
    if (movOrigen && activeSucursal) {
        movOrigen.value = activeSucursal;
    }
    const movDestino = document.getElementById('mov_sucursal_destino');
    if (movDestino) {
        movDestino.value = '';
    }

    // Resetear buscadores de origen y destino
    const inputs = [
        'buscar_prod_movimiento_origen',
        'select_prod_movimiento_origen',
        'select_lote_origen',
        'select_vencimiento_origen',
        'select_costo_origen',
        'select_inventario_origen_id',
        'buscar_prod_movimiento_destino',
        'select_prod_movimiento_destino'
    ];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    deshabilitarCamposMovimiento();
    actualizarEstadoProductoDestinoMov();
    await cargarProductosOrigenMov();
    await cargarProductosDestinoMov();
}

function deshabilitarCamposMovimiento() {
    const sel = document.getElementById('mov_select_agrupacion');
    const cantInput = document.getElementById('mov_cantidad_agrupacion');
    if (sel) sel.disabled = true;
    if (cantInput) cantInput.disabled = true;

    // Ocultar contenido de detalles y mostrar marcador de posición
    const detailsVacio = document.getElementById('mov_detalles_vacio');
    const detailsContenido = document.getElementById('mov_detalles_contenido');
    if (detailsVacio) detailsVacio.style.display = 'flex';
    if (detailsContenido) detailsContenido.style.display = 'none';

    const equivInfo = document.getElementById('mov_equivalencia_info');
    if (equivInfo) equivInfo.style.display = 'none';
}

async function actualizarStocksMovimiento() {
    const prodIdOrigen = document.getElementById('select_prod_movimiento_origen')?.value;
    const prodIdDestino = document.getElementById('select_prod_movimiento_destino')?.value || prodIdOrigen;
    const origen = document.getElementById('mov_sucursal_origen')?.value;
    const destino = document.getElementById('mov_sucursal_destino')?.value;

    if (!prodIdOrigen) {
        deshabilitarCamposMovimiento();
        return;
    }

    if (!origen || !destino) {
        // Ocultar contenido de detalles y mostrar marcador de posición sin deshabilitar campos de agrupación/cantidad
        const detailsVacio = document.getElementById('mov_detalles_vacio');
        const detailsContenido = document.getElementById('mov_detalles_contenido');
        if (detailsVacio) detailsVacio.style.display = 'flex';
        if (detailsContenido) detailsContenido.style.display = 'none';

        const equivInfo = document.getElementById('mov_equivalencia_info');
        if (equivInfo) equivInfo.style.display = 'none';
        return;
    }

    try {
        const [dataOrigen, dataDestino] = await Promise.all([
            apiGet(`/inventario/stock/${prodIdOrigen}`),
            apiGet(`/inventario/stock/${prodIdDestino}`)
        ]);

        const origenStockObj = dataOrigen.find(s => s.sucursal === origen || s.nombre === origen);
        const destinoStockObj = dataDestino.find(s => s.sucursal === destino || s.nombre === destino);

        // Si es el lote específico, el stock disponible origen es el stock de esa fila en particular, 
        // no la suma de toda la bodega de la sucursal. 
        const selectInventarioId = document.getElementById('select_inventario_origen_id')?.value;
        if (selectInventarioId && productosOrigenMov) {
            const selectedBatch = productosOrigenMov.find(p => String(p.id_inventario) === String(selectInventarioId));
            movStockOrigenGlobal = selectedBatch ? parseFloat(selectedBatch.stock) || 0 : 0;
        } else {
            movStockOrigenGlobal = origenStockObj ? parseFloat(origenStockObj.stock) || 0 : 0;
        }
        movStockDestinoGlobal = destinoStockObj ? parseFloat(destinoStockObj.stock) || 0 : 0;

        const prodOrigen = window.productosInventario?.find(p => String(p.id) === String(prodIdOrigen));
        const prodDestino = window.productosInventario?.find(p => String(p.id) === String(prodIdDestino));
        if (prodOrigen) {
            let nombreMostrar = prodOrigen.name;
            if (prodDestino && prodDestino.id !== prodOrigen.id) {
                nombreMostrar = `${prodOrigen.name} ➡️ ${prodDestino.name}`;
            }
            document.getElementById('mov_detalles_prod_nombre').textContent = nombreMostrar;
            document.getElementById('mov_detalles_prod_cat').textContent = `Categoría Origen: ${prodOrigen.category}`;
        }

        document.getElementById('mov_detalles_stock_origen').textContent = `${movStockOrigenGlobal} uds`;
        document.getElementById('mov_detalles_stock_destino').textContent = `${movStockDestinoGlobal} uds`;

        const detailsVacio = document.getElementById('mov_detalles_vacio');
        const detailsContenido = document.getElementById('mov_detalles_contenido');
        if (detailsVacio) detailsVacio.style.display = 'none';
        if (detailsContenido) detailsContenido.style.display = 'block';

        actualizarDetallesProyeccionMovimiento();
    } catch (e) {
        console.error('Error al actualizar stock de movimiento:', e);
    }
}

function actualizarDetallesProyeccionMovimiento() {
    const prodId = document.getElementById('select_prod_movimiento_origen')?.value;
    if (!prodId) return;

    const cantAgrupInput = document.getElementById('mov_cantidad_agrupacion');
    const cantVal = parseInt(cantAgrupInput?.value) || 0;

    const sel = document.getElementById('mov_select_agrupacion');
    if (!sel || sel.selectedIndex === -1 || cantVal <= 0) {
        const equivInfo = document.getElementById('mov_equivalencia_info');
        if (equivInfo) equivInfo.style.display = 'none';
        return;
    }

    const opt = sel.options[sel.selectedIndex];
    const equiv = parseFloat(opt.dataset.equiv) || 1;
    const totalUds = Math.round(cantVal * equiv);

    const equivUds = document.getElementById('mov_equiv_uds');
    if (equivUds) equivUds.textContent = `${totalUds} unidades`;
    const equivInfo = document.getElementById('mov_equivalencia_info');
    if (equivInfo) equivInfo.style.display = 'block';

    const proyOrigen = movStockOrigenGlobal - totalUds;
    const proyDestino = movStockDestinoGlobal + totalUds;

    document.getElementById('mov_detalles_monto_mover').textContent = `${totalUds} uds`;

    const proyOrigenEl = document.getElementById('mov_detalles_proy_origen');
    const proyDestinoEl = document.getElementById('mov_detalles_proy_destino');

    if (proyOrigenEl) proyOrigenEl.textContent = `${proyOrigen} uds`;
    if (proyDestinoEl) proyDestinoEl.textContent = `${proyDestino} uds`;

    const agrupText = opt ? opt.value : 'Unidad';
    const origenAgrupSpan = document.getElementById('mov_detalles_origen_agrup');
    const destinoAgrupSpan = document.getElementById('mov_detalles_destino_agrup');

    if (origenAgrupSpan && destinoAgrupSpan) {
        if (equiv > 1) {
            const origenInAgrup = (movStockOrigenGlobal / equiv).toFixed(1);
            const destinoInAgrup = (movStockDestinoGlobal / equiv).toFixed(1);
            origenAgrupSpan.textContent = `~ ${origenInAgrup} ${agrupText}(s)`;
            destinoAgrupSpan.textContent = `~ ${destinoInAgrup} ${agrupText}(s)`;
        } else {
            origenAgrupSpan.textContent = '';
            destinoAgrupSpan.textContent = '';
        }
    }

    const statusBadge = document.getElementById('mov_status_badge');
    const alertTexto = document.getElementById('mov_alerta_texto');
    const btnRealizar = document.getElementById('btn_realizar_movimiento');
    const origen = document.getElementById('mov_sucursal_origen')?.value;
    const destino = document.getElementById('mov_sucursal_destino')?.value;

    if (origen === destino) {
        if (statusBadge) {
            statusBadge.textContent = 'Sucursales Iguales';
            statusBadge.style.background = '#fee2e2';
            statusBadge.style.color = '#ef4444';
            statusBadge.style.border = '1px solid #fca5a5';
        }
        if (alertTexto) {
            alertTexto.textContent = `⚠️ Las sucursales de origen y destino deben ser diferentes.`;
            alertTexto.style.display = 'block';
        }
        if (btnRealizar) {
            btnRealizar.disabled = true;
            btnRealizar.style.background = '#cbd5e1';
            btnRealizar.style.cursor = 'not-allowed';
        }
    } else if (totalUds > movStockOrigenGlobal) {
        if (statusBadge) {
            statusBadge.textContent = 'Stock Insuficiente';
            statusBadge.style.background = '#fee2e2';
            statusBadge.style.color = '#ef4444';
            statusBadge.style.border = '1px solid #fca5a5';
        }
        if (proyOrigenEl) proyOrigenEl.style.color = '#ef4444';
        if (alertTexto) {
            alertTexto.textContent = `⚠️ No hay suficiente stock en origen. Stock disponible: ${movStockOrigenGlobal} unidades. Estás solicitando ${totalUds} unidades.`;
            alertTexto.style.display = 'block';
        }
        if (btnRealizar) {
            btnRealizar.disabled = true;
            btnRealizar.style.background = '#cbd5e1';
            btnRealizar.style.cursor = 'not-allowed';
        }
    } else if (totalUds <= 0) {
        if (statusBadge) {
            statusBadge.textContent = 'Cantidad Inválida';
            statusBadge.style.background = '#f1f5f9';
            statusBadge.style.color = '#64748b';
            statusBadge.style.border = '1px solid #cbd5e1';
        }
        if (alertTexto) alertTexto.style.display = 'none';
        if (proyOrigenEl) proyOrigenEl.style.color = '#0f172a';
        if (btnRealizar) {
            btnRealizar.disabled = true;
            btnRealizar.style.background = '#cbd5e1';
            btnRealizar.style.cursor = 'not-allowed';
        }
    } else {
        if (statusBadge) {
            statusBadge.textContent = 'Movimiento Válido';
            statusBadge.style.background = '#e6f7ed';
            statusBadge.style.color = '#10b981';
            statusBadge.style.border = '1px solid #a7f3d0';
        }
        if (proyOrigenEl) proyOrigenEl.style.color = '#10b981';
        if (alertTexto) alertTexto.style.display = 'none';
        if (btnRealizar) {
            btnRealizar.disabled = false;
            btnRealizar.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
            btnRealizar.style.cursor = 'pointer';
        }
    }
}

// Autocompletado movimientos
const buscarProdMovOrigen = document.getElementById('buscar_prod_movimiento_origen');
const selectProdMovIdOrigen = document.getElementById('select_prod_movimiento_origen');
const resultadosBusqMovOrigen = document.getElementById('resultados_busqueda_movimiento_origen');

const buscarProdMovDestino = document.getElementById('buscar_prod_movimiento_destino');
const selectProdMovIdDestino = document.getElementById('select_prod_movimiento_destino');
const resultadosBusqMovDestino = document.getElementById('resultados_busqueda_movimiento_destino');

let productosOrigenMov = [];
let productosDestinoMov = [];

async function cargarProductosOrigenMov() {
    const origen = document.getElementById('mov_sucursal_origen')?.value;
    if (!origen) {
        productosOrigenMov = [];
        return;
    }
    try {
        const data = await apiGet(`/inventario?sucursal=${encodeURIComponent(origen)}&ubicacion=Bodega`);
        productosOrigenMov = data;
    } catch (e) {
        console.error('Error al cargar productos de origen:', e);
        productosOrigenMov = [];
    }
}

async function cargarProductosDestinoMov() {
    const destino = document.getElementById('mov_sucursal_destino')?.value;
    if (!destino) {
        productosDestinoMov = [];
        return;
    }
    try {
        const data = await apiGet(`/inventario?sucursal=${encodeURIComponent(destino)}`);
        const destStocks = {};
        data.forEach(item => {
            destStocks[item.id_producto] = (destStocks[item.id_producto] || 0) + item.stock;
        });

        productosDestinoMov = (window.productosInventario || []).map(p => {
            const hasStock = destStocks[p.id] !== undefined;
            return {
                id: String(p.id),
                name: p.name,
                category: p.category,
                stock: hasStock ? destStocks[p.id] : 0,
                registrado: hasStock
            };
        });
    } catch (e) {
        console.error('Error al cargar productos de destino:', e);
        productosDestinoMov = [];
    }
}

if (buscarProdMovOrigen) {
    buscarProdMovOrigen.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const origen = document.getElementById('mov_sucursal_origen')?.value;
        if (!origen) {
            resultadosBusqMovOrigen.innerHTML = '<div class="autocomplete-item-no-results" style="color: #ef4444; font-weight: 600;">⚠️ Seleccione primero la sucursal de origen</div>';
            resultadosBusqMovOrigen.style.display = 'block';
            return;
        }
        // Al escribir se descarta la selección previa hasta que se elija un lote de la lista
        selectProdMovIdOrigen.value = '';
        document.getElementById('select_lote_origen').value = '';
        document.getElementById('select_vencimiento_origen').value = '';
        document.getElementById('select_costo_origen').value = '';
        document.getElementById('select_inventario_origen_id').value = '';
        if (buscarProdMovDestino) buscarProdMovDestino.value = '';
        if (selectProdMovIdDestino) selectProdMovIdDestino.value = '';
        actualizarEstadoProductoDestinoMov();
        deshabilitarCamposMovimiento();

        if (!query) {
            resultadosBusqMovOrigen.style.display = 'none';
            return;
        }

        const prods = productosOrigenMov.filter(p => p.producto.toLowerCase().includes(query) || (p.lote && p.lote.toLowerCase().includes(query)));
        if (prods.length === 0) {
            resultadosBusqMovOrigen.innerHTML = '<div class="autocomplete-item-no-results">No se encontraron productos en Bodega</div>';
            resultadosBusqMovOrigen.style.display = 'block';
            deshabilitarCamposMovimiento();
            return;
        }
        resultadosBusqMovOrigen.innerHTML = prods.map(p => {
            const venc = p.fecha_vencimiento ? formatDate(p.fecha_vencimiento) : 'Sin venc.';
            const loteStr = p.lote ? `Lote: ${p.lote}` : 'Sin lote';
            return `<div class="autocomplete-item" 
                data-id="${p.id_producto}" 
                data-name="${p.producto}"
                data-lote="${p.lote || ''}"
                data-venc="${p.fecha_vencimiento || ''}"
                data-costo="${p.precio_costo || 0}"
                data-inventario-id="${p.id_inventario}"
                data-stock="${p.stock}">
                <strong>${p.producto}</strong>
                <span style="font-size:11px;color:#64748b;margin-left:8px;">(${loteStr} | Vence: ${venc} | Stock: ${p.stock} uds)</span>
            </div>`;
        }).join('');
        resultadosBusqMovOrigen.style.display = 'block';

        resultadosBusqMovOrigen.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                buscarProdMovOrigen.value = `${item.dataset.name} (${item.dataset.lote ? 'Lote: ' + item.dataset.lote : 'Sin lote'})`;
                selectProdMovIdOrigen.value = item.dataset.id;
                document.getElementById('select_lote_origen').value = item.dataset.lote;
                document.getElementById('select_vencimiento_origen').value = item.dataset.venc;
                document.getElementById('select_costo_origen').value = item.dataset.costo;
                document.getElementById('select_inventario_origen_id').value = item.dataset.inventarioId;

                // El producto destino se busca aparte en la sucursal destino
                if (buscarProdMovDestino) buscarProdMovDestino.value = '';
                if (selectProdMovIdDestino) selectProdMovIdDestino.value = '';
                actualizarEstadoProductoDestinoMov();

                resultadosBusqMovOrigen.style.display = 'none';
                cargarAgrupacionesMov(item.dataset.id);
                actualizarStocksMovimiento();
            });
        });
    });

    document.addEventListener('click', (e) => {
        if (resultadosBusqMovOrigen && !buscarProdMovOrigen.contains(e.target) && !resultadosBusqMovOrigen.contains(e.target)) {
            resultadosBusqMovOrigen.style.display = 'none';
        }
    });
}

// Producto de destino: se busca entre los productos que tiene la sucursal destino (allí
// puede tener otro nombre). Si no existe, se registra el producto de origen con todos sus
// datos (lote, vencimiento y costo) en la Bodega de la sucursal destino.
function actualizarEstadoProductoDestinoMov() {
    const estado = document.getElementById('mov_destino_estado');
    if (!estado) return;
    const prodIdDestino = selectProdMovIdDestino?.value;
    const prodIdOrigen = selectProdMovIdOrigen?.value;
    const destino = document.getElementById('mov_sucursal_destino')?.value;

    if (!prodIdDestino) {
        estado.style.display = 'none';
        return;
    }
    estado.style.display = 'block';
    const prodDestino = productosDestinoMov.find(p => String(p.id) === String(prodIdDestino));
    const lote = document.getElementById('select_lote_origen')?.value;
    const datosLote = lote ? `lote ${lote}` : 'sin lote';

    if (prodDestino && prodDestino.registrado) {
        estado.style.color = '#166534';
        const reasignado = String(prodIdDestino) !== String(prodIdOrigen) ? ' (producto con otro nombre en destino)' : '';
        estado.textContent = `✔ Se sumará a "${prodDestino.name}" en ${destino}${reasignado}. Stock actual: ${prodDestino.stock} uds.`;
    } else {
        estado.style.color = '#1d4ed8';
        estado.textContent = `ℹ️ ${destino} no tiene este producto. Se registrará en su Bodega con los datos del origen (${datosLote}, vencimiento y costo).`;
    }
}

function limpiarProductoDestinoMov() {
    if (buscarProdMovDestino) buscarProdMovDestino.value = '';
    if (selectProdMovIdDestino) selectProdMovIdDestino.value = '';
    if (resultadosBusqMovDestino) resultadosBusqMovDestino.style.display = 'none';
    actualizarEstadoProductoDestinoMov();
}

function seleccionarProductoDestinoMov(id, nombre) {
    buscarProdMovDestino.value = nombre;
    selectProdMovIdDestino.value = id;
    resultadosBusqMovDestino.style.display = 'none';
    actualizarEstadoProductoDestinoMov();
    actualizarStocksMovimiento();
}

function mostrarResultadosDestinoMov() {
    const destino = document.getElementById('mov_sucursal_destino')?.value;
    const prodIdOrigen = selectProdMovIdOrigen?.value;

    if (!prodIdOrigen) {
        resultadosBusqMovDestino.innerHTML = '<div class="autocomplete-item-no-results" style="color: #ef4444; font-weight: 600;">⚠️ Seleccione primero el producto de origen</div>';
        resultadosBusqMovDestino.style.display = 'block';
        return;
    }
    if (!destino) {
        resultadosBusqMovDestino.innerHTML = '<div class="autocomplete-item-no-results" style="color: #ef4444; font-weight: 600;">⚠️ Seleccione primero la sucursal de destino</div>';
        resultadosBusqMovDestino.style.display = 'block';
        return;
    }

    const query = (buscarProdMovDestino.value || '').toLowerCase().trim();
    const prodOrigen = window.productosInventario?.find(p => String(p.id) === String(prodIdOrigen));
    const origenEnDestino = productosDestinoMov.some(p => p.registrado && String(p.id) === String(prodIdOrigen));

    // Solo productos que existen (con stock) en la sucursal destino
    const prods = productosDestinoMov.filter(p => p.registrado && (!query || p.name.toLowerCase().includes(query)));

    let html = '';
    // Opción para registrar el producto de origen si no existe en destino
    if (prodOrigen && !origenEnDestino) {
        html += `<div class="autocomplete-item" data-id="${prodOrigen.id}" data-name="${prodOrigen.name}" style="background:#eff6ff;">
            <strong>➕ Registrar "${prodOrigen.name}" en ${destino}</strong>
            <span style="font-size:11px;color:#1d4ed8;margin-left:8px;">(no existe en destino: se pasan todos sus datos)</span>
        </div>`;
    }
    html += prods.map(p => `<div class="autocomplete-item" data-id="${p.id}" data-name="${p.name}">
            <strong>${p.name}</strong>
            <span style="font-size:11px;color:#166534;margin-left:8px;">(${p.category} | Stock en ${destino}: ${p.stock} uds)</span>
        </div>`).join('');

    if (!html) {
        html = `<div class="autocomplete-item-no-results">No se encontraron productos en ${destino}</div>`;
    }
    resultadosBusqMovDestino.innerHTML = html;
    resultadosBusqMovDestino.style.display = 'block';
    resultadosBusqMovDestino.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => seleccionarProductoDestinoMov(item.dataset.id, item.dataset.name));
    });
}

if (buscarProdMovDestino) {
    buscarProdMovDestino.addEventListener('input', () => {
        // Al escribir se descarta la selección hasta que se elija una opción de la lista
        if (selectProdMovIdDestino) selectProdMovIdDestino.value = '';
        actualizarEstadoProductoDestinoMov();
        mostrarResultadosDestinoMov();
    });
    buscarProdMovDestino.addEventListener('focus', mostrarResultadosDestinoMov);

    document.addEventListener('click', (e) => {
        if (resultadosBusqMovDestino && !buscarProdMovDestino.contains(e.target) && !resultadosBusqMovDestino.contains(e.target)) {
            resultadosBusqMovDestino.style.display = 'none';
        }
    });
}

function cargarAgrupacionesMov(prodId) {
    const sel = document.getElementById('mov_select_agrupacion');
    if (!sel) return;
    sel.innerHTML = '';
    const prod = window.productosInventario?.find(p => String(p.id) === String(prodId));
    if (prod && prod.groupings) {
        Object.entries(prod.groupings).forEach(([g, eq]) => {
            const opt = document.createElement('option');
            opt.value = g; opt.dataset.equiv = eq;
            opt.textContent = `${g} (${eq} ud${eq > 1 ? 's' : ''})`;
            sel.appendChild(opt);
        });
        sel.disabled = false;
        const cantInput = document.getElementById('mov_cantidad_agrupacion');
        if (cantInput) { cantInput.disabled = false; cantInput.value = '1'; }

        actualizarDetallesProyeccionMovimiento();
    }
}

// Vincular listeners para actualizaciones en tiempo real de los detalles del movimiento
document.getElementById('mov_sucursal_origen')?.addEventListener('change', async () => {
    await cargarProductosOrigenMov();
    // El lote elegido pertenece a la sucursal anterior: hay que volver a elegirlo
    ['buscar_prod_movimiento_origen', 'select_prod_movimiento_origen', 'select_lote_origen',
        'select_vencimiento_origen', 'select_costo_origen', 'select_inventario_origen_id',
        'buscar_prod_movimiento_destino', 'select_prod_movimiento_destino'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    actualizarEstadoProductoDestinoMov();
    deshabilitarCamposMovimiento();
});
document.getElementById('mov_sucursal_destino')?.addEventListener('change', async () => {
    await cargarProductosDestinoMov();
    // El producto destino elegido pertenecía a la sucursal anterior
    limpiarProductoDestinoMov();
    actualizarStocksMovimiento();
});
document.getElementById('mov_select_agrupacion')?.addEventListener('change', actualizarDetallesProyeccionMovimiento);
document.getElementById('mov_cantidad_agrupacion')?.addEventListener('input', actualizarDetallesProyeccionMovimiento);

// Realizar movimiento
document.getElementById('btn_realizar_movimiento')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const prodIdOrigen = selectProdMovIdOrigen?.value;
    const prodIdDestino = selectProdMovIdDestino?.value;
    const origen = document.getElementById('mov_sucursal_origen')?.value;
    const destino = document.getElementById('mov_sucursal_destino')?.value;
    const agrupacion = document.getElementById('mov_select_agrupacion')?.value;
    const cantAgrup = parseInt(document.getElementById('mov_cantidad_agrupacion')?.value) || 0;
    const inventarioOrigenSel = document.getElementById('select_inventario_origen_id')?.value;

    if (!prodIdOrigen || !inventarioOrigenSel) { mostrarToast('Seleccione de la lista el producto y lote de origen.', 'warning'); return; }
    if (!prodIdDestino) { mostrarToast('Busque y seleccione de la lista el producto de destino (o la opción de registrarlo en la sucursal destino).', 'warning'); return; }
    // El destino debe ser el mismo producto o uno que exista en la sucursal destino
    const destinoValido = String(prodIdDestino) === String(prodIdOrigen) ||
        productosDestinoMov.some(p => p.registrado && String(p.id) === String(prodIdDestino));
    if (!destinoValido) {
        mostrarToast('El producto de destino no existe en la sucursal destino. Búsquelo de nuevo.', 'warning');
        return;
    }
    if (!origen || !destino) { mostrarToast('Seleccione las sucursales.', 'warning'); return; }
    if (origen === destino) { mostrarToast('Las sucursales deben ser diferentes.', 'warning'); return; }
    if (cantAgrup <= 0) { mostrarToast('La cantidad debe ser mayor a cero.', 'warning'); return; }

    const sel = document.getElementById('mov_select_agrupacion');
    const equiv = parseFloat(sel.options[sel.selectedIndex]?.dataset.equiv) || 1;
    const totalUds = Math.round(cantAgrup * equiv);

    if (totalUds > movStockOrigenGlobal) {
        mostrarToast('Error: No puedes transferir más unidades de las disponibles en la sucursal de origen.', 'danger');
        return;
    }

    const origenObj = sucursalesCache.find(s => s.nombre === origen);
    const destinoObj = sucursalesCache.find(s => s.nombre === destino);

    const prod = window.productosInventario?.find(p => String(p.id) === String(prodIdOrigen));
    const groupingDetail = prod?.groupingDetails?.[agrupacion];
    const idAgrupacion = groupingDetail ? groupingDetail.id_agrupacion : 1;

    // Obtener detalles del lote origen seleccionado
    const lote = document.getElementById('select_lote_origen').value;
    const vencimiento = document.getElementById('select_vencimiento_origen').value;
    const costo = parseFloat(document.getElementById('select_costo_origen').value) || 0;
    const inventarioOrigenId = parseInt(document.getElementById('select_inventario_origen_id').value);

    // Escribir observaciones si el producto destino es diferente al de origen
    let observaciones = null;
    const prodDestinoObj = window.productosInventario?.find(p => String(p.id) === String(prodIdDestino));
    if (prodDestinoObj && prodDestinoObj.id !== prod.id) {
        observaciones = `Reasignado de "${prod.name}" a "${prodDestinoObj.name}" en destino.`;
    }

    const result = await apiPost('/inventario/movimiento', {
        id_producto: parseInt(prodIdOrigen),
        id_producto_destino: parseInt(prodIdDestino),
        id_sucursal_origen: origenObj?.id_sucursal,
        id_sucursal_destino: destinoObj?.id_sucursal,
        id_agrupacion: idAgrupacion,
        cantidad_agrupacion: cantAgrup,
        cantidad_unidades: totalUds,
        id_usuario: currentUser?.id_usuario,
        id_inventario_origen: inventarioOrigenId,
        lote: lote || null,
        fecha_vencimiento: vencimiento || null,
        precio_costo: costo,
        observaciones: observaciones
    });

    if (result.message) {
        mostrarToast('¡Transferencia de inventario realizada exitosamente!', 'success');
        cargarMovimientos();
    } else mostrarToast(result.error || 'Error al realizar el movimiento.', 'danger');
});

// ============================================================================
// RELLENO INVENTARIO
// ============================================================================
window.iniciarRellenoTab = function () {
    actualizarRellenoSucursalDisplay();
    initBuscadorAutocompleteRelleno();
};

const buscarProdRelleno = document.getElementById('buscar_prod_relleno');
const selectProdRellenoId = document.getElementById('select_prod_relleno');
const resultadosBusqRelleno = document.getElementById('resultados_busqueda_relleno');
const rellenoSelectAgrup = document.getElementById('relleno_select_agrupacion');
const rellenoCantAgrup = document.getElementById('relleno_cantidad_agrupacion');

let rellenoStockBodegaGlobal = 0;
let rellenoStockMostradorGlobal = 0;

function actualizarRellenoSucursalDisplay() {
    const displayNombre = document.getElementById('relleno_sucursal_nombre');
    if (displayNombre) {
        displayNombre.textContent = `Sucursal ${activeSucursal || 'Central'}`;
    }
}

function initBuscadorAutocompleteRelleno() {
    if (!buscarProdRelleno) return;
    if (window.rellenoInitialized) return;
    window.rellenoInitialized = true;

    buscarProdRelleno.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            resultadosBusqRelleno.style.display = 'none';
            selectProdRellenoId.value = '';
            deshabilitarCamposRelleno();
            return;
        }

        const prods = (window.productosInventario || []).filter(p => p.name.toLowerCase().includes(query));
        if (prods.length === 0) {
            resultadosBusqRelleno.innerHTML = '<div class="autocomplete-item-no-results">No se encontraron productos</div>';
            resultadosBusqRelleno.style.display = 'block';
            deshabilitarCamposRelleno();
            return;
        }

        resultadosBusqRelleno.innerHTML = prods.map(p => `
            <div class="autocomplete-item" data-id="${p.id}" data-name="${p.name}" data-category="${p.category}" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 2px;">
                <div style="font-weight: 700; color: var(--color-principal); font-size: 0.9rem;">${p.name}</div>
                <div style="font-size: 11px; color: var(--color-gris);">Categoría: ${p.category}</div>
            </div>
        `).join('');
        resultadosBusqRelleno.style.display = 'block';

        resultadosBusqRelleno.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                buscarProdRelleno.value = item.dataset.name;
                selectProdRellenoId.value = item.dataset.id;
                resultadosBusqRelleno.style.display = 'none';

                cargarAgrupacionesRelleno(item.dataset.id);
                actualizarStocksRelleno();
            });
        });
    });

    document.addEventListener('click', (e) => {
        if (resultadosBusqRelleno && !buscarProdRelleno.contains(e.target) && !resultadosBusqRelleno.contains(e.target)) {
            resultadosBusqRelleno.style.display = 'none';
        }
    });

    rellenoSelectAgrup?.addEventListener('change', actualizarDetallesProyeccion);
    rellenoCantAgrup?.addEventListener('input', actualizarDetallesProyeccion);

    document.getElementById('btn_realizar_relleno')?.addEventListener('click', realizarRellenoSubmit);
}

function deshabilitarCamposRelleno() {
    if (rellenoSelectAgrup) rellenoSelectAgrup.disabled = true;
    if (rellenoCantAgrup) rellenoCantAgrup.disabled = true;

    // Hide details content and show placeholder
    const detailsVacio = document.getElementById('relleno_detalles_vacio');
    const detailsContenido = document.getElementById('relleno_detalles_contenido');
    if (detailsVacio) detailsVacio.style.display = 'flex';
    if (detailsContenido) detailsContenido.style.display = 'none';

    document.getElementById('relleno_equivalencia_info').style.display = 'none';
}

function cargarAgrupacionesRelleno(prodId) {
    if (!rellenoSelectAgrup) return;
    rellenoSelectAgrup.innerHTML = '';
    const prod = window.productosInventario?.find(p => String(p.id) === String(prodId));
    if (prod && prod.groupings) {
        Object.entries(prod.groupings).forEach(([g, eq]) => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.dataset.equiv = eq;
            opt.textContent = `${g} (${eq} ud${eq > 1 ? 's' : ''})`;
            rellenoSelectAgrup.appendChild(opt);
        });
        rellenoSelectAgrup.disabled = false;
        if (rellenoCantAgrup) {
            rellenoCantAgrup.disabled = false;
            rellenoCantAgrup.value = '1';
        }
        actualizarEquivalenciaRelleno();
    }
}

async function actualizarStocksRelleno() {
    const prodId = selectProdRellenoId?.value;
    const sucursalVal = activeSucursal || 'Central';

    if (!prodId) {
        deshabilitarCamposRelleno();
        return;
    }

    try {
        const data = await apiGet(`/inventario?sucursal=${encodeURIComponent(sucursalVal)}`);
        const prodItems = data.filter(item => String(item.id_producto) === String(prodId));

        rellenoStockBodegaGlobal = prodItems.filter(item => item.ubicacion === 'Bodega').reduce((sum, item) => sum + item.stock, 0);
        rellenoStockMostradorGlobal = prodItems.filter(item => item.ubicacion === 'Mostrador').reduce((sum, item) => sum + item.stock, 0);

        // Show details card
        const prod = window.productosInventario?.find(p => String(p.id) === String(prodId));
        if (prod) {
            document.getElementById('relleno_detalles_prod_nombre').textContent = prod.name;
            document.getElementById('relleno_detalles_prod_cat').textContent = `Categoría: ${prod.category}`;
        }

        document.getElementById('relleno_detalles_stock_bodega').textContent = `${rellenoStockBodegaGlobal} uds`;
        document.getElementById('relleno_detalles_stock_mostrador').textContent = `${rellenoStockMostradorGlobal} uds`;

        const detailsVacio = document.getElementById('relleno_detalles_vacio');
        const detailsContenido = document.getElementById('relleno_detalles_contenido');
        if (detailsVacio) detailsVacio.style.display = 'none';
        if (detailsContenido) detailsContenido.style.display = 'block';

        actualizarDetallesProyeccion();
    } catch (e) {
        console.error('Error al actualizar stock de relleno:', e);
    }
}

function actualizarEquivalenciaRelleno() {
    const cantVal = parseInt(rellenoCantAgrup?.value) || 0;
    if (!rellenoSelectAgrup || rellenoSelectAgrup.selectedIndex === -1 || cantVal <= 0) {
        document.getElementById('relleno_equivalencia_info').style.display = 'none';
        return;
    }
    const opt = rellenoSelectAgrup.options[rellenoSelectAgrup.selectedIndex];
    const equiv = parseFloat(opt.dataset.equiv) || 1;
    const totalUds = Math.round(cantVal * equiv);

    document.getElementById('relleno_equiv_uds').textContent = `${totalUds} unidades`;
    document.getElementById('relleno_equivalencia_info').style.display = 'block';
}

function actualizarDetallesProyeccion() {
    actualizarEquivalenciaRelleno();

    const prodId = selectProdRellenoId?.value;
    if (!prodId) return;

    const cantVal = parseInt(rellenoCantAgrup?.value) || 0;
    const opt = rellenoSelectAgrup.options[rellenoSelectAgrup.selectedIndex];
    const equiv = opt ? parseFloat(opt.dataset.equiv) || 1 : 1;
    const totalUds = Math.round(cantVal * equiv);

    const proyBodega = rellenoStockBodegaGlobal - totalUds;
    const proyMostrador = rellenoStockMostradorGlobal + totalUds;

    document.getElementById('relleno_detalles_monto_mover').textContent = `${totalUds} uds`;

    const proyBodegaEl = document.getElementById('relleno_detalles_proy_bodega');
    const proyMostradorEl = document.getElementById('relleno_detalles_proy_mostrador');

    proyBodegaEl.textContent = `${proyBodega} uds`;
    proyMostradorEl.textContent = `${proyMostrador} uds`;

    // Format text under Stock cards
    const agrupText = opt ? opt.value : 'Unidad';
    const bodegaAgrupSpan = document.getElementById('relleno_detalles_bodega_agrup');
    const mostradorAgrupSpan = document.getElementById('relleno_detalles_mostrador_agrup');

    if (equiv > 1) {
        const bodegaInAgrup = (rellenoStockBodegaGlobal / equiv).toFixed(1);
        const mostradorInAgrup = (rellenoStockMostradorGlobal / equiv).toFixed(1);
        bodegaAgrupSpan.textContent = `~ ${bodegaInAgrup} ${agrupText}(s)`;
        mostradorAgrupSpan.textContent = `~ ${mostradorInAgrup} ${agrupText}(s)`;
    } else {
        bodegaAgrupSpan.textContent = '';
        mostradorAgrupSpan.textContent = '';
    }

    // Validation
    const statusBadge = document.getElementById('relleno_status_badge');
    const alertTexto = document.getElementById('relleno_alerta_texto');
    const btnRealizar = document.getElementById('btn_realizar_relleno');

    if (totalUds > rellenoStockBodegaGlobal) {
        // Over limit
        statusBadge.textContent = 'Stock Insuficiente';
        statusBadge.style.background = '#fee2e2';
        statusBadge.style.color = '#ef4444';
        statusBadge.style.border = '1px solid #fca5a5';

        proyBodegaEl.style.color = '#ef4444';
        alertTexto.textContent = `⚠️ No hay suficiente stock en Bodega. Stock disponible: ${rellenoStockBodegaGlobal} unidades. Estás solicitando ${totalUds} unidades.`;
        alertTexto.style.display = 'block';

        if (btnRealizar) {
            btnRealizar.disabled = true;
            btnRealizar.style.background = '#cbd5e1';
            btnRealizar.style.cursor = 'not-allowed';
        }
    } else if (totalUds <= 0) {
        statusBadge.textContent = 'Cantidad Inválida';
        statusBadge.style.background = '#f1f5f9';
        statusBadge.style.color = '#64748b';
        statusBadge.style.border = '1px solid #cbd5e1';

        alertTexto.style.display = 'none';
        proyBodegaEl.style.color = '#0f172a';

        if (btnRealizar) {
            btnRealizar.disabled = true;
            btnRealizar.style.background = '#cbd5e1';
            btnRealizar.style.cursor = 'not-allowed';
        }
    } else {
        // Valid
        statusBadge.textContent = 'Abastecimiento Válido';
        statusBadge.style.background = '#e6f7ed';
        statusBadge.style.color = '#10b981';
        statusBadge.style.border = '1px solid #a7f3d0';

        proyBodegaEl.style.color = '#10b981';
        alertTexto.style.display = 'none';

        if (btnRealizar) {
            btnRealizar.disabled = false;
            btnRealizar.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            btnRealizar.style.cursor = 'pointer';
        }
    }
}

async function realizarRellenoSubmit(e) {
    e.preventDefault();
    const prodId = selectProdRellenoId?.value;
    const cantVal = parseInt(rellenoCantAgrup?.value) || 0;

    if (!prodId) { mostrarToast('Seleccione un producto.', 'warning'); return; }
    if (cantVal <= 0) { mostrarToast('La cantidad debe ser mayor a cero.', 'warning'); return; }

    const opt = rellenoSelectAgrup.options[rellenoSelectAgrup.selectedIndex];
    const equiv = opt ? parseFloat(opt.dataset.equiv) || 1 : 1;
    const totalUds = Math.round(cantVal * equiv);

    if (totalUds > rellenoStockBodegaGlobal) {
        mostrarToast('Error: No puedes solicitar más unidades de las disponibles en Bodega.', 'danger');
        return;
    }

    const activeSucName = activeSucursal || 'Central';
    const sucObj = sucursalesCache.find(s => s.nombre === activeSucName);
    if (!sucObj) { mostrarToast('Sucursal activa no válida.', 'warning'); return; }

    const result = await apiPost('/inventario/relleno', {
        id_producto: parseInt(prodId),
        id_sucursal: sucObj.id_sucursal,
        cantidad: totalUds,
        id_usuario: currentUser?.id_usuario
    });

    if (result.message) {
        mostrarToast('¡Relleno de mostrador realizado exitosamente!', 'success');
        buscarProdRelleno.value = '';
        selectProdRellenoId.value = '';
        deshabilitarCamposRelleno();
        cargarInventario();
    } else {
        mostrarToast(result.error || 'Error al realizar el relleno.', 'danger');
    }
}

// ============================================================================
// PROVEEDORES
// ============================================================================
let supplierRowBeingEdited = null;

async function cargarProveedores() {
    const tbody = document.querySelector('#proveedores .tabla_agg tbody');
    if (!tbody) return;
    try {
        const sucursal = activeSucursal || 'Central';
        proveedoresCache = await apiGet(`/proveedores?sucursal=${encodeURIComponent(sucursal)}`);
        window.proveedoresCache = proveedoresCache;
        tbody.innerHTML = proveedoresCache.map(p => {
            const estadoClass = p.estado === 'Activo' ? 'estado activo' : 'estado inactivo';
            const btnToggleText = p.estado === 'Activo' ? 'INACTIVAR' : 'ACTIVAR';
            const btnToggleClass = p.estado === 'Activo' ? 'btn_inactivar_proveedor' : 'btn_activar_proveedor';
            return `<tr data-id="${p.id_proveedor}">
                <td>${p.id_proveedor}</td>
                <td>${p.nombre}</td>
                <td>${p.contacto || ''}</td>
                <td>${p.telefono || ''}</td>
                <td>${p.correo || ''}</td>
                <td>${p.sucursal || 'Central'}</td>
                <td><span class="${estadoClass}">${p.estado}</span></td>
                <td><button class="btn_modificar_proveedor">MODIFICAR</button>
                    <button class="${btnToggleClass} btn_toggle_proveedor">${btnToggleText}</button></td>
            </tr>`;
        }).join('');
    } catch (e) { console.error('Error cargando proveedores:', e); }
}

// Guardar proveedor
document.getElementById('agg_new_proveedor')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('prov_nombre')?.value.trim();
    const contacto = document.getElementById('prov_contacto')?.value.trim();
    const telefono = document.getElementById('prov_telefono')?.value.trim();
    const correo = document.getElementById('prov_correo')?.value.trim();

    if (!nombre || !contacto || !telefono || !correo) { mostrarToast('Completa todos los campos.', 'warning'); return; }

    // Validar nombre del proveedor (sin números)
    if (/\d/.test(nombre)) {
        mostrarToast('El nombre del proveedor no debe contener números.', 'warning');
        return;
    }

    // Validar contacto (sin números)
    if (/\d/.test(contacto)) {
        mostrarToast('El contacto del proveedor no debe contener números.', 'warning');
        return;
    }

    // Validar teléfono (exactamente 8 números)
    if (!/^\d{8}$/.test(telefono)) {
        mostrarToast('El teléfono debe tener exactamente 8 números.', 'warning');
        return;
    }

    // Validar correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
        mostrarToast('Por favor, ingresa un correo electrónico válido.', 'warning');
        return;
    }

    // Validar proveedor duplicado por nombre
    const normalizedNewName = nombre.toLowerCase().trim();
    const duplicate = (window.proveedoresCache || []).find(p => {
        const isSameName = p.nombre.toLowerCase().trim() === normalizedNewName;
        const isDifferentProvider = supplierRowBeingEdited ? String(p.id_proveedor) !== String(supplierRowBeingEdited) : true;
        return isSameName && isDifferentProvider;
    });
    if (duplicate) {
        mostrarToast('Ya existe un proveedor registrado con ese nombre.', 'warning');
        return;
    }

    let id_sucursal = null;
    let estado = 'Activo';
    if (supplierRowBeingEdited && window.proveedoresCache) {
        const prov = window.proveedoresCache.find(p => String(p.id_proveedor) === String(supplierRowBeingEdited));
        if (prov) {
            estado = prov.estado;
            id_sucursal = prov.id_sucursal;
        }
    }
    if (!id_sucursal) {
        const activeSucursalName = activeSucursal || (currentUser && currentUser.sucursal) || 'Central';
        const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
        id_sucursal = sucursalObj ? sucursalObj.id_sucursal : 1;
    }

    if (supplierRowBeingEdited) {
        const result = await apiPut(`/proveedores/${supplierRowBeingEdited}`, { nombre, contacto, telefono, correo, id_sucursal, estado });
        if (result.error) {
            mostrarToast(result.error, 'danger');
            return;
        }
        if (result.message) mostrarToast('Proveedor modificado.', 'success');
    } else {
        const result = await apiPost('/proveedores', { nombre, contacto, telefono, correo, id_sucursal, estado });
        if (result.error) {
            mostrarToast(result.error, 'danger');
            return;
        }
        if (result.id_proveedor) mostrarToast('Proveedor agregado.', 'success');
    }

    supplierRowBeingEdited = null;
    document.getElementById('btn_guardar_proveedor').textContent = 'AGREGAR NUEVO PROVEEDOR';
    document.getElementById('cancel_edit_proveedor').style.display = 'none';
    ['prov_nombre', 'prov_contacto', 'prov_telefono', 'prov_correo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    await cargarProveedores();
});

document.getElementById('btn_cancelar_proveedor')?.addEventListener('click', (e) => {
    e.preventDefault();
    ['prov_nombre', 'prov_contacto', 'prov_telefono', 'prov_correo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    supplierRowBeingEdited = null;
    document.getElementById('btn_guardar_proveedor').textContent = 'AGREGAR NUEVO PROVEEDOR';
    document.getElementById('cancel_edit_proveedor').style.display = 'none';
});

document.querySelector('#proveedores .tabla_agg tbody')?.addEventListener('click', async (e) => {
    const btnMod = e.target.closest('.btn_modificar_proveedor');
    const btnToggle = e.target.closest('.btn_toggle_proveedor');

    if (btnMod) {
        const tr = btnMod.closest('tr');
        supplierRowBeingEdited = tr.dataset.id;

        document.getElementById('prov_nombre').value = tr.cells[1].textContent.trim();
        document.getElementById('prov_contacto').value = tr.cells[2].textContent.trim();
        document.getElementById('prov_telefono').value = tr.cells[3].textContent.trim();
        document.getElementById('prov_correo').value = tr.cells[4].textContent.trim();

        document.getElementById('btn_guardar_proveedor').textContent = 'GUARDAR CAMBIOS';
        document.getElementById('cancel_edit_proveedor').style.display = 'flex';
        document.querySelector('.header_proveedores')?.scrollIntoView({ behavior: 'smooth' });
    }

    if (btnToggle) {
        const tr = btnToggle.closest('tr');
        const provId = tr.dataset.id;
        const nombreProv = tr.cells[1].textContent.trim();
        const estadoActual = tr.cells[6].textContent.trim();

        let currentRole = 'vendedor';
        if (typeof currentUser !== 'undefined' && currentUser && currentUser.role) {
            currentRole = currentUser.role;
        } else if (typeof activeRole !== 'undefined' && activeRole) {
            currentRole = activeRole;
        } else if (window.activeRole) {
            currentRole = window.activeRole;
        }

        if (estadoActual === 'Activo') {
            if (currentRole === 'vendedor') {
                document.getElementById('inactivar_proveedor_id').value = provId;
                document.getElementById('inactivar_proveedor_motivo').value = '';

                // Cargar administradores en el select
                const selectAdmin = document.getElementById('inactivar_proveedor_admin');
                if (selectAdmin) {
                    selectAdmin.innerHTML = '<option value="">Seleccione un administrador...</option>';
                    try {
                        const usuarios = await apiGet('/usuarios');
                        const admins = usuarios.filter(u => u.estado === 'Activo' && (u.rol === 'Gerente' || u.rol === 'Administrador'));
                        admins.forEach(u => {
                            const opt = document.createElement('option');
                            opt.value = u.id_usuario;
                            opt.textContent = `${u.nombre_completo} (${u.rol})`;
                            selectAdmin.appendChild(opt);
                        });
                    } catch (err) {
                        console.error('Error al cargar admins para inactivar proveedor:', err);
                    }
                }
                mostrarModal('modal_solicitar_inactivar_proveedor');
            } else {
                mostrarConfirmacionEliminar(
                    '¿Desactivar Proveedor?',
                    `¿Estás seguro de que deseas poner al proveedor "${nombreProv}" como Inactivo?`,
                    async () => {
                        const result = await apiPut(`/proveedores/${provId}`, {
                            nombre: tr.cells[1].textContent.trim(),
                            contacto: tr.cells[2].textContent.trim(),
                            telefono: tr.cells[3].textContent.trim(),
                            correo: tr.cells[4].textContent.trim(),
                            estado: 'Inactivo'
                        });
                        if (result.message) {
                            mostrarToast('Proveedor desactivado.', 'success');
                            await cargarProveedores();
                        } else {
                            mostrarToast(result.error || 'Error al desactivar proveedor.', 'danger');
                        }
                    },
                    'Desactivar'
                );
            }
        } else {
            mostrarConfirmacionEliminar(
                '¿Activar Proveedor?',
                `¿Estás seguro de que deseas poner al proveedor "${nombreProv}" como Activo?`,
                async () => {
                    const result = await apiPut(`/proveedores/${provId}`, {
                        nombre: tr.cells[1].textContent.trim(),
                        contacto: tr.cells[2].textContent.trim(),
                        telefono: tr.cells[3].textContent.trim(),
                        correo: tr.cells[4].textContent.trim(),
                        estado: 'Activo'
                    });
                    if (result.message) {
                        mostrarToast('Proveedor activado.', 'success');
                        await cargarProveedores();
                    } else {
                        mostrarToast(result.error || 'Error al activar proveedor.', 'danger');
                    }
                },
                'Activar'
            );
        }
    }
});

// Enviar solicitud de inactivación de proveedor
document.getElementById('form_solicitar_inactivar_proveedor')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provId = document.getElementById('inactivar_proveedor_id').value;
    const motivo = document.getElementById('inactivar_proveedor_motivo').value.trim();
    const id_usuario_admin = document.getElementById('inactivar_proveedor_admin').value;

    if (!motivo) {
        mostrarToast('Por favor, describa el motivo de la inactivación.', 'warning');
        return;
    }

    try {
        const solicitudes = await apiGet('/anulaciones');
        const exists = Array.isArray(solicitudes) ? solicitudes.some(s => {
            return s.estado === 'Pendiente' && s.tipo === 'Proveedor' && String(s.prod_id) === String(provId);
        }) : false;

        if (exists) {
            mostrarToast('Ya existe una solicitud de inactivación en curso para este proveedor.', 'warning');
            return;
        }

        const result = await apiPost('/anulaciones/proveedor', {
            id_proveedor: parseInt(provId),
            motivo: motivo,
            id_usuario_solicitante: currentUser.id_usuario,
            id_usuario_admin: id_usuario_admin ? parseInt(id_usuario_admin) : null
        });

        if (result.id_desactivacion) {
            mostrarToast('Solicitud de inactivación registrada con éxito.', 'success');
            closeMostAggProdu();
            await cargarProveedores();
        } else {
            mostrarToast(result.error || 'Error al registrar la solicitud.', 'danger');
        }
    } catch (err) {
        console.error('Error al enviar solicitud de inactivación:', err);
        mostrarToast('Error al enviar la solicitud.', 'danger');
    }
});

document.getElementById('buscar_proveedor')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const tbody = document.querySelector('#proveedores .tabla_agg tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(row => {
        const name = row.cells[1]?.textContent.toLowerCase() || '';
        row.style.display = name.includes(query) ? '' : 'none';
    });
});

// ============================================================================
// VENTAS - Historial
// ============================================================================
async function cargarHistorialVentas() {
    if (typeof window.cargarVentasRealizadas === 'function') {
        await window.cargarVentasRealizadas();
    }
}

// ============================================================================
// COMPRAS
// ============================================================================
async function cargarCompras() {
    if (typeof window.cargarComprasRealizadas === 'function') {
        window.cargarComprasRealizadas();
    }
}

// ============================================================================
// GASTOS
// ============================================================================
async function cargarGastos() {
    if (typeof window.renderGastos === 'function') {
        window.renderGastos();
    }
}

// ============================================================================
// ANULACIONES
// ============================================================================
async function cargarAnulaciones() {
    if (typeof window.renderSolicitudes === 'function') {
        window.renderSolicitudes();
    }
}

// ============================================================================
// OPERAR
// ============================================================================
function actualizarOpcionesSucursal() {
    const userSelect = document.getElementById('ope_usuario');
    const sucursalSelect = document.getElementById('ope_sucursal');
    if (!userSelect || !sucursalSelect) return;

    const selectedOption = userSelect.selectedOptions[0];
    if (!selectedOption) return;

    const userSucursal = selectedOption.dataset.sucursal;
    const currentVal = sucursalSelect.value;
    
    sucursalSelect.innerHTML = '';

    if (userSucursal === 'Todas' || !userSucursal) {
        const sucursales = window.sucursalesCache && window.sucursalesCache.length > 0 ? window.sucursalesCache : [{ nombre: 'Central' }, { nombre: 'Plaza' }, { nombre: 'Norte' }];
        sucursales.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.nombre;
            opt.textContent = `Sucursal ${s.nombre}`;
            sucursalSelect.appendChild(opt);
        });
        if (Array.from(sucursalSelect.options).some(opt => opt.value === currentVal)) {
            sucursalSelect.value = currentVal;
        }
    } else {
        const opt = document.createElement('option');
        opt.value = userSucursal;
        opt.textContent = `Sucursal ${userSucursal}`;
        sucursalSelect.appendChild(opt);
        sucursalSelect.value = userSucursal;
    }
}

function setupOperar() {
    const userSelect = document.getElementById('ope_usuario');
    if (!userSelect) return;
    
    userSelect.removeEventListener('change', actualizarOpcionesSucursal);
    userSelect.addEventListener('change', actualizarOpcionesSucursal);
    
    cargarUsuariosOperar();
}

async function cargarUsuariosOperar() {
    const userSelect = document.getElementById('ope_usuario');
    if (!userSelect) return;

    try {
        const usuarios = await apiGet('/usuarios');
        userSelect.innerHTML = '';

        const role = currentUser ? currentUser.role : 'gerente';

        if (role === 'vendedor') {
            const opt = document.createElement('option');
            opt.value = currentUser.name;
            opt.textContent = `${currentUser.name} (Vendedor)`;
            opt.dataset.rol = 'vendedor';
            opt.dataset.sucursal = currentUser.sucursal;
            userSelect.appendChild(opt);
            userSelect.disabled = true;
            actualizarOpcionesSucursal();
            return;
        }

        userSelect.disabled = false;

        usuarios.filter(u => u.estado === 'Activo').forEach(u => {
            if (role === 'admin') {
                const uRol = u.rol.toLowerCase().includes('gerente') ? 'gerente' : u.rol.toLowerCase().includes('admin') ? 'admin' : 'vendedor';
                if (uRol !== 'vendedor' && u.nombre_completo !== currentUser.name) return;
                if (u.sucursal !== currentUser.sucursal && u.nombre_completo !== currentUser.name) return;
            }

            const opt = document.createElement('option');
            opt.value = u.nombre_completo;
            opt.textContent = `${u.nombre_completo} (${u.rol} - ${u.sucursal})`;
            opt.dataset.rol = u.rol.toLowerCase().includes('gerente') ? 'gerente' : u.rol.toLowerCase().includes('admin') ? 'admin' : 'vendedor';
            opt.dataset.sucursal = u.sucursal;
            userSelect.appendChild(opt);
        });

        if (userSelect.options.length > 0) {
            userSelect.selectedIndex = 0;
        }
        actualizarOpcionesSucursal();
    } catch (e) { 
        console.error('Error cargando usuarios para operar:', e); 
    }
}

document.getElementById('btn_aplicar_operar')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const userSelect = document.getElementById('ope_usuario');
    const sucursalSelect = document.getElementById('ope_sucursal');
    if (!userSelect || !sucursalSelect) return;

    const selectedUser = userSelect.value;
    const selectedSucursal = sucursalSelect.value;
    const selectedOption = userSelect.selectedOptions[0];
    const selectedRole = selectedOption?.dataset.rol || 'vendedor';

    // Validar si hay arqueo de caja abierto para evitar dejar la caja huérfana
    if (window.arqueoActivo) {
        if (selectedUser !== activeOperator || selectedSucursal !== activeSucursal) {
            alert(" No puedes cambiar de usuario o sucursal mientras tengas la caja de arqueo diario abierta.\n\nPor favor, realiza el arqueo y cierra la caja actual en la sección de operaciones antes de cambiar la configuración.");
            if (typeof mostrarToast === 'function') {
                mostrarToast("Debe cerrar la caja de arqueo diario activa primero.", "danger");
            }
            // Restablecer selectores en la interfaz a los valores activos actuales
            userSelect.value = activeOperator;
            sucursalSelect.value = activeSucursal;
            return;
        }
    }

    activeOperator = selectedUser;
    activeSucursal = selectedSucursal;
    activeRole = selectedRole;
    sessionStorage.setItem('gerenteConfigurado', 'true');

    await cargarProductosPorSucursal();
    renderizarTodoProductos();
    renderProductosCheckout();

    const selectSucur = document.getElementById('select_sucur');
    if (selectSucur && activeSucursal) {
        selectSucur.value = activeSucursal;
    }

    const movOrigen = document.getElementById('mov_sucursal_origen');
    if (movOrigen && activeSucursal) {
        movOrigen.value = activeSucursal;
    }

    const now = new Date();
    sessionStartTime = formatDateTime(now);

    // Actualizar UI
    const headerLabel = document.querySelector('.header .box_comp label');
    const headerRol = document.querySelector('.header .Cont_usuario .rol');
    if (headerLabel) headerLabel.textContent = activeOperator;
    if (headerRol) { headerRol.textContent = activeRole; aplicarEstiloRol(headerRol, activeRole); }

    document.getElementById('card_operar_usuario').textContent = activeOperator;
    const rolLabel = activeRole === 'gerente' ? 'Gerente' : activeRole === 'admin' ? 'Administrador' : 'Vendedor';
    document.getElementById('card_operar_rol').textContent = rolLabel;
    document.getElementById('card_operar_sucursal').textContent = activeSucursal;
    document.getElementById('card_operar_inicio').textContent = sessionStartTime;

    // Refrescar el estado de caja para la nueva sucursal
    await verificarArqueoActivo();

    // El historial de compras es independiente por sucursal
    if (typeof window.cargarComprasRealizadas === 'function') window.cargarComprasRealizadas();

    // Log
    apiPost('/reportes/log', {
        id_usuario: currentUser?.id_usuario,
        nombre_usuario: activeOperator,
        nombre_sucursal: activeSucursal,
        accion: `Cambio de operador a ${activeOperator} en ${activeSucursal}`,
        modulo: 'Operar'
    });

    mostrarToast(`Operando en ${activeSucursal} como ${activeOperator} (${rolLabel})`, 'success');
});

// Tabs de productos
document.querySelectorAll('.tab_prod_btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab_prod_btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('tab_lista_productos').style.display = tab === 'lista-productos' ? 'block' : 'none';
        const preciosTab = document.getElementById('tab_precios_agrupacion');
        if (preciosTab) preciosTab.style.display = tab === 'precios-agrupacion' ? 'block' : 'none';
    });
});

// Cargar productos (función global)
async function cargarProductos() {
    await cargarDatosIniciales();
}

// ============================================================================
// DARK MODE (simple toggle)
// ============================================================================
const darkModeToggle = document.getElementById('dark-mode-toggle');
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });
}

// ============================================================================
// LÓGICA DE PRECIOS POR AGRUPACIÓN (POR MAYOR)
// ============================================================================
let preciosConfigurados = {};
window.preciosConfigurados = preciosConfigurados;

document.addEventListener("DOMContentLoaded", () => {
    // 1. GESTIÓN DE PESTAÑAS (TABS)
    const tabButtons = document.querySelectorAll(".tab_prod_btn");
    const tabLista = document.getElementById("tab_lista_productos");
    const tabPrecios = document.getElementById("tab_precios_agrupacion");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            // Remover clase activa de todos los botones
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const tab = btn.dataset.tab;
            if (tab === "lista-productos") {
                if (tabLista) tabLista.style.display = "block";
                if (tabPrecios) tabPrecios.style.display = "none";
            } else {
                if (tabLista) tabLista.style.display = "none";
                if (tabPrecios) tabPrecios.style.display = "block";
            }
        });
    });

    // 2. CONFIGURADOR DE PRECIOS POR PRODUCTO
    const selectProd = document.getElementById("select_prod_agrupacion");
    const buscarProdInput = document.getElementById("buscar_prod_agrupacion");
    const resultadosBusqueda = document.getElementById("resultados_busqueda_agrupacion");
    const configContainer = document.getElementById("agrupaciones_config_container");
    const listContainer = document.getElementById("lista_agrupaciones_inputs");

    const iniciarAutocompletadoAgrupacion = () => {
        if (!buscarProdInput || !resultadosBusqueda) return;

        // Filtrar y mostrar resultados mientras escribe
        buscarProdInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                resultadosBusqueda.style.display = "none";
                selectProd.value = "";
                selectProd.dispatchEvent(new Event("change"));
                return;
            }

            const productos = window.productosInventario || [];
            const filtrados = productos.filter(p =>
                p.name.toLowerCase().includes(query) ||
                p.category.toLowerCase().includes(query)
            );

            if (filtrados.length === 0) {
                resultadosBusqueda.innerHTML = `<div class="autocomplete-item-no-results">No se encontraron productos</div>`;
                resultadosBusqueda.style.display = "block";
                return;
            }

            resultadosBusqueda.innerHTML = filtrados.map(prod => `
                <div class="autocomplete-item" data-id="${prod.id}" data-name="${prod.name}">
                    <strong>${prod.name}</strong> <span style="font-size: 11px; color: #64748b; margin-left: 8px;">(${prod.category})</span>
                </div>
            `).join("");

            resultadosBusqueda.style.display = "block";

            // Vincular evento de clic a las opciones filtradas
            resultadosBusqueda.querySelectorAll(".autocomplete-item").forEach(item => {
                item.addEventListener("click", () => {
                    const id = item.dataset.id;
                    const name = item.dataset.name;

                    buscarProdInput.value = name;
                    selectProd.value = id;
                    resultadosBusqueda.style.display = "none";

                    selectProd.dispatchEvent(new Event("change"));
                });
            });
        });

        // Mostrar lista completa al hacer click/focus
        buscarProdInput.addEventListener("focus", () => {
            const query = buscarProdInput.value.toLowerCase().trim();
            const productos = window.productosInventario || [];
            const filtrados = query ?
                productos.filter(p => p.name.toLowerCase().includes(query)) :
                productos;

            if (filtrados.length === 0) {
                resultadosBusqueda.innerHTML = `<div class="autocomplete-item-no-results">No se encontraron productos</div>`;
                resultadosBusqueda.style.display = "block";
                return;
            }

            resultadosBusqueda.innerHTML = filtrados.map(prod => `
                <div class="autocomplete-item" data-id="${prod.id}" data-name="${prod.name}">
                    <strong>${prod.name}</strong> <span style="font-size: 11px; color: #64748b; margin-left: 8px;">(${prod.category})</span>
                </div>
            `).join("");

            resultadosBusqueda.style.display = "block";

            // Vincular evento de clic a las opciones
            resultadosBusqueda.querySelectorAll(".autocomplete-item").forEach(item => {
                item.addEventListener("click", () => {
                    const id = item.dataset.id;
                    const name = item.dataset.name;

                    buscarProdInput.value = name;
                    selectProd.value = id;
                    resultadosBusqueda.style.display = "none";

                    selectProd.dispatchEvent(new Event("change"));
                });
            });
        });

        // Cerrar resultados al hacer click fuera
        document.addEventListener("click", (e) => {
            if (!buscarProdInput.contains(e.target) && !resultadosBusqueda.contains(e.target)) {
                resultadosBusqueda.style.display = "none";
            }
        });
    };

    window.actualizarDropdownPreciosAgrupacion = function () {
        if (!selectProd) return;
        const valGuardada = selectProd.value;

        if (window.productosInventario && valGuardada) {
            const prodExistente = window.productosInventario.find(p => p.id === valGuardada);
            if (prodExistente) {
                if (buscarProdInput) buscarProdInput.value = prodExistente.name;
                selectProd.value = valGuardada;
                selectProd.dispatchEvent(new Event("change"));
                return;
            }
        }

        if (buscarProdInput) buscarProdInput.value = "";
        selectProd.value = "";
        configContainer.style.display = "none";
        renderResumenPreciosTabla();
    };

    // Inicializar autocompletado
    iniciarAutocompletadoAgrupacion();

    selectProd?.addEventListener("change", async (e) => {
        const prodId = e.target.value;
        if (!prodId) {
            configContainer.style.display = "none";
            renderResumenPreciosTabla();
            return;
        }

        const productObj = window.productosInventario.find(p => p.id === prodId);
        if (!productObj) {
            configContainer.style.display = "none";
            renderResumenPreciosTabla();
            return;
        }

        const basePrice = productObj.price;

        // Determinar qué agrupaciones aplican al producto según su configuración
        let allowedGroupings = Object.keys(productObj.groupings).filter(g => g !== "Unidad");

        if (allowedGroupings.length === 0) {
            listContainer.innerHTML = `<p style="color: #64748b; font-size: 0.875rem; padding: 12px; text-align: center;">Este producto no tiene agrupaciones por volumen disponibles.</p>`;
            configContainer.style.display = "block";
            return;
        }

        let dbPrecios = [];
        try {
            dbPrecios = await apiGet(`/productos/${prodId}/precios-agrupacion`);
        } catch (err) {
            console.error("Error al obtener precios por agrupacion:", err);
        }

        // Generar las tarjetas de configuración para cada agrupación
        listContainer.innerHTML = allowedGroupings.map(groupName => {
            const equiv = productObj.groupings[groupName] || 6;
            const normalPrice = basePrice * equiv;

            // Buscar si ya hay un descuento o precio promocional configurado; si no, por defecto 10%
            const configExistente = dbPrecios.find(c => c.agrupacion === groupName);
            const pctDesc = configExistente ? parseFloat(configExistente.descuento_porcentaje) : 10.0;
            const promoPrice = configExistente && configExistente.precio !== null ? parseFloat(configExistente.precio) : (normalPrice * (1 - (pctDesc / 100)));
            const ahorro = normalPrice - promoPrice;

            return `
                <div class="agrupacion_config_item" data-group-name="${groupName}" data-equiv="${equiv}">
                    <div class="agrup_item_header">
                        <span style="font-weight: 700; color: #0f172a;">${groupName}</span>
                        <span class="agrup_equiv_badge">${equiv} Unidades</span>
                    </div>
                    <div class="agrup_pricing_fields" style="display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 12px;">
                        <div class="form_group">
                            <label>Precio Normal Sugerido</label>
                            <input type="text" value="C$ ${normalPrice.toFixed(0)}" readonly style="background: #e2e8f0; font-weight: bold; color: #475569; border: 1px solid #cbd5e1; height: 38px; border-radius: 6px; padding: 0 10px; font-size: 0.85rem; outline: none;">
                        </div>
                        <div class="form_group">
                            <label>Descuento por mayor (%)</label>
                            <input type="number" class="input_discount_pct" value="${pctDesc.toFixed(1)}" min="0" max="99" step="0.5" data-normal-price="${normalPrice}" oninput="calculatePriceFromDiscount(this)" style="border: 1px solid #cbd5e1; font-weight: bold; color: #2563eb; height: 38px; border-radius: 6px; padding: 0 10px; font-size: 0.85rem; outline: none;">
                        </div>
                        <div class="form_group">
                            <label>Precio Especial (Calculado)</label>
                            <input type="text" class="input_promo_price" value="C$ ${promoPrice.toFixed(0)}" readonly style="background: #f0fdf4; border: 1px solid #bbf7d0; font-weight: bold; color: #166534; height: 38px; border-radius: 6px; padding: 0 10px; font-size: 0.85rem; outline: none;">
                        </div>
                    </div>
                    <div class="discount_indicator" style="font-size: 0.75rem; font-weight: 600; color: #166534; margin-top: 6px;">
                        <span>Ahorro de C$ ${ahorro.toFixed(0)} por agrupación</span>
                    </div>
                </div>
            `;
        }).join('');

        configContainer.style.display = "block";
        renderResumenPreciosTabla();
    });

    // 3. GUARDAR CAMBIOS Y ACTUALIZAR TABLA DE RESUMEN
    const btnGuardar = document.getElementById("btn_guardar_precios_agrupacion");

    const renderResumenPreciosTabla = async () => {
        const listBody = document.getElementById("precios_detalles_lista");
        const vacioEl = document.getElementById("precios_detalles_vacio");
        const contenidoEl = document.getElementById("precios_detalles_contenido");
        const prodNombreEl = document.getElementById("precios_detalles_prod_nombre");
        const prodCatEl = document.getElementById("precios_detalles_prod_cat");

        if (!listBody) return;

        const prodId = selectProd?.value;
        if (!prodId) {
            if (vacioEl) vacioEl.style.display = "flex";
            if (contenidoEl) contenidoEl.style.display = "none";
            return;
        }

        const productObj = window.productosInventario?.find(p => String(p.id) === String(prodId));
        if (!productObj) {
            if (vacioEl) vacioEl.style.display = "flex";
            if (contenidoEl) contenidoEl.style.display = "none";
            return;
        }

        if (vacioEl) vacioEl.style.display = "none";
        if (contenidoEl) contenidoEl.style.display = "block";
        if (prodNombreEl) prodNombreEl.textContent = productObj.name;
        if (prodCatEl) prodCatEl.textContent = productObj.category;

        listBody.innerHTML = "";

        // Check if there are live input cards rendered on the left
        const liveItems = document.querySelectorAll("#lista_agrupaciones_inputs .agrupacion_config_item");
        if (liveItems.length > 0) {
            let cardsHtml = "";
            liveItems.forEach(item => {
                const groupName = item.dataset.groupName;
                const equiv = parseInt(item.dataset.equiv) || 1;
                const basePrice = productObj.price;
                const normalPrice = basePrice * equiv;

                const pctDescInput = item.querySelector(".input_discount_pct");
                const pctDesc = pctDescInput ? (parseFloat(pctDescInput.value) || 0) : 0;

                const promoPrice = normalPrice * (1 - (pctDesc / 100));
                const ahorro = normalPrice - promoPrice;

                cardsHtml += `
                    <div style="background: #f8fafc; border: 1px solid var(--color-borde); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 0.95rem; color: var(--color-secundario);">
                            <div>
                                <span style="color: var(--color-principal); font-weight: 800;">${groupName}</span>
                                <span style="font-size: 0.75rem; color: var(--color-gris); font-weight: 600; margin-left: 6px;">(${equiv} ud${equiv > 1 ? 's' : ''})</span>
                            </div>
                            <span style="background: rgba(34, 197, 94, 0.15); color: #166534; font-weight: 800; font-size: 0.75rem; padding: 3px 8px; border-radius: 69px; letter-spacing: 0.5px; text-transform: uppercase;">
                                ${pctDesc.toFixed(1)}% desc.
                            </span>
                        </div>
                        
                        <div style="background: #ffffff; border: 1px dashed var(--color-borde); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                                <span style="color: #64748b; font-weight: 500;">Precio Normal Sugerido:</span>
                                <strong style="color: #475569; font-weight: 700;">C$ ${normalPrice.toFixed(0)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                                <span style="color: #64748b; font-weight: 500;">Precio Especial:</span>
                                <strong style="color: #166534; font-weight: 800; font-size: 0.95rem;">C$ ${promoPrice.toFixed(0)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-top: 1px solid #f1f5f9; padding-top: 6px; margin-top: 2px;">
                                <span style="color: #64748b; font-weight: 600;">Ahorro por Agrupación:</span>
                                <strong style="color: #10b981; font-weight: 800;">C$ ${ahorro.toFixed(0)}</strong>
                            </div>
                        </div>
                    </div>
                `;
            });
            listBody.innerHTML = cardsHtml;
            return;
        }

        try {
            const dbPrecios = await apiGet(`/productos/${prodId}/precios-agrupacion`);
            let allowedGroupings = Object.keys(productObj.groupings).filter(g => g !== "Unidad");

            if (allowedGroupings.length === 0 || dbPrecios.length === 0) {
                listBody.innerHTML = `
                    <div style="text-align: center; color: #64748b; padding: 30px 20px; font-weight: 600; font-size: 0.9rem;">
                        Sin precios especiales configurados.
                    </div>
                `;
                return;
            }

            listBody.innerHTML = dbPrecios.map(item => {
                const groupName = item.agrupacion;
                const equiv = productObj.groupings ? (productObj.groupings[groupName] || 1) : 1;
                const basePrice = productObj.price;
                const normalPrice = basePrice * equiv;
                const promoPrice = parseFloat(item.precio);
                const pctDesc = parseFloat(item.descuento_porcentaje);
                const ahorro = normalPrice - promoPrice;

                return `
                    <div style="background: #f8fafc; border: 1px solid var(--color-borde); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 0.95rem; color: var(--color-secundario);">
                            <div>
                                <span style="color: var(--color-principal); font-weight: 800;">${groupName}</span>
                                <span style="font-size: 0.75rem; color: var(--color-gris); font-weight: 600; margin-left: 6px;">(${equiv} ud${equiv > 1 ? 's' : ''})</span>
                            </div>
                            <span style="background: rgba(34, 197, 94, 0.15); color: #166534; font-weight: 800; font-size: 0.75rem; padding: 3px 8px; border-radius: 69px; letter-spacing: 0.5px; text-transform: uppercase;">
                                ${pctDesc.toFixed(1)}% desc.
                            </span>
                        </div>
                        
                        <div style="background: #ffffff; border: 1px dashed var(--color-borde); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                                <span style="color: #64748b; font-weight: 500;">Precio Normal Sugerido:</span>
                                <strong style="color: #475569; font-weight: 700;">C$ ${normalPrice.toFixed(0)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                                <span style="color: #64748b; font-weight: 500;">Precio Especial:</span>
                                <strong style="color: #166534; font-weight: 800; font-size: 0.95rem;">C$ ${promoPrice.toFixed(0)}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; border-top: 1px solid #f1f5f9; padding-top: 6px; margin-top: 2px;">
                                <span style="color: #64748b; font-weight: 600;">Ahorro por Agrupación:</span>
                                <strong style="color: #10b981; font-weight: 800;">C$ ${ahorro.toFixed(0)}</strong>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");
        } catch (err) {
            console.error("Error al renderizar tabla de resumen de precios:", err);
            listBody.innerHTML = `
                <div style="text-align: center; color: #ef4444; padding: 30px 20px; font-weight: 600; font-size: 0.9rem;">
                    Error al cargar datos.
                </div>
            `;
        }
    };

    // Expose render function globally so it can be called from calculatePriceFromDiscount
    window.renderResumenPreciosTabla = renderResumenPreciosTabla;

    // Render summary table initially
    setTimeout(renderResumenPreciosTabla, 100);

    btnGuardar?.addEventListener("click", async () => {
        const prodId = selectProd.value;
        if (!prodId) return;

        const productObj = window.productosInventario.find(p => p.id === prodId);
        if (!productObj) return;

        const prodName = productObj.name;
        const items = listContainer.querySelectorAll(".agrupacion_config_item");

        try {
            for (const item of items) {
                const groupName = item.dataset.groupName;
                const equiv = parseInt(item.dataset.equiv);
                const basePrice = productObj.price;
                const normalPrice = basePrice * equiv;

                const pctDesc = parseFloat(item.querySelector(".input_discount_pct").value) || 0;
                const promoValText = item.querySelector(".input_promo_price").value;
                const promoPrice = parseFloat(promoValText.replace("C$", "").trim()) || normalPrice;

                const detail = productObj.groupingDetails[groupName];
                if (detail) {
                    await apiPost(`/productos/${prodId}/precios-agrupacion`, {
                        id_agrupacion: detail.id_agrupacion,
                        precio: promoPrice,
                        descuento_porcentaje: pctDesc
                    });
                }
            }

            // Limpiar selección de producto
            if (buscarProdInput) buscarProdInput.value = "";
            selectProd.value = "";
            configContainer.style.display = "none";

            // Volver a renderizar la tabla de resumen (para vaciarla)
            await renderResumenPreciosTabla();

            alert(`¡Precios al por mayor guardados exitosamente para ${prodName}!`);
        } catch (err) {
            console.error("Error al guardar precios agrupados:", err);
            alert("Error de conexión al guardar precios en el servidor.");
        }
    });
});

// Función global que calcula el precio promocional en tiempo real basándose en el porcentaje ingresado
window.calculatePriceFromDiscount = function (input) {
    const normalPrice = parseFloat(input.dataset.normalPrice);
    const pctDesc = parseFloat(input.value) || 0;
    const card = input.closest(".agrupacion_config_item");
    const promoInput = card.querySelector(".input_promo_price");
    const indicator = card.querySelector(".discount_indicator");

    if (pctDesc < 0 || pctDesc >= 100) {
        promoInput.value = "C$ " + normalPrice.toFixed(0);
        indicator.innerHTML = `<span style="color: #dc2626; font-weight: bold;">Descuento no válido (debe ser entre 0% y 99%)</span>`;
        return;
    }

    const promoPrice = normalPrice * (1 - (pctDesc / 100));
    const ahorro = normalPrice - promoPrice;

    promoInput.value = `C$ ${promoPrice.toFixed(0)}`;
    indicator.innerHTML = `<span>Ahorro de C$ ${ahorro.toFixed(0)} por agrupación</span>`;

    // Update the right-side summary card in real-time as the user types/changes the discount
    if (typeof window.renderResumenPreciosTabla === "function") {
        window.renderResumenPreciosTabla();
    }
};

// ============================================================================
// LÓGICA DE ARQUEO DE CAJA DIARIO
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Configurar listeners para abrir caja
    document.getElementById("btn_pv_abrir_caja")?.addEventListener("click", () => {
        const val = parseFloat(document.getElementById("pv_monto_inicial")?.value);
        if (typeof window.abrirCaja === 'function') window.abrirCaja(val);
    });
    document.getElementById("btn_gastos_abrir_caja")?.addEventListener("click", () => {
        const val = parseFloat(document.getElementById("gastos_monto_inicial")?.value);
        if (typeof window.abrirCaja === 'function') window.abrirCaja(val);
    });
    document.getElementById("btn_arqueo_abrir_caja")?.addEventListener("click", () => {
        const val = parseFloat(document.getElementById("arqueo_monto_inicial_open")?.value);
        if (typeof window.abrirCaja === 'function') window.abrirCaja(val);
    });

    // 1. GESTIÓN DE PESTAÑAS (TABS) PARA VENTAS / ARQUEO
    const tabButtons = document.querySelectorAll(".tab_ventas_btn");
    const tabHistorial = document.getElementById("tab_historial_ventas");
    const tabArqueo = document.getElementById("tab_arqueo_caja");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const tab = btn.dataset.tab;
            if (tab === "historial-ventas") {
                if (tabHistorial) tabHistorial.style.display = "block";
                if (tabArqueo) tabArqueo.style.display = "none";

                if (typeof cargarVentasRealizadas === "function") {
                    cargarVentasRealizadas();
                }
            } else {
                if (tabHistorial) tabHistorial.style.display = "none";
                if (tabArqueo) tabArqueo.style.display = "block";

                // Recalcular ventas en efectivo, gastos aprobados e historial al abrir arqueo
                if (typeof cargarVentasRealizadas === "function") {
                    cargarVentasRealizadas().then(() => {
                        if (typeof cargarGastosAprobados === "function") cargarGastosAprobados();
                        if (typeof cargarHistorialArqueos === "function") cargarHistorialArqueos();
                    });
                }
            }
        });
    });

    // 2. FILTRAR VENTAS POR MÉTODO DE PAGO
    const selectPago = document.getElementById("Selec_pago");
    const tablaVentas = document.getElementById("tabla_ventas_realizadas");

    selectPago?.addEventListener("change", () => {
        const metodo = selectPago.value;
        const rows = tablaVentas?.querySelectorAll("tbody tr");
        if (!rows) return;

        rows.forEach(row => {
            const pagoAttr = row.getAttribute("data-pago");
            if (!metodo || pagoAttr === metodo) {
                row.style.display = "";
            } else {
                row.style.display = "none";
            }
        });
    });

    const filtroVentas = document.getElementById("filtro_fecha_ventas");
    if (filtroVentas) {
        filtroVentas.value = getLocalDateString();
        filtroVentas.addEventListener("change", () => {
            if (typeof cargarVentasRealizadas === "function") cargarVentasRealizadas();
        });
    }

    const filtroArqueo = document.getElementById("filtro_fecha_arqueo");
    if (filtroArqueo) {
        filtroArqueo.value = getLocalDateString();
        filtroArqueo.disabled = true;
        filtroArqueo.addEventListener("change", () => {
            if (typeof cargarVentasRealizadas === "function") {
                cargarVentasRealizadas().then(() => {
                    if (typeof cargarGastosAprobados === "function") cargarGastosAprobados();
                });
            }
        });
    }

    // 3. LÓGICA DE ARQUEO DE CAJA DIARIO
    const inputMontoInicial = document.getElementById("arq_monto_inicial");
    const displayMontoInicial = document.getElementById("arq_monto_inicial_disp");
    const displayVentasEfectivo = document.getElementById("arq_ventas_efectivo");
    const displayEsperado = document.getElementById("arq_efectivo_esperado");
    const displayContado = document.getElementById("arq_efectivo_contado");
    const resultBadgeContainer = document.getElementById("arq_resultado_badge");
    const denominacionInputs = document.querySelectorAll(".denominacion_input");
    const arqObservacion = document.getElementById("arq_observacion");
    const btnGuardarArqueo = document.getElementById("btn_guardar_arqueo");
    const btnImprimirArqueo = document.getElementById("btn_imprimir_arqueo");

    let totalVentasEfectivo = 0.00;
    window.totalGastosAprobados = 0.00;

    async function cargarVentasRealizadas() {
        const tbody = document.querySelector("#tabla_ventas_realizadas tbody");
        if (!tbody) return;

        try {
            const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
            const currentOp = activeOperator || document.getElementById('card_operar_usuario')?.textContent || '';
            const tabArqueo = document.getElementById("tab_arqueo_caja");
            const isArqueoActive = tabArqueo && tabArqueo.style.display !== "none";
            const filtroVentas = document.getElementById("filtro_fecha_ventas");
            const filtroArqueo = document.getElementById("filtro_fecha_arqueo");

            let fechaSeleccionada = getLocalDateString();
            if (isArqueoActive && filtroArqueo && filtroArqueo.value) {
                fechaSeleccionada = filtroArqueo.value;
            } else if (!isArqueoActive && filtroVentas && filtroVentas.value) {
                fechaSeleccionada = filtroVentas.value;
            }

            let ventas;
            if (isArqueoActive) {
                if (window.arqueoActivo) {
                    ventas = await apiGet(`/ventas?id_arqueo=${window.arqueoActivo.id_arqueo}`);
                } else {
                    ventas = [];
                }
            } else {
                ventas = await apiGet(`/ventas?sucursal=${activeSucursalName}&fecha_inicio=${fechaSeleccionada}&fecha_fin=${fechaSeleccionada}`);
            }

            // Filter sales by selected operator, sucursal and selected date (if not active arqueo)
            const filteredVentas = ventas.filter(venta => {
                const matchesSucursal = String(venta.sucursal).toLowerCase().trim() === activeSucursalName.toLowerCase().trim();
                const matchesOperator = currentOp ? (String(venta.vendedor).toLowerCase().trim() === currentOp.toLowerCase().trim()) : true;
                const matchesDate = isArqueoActive ? true : (getCleanLocalDate(venta.fecha) === fechaSeleccionada);
                return matchesSucursal && matchesOperator && matchesDate;
            });

            if (filteredVentas.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748b; padding: 24px; font-weight: 500;">
                            No hay ventas registradas para ${currentOp} en la sucursal ${activeSucursalName}.
                        </td>
                    </tr>
                `;
                recalcularVentasEfectivo();
                calcularCuadre();
                return;
            }

            tbody.innerHTML = filteredVentas.map(venta => {
                const estado = venta.estado || "Completada";
                const isAnulada = (estado === "Anulada");
                const strikeStyle = isAnulada ? "text-decoration: line-through; opacity: 0.6;" : "";

                const totalVal = `C$ ${(parseFloat(venta.total) || 0).toFixed(2)}`;

                let badgeHTML = "";
                if (isAnulada) {
                    badgeHTML = `<span style="background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">Anulada</span>`;
                }

                const fechaFormateada = venta.fecha ? getCleanLocalDate(venta.fecha) : '';

                return `
                    <tr data-pago="${venta.metodo_pago}" data-status="${estado}" style="${strikeStyle}">
                        <td><strong>${venta.codigo_venta || venta.id_venta}</strong></td>
                        <td>${fechaFormateada}</td>
                        <td style="color: ${isAnulada ? '#94a3b8' : 'green'}; font-weight: bold;">${totalVal}${badgeHTML}</td>
                        <td>${venta.metodo_pago}</td>
                        <td>${venta.vendedor}</td>
                        <td>
                            <button class="btn_observar_v" onclick="window.mostrarDetallesVenta('${venta.id_venta}')">Observar venta</button>
                        </td>
                    </tr>
                `;
            }).join("");

            recalcularVentasEfectivo();
            calcularCuadre();
        } catch (err) {
            console.error("Error al cargar ventas realizadas:", err);
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">Error al cargar ventas desde el servidor.</td></tr>`;
        }
    }
    window.cargarVentasRealizadas = cargarVentasRealizadas;

    // Función para calcular dinámicamente las ventas en efectivo del día basándose en la tabla de ventas
    function recalcularVentasEfectivo() {
        const rows = tablaVentas?.querySelectorAll("tbody tr");
        if (!rows) return;

        let total = 0;
        rows.forEach(row => {
            const pagoAttr = row.getAttribute("data-pago");
            const statusAttr = row.getAttribute("data-status");
            if (statusAttr === "Anulada") return;

            if (pagoAttr === "Efectivo") {
                const amountCell = row.cells[2];
                if (amountCell) {
                    const amountText = amountCell.textContent.replace("Anulada", "").replace("C$", "").replace(/,/g, "").trim();
                    const amount = parseFloat(amountText) || 0;
                    total += amount;
                }
            }
        });

        totalVentasEfectivo = total;
        if (displayVentasEfectivo) {
            displayVentasEfectivo.textContent = `C$ ${totalVentasEfectivo.toFixed(2)}`;
        }

        // Actualizar también el KPI del encabezado de ventas
        const kpiMonto = document.getElementById("ventas_hoy_monto");
        if (kpiMonto) {
            kpiMonto.textContent = `C$ ${totalVentasEfectivo.toFixed(2)}`;
        }
        const kpiCant = document.getElementById("ventas_hoy_cant");
        if (kpiCant) {
            const cashRowsCount = Array.from(rows).filter(r => r.getAttribute("data-pago") === "Efectivo" && r.getAttribute("data-status") !== "Anulada").length;
            kpiCant.textContent = `${cashRowsCount} Venta${cashRowsCount !== 1 ? 's' : ''} realizada${cashRowsCount !== 1 ? 's' : ''}`;
        }
    }
    window.recalcularVentasEfectivo = recalcularVentasEfectivo;

    async function cargarGastosAprobados() {
        try {
            const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
            let approvedGastos;
            if (window.arqueoActivo) {
                approvedGastos = await apiGet(`/gastos?id_arqueo=${window.arqueoActivo.id_arqueo}&estado=Aprobado`);
            } else {
                approvedGastos = [];
            }
            window.totalGastosAprobados = approvedGastos.reduce((sum, g) => sum + (parseFloat(g.monto) || 0), 0);
            calcularCuadre();
        } catch (err) {
            console.error("Error al cargar gastos aprobados:", err);
        }
    }
    window.cargarGastosAprobados = cargarGastosAprobados;

    function calcularCuadre() {
        const inicial = parseFloat(inputMontoInicial?.value) || 0;

        if (displayMontoInicial) {
            displayMontoInicial.textContent = `C$ ${inicial.toFixed(2)}`;
        }

        const totalGastosAprobados = window.totalGastosAprobados || 0;

        const displayGastosAprobados = document.getElementById("arq_gastos_aprobados");
        if (displayGastosAprobados) {
            displayGastosAprobados.textContent = `C$ ${totalGastosAprobados.toFixed(2)}`;
        }

        const esperado = inicial + totalVentasEfectivo - totalGastosAprobados;
        if (displayEsperado) {
            displayEsperado.textContent = `C$ ${esperado.toFixed(2)}`;
        }

        let contado = 0;
        denominacionInputs.forEach(input => {
            const valorDenom = parseFloat(input.dataset.value) || 0;
            const cantidad = parseInt(input.value) || 0;
            contado += valorDenom * cantidad;
        });

        if (displayContado) {
            displayContado.textContent = `C$ ${contado.toFixed(2)}`;
        }

        const diferencia = contado - esperado;

        if (resultBadgeContainer) {
            const haIngresadoDatos = Array.from(denominacionInputs).some(i => i.value && parseInt(i.value) > 0);

            if (!haIngresadoDatos) {
                resultBadgeContainer.innerHTML = `<span class="badge_cuadre neutral">Sin Conteo</span>`;
            } else if (Math.abs(diferencia) < 0.01) {
                resultBadgeContainer.innerHTML = `<span class="badge_cuadre success">Caja Cuadrada (C$ 0.00)</span>`;
            } else if (diferencia < 0) {
                resultBadgeContainer.innerHTML = `<span class="badge_cuadre danger">Faltante (-C$ ${Math.abs(diferencia).toFixed(2)})</span>`;
            } else {
                resultBadgeContainer.innerHTML = `<span class="badge_cuadre warning">Sobrante (+C$ ${diferencia.toFixed(2)})</span>`;
            }
        }
    }
    window.calcularCuadre = calcularCuadre;

    // Vincular eventos de entrada de datos
    inputMontoInicial?.addEventListener("input", calcularCuadre);
    denominacionInputs.forEach(input => {
        input.addEventListener("input", calcularCuadre);
    });

    // Guardar Arqueo de Caja
    btnGuardarArqueo?.addEventListener("click", async () => {
        const inicial = parseFloat(inputMontoInicial?.value) || 0;
        const totalGastosAprobados = window.totalGastosAprobados || 0;
        const esperado = inicial + totalVentasEfectivo - totalGastosAprobados;

        let contado = 0;
        const denominaciones = [];
        denominacionInputs.forEach(input => {
            const valorDenom = parseFloat(input.dataset.value) || 0;
            const cantidad = parseInt(input.value) || 0;
            contado += valorDenom * cantidad;
            if (cantidad > 0) {
                denominaciones.push({
                    denominacion: valorDenom,
                    cantidad: cantidad
                });
            }
        });

        const haIngresadoDatos = Array.from(denominacionInputs).some(i => i.value && parseInt(i.value) > 0);

        if (!haIngresadoDatos) {
            alert("Por favor, realice el recuento físico de efectivo introduciendo valores en las denominaciones antes de guardar.");
            return;
        }

        const userId = window.currentUser?.id_usuario || 1;
        const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
        const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;
        const observaciones = arqObservacion?.value.trim() || "";

        const filtroArqueo = document.getElementById("filtro_fecha_arqueo");
        const fechaArqueo = filtroArqueo && filtroArqueo.value ? filtroArqueo.value : getLocalDateString();

        try {
            if (window.arqueoActivo) {
                const payload = {
                    efectivo_contado: contado,
                    observaciones: observaciones,
                    denominaciones: denominaciones
                };
                const result = await apiPatch(`/arqueo/${window.arqueoActivo.id_arqueo}/cerrar`, payload);
                if (result.error) {
                    alert("Error al cerrar el arqueo de caja: " + result.error);
                    return;
                }
                alert("La caja activa ha sido cerrada y el arqueo de caja ha sido registrado exitosamente.");
                window.arqueoActivo = null;
                actualizarCajaUI();
            } else {
                const payload = {
                    fecha: fechaArqueo,
                    id_usuario: userId,
                    id_sucursal: sucursalId,
                    efectivo_inicial: inicial,
                    ventas_efectivo: totalVentasEfectivo,
                    gastos_aprobados: totalGastosAprobados,
                    efectivo_contado: contado,
                    observaciones: observaciones,
                    denominaciones: denominaciones
                };
                const result = await apiPost('/arqueo', payload);
                if (result.error) {
                    alert("Error al registrar el arqueo: " + result.error);
                    return;
                }
                alert("El Arqueo de caja diario ha sido registrado exitosamente en el historial.");
            }

            // Limpiar inputs de conteo y observaciones
            denominacionInputs.forEach(input => input.value = 0);
            if (arqObservacion) arqObservacion.value = "";

            // Recargar datos y calcular cuadre
            await cargarHistorialArqueos();
            calcularCuadre();
        } catch (err) {
            console.error("Error al registrar/cerrar arqueo:", err);
            alert("Error de conexión al procesar el arqueo.");
        }
    });

    // Cargar historial de arqueos
    // Cargar historial de arqueos
    async function cargarHistorialArqueos() {
        const tbody = document.getElementById("tabla_historial_arqueos");
        if (!tbody) return;

        const dateInput = document.getElementById("filtro_fecha_historial_arqueo");
        if (dateInput && !dateInput.value) {
            dateInput.value = getLocalDateString();
        }
        const selectedDate = dateInput ? dateInput.value : getLocalDateString();

        try {
            const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
            const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
            const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;

            const activeUserId = window.currentUser?.id_usuario || (currentUser ? currentUser.id_usuario : null);

            let url = `/arqueo?id_sucursal=${sucursalId}&fecha=${selectedDate}`;
            if (activeUserId) {
                url += `&id_usuario=${activeUserId}`;
            }

            const arqueos = await apiGet(url);

            if (arqueos.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; color: #64748b; padding: 24px; font-weight: 500;">
                            No hay arqueos de caja registrados para este usuario en esta fecha.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = arqueos.map(arq => {
                let badgeStyle = "background: rgba(34, 197, 94, 0.15); color: #166534;";
                let difColor = "green";
                if (arq.estado === "Faltante") {
                    badgeStyle = "background: #fee2e2; color: #b91c1c;";
                    difColor = "#ef4444";
                } else if (arq.estado === "Sobrante") {
                    badgeStyle = "background: #eff6ff; color: #1d4ed8;";
                    difColor = "#2563eb";
                }

                const fechaFormateada = arq.fecha ? getCleanLocalDate(arq.fecha) : '';
                const diferencia = parseFloat(arq.diferencia) || 0;

                return `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td><strong>${fechaFormateada}</strong></td>
                        <td>${arq.cajero || "Carmelo"}</td>
                        <td>C$ ${(parseFloat(arq.efectivo_inicial) || 0).toFixed(2)}</td>
                        <td>C$ ${(parseFloat(arq.ventas_efectivo) || 0).toFixed(2)}</td>
                        <td>C$ ${(parseFloat(arq.efectivo_esperado) || 0).toFixed(2)}</td>
                        <td>C$ ${(parseFloat(arq.efectivo_contado) || 0).toFixed(2)}</td>
                        <td style="color: ${difColor}; font-weight: bold;">${diferencia < 0 ? '-' : ''}C$ ${Math.abs(diferencia).toFixed(2)}</td>
                        <td><span class="badge_pct" style="${badgeStyle}">${arq.estado}</span></td>
                    </tr>
                `;
            }).join("");
        } catch (err) {
            console.error("Error al cargar historial de arqueos:", err);
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 24px;">Error al cargar historial desde el servidor.</td></tr>`;
        }
    }
    window.cargarHistorialArqueos = cargarHistorialArqueos;

    // Imprimir Arqueo
    btnImprimirArqueo?.addEventListener("click", () => {
        window.print();
    });

    document.getElementById("filtro_fecha_historial_arqueo")?.addEventListener("change", () => {
        cargarHistorialArqueos();
    });

    // Inicializar cálculos
    cargarVentasRealizadas().then(() => {
        cargarGastosAprobados();
        cargarHistorialArqueos();
    });
});

// ============================================================================
// LÓGICA DE COMPRAS (FACTURACIÓN DE COMPRA)
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    // 1. Elementos del DOM
    const numFacturaInput = document.getElementById("compra_num_factura");
    const fechaInput = document.getElementById("compra_fecha");
    const usuarioInput = document.getElementById("compra_usuario");
    const metodoPagoSelect = document.getElementById("compra_metodo_pago");
    const selectProveedor = document.getElementById("compra_select_proveedor");

    const buscarProductoInput = document.getElementById("compra_buscar_producto");
    const selectProductoId = document.getElementById("compra_select_producto_id");
    const resultadosBusqueda = document.getElementById("compra_resultados_busqueda");
    const selectAgrupacion = document.getElementById("compra_select_agrupacion");
    const cantidadAgrupacionInput = document.getElementById("compra_cantidad_agrupacion");
    const cantidadInput = document.getElementById("compra_cantidad");
    const precioCostoInput = document.getElementById("compra_precio_costo");
    const ivaInput = document.getElementById("compra_iva");
    const descuentoInput = document.getElementById("compra_descuento");
    const bonificacionInput = document.getElementById("compra_bonificacion");
    const loteInput = document.getElementById("compra_lote");
    const fechaEntregaInput = document.getElementById("compra_fecha_entrega");
    const fechaCaducidadInput = document.getElementById("compra_fecha_caducidad");

    const precioUnitarioCalc = document.getElementById("compra_precio_unitario_calc");
    const formulaDisplay = document.getElementById("compra_formula_display");
    const gananciaCalc = document.getElementById("compra_ganancia_calc");
    const gananciaFormula = document.getElementById("compra_ganancia_formula");
    const margenDeseadoInput = document.getElementById("compra_margen_deseado");
    const gananciaLabel = document.getElementById("compra_ganancia_label");

    const tablaBody = document.getElementById("compra_tabla_body");
    const subtotalFacturaEl = document.getElementById("compra_subtotal_factura");
    const ivaFacturaEl = document.getElementById("compra_iva_factura");
    const totalFacturaEl = document.getElementById("compra_total_factura");

    const btnAgregarProd = document.getElementById("btn_compra_agregar_prod");
    const btnEliminarProd = document.getElementById("btn_compra_eliminar_prod");
    const btnEditarProdSel = document.getElementById("btn_compra_editar_prod_sel");
    const btnEditarFactura = document.getElementById("btn_compra_editar_factura");
    const btnVerFactura = document.getElementById("btn_compra_ver_factura");

    // Estado local de la factura actual
    let compraItems = [];
    let selectedItemIndex = null;

    // A. Funciones auxiliares para proveedores y agrupaciones
    const popularProveedoresSelect = async () => {
        if (!selectProveedor) return;
        const valorActual = selectProveedor.value;
        selectProveedor.innerHTML = '<option value="">Seleccione un proveedor...</option>';

        try {
            const sucursal = activeSucursal || 'Central';
            const proveedores = await apiGet(`/proveedores?sucursal=${encodeURIComponent(sucursal)}`);
            window.proveedoresCache = proveedores;
            proveedores.forEach(p => {
                if (p.estado !== 'Inactivo') {
                    const option = document.createElement("option");
                    option.value = p.id_proveedor;
                    option.textContent = p.nombre;
                    selectProveedor.appendChild(option);
                }
            });
            if (valorActual && Array.from(selectProveedor.options).some(opt => opt.value === valorActual)) {
                selectProveedor.value = valorActual;
            }
        } catch (err) {
            console.error("Error al cargar proveedores:", err);
        }
    };
    window.popularProveedoresSelect = popularProveedoresSelect;

    const cargarAgrupacionesProducto = (prodId) => {
        if (!selectAgrupacion) return;
        selectAgrupacion.innerHTML = '';

        const productos = window.productosInventario || [];
        const productoObj = productos.find(p => p.id === prodId);

        if (productoObj && productoObj.groupings) {
            Object.entries(productoObj.groupings).forEach(([groupName, equiv]) => {
                const option = document.createElement("option");
                option.value = groupName;
                option.dataset.equiv = equiv;
                option.textContent = `${groupName} (${equiv} ud${equiv > 1 ? 's' : ''})`;
                selectAgrupacion.appendChild(option);
            });
        } else {
            const option = document.createElement("option");
            option.value = "Unidad";
            option.dataset.equiv = "1";
            option.textContent = "Unidad (1 ud)";
            selectAgrupacion.appendChild(option);
        }

        if (cantidadAgrupacionInput) cantidadAgrupacionInput.value = "1";
        if (cantidadInput) {
            const equiv = parseFloat(selectAgrupacion.options[0]?.dataset.equiv) || 1;
            cantidadInput.value = equiv;
        }
    };

    // 2. Inicialización de valores por defecto
    const inicializarValores = () => {
        // Establecer fecha de hoy para la factura
        const hoy = getLocalDateString();
        if (fechaInput) fechaInput.value = hoy;
        if (fechaEntregaInput) fechaEntregaInput.value = hoy;

        // Cargar usuario activo del header o de currentUser
        const labelUser = window.currentUser?.name || document.querySelector("header .box_comp label")?.textContent || "Carmelo";
        if (usuarioInput) usuarioInput.value = labelUser;

        // Cargar proveedores
        popularProveedoresSelect();

        // Iniciar comportamiento de búsqueda de productos (autocompletado escrito)
        iniciarAutocompletado();

        // Calcular precio unitario inicial
        calcularPrecioUnitario();
    };

    // 3. Manejo de Autocompletado / Búsqueda Escrita
    const iniciarAutocompletado = () => {
        if (!buscarProductoInput || !resultadosBusqueda) return;

        // Filtrar y mostrar resultados mientras escribe
        buscarProductoInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                resultadosBusqueda.style.display = "none";
                selectProductoId.value = "";
                calcularPrecioUnitario();
                return;
            }

            const productos = window.productosInventario || [];
            const filtrados = productos.filter(p =>
                (p.name.toLowerCase().includes(query) ||
                p.category.toLowerCase().includes(query)) &&
                p.activo
            );

            if (filtrados.length === 0) {
                resultadosBusqueda.innerHTML = `<div class="autocomplete-item-no-results">No se encontraron productos</div>`;
                resultadosBusqueda.style.display = "block";
                return;
            }

            resultadosBusqueda.innerHTML = filtrados.map(prod => `
                <div class="autocomplete-item" data-id="${prod.id}" data-name="${prod.name}">
                    <strong>${prod.name}</strong> <span style="font-size: 11px; color: #64748b; margin-left: 8px;">(${prod.category})</span>
                </div>
            `).join("");

            resultadosBusqueda.style.display = "block";

            // Vincular evento de clic a las opciones filtradas
            resultadosBusqueda.querySelectorAll(".autocomplete-item").forEach(item => {
                item.addEventListener("click", () => {
                    const id = item.dataset.id;
                    const name = item.dataset.name;

                    buscarProductoInput.value = name;
                    selectProductoId.value = id;
                    resultadosBusqueda.style.display = "none";
                    cargarAgrupacionesProducto(id);

                    calcularPrecioUnitario();
                });
            });
        });

        // Mostrar lista completa al hacer click/focus
        buscarProductoInput.addEventListener("focus", () => {
            const query = buscarProductoInput.value.toLowerCase().trim();
            const productos = window.productosInventario || [];
            const filtrados = query ?
                productos.filter(p => p.name.toLowerCase().includes(query) && p.activo) :
                productos.filter(p => p.activo);

            if (filtrados.length === 0) {
                resultadosBusqueda.innerHTML = `<div class="autocomplete-item-no-results">No se encontraron productos</div>`;
                resultadosBusqueda.style.display = "block";
                return;
            }

            resultadosBusqueda.innerHTML = filtrados.map(prod => `
                <div class="autocomplete-item" data-id="${prod.id}" data-name="${prod.name}">
                    <strong>${prod.name}</strong> <span style="font-size: 11px; color: #64748b; margin-left: 8px;">(${prod.category})</span>
                </div>
            `).join("");

            resultadosBusqueda.style.display = "block";

            // Vincular evento de clic a las opciones
            resultadosBusqueda.querySelectorAll(".autocomplete-item").forEach(item => {
                item.addEventListener("click", () => {
                    const id = item.dataset.id;
                    const name = item.dataset.name;

                    buscarProductoInput.value = name;
                    selectProductoId.value = id;
                    resultadosBusqueda.style.display = "none";
                    cargarAgrupacionesProducto(id);

                    calcularPrecioUnitario();
                });
            });
        });

        // Cerrar resultados al hacer click fuera
        document.addEventListener("click", (e) => {
            if (!buscarProductoInput.contains(e.target) && !resultadosBusqueda.contains(e.target)) {
                resultadosBusqueda.style.display = "none";
            }
        });
    };

    // 4. Calcular el precio unitario y precio sugerido en tiempo real
    const calcularPrecioUnitario = () => {
        const cantidad = parseFloat(cantidadInput?.value) || 0;
        const costo = parseFloat(precioCostoInput?.value) || 0;
        const ivaPct = parseFloat(ivaInput?.value) || 0;
        const descuento = parseFloat(descuentoInput?.value) || 0;
        const bonificacion = parseFloat(bonificacionInput?.value) || 0;
        const margenDeseado = parseFloat(margenDeseadoInput?.value) || 0;

        // Fórmula: Costo total = (Cantidad * Costo) - Descuento + IVA
        const subtotalBruto = cantidad * costo;
        const baseDescuento = subtotalBruto - descuento;
        const ivaCalculado = baseDescuento > 0 ? baseDescuento * (ivaPct / 100) : 0;
        const totalNeto = Math.max(0, baseDescuento + ivaCalculado);
        const cantidadTotalRecibida = cantidad + bonificacion;

        const precioUnitarioVal = cantidadTotalRecibida > 0 ? (totalNeto / cantidadTotalRecibida) : 0;

        if (precioUnitarioCalc) {
            precioUnitarioCalc.textContent = `C$ ${precioUnitarioVal.toFixed(2)}`;
        }

        if (formulaDisplay) {
            formulaDisplay.textContent = `Fórmula: ((${cantidad} * C$${costo.toFixed(0)}) - C$${descuento.toFixed(0)} + C$${ivaCalculado.toFixed(0)}) / (${cantidad} + ${bonificacion} uds) = C$${precioUnitarioVal.toFixed(2)}`;
        }

        // Cálculo de Precio Sugerido basado en el margen deseado
        // Fórmula del margen comercial estándar: Precio Venta = Costo / (1 - Margen%)
        const precioSugerido = margenDeseado < 100 ? (precioUnitarioVal / (1 - (margenDeseado / 100))) : 0;

        if (gananciaLabel) {
            gananciaLabel.textContent = `Precio Venta Sugerido (${margenDeseado.toFixed(0)}% Ganancia):`;
        }

        if (gananciaCalc) {
            gananciaCalc.textContent = `C$ ${precioSugerido.toFixed(2)}`;
        }

        if (gananciaFormula) {
            gananciaFormula.textContent = `Fórmula: Costo C$ ${precioUnitarioVal.toFixed(2)} / (1 - ${(margenDeseado / 100).toFixed(2)})`;
        }

        return {
            precioUnitario: precioUnitarioVal,
            subtotalNeto: totalNeto,
            ivaVal: ivaCalculado,
            precioSugerido: precioSugerido,
            margenDeseado: margenDeseado
        };
    };

    // Escuchar cambios en la agrupación y cantidad de agrupación
    selectAgrupacion?.addEventListener("change", () => {
        const selectedOpt = selectAgrupacion.options[selectAgrupacion.selectedIndex];
        const equiv = parseFloat(selectedOpt?.dataset.equiv) || 1;
        const cantAgrup = parseFloat(cantidadAgrupacionInput?.value) || 0;

        if (cantidadInput) {
            cantidadInput.value = Math.round(cantAgrup * equiv);
        }
        calcularPrecioUnitario();
    });

    cantidadAgrupacionInput?.addEventListener("input", () => {
        const selectedOpt = selectAgrupacion?.options[selectAgrupacion.selectedIndex];
        const equiv = parseFloat(selectedOpt?.dataset.equiv) || 1;
        const cantAgrup = parseFloat(cantidadAgrupacionInput.value) || 0;

        if (cantidadInput) {
            cantidadInput.value = Math.round(cantAgrup * equiv);
        }
        calcularPrecioUnitario();
    });

    cantidadInput?.addEventListener("input", () => {
        const cantidad = parseFloat(cantidadInput.value) || 0;
        const selectedOpt = selectAgrupacion?.options[selectAgrupacion.selectedIndex];
        const equiv = parseFloat(selectedOpt?.dataset.equiv) || 1;

        if (cantidad % equiv === 0) {
            if (cantidadAgrupacionInput) {
                cantidadAgrupacionInput.value = Math.round(cantidad / equiv);
            }
        } else {
            // Si la cantidad modificada directamente no es divisible por la agrupación actual,
            // se restablece la agrupación a "Unidad" para no desacomodar la agrupación.
            if (selectAgrupacion) {
                selectAgrupacion.value = "Unidad";
            }
            if (cantidadAgrupacionInput) {
                cantidadAgrupacionInput.value = 0;
            }
        }
    });

    // Escuchar cambios en los inputs del producto para calcular el precio unitario
    [cantidadInput, precioCostoInput, ivaInput, descuentoInput, bonificacionInput, margenDeseadoInput].forEach(input => {
        input?.addEventListener("input", calcularPrecioUnitario);
    });

    // 5. Renderizar tabla de productos agregados
    const renderTablaItems = () => {
        if (!tablaBody) return;

        if (compraItems.length === 0) {
            tablaBody.innerHTML = `
                <tr id="compra_tabla_vacia">
                    <td colspan="10" style="text-align: center; color: #64748b; padding: 24px; font-weight: 500;">
                        No hay productos agregados a esta factura de compra.
                    </td>
                </tr>
            `;
            actualizarTotalesFactura(0, 0, 0);
            if (btnEliminarProd) {
                btnEliminarProd.disabled = true;
                btnEliminarProd.style.opacity = "0.5";
            }
            if (btnEditarProdSel) {
                btnEditarProdSel.disabled = true;
                btnEditarProdSel.style.opacity = "0.5";
            }
            return;
        }

        let subtotalAcumulado = 0;
        let ivaAcumulado = 0;
        let totalAcumulado = 0;

        tablaBody.innerHTML = compraItems.map((item, index) => {
            subtotalAcumulado += (item.cantidad * item.costo) - item.descuento;
            ivaAcumulado += item.ivaVal;
            totalAcumulado += item.subtotalNeto;

            const isSelected = selectedItemIndex === index ? "selected" : "";

            const agrupacionText = item.agrupacion && item.agrupacion !== "Unidad"
                ? `${item.cantidad} (${item.cantidadAgrupacion} ${item.agrupacion})`
                : `${item.cantidad}`;

            return `
                <tr class="${isSelected}" data-index="${index}">
                    <td><strong>${item.nombre}</strong></td>
                    <td style="text-align: center;">${agrupacionText}</td>
                    <td style="text-align: center;">${item.bonificacion}</td>
                    <td>C$ ${item.costo.toFixed(2)}</td>
                    <td>C$ ${item.descuento.toFixed(2)}</td>
                    <td><span class="badge" style="background: #e2e8f0; color: #475569;">${item.lote}</span></td>
                    <td>${item.fechaEntrega}</td>
                    <td><span style="color: #ef4444; font-weight: 500;">${item.fechaCaducidad}</span></td>
                    <td style="font-weight: bold; color: #2563eb;">C$ ${item.precioUnitario.toFixed(2)}</td>
                    <td style="font-weight: bold; color: #10b981;">C$ ${item.subtotalNeto.toFixed(2)}</td>
                </tr>
            `;
        }).join("");

        actualizarTotalesFactura(subtotalAcumulado, ivaAcumulado, totalAcumulado);

        // Volver a vincular eventos de clic para la selección de fila
        const rows = tablaBody.querySelectorAll("tr");
        rows.forEach(row => {
            row.addEventListener("click", () => {
                const index = parseInt(row.dataset.index);
                if (isNaN(index)) return;

                if (selectedItemIndex === index) {
                    // Si ya está seleccionado, deseleccionar
                    selectedItemIndex = null;
                    row.classList.remove("selected");
                    if (btnEliminarProd) {
                        btnEliminarProd.disabled = true;
                        btnEliminarProd.style.opacity = "0.5";
                    }
                    if (btnEditarProdSel) {
                        btnEditarProdSel.disabled = true;
                        btnEditarProdSel.style.opacity = "0.5";
                    }
                } else {
                    // Seleccionar la fila
                    selectedItemIndex = index;
                    rows.forEach(r => r.classList.remove("selected"));
                    row.classList.add("selected");
                    if (btnEliminarProd) {
                        btnEliminarProd.disabled = false;
                        btnEliminarProd.style.opacity = "1";
                    }
                    if (btnEditarProdSel) {
                        btnEditarProdSel.disabled = false;
                        btnEditarProdSel.style.opacity = "1";
                    }

                    // Cargar valores de la fila en el formulario para facilitar edición/visualización
                    cargarItemEnFormulario(compraItems[index]);
                }
            });
        });
    };

    // Cargar los valores de un item en el formulario de entrada
    const cargarItemEnFormulario = (item) => {
        if (buscarProductoInput) buscarProductoInput.value = item.nombre;
        if (selectProductoId) selectProductoId.value = item.id;

        // Cargar las agrupaciones del producto
        cargarAgrupacionesProducto(item.id);

        // Seleccionar la agrupación guardada si existe
        if (selectAgrupacion && item.agrupacion) {
            selectAgrupacion.value = item.agrupacion;
        }
        if (cantidadAgrupacionInput && item.cantidadAgrupacion !== undefined) {
            cantidadAgrupacionInput.value = item.cantidadAgrupacion;
        }

        if (cantidadInput) cantidadInput.value = item.cantidad;
        if (precioCostoInput) precioCostoInput.value = item.costo;
        if (ivaInput) ivaInput.value = item.ivaPct;
        if (descuentoInput) descuentoInput.value = item.descuento;
        if (bonificacionInput) bonificacionInput.value = item.bonificacion;
        if (loteInput) loteInput.value = item.lote;
        if (fechaEntregaInput) fechaEntregaInput.value = item.fechaEntrega;
        if (fechaCaducidadInput) fechaCaducidadInput.value = item.fechaCaducidad === "Sin venc." ? "" : item.fechaCaducidad;
        if (margenDeseadoInput && item.margenDeseado !== undefined) {
            margenDeseadoInput.value = item.margenDeseado;
        }

        calcularPrecioUnitario();
    };

    // Actualizar los elementos de totales en la UI
    const actualizarTotalesFactura = (subtotal, iva, total) => {
        if (subtotalFacturaEl) subtotalFacturaEl.textContent = `C$ ${Math.max(0, subtotal).toFixed(2)}`;
        if (ivaFacturaEl) ivaFacturaEl.textContent = `C$ ${Math.max(0, iva).toFixed(2)}`;
        if (totalFacturaEl) totalFacturaEl.textContent = `C$ ${Math.max(0, total).toFixed(2)}`;
    };

    // 6. Botón: Agregar Producto
    btnAgregarProd?.addEventListener("click", (e) => {
        e.preventDefault();

        if (!selectProductoId || selectProductoId.value === "") {
            alert("Por favor, selecciona un producto de la lista primero.");
            return;
        }

        const id = selectProductoId.value;
        const nombre = buscarProductoInput.value.trim();

        const cantidad = parseInt(cantidadInput.value) || 0;
        const agrupacion = selectAgrupacion?.value || "Unidad";
        const cantidadAgrupacion = parseInt(cantidadAgrupacionInput?.value) || 1;
        const costo = parseFloat(precioCostoInput.value) || 0;
        const ivaPct = parseFloat(ivaInput.value) || 0;
        const descuento = parseFloat(descuentoInput.value) || 0;
        const bonificacion = parseInt(bonificacionInput.value) || 0;
        const lote = loteInput.value.trim() || "N/A";
        const fechaEntrega = (fechaEntregaInput ? fechaEntregaInput.value : "") || getLocalDateString();
        const fechaCaducidad = fechaCaducidadInput.value || "Sin venc.";

        if (cantidad <= 0) {
            alert("La cantidad debe ser mayor a 0.");
            return;
        }
        if (costo < 0) {
            alert("El precio de compra no puede ser menor a 0.");
            return;
        }
        if (descuento < 0) {
            alert("El descuento no puede ser menor a 0.");
            return;
        }
        if (bonificacion < 0) {
            alert("La bonificación no puede ser menor a 0.");
            return;
        }

        // Obtener los cálculos
        const calculos = calcularPrecioUnitario();

        // Agregar al carrito de compra
        compraItems.push({
            id: id,
            nombre: nombre,
            cantidad: cantidad,
            agrupacion: agrupacion,
            cantidadAgrupacion: cantidadAgrupacion,
            costo: costo,
            ivaPct: ivaPct,
            ivaVal: calculos.ivaVal,
            descuento: descuento,
            bonificacion: bonificacion,
            lote: lote,
            fechaEntrega: fechaEntrega,
            fechaCaducidad: fechaCaducidad,
            precioUnitario: calculos.precioUnitario,
            subtotalNeto: calculos.subtotalNeto,
            precioSugerido: calculos.precioSugerido,
            margenDeseado: calculos.margenDeseado
        });

        // Limpiar formulario de producto
        buscarProductoInput.value = "";
        selectProductoId.value = "";
        if (selectAgrupacion) {
            selectAgrupacion.innerHTML = '<option value="Unidad" data-equiv="1">Unidad (1 ud)</option>';
            selectAgrupacion.value = "Unidad";
        }
        if (cantidadAgrupacionInput) cantidadAgrupacionInput.value = "1";
        cantidadInput.value = "1";
        precioCostoInput.value = "0.00";
        ivaInput.value = "15";
        descuentoInput.value = "0.00";
        bonificacionInput.value = "0";
        loteInput.value = "";
        fechaCaducidadInput.value = "";
        if (fechaEntregaInput) fechaEntregaInput.value = "";
        margenDeseadoInput.value = "20";

        calcularPrecioUnitario();
        renderTablaItems();

        // Deseleccionar cualquier fila
        selectedItemIndex = null;
        if (btnEliminarProd) {
            btnEliminarProd.disabled = true;
            btnEliminarProd.style.opacity = "0.5";
        }
        if (btnEditarProdSel) {
            btnEditarProdSel.disabled = true;
            btnEditarProdSel.style.opacity = "0.5";
        }
    });

    // 7. Botón: Eliminar Producto Seleccionado
    btnEliminarProd?.addEventListener("click", (e) => {
        e.preventDefault();

        if (selectedItemIndex === null) {
            alert("Por favor, selecciona un producto de la tabla primero haciendo clic en su fila.");
            return;
        }

        const itemEliminado = compraItems[selectedItemIndex];
        if (confirm(`¿Estás seguro de que deseas eliminar "${itemEliminado.nombre}" de la factura?`)) {
            compraItems.splice(selectedItemIndex, 1);
            selectedItemIndex = null;

            renderTablaItems();

            btnEliminarProd.disabled = true;
            btnEliminarProd.style.opacity = "0.5";
            if (btnEditarProdSel) {
                btnEditarProdSel.disabled = true;
                btnEditarProdSel.style.opacity = "0.5";
            }
        }
    });

    // 7.5 Botón: Edit Producto Seleccionado
    btnEditarProdSel?.addEventListener("click", (e) => {
        e.preventDefault();

        if (selectedItemIndex === null) {
            alert("Por favor, selecciona un producto de la tabla primero haciendo clic en su fila.");
            return;
        }

        const itemAEditar = compraItems[selectedItemIndex];
        cargarItemEnFormulario(itemAEditar);

        // Remover el item de la lista para que al guardarlo de nuevo no se duplique
        compraItems.splice(selectedItemIndex, 1);
        selectedItemIndex = null;

        renderTablaItems();

        if (btnEliminarProd) {
            btnEliminarProd.disabled = true;
            btnEliminarProd.style.opacity = "0.5";
        }
        if (btnEditarProdSel) {
            btnEditarProdSel.disabled = true;
            btnEditarProdSel.style.opacity = "0.5";
        }

        // Cerrar modal
        if (window.closeMostAggProdu) {
            window.closeMostAggProdu();
        }
    });

    // 8. Botón: Registrar Factura en el backend
    btnEditarFactura?.addEventListener("click", async (e) => {
        e.preventDefault();

        const numFactura = numFacturaInput?.value.trim();
        const fecha = fechaInput?.value;
        const metodoPago = metodoPagoSelect?.value;
        const proveedorId = selectProveedor?.value || "";

        if (!numFactura) {
            alert("Por favor, ingresa el número de factura.");
            numFacturaInput.focus();
            return;
        }
        if (!proveedorId) {
            alert("Por favor, selecciona un proveedor.");
            selectProveedor.focus();
            return;
        }

        if (compraItems.length === 0) {
            alert("No puedes guardar una factura de compra sin productos. Agrega al menos uno.");
            return;
        }

        // Obtener el ID del usuario actual
        const userId = window.currentUser?.id_usuario || 1;

        // Obtener el ID de la sucursal actual
        const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
        const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;

        // Construir productos para el backend
        const productosPayload = compraItems.map(item => {
            const productObj = (window.productosInventario || []).find(p => p.id === item.id);
            const groupingDetail = productObj?.groupingDetails?.[item.agrupacion];
            const idAgrupacion = groupingDetail ? groupingDetail.id_agrupacion : 1;

            return {
                id_producto: parseInt(item.id),
                id_agrupacion: idAgrupacion,
                cantidad_agrupacion: parseFloat(item.cantidadAgrupacion) || 0,
                cantidad_unidades: parseFloat(item.cantidad) || 0,
                precio_costo: parseFloat(item.costo) || 0,
                iva_porcentaje: parseFloat(item.ivaPct) || 15,
                descuento: parseFloat(item.descuento) || 0,
                bonificacion: parseInt(item.bonificacion) || 0,
                lote: item.lote === "N/A" ? null : item.lote,
                fecha_entrega: item.fechaEntrega || null,
                fecha_caducidad: item.fechaCaducidad === "Sin venc." || !item.fechaCaducidad ? null : item.fechaCaducidad,
                precio_venta_sugerido: parseFloat(item.precioSugerido) || null,
                margen_ganancia: parseFloat(item.margenDeseado) || 20.00
            };
        });

        const purchasePayload = {
            numero_factura: numFactura,
            fecha: fecha,
            id_proveedor: parseInt(proveedorId),
            id_usuario: userId,
            metodo_pago: metodoPago || "Efectivo",
            productos: productosPayload,
            id_sucursal: sucursalId
        };

        try {
            const response = await apiPost('/compras', purchasePayload);
            if (response.error) {
                alert("Error al registrar la compra: " + response.error);
                return;
            }

            alert(`¡Factura de compra "${numFactura}" registrada exitosamente en el sistema!`);

            // Limpiar formulario completo de factura
            if (numFacturaInput) numFacturaInput.value = "";
            if (selectProveedor) selectProveedor.value = "";
            compraItems = [];
            renderTablaItems();
            inicializarValores();

            // Actualizar el historial de compras en la UI inmediatamente
            cargarComprasRealizadas();
            await cargarDatosIniciales();

            // Cerrar modal
            if (window.closeMostAggProdu) {
                window.closeMostAggProdu();
            }
        } catch (err) {
            console.error("Error al registrar la compra:", err);
            alert("Error de conexión al registrar la compra en el servidor.");
        }
    });

    // 8.5 Botón: Ver Factura (Abrir modal)
    btnVerFactura?.addEventListener("click", (e) => {
        e.preventDefault();

        // Poblar los metadatos generales en el modal
        const numFacturaVal = numFacturaInput?.value.trim() || "Borrador";
        const fechaVal = fechaInput?.value || "-";

        let proveedorVal = "Ninguno";
        if (selectProveedor && selectProveedor.selectedIndex >= 0) {
            proveedorVal = selectProveedor.options[selectProveedor.selectedIndex].text;
        }

        const usuarioVal = usuarioInput?.value || "-";
        const metodoPagoVal = metodoPagoSelect?.value || "-";

        const verNumFactura = document.getElementById("ver_compra_num_factura");
        const verFecha = document.getElementById("ver_compra_fecha");
        const verProveedor = document.getElementById("ver_compra_proveedor");
        const verUsuario = document.getElementById("ver_compra_usuario");
        const verMetodo = document.getElementById("ver_compra_metodo_pago");

        if (verNumFactura) verNumFactura.textContent = numFacturaVal;
        if (verFecha) verFecha.textContent = fechaVal;
        if (verProveedor) verProveedor.textContent = proveedorVal;
        if (verUsuario) verUsuario.textContent = usuarioVal;
        if (verMetodo) verMetodo.textContent = metodoPagoVal;

        if (btnEditarFactura) {
            btnEditarFactura.textContent = "Registrar Factura";
        }

        if (window.mostrarModal) {
            window.mostrarModal("modal_ver_factura_compra");
        }
    });

    // 9. Cargar factura al cambiar número de factura (Buscador automático / Carga de edición)
    numFacturaInput?.addEventListener("change", async () => {
        const numFactura = numFacturaInput.value.trim();
        if (!numFactura) return;

        try {
            // El número de factura es único en todo el sistema: se busca en todas las sucursales
            const facturas = await apiGet(`/compras?numero_factura=${encodeURIComponent(numFactura)}`);
            const facturaEncontrada = (Array.isArray(facturas) ? facturas : []).find(f => f.numero_factura === numFactura);
            if (facturaEncontrada) {
                alert(`La factura "${numFactura}" ya se encuentra registrada en el sistema con estado "${facturaEncontrada.estado}". Si desea corregir un error, debe solicitar su anulación en el Historial.`);
                numFacturaInput.value = "";
            }
        } catch (e) {
            console.error("Error al buscar factura:", e);
        }
    });

    // Tab switching for compras section
    const comprasTabButtons = document.querySelectorAll(".tab_compras_btn");
    const tabRegistro = document.getElementById("tab_registro_compras");
    const tabHistorial = document.getElementById("tab_historial_compras");

    comprasTabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            comprasTabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const tab = btn.dataset.tab;
            if (tab === "registro-compras") {
                if (tabRegistro) tabRegistro.style.display = "block";
                if (tabHistorial) tabHistorial.style.display = "none";
            } else {
                if (tabRegistro) tabRegistro.style.display = "none";
                if (tabHistorial) tabHistorial.style.display = "block";
                cargarComprasRealizadas();
            }
        });
    });

    async function cargarComprasRealizadas() {
        const tbody = document.getElementById("tabla_compras_realizadas_body");
        if (!tbody) return;

        const dateInput = document.getElementById("fecha_compra_historial");
        if (dateInput && !dateInput.value) {
            dateInput.value = getLocalDateString();
        }
        const selectedDate = dateInput ? dateInput.value : getLocalDateString();

        try {
            // Historial independiente por sucursal: solo las compras de la sucursal en la que se opera
            const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent?.trim() || activeSucursal || 'Central';
            const activeUserId = window.currentUser?.id_usuario || (currentUser ? currentUser.id_usuario : null);
            const activeUserName = window.currentUser?.name || (currentUser ? currentUser.name : null);

            const allFacturas = await apiGet(`/compras?sucursal=${encodeURIComponent(activeSucursalName)}&fecha=${selectedDate}`);
            const lista = Array.isArray(allFacturas) ? allFacturas : [];

            const facturas = lista.filter(compra => {
                const matchesSucursal = compra.sucursal === activeSucursalName;
                const matchesDate = getCleanLocalDate(compra.fecha) === selectedDate;
                let matchesUser = true;
                if (activeUserId) {
                    matchesUser = (compra.id_usuario === activeUserId);
                } else if (activeUserName) {
                    matchesUser = (compra.comprador === activeUserName);
                }
                return matchesSucursal && matchesDate && matchesUser;
            });

            if (facturas.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" style="text-align: center; color: #64748b; padding: 24px; font-weight: 500;">
                            No hay facturas de compra registradas para este usuario en la sucursal ${activeSucursalName} en esta fecha.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = facturas.map(compra => {
                const estado = compra.estado || "Registrada";
                const badgeStyle = estado === "Anulada"
                    ? "background: #fee2e2; color: #b91c1c;"
                    : "background: #dcfce7; color: #15803d;";

                const fechaFormateada = compra.fecha ? getCleanLocalDate(compra.fecha) : '';

                return `
                    <tr style="border-bottom: 1px solid #cbd5e1;">
                        <td style="padding: 12px;"><strong>${compra.numero_factura}</strong></td>
                        <td style="padding: 12px;">${fechaFormateada}</td>
                        <td style="padding: 12px;">${compra.proveedor || "Ninguno"}</td>
                        <td style="padding: 12px;">${compra.comprador || "-"}</td>
                        <td style="padding: 12px;">${compra.metodo_pago || "-"}</td>
                        <td style="padding: 12px; font-weight: bold; color: #10b981;">C$ ${(parseFloat(compra.total) || 0).toFixed(2)}</td>
                        <td style="padding: 12px;"><span class="badge_pct" style="${badgeStyle}">${estado}</span></td>
                        <td style="padding: 12px; text-align: center;">
                            <button onclick="window.mostrarDetallesCompra('${compra.id_compra}')" style="background: #eff6ff; color: #2563eb; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer;">Observar compra</button>
                        </td>
                    </tr>
                `;
            }).join("");
        } catch (err) {
            console.error("Error al cargar compras:", err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #ef4444; padding: 24px; font-weight: 500;">
                        Error al obtener las compras desde el servidor.
                    </td>
                </tr>
            `;
        }
    }
    window.cargarComprasRealizadas = cargarComprasRealizadas;

    document.getElementById("buscar_compra_historial")?.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll("#tabla_compras_realizadas_body tr");
        rows.forEach(row => {
            if (row.cells.length === 1) return;
            let match = false;
            Array.from(row.cells).forEach(cell => {
                if (cell.textContent.toLowerCase().includes(query)) match = true;
            });
            row.style.display = match ? "" : "none";
        });
    });

    document.getElementById("fecha_compra_historial")?.addEventListener("change", () => {
        cargarComprasRealizadas();
    });

    // Escuchar cuando el usuario hace clic en el apartado de compras para ocultar resultados de búsqueda y recargar proveedores
    document.querySelector('.nav_button[data-section="compras"]')?.addEventListener('click', () => {
        if (resultadosBusqueda) resultadosBusqueda.style.display = "none";
        popularProveedoresSelect();
        cargarComprasRealizadas();
    });

    // Carga inicial al iniciar la app
    inicializarValores();
    cargarComprasRealizadas();
});

// ==========================================
// OBSERVACIÓN Y ANULACIÓN DE COMPRAS HISTORIAL
// ==========================================
window.mostrarDetallesCompra = async function (compraId) {
    try {
        const compra = await apiGet(`/compras/${compraId}`);

        // Guardar ID activo para anulación
        const anulacionCompraIdInput = document.getElementById("anulacion_compra_id_hidden");
        if (anulacionCompraIdInput) anulacionCompraIdInput.value = compra.id_compra;

        // Actualizar estado del botón de anulación
        const btnAnularCompra = document.getElementById("btn_solicitar_anulacion_compra");
        if (btnAnularCompra) {
            if (compra.estado === "Anulada") {
                btnAnularCompra.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    Compra Anulada
                `;
                btnAnularCompra.style.background = "#94a3b8";
                btnAnularCompra.style.cursor = "not-allowed";
                btnAnularCompra.disabled = true;
                btnAnularCompra.style.boxShadow = "none";
            } else {
                btnAnularCompra.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    Anular Compra
                `;
                btnAnularCompra.style.background = "#ef4444";
                btnAnularCompra.style.cursor = "pointer";
                btnAnularCompra.disabled = false;
                btnAnularCompra.style.boxShadow = "0 2px 4px rgba(239, 68, 68, 0.2)";
            }
        }

        // Actualizar campos principales
        document.getElementById("ver_compra_titulo").textContent = `Compra Número ${compra.numero_factura}`;
        document.getElementById("det_compra_num_factura").textContent = compra.numero_factura;

        const fechaFormateada = compra.fecha ? getCleanLocalDate(compra.fecha) : '';
        document.getElementById("det_compra_fecha").textContent = fechaFormateada;
        document.getElementById("det_compra_proveedor").textContent = compra.proveedor || "Ninguno";
        document.getElementById("det_compra_usuario").textContent = compra.comprador || "-";
        document.getElementById("det_compra_metodo_pago").textContent = compra.metodo_pago || "Efectivo";

        // Cargar tabla de productos de la compra
        const tbody = document.getElementById("det_compra_tabla_body");
        if (tbody) {
            tbody.innerHTML = "";
            let rowsHTML = "";
            if (compra.detalle && compra.detalle.length > 0) {
                compra.detalle.forEach(item => {
                    const agrupacionText = item.agrupacion && item.agrupacion !== "Unidad"
                        ? `${item.cantidad_unidades} (${item.cantidad_agrupacion} ${item.agrupacion})`
                        : `${item.cantidad_unidades}`;

                    rowsHTML += `
                        <tr>
                            <td><strong>${item.producto}</strong></td>
                            <td>${agrupacionText}</td>
                            <td>${item.bonificacion || 0}</td>
                            <td>C$ ${(parseFloat(item.precio_costo) || 0).toFixed(2)}</td>
                            <td>C$ ${(parseFloat(item.descuento) || 0).toFixed(2)}</td>
                            <td><span class="badge" style="background: #e2e8f0; color: #475569;">${item.lote || "N/A"}</span></td>
                            <td>${item.fecha_entrega ? getCleanLocalDate(item.fecha_entrega) : "-"}</td>
                            <td><span style="color: #ef4444; font-weight: 500;">${item.fecha_caducidad ? getCleanLocalDate(item.fecha_caducidad) : "Sin venc."}</span></td>
                            <td style="font-weight: bold; color: #2563eb;">C$ ${(parseFloat(item.precio_unitario_neto) || 0).toFixed(2)}</td>
                            <td style="font-weight: bold; color: #10b981;">C$ ${(parseFloat(item.subtotal_neto) || 0).toFixed(2)}</td>
                        </tr>
                    `;
                });
            } else {
                rowsHTML = `
                    <tr>
                        <td colspan="10" style="text-align: center; color: #64748b; padding: 20px;">No hay información detallada de productos.</td>
                    </tr>
                `;
            }
            tbody.innerHTML = rowsHTML;
        }

        // Totales
        document.getElementById("det_compra_subtotal").textContent = `C$ ${(parseFloat(compra.subtotal) || 0).toFixed(2)}`;
        document.getElementById("det_compra_iva").textContent = `C$ ${(parseFloat(compra.iva_total) || 0).toFixed(2)}`;
        document.getElementById("det_compra_total").textContent = `C$ ${(parseFloat(compra.total) || 0).toFixed(2)}`;



        window.mostrarModal("modal_ver_compras");
    } catch (err) {
        console.error("Error al mostrar detalles de compra:", err);
        alert("Error al obtener detalles de la compra desde el servidor.");
    }
};

window.abrirSolicitudAnulacionCompra = async function (compraId, facturaNumero) {
    if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'admin')) {
        const result = await anularDirecto(compraId, "Compra");
        if (result) {
            if (typeof window.cargarComprasRealizadas === "function") await window.cargarComprasRealizadas();
            const regrBtn = document.querySelector("#modal_ver_compras .Encabezado_regresar") || document.getElementById("vol_v_compra_hist") || document.getElementById("vol_v_compra");
            regrBtn?.click();
            await cargarDatosIniciales();
        }
        return;
    }

    window.activeAnulacionTipo = "Compra";

    document.getElementById("anulacion_motivo").value = "";
    document.getElementById("anulacion_venta_id").value = compraId;

    // Cargar administradores en el select
    const selectAdmin = document.getElementById("anulacion_admin");
    if (selectAdmin) {
        selectAdmin.innerHTML = '<option value="">Seleccione un administrador...</option>';

        try {
            const usuarios = await apiGet('/usuarios');
            usuarios.forEach(u => {
                if (u.estado === 'Activo' && (u.rol.toLowerCase().includes("admin") || u.rol.toLowerCase().includes("gerente"))) {
                    const opt = document.createElement("option");
                    opt.value = u.id_usuario;
                    opt.textContent = `${u.nombre_completo} (${u.rol})`;
                    selectAdmin.appendChild(opt);
                }
            });
        } catch (err) {
            console.error("Error al cargar administradores:", err);
        }
    }

    window.mostrarModal("modal_solicitar_anulacion");
};

// ============================================================================
// SISTEMA DE ANULACIÓN Y SOLICITUDES
// ============================================================================
// Filtro activo de las tarjetas KPI
let filtroAnulacionActivo = "Todas";

document.addEventListener("DOMContentLoaded", () => {
    // Inicializar bandeja si estamos en la sección de anulaciones
    renderSolicitudes();

    // Sincronizar al presionar el botón de la barra de navegación
    document.getElementById("nav_anulaciones")?.addEventListener("click", () => {
        renderSolicitudes();
    });

    // Vincular buscador local
    document.getElementById("buscar_solicitud_anulacion")?.addEventListener("input", filtrarTablaSolicitudes);
    document.getElementById("fecha_solicitud_anulacion")?.addEventListener("change", renderSolicitudes);

    // === CLICK EN TARJETAS KPI PARA FILTRAR TABLA ===
    document.querySelectorAll(".card_filtro_anulacion").forEach(card => {
        card.addEventListener("click", () => {
            const filtro = card.getAttribute("data-filter");
            filtroAnulacionActivo = filtro;

            // Actualizar estado visual de las tarjetas
            document.querySelectorAll(".card_filtro_anulacion").forEach(c => {
                c.classList.remove("active_filter_card");
            });
            card.classList.add("active_filter_card");

            // Actualizar título de la tabla según filtro
            const tituloTabla = document.querySelector("#anulaciones .box_tabla_operar h2");
            if (tituloTabla) {
                if (filtro === "Todas") {
                    tituloTabla.textContent = "Listado de Solicitudes de Anulación";
                } else if (filtro === "Pendiente") {
                    tituloTabla.textContent = "Solicitudes Pendientes de Revisión";
                } else if (filtro === "Aprobada") {
                    tituloTabla.textContent = "Solicitudes Aprobadas";
                } else if (filtro === "Rechazada") {
                    tituloTabla.textContent = "Solicitudes Rechazadas";
                }
            }

            // Re-renderizar tabla con el filtro
            renderSolicitudes();
        });
    });

    // Vincular cierre del modal de solicitud de anulación (volver al modal correspondiente)
    document.getElementById("regr_solicitar_anulacion")?.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.activeAnulacionTipo === "Compra") {
            mostrarModal("modal_ver_compras");
        } else {
            mostrarModal("modal_ver_ventas");
        }
    });

    // Vincular envío del formulario de anulación
    document.getElementById("form_solicitar_anulacion")?.addEventListener("submit", procesarEnvioSolicitud);
});

// ==========================================
// RENDERIZAR DETALLES DE VENTA DINÁMICOS
// ==========================================
window.mostrarDetallesVenta = async function (ventaId) {
    try {
        const venta = await apiGet(`/ventas/${ventaId}`);

        // Guardar ID activo en el modal de detalles
        document.getElementById("anulacion_venta_id").value = venta.id_venta;

        // Actualizar estado del botón de anulación
        const btnAnularVenta = document.getElementById("btn_solicitar_anulacion_venta");
        if (btnAnularVenta) {
            if (venta.estado === "Anulada") {
                btnAnularVenta.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    Venta Anulada
                `;
                btnAnularVenta.style.background = "#94a3b8";
                btnAnularVenta.style.cursor = "not-allowed";
                btnAnularVenta.disabled = true;
                btnAnularVenta.style.boxShadow = "none";
            } else {
                btnAnularVenta.innerHTML = `
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    Anular Venta
                `;
                btnAnularVenta.style.background = "#ef4444";
                btnAnularVenta.style.cursor = "pointer";
                btnAnularVenta.disabled = false;
                btnAnularVenta.style.boxShadow = "0 2px 4px rgba(239, 68, 68, 0.2)";
            }
        }

        // Actualizar campos de texto principales
        document.getElementById("ver_venta_titulo").textContent = `Venta Número ${venta.codigo_venta || venta.id_venta}`;

        const totalVal = `C$ ${(parseFloat(venta.total) || 0).toFixed(2)}`;
        const pagoConVal = `C$ ${(parseFloat(venta.pago_recibido) || 0).toFixed(2)}`;
        const vueltoVal = `C$ ${(parseFloat(venta.cambio) || 0).toFixed(2)}`;

        document.getElementById("ver_venta_total").textContent = totalVal;
        document.getElementById("ver_venta_pago").textContent = pagoConVal;
        document.getElementById("ver_venta_vuelto").textContent = vueltoVal;

        const fechaFormateada = venta.fecha ? getCleanLocalDate(venta.fecha) : '';
        document.getElementById("ver_venta_fecha").textContent = fechaFormateada;
        document.getElementById("ver_venta_metodo").textContent = venta.metodo_pago || "Efectivo";

        // Cargar tabla de productos de la venta
        const tbody = document.getElementById("ver_venta_tbody");
        if (tbody) {
            tbody.innerHTML = "";
            let rowsHTML = "";

            if (venta.detalle && venta.detalle.length > 0) {
                venta.detalle.forEach((prod, idx) => {
                    const subtotal = (parseFloat(prod.precio_unitario) || 0) * (parseFloat(prod.cantidad) || 0);
                    rowsHTML += `
                        <tr>
                            <td>${idx + 1}</td>
                            <td><strong>${prod.producto}</strong> <span style="font-size: 11px; color: #64748b;">(${prod.agrupacion || 'Unidad'})</span></td>
                            <td style="font-weight: 600;">${prod.cantidad}</td>
                            <td>C$ ${(parseFloat(prod.precio_unitario) || 0).toFixed(2)}</td>
                            <td style="font-weight: 700; color: #0f172a;">C$ ${subtotal.toFixed(2)}</td>
                            <td><span class="estado" style="background: rgba(34, 197, 94, 0.12); color: #166534; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">Entregado</span></td>
                        </tr>
                    `;
                });
            } else {
                rowsHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: #64748b; padding: 20px;">No hay información detallada de productos.</td>
                    </tr>
                `;
            }
            tbody.innerHTML = rowsHTML;
        }

        // Mostrar modal
        mostrarModal("modal_ver_ventas");
    } catch (err) {
        console.error("Error al mostrar detalles de venta:", err);
        alert("Error al cargar detalles de la venta desde el servidor.");
    }
};

async function anularDirecto(docId, tipoDoc) {
    const actionText = tipoDoc === "Compra" ? "compra" : "venta";
    const defaultMotivo = `Anulación directa por ${currentUser.role === 'gerente' ? 'Gerente' : 'Administrador'}`;
    
    const confirmar = confirm(`¿Está seguro de que desea anular esta ${actionText} de forma directa? El stock se revertirá de inmediato.`);
    if (!confirmar) return false;

    try {
        const payload = {
            id_usuario_solicitante: currentUser.id_usuario,
            motivo: defaultMotivo
        };

        if (tipoDoc === "Compra") {
            payload.id_compra = parseInt(docId);
        } else {
            payload.id_venta = parseInt(docId);
        }

        const response = await apiPost('/anulaciones', payload);
        if (response.error) {
            alert("Error al anular directamente: " + response.error);
            return false;
        }

        alert(`¡La ${actionText} ha sido anulada con éxito de forma directa!`);
        return true;
    } catch (err) {
        console.error("Error al realizar anulación directa:", err);
        alert("Error al anular el documento.");
        return false;
    }
}

window.abrirSolicitudAnulacion = abrirSolicitudAnulacion;

// ==========================================
// ABRIR VENTANA DE SOLICITUD DE ANULACIÓN
// ==========================================
async function abrirSolicitudAnulacion(docId, tipoDoc = "Venta") {
    if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'admin')) {
        const result = await anularDirecto(docId, tipoDoc);
        if (result) {
            if (tipoDoc === "Compra") {
                if (typeof window.cargarComprasRealizadas === "function") await window.cargarComprasRealizadas();
                document.getElementById("vol_v_compra_hist")?.click();
            } else {
                if (typeof window.cargarVentasRealizadas === "function") await window.cargarVentasRealizadas();
                document.getElementById("vol_v_venta")?.click();
            }
            await cargarDatosIniciales();
        }
        return;
    }

    window.activeAnulacionTipo = tipoDoc;
    // Restablecer campos
    document.getElementById("anulacion_motivo").value = "";
    document.getElementById("anulacion_venta_id").value = docId;

    // Cargar administradores en el select
    const selectAdmin = document.getElementById("anulacion_admin");
    if (selectAdmin) {
        selectAdmin.innerHTML = '<option value="">Seleccione un administrador...</option>';

        try {
            const usuarios = await apiGet('/usuarios');
            usuarios.forEach(u => {
                if (u.estado === 'Activo' && (u.rol.toLowerCase().includes("admin") || u.rol.toLowerCase().includes("gerente"))) {
                    const opt = document.createElement("option");
                    opt.value = u.id_usuario;
                    opt.textContent = `${u.nombre_completo} (${u.rol})`;
                    selectAdmin.appendChild(opt);
                }
            });
        } catch (err) {
            console.error("Error al cargar administradores para anulación:", err);
        }
    }

    // Mostrar modal de solicitud
    mostrarModal("modal_solicitar_anulacion");
}

// ==========================================
// PROCESAR ENVÍO DE SOLICITUD DE ANULACIÓN
// ==========================================
async function procesarEnvioSolicitud(e) {
    e.preventDefault();

    const referenceId = document.getElementById("anulacion_venta_id").value;
    const motivo = document.getElementById("anulacion_motivo").value.trim();
    const adminId = document.getElementById("anulacion_admin").value;
    const solicitanteId = window.currentUser?.id_usuario || 1;
    const tipoDoc = window.activeAnulacionTipo || "Venta";

    if (!motivo) {
        alert("Por favor, describa el motivo de la anulación.");
        return;
    }
    if (!adminId) {
        alert("Por favor, seleccione un administrador asignado.");
        return;
    }

    const payload = {
        motivo: motivo,
        id_usuario_solicitante: solicitanteId,
        id_usuario_admin: parseInt(adminId)
    };

    if (tipoDoc === "Compra") {
        payload.id_compra = parseInt(referenceId);
    } else {
        payload.id_venta = parseInt(referenceId);
    }

    try {
        const response = await apiPost('/anulaciones', payload);
        if (response.error) {
            alert("Error al registrar solicitud: " + response.error);
            return;
        }

        const adminName = document.getElementById("anulacion_admin").options[document.getElementById("anulacion_admin").selectedIndex].text;
        alert(`Solicitud de anulación registrada con éxito para revisión por ${adminName}.`);

        // Cerrar modals
        closeMostAggProdu();

        // Actualizar historial en UI
        if (tipoDoc === "Compra") {
            if (typeof window.cargarComprasRealizadas === "function") {
                window.cargarComprasRealizadas();
            }
        } else {
            if (typeof window.cargarVentasRealizadas === "function") {
                window.cargarVentasRealizadas();
            }
        }
        renderSolicitudes();
    } catch (err) {
        console.error("Error al enviar solicitud de anulación:", err);
        alert("Error de conexión al registrar la solicitud de anulación.");
    }
}

// ==========================================
// MOSTRAR U OCULTAR SECCIÓN SEGÚN ROL (ADMIN)
// ==========================================
window.actualizarVisibilidadAnulaciones = function () {
    const navAnulaciones = document.getElementById("nav_anulaciones");
    if (!navAnulaciones) return;

    const currentRole = (typeof activeRole !== "undefined" && activeRole) ? activeRole : "gerente";

    // Gerente y Admin pueden ver anulaciones; Vendedor no
    if (currentRole === "gerente" || currentRole === "admin") {
        navAnulaciones.style.display = "flex";
    } else {
        navAnulaciones.style.display = "none";

        // Redirigir al inicio si el usuario estaba viendo la sección restringida
        const activeSection = document.querySelector(".content-section.active");
        if (activeSection && activeSection.id === "anulaciones") {
            const btnInicio = document.querySelector('.nav_button[data-section="inicio"]');
            if (btnInicio) btnInicio.click();
        }
    }
};

// ==========================================
// RENDERIZAR TABLA DE SOLICITUDES (ADMIN)
// ==========================================
async function renderSolicitudes() {
    const tbody = document.getElementById("tabla_solicitudes_anulacion_body");
    if (!tbody) return;

    const dateInput = document.getElementById("fecha_solicitud_anulacion");
    if (dateInput && !dateInput.value) {
        dateInput.value = getLocalDateString();
    }
    const selectedDate = dateInput ? dateInput.value : getLocalDateString();

    try {
        const allSolicitudes = await apiGet('/anulaciones');
        const solicitudes = allSolicitudes.filter(s => s.fecha === selectedDate);
        window.listadoSolicitudes = solicitudes;

        // Contadores de KPIs
        let pendientesCount = 0;
        let aprobadasCount = 0;
        let rechazadasCount = 0;

        solicitudes.forEach(s => {
            if (s.estado === "Pendiente") pendientesCount++;
            else if (s.estado.startsWith("Aprob")) aprobadasCount++;
            else if (s.estado.startsWith("Rechaz")) rechazadasCount++;
        });

        // Actualizar badges/KPIs
        const elTotal = document.getElementById("cant_total_anulacion");
        if (elTotal) elTotal.textContent = solicitudes.length;
        document.getElementById("cant_pendientes_anulacion").textContent = pendientesCount;
        document.getElementById("cant_aprobadas_anulacion").textContent = aprobadasCount;
        document.getElementById("cant_rechazadas_anulacion").textContent = rechazadasCount;

        // Aplicar filtro activo
        const filtradas = solicitudes.filter(s => {
            if (filtroAnulacionActivo === "Todas") return true;

            const normalizedState = s.estado.startsWith("Aprob") ? "Aprobada" : s.estado.startsWith("Rechaz") ? "Rechazada" : "Pendiente";
            return normalizedState === filtroAnulacionActivo;
        });

        if (filtradas.length === 0) {
            let mensajeVacio = "No se han registrado solicitudes de anulación en el sistema.";
            if (filtroAnulacionActivo === "Pendiente") mensajeVacio = "No hay solicitudes pendientes de revisión.";
            else if (filtroAnulacionActivo === "Aprobada") mensajeVacio = "No hay solicitudes aprobadas.";
            else if (filtroAnulacionActivo === "Rechazada") mensajeVacio = "No hay solicitudes rechazadas.";

            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: #64748b; padding: 25px; font-weight: 500;">
                        ${mensajeVacio}
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = filtradas.map(sol => {
            const isAprobada = sol.estado.startsWith("Aprob");
            const isRechazada = sol.estado.startsWith("Rechaz");

            let badgeStyle = "background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            if (isAprobada) {
                badgeStyle = "background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            } else if (isRechazada) {
                badgeStyle = "background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            }

            let actionsHTML = `<span style="color: #94a3b8; font-style: italic;">Resuelto</span>`;
            if (sol.estado === "Pendiente") {
                actionsHTML = `
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn_aprobar" onclick="resolverSolicitudAnulacion('${sol.id}', 'Aprobada')" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;">Aprobar</button>
                        <button class="btn_rechazar" onclick="resolverSolicitudAnulacion('${sol.id}', 'Rechazada')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 12px;">Rechazar</button>
                    </div>
                `;
            }

            const isCompra = sol.tipo === "Compra";
            const isGasto = sol.tipo === "Gasto";
            const isProducto = sol.tipo === "Producto";
            const isProveedor = sol.tipo === "Proveedor";
            let clickAction = "";
            let labelText = "";

            if (isGasto) {
                clickAction = `window.mostrarDetallesGasto('${sol.id}')`;
                labelText = `C$ ${parseFloat(sol.monto).toFixed(2)} (Gasto)`;
            } else if (isCompra) {
                clickAction = `window.mostrarDetallesCompra('${sol.id_original}')`;
                labelText = `${sol.ventaId} (Compra)`;
            } else if (isProducto) {
                clickAction = `window.mostrarDetallesProducto('${sol.id}')`;
                labelText = `${sol.detallesProducto?.name || 'Producto'} (Eliminar)`;
            } else if (isProveedor) {
                clickAction = `window.mostrarDetallesProveedor('${sol.id}')`;
                labelText = `${sol.detallesProveedor?.name || 'Proveedor'} (Desactivar)`;
            } else {
                clickAction = `window.mostrarDetallesVenta('${sol.id_original}')`;
                labelText = `${sol.ventaId} (Venta)`;
            }

            return `
                <tr data-estado="${sol.estado}" style="border-bottom: 1px solid #e2e8f0; transition: background 0.15s;">
                    <td style="padding: 14px; font-weight: bold; color: #1e293b;">${sol.id}</td>
                    <td style="padding: 14px;"><a href="#" onclick="event.preventDefault(); ${clickAction}" style="color: #2563eb; font-weight: 600; text-decoration: none;">${labelText}</a></td>
                    <td style="padding: 14px; color: #475569;">${sol.fecha}</td>
                    <td style="padding: 14px; font-weight: 500; color: #0f172a;">${sol.solicitadoPor}</td>
                    <td style="padding: 14px; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #475569;" title="${sol.motivo}">${sol.motivo}</td>
                    <td style="padding: 14px; color: #475569;">${sol.adminAsignado}</td>
                    <td style="padding: 14px;"><span style="${badgeStyle}">${sol.estado}</span></td>
                    <td style="padding: 14px; text-align: center;">${actionsHTML}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar solicitudes de anulación:", err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 25px;">Error al obtener solicitudes desde el servidor.</td></tr>`;
    }
}

// ==========================================
// RESOLVER SOLICITUD DE ANULACIÓN (ADMIN)
// ==========================================
window.resolverSolicitudAnulacion = async function (solicitudId, nuevoEstado) {
    const solicitudes = window.listadoSolicitudes || [];
    const sol = solicitudes.find(s => s.id === solicitudId);

    if (!sol) {
        alert("No se encontró la solicitud especificada.");
        return;
    }

    const adminId = window.currentUser?.id_usuario || 1;
    const isCompra = sol.tipo === "Compra";
    const isGasto = sol.tipo === "Gasto";
    const isProducto = sol.tipo === "Producto";
    const isProveedor = sol.tipo === "Proveedor";

    let endpoint = "";
    let payload = {};

    if (isGasto) {
        endpoint = `/gastos/${sol.id_original}`;
        const estadoGasto = nuevoEstado === "Aprobada" ? "Aprobado" : nuevoEstado === "Rechazada" ? "Rechazado" : nuevoEstado;
        payload = { estado: estadoGasto, id_usuario_admin: adminId };
    } else if (isProducto) {
        endpoint = `/anulaciones/eliminacion/${sol.id_original}`;
        payload = { estado: nuevoEstado };
    } else if (isProveedor) {
        endpoint = `/anulaciones/proveedor/${sol.id_original}`;
        payload = { estado: nuevoEstado, id_usuario_admin: adminId };
    } else {
        endpoint = `/anulaciones/${sol.id_original}`;
        payload = { estado: nuevoEstado, id_usuario_admin: adminId };
    }

    try {
        const result = await apiPatch(endpoint, payload);
        if (result.error) {
            alert("Error al resolver la solicitud: " + result.error);
            return;
        }

        alert(`Solicitud ${nuevoEstado.toLowerCase()} con éxito.`);

        // Cerrar modals
        closeMostAggProdu();

        // Recargar datos locales
        await cargarDatosIniciales();
        if (isGasto && typeof window.renderGastos === "function") {
            window.renderGastos();
        }
        if (isCompra && typeof window.cargarComprasRealizadas === "function") {
            window.cargarComprasRealizadas();
        }
        if (!isCompra && !isGasto && !isProducto && !isProveedor && typeof window.cargarVentasRealizadas === "function") {
            window.cargarVentasRealizadas();
        }
        if (isProveedor && typeof window.cargarProveedores === "function") {
            window.cargarProveedores();
        }

        // Recargar solicitudes
        renderSolicitudes();
    } catch (err) {
        console.error("Error al resolver la solicitud:", err);
        alert("Error de conexión al procesar la solicitud en el servidor.");
    }
};

// ==========================================
// FILTRAR SOLICITUDES DE LA TABLA
// ==========================================
function filtrarTablaSolicitudes(e) {
    const query = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll("#tabla_solicitudes_anulacion_body tr");

    rows.forEach(row => {
        // Ignorar filas de 'sin resultados'
        if (row.cells.length === 1 && row.cells[0].colSpan === 8) return;

        let textMatch = false;
        Array.from(row.cells).forEach(cell => {
            if (cell.textContent.toLowerCase().includes(query)) {
                textMatch = true;
            }
        });
        row.style.display = textMatch ? "" : "none";
    });
}

// ==========================================
// MOSTRAR DETALLES DE GASTO EN MODAL
// ==========================================
window.mostrarDetallesGasto = function (gastoId) {
    const solicitudes = window.listadoSolicitudes || [];
    const sol = solicitudes.find(s => s.id === gastoId && s.tipo === "Gasto");
    if (!sol) {
        alert("No se encontró el detalle del gasto especificado.");
        return;
    }

    // Actualizar campos principales del modal
    document.getElementById("ver_gasto_titulo").textContent = `Gasto Número ${sol.id}`;
    document.getElementById("det_gasto_id").textContent = sol.id;
    document.getElementById("det_gasto_fecha").textContent = sol.fecha;
    document.getElementById("det_gasto_usuario").textContent = sol.solicitadoPor;
    document.getElementById("det_gasto_admin").textContent = sol.adminAsignado;

    // Formatear badge de estado
    const estadoEl = document.getElementById("det_gasto_estado");
    if (estadoEl) {
        estadoEl.textContent = sol.estado;
        estadoEl.style.padding = "4px 8px";
        estadoEl.style.borderRadius = "6px";
        estadoEl.style.fontSize = "12px";
        estadoEl.style.fontWeight = "bold";
        estadoEl.style.display = "inline-block";
        if (sol.estado === "Aprobada" || sol.estado === "Aprobado") {
            estadoEl.style.background = "#dcfce7";
            estadoEl.style.color = "#16a34a";
        } else if (sol.estado === "Rechazada" || sol.estado === "Rechazado") {
            estadoEl.style.background = "#fee2e2";
            estadoEl.style.color = "#dc2626";
        } else {
            estadoEl.style.background = "#fef3c7";
            estadoEl.style.color = "#d97706";
        }
    }

    // Motivo y total
    document.getElementById("det_gasto_motivo").textContent = sol.motivo;
    document.getElementById("det_gasto_total").textContent = `C$ ${parseFloat(sol.monto).toFixed(2)}`;

    // Configurar botones de acción
    const btnAcciones = document.getElementById("det_gasto_acciones");
    const btnAprobar = document.getElementById("btn_aprobar_gasto_modal");
    const btnRechazar = document.getElementById("btn_rechazar_gasto_modal");

    if (btnAcciones && btnAprobar && btnRechazar) {
        if (sol.estado === "Pendiente") {
            btnAcciones.style.display = "flex";

            // Vincular acciones a los botones del modal
            btnAprobar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Aprobada");
                window.closeMostAggProdu();
            };

            btnRechazar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Rechazada");
                window.closeMostAggProdu();
            };
        } else {
            btnAcciones.style.display = "none";
        }
    }

    window.mostrarModal("modal_ver_gastos");
};

// ==========================================
// MOSTRAR DETALLES DE ELIMINACIÓN DE PRODUCTO EN MODAL
// ==========================================
window.mostrarDetallesProducto = function (solicitudId) {
    const solicitudes = window.listadoSolicitudes || [];
    const sol = solicitudes.find(s => s.id === solicitudId && s.tipo === "Producto");
    if (!sol) {
        alert("No se encontró el detalle de la solicitud especificada.");
        return;
    }

    // Actualizar campos principales del modal
    document.getElementById("ver_prod_elim_titulo").textContent = `Eliminación: ${sol.detallesProducto?.name || 'Producto'}`;
    document.getElementById("det_prod_elim_id").textContent = sol.detallesProducto?.id || "-";
    document.getElementById("det_prod_elim_categoria").textContent = sol.detallesProducto?.category || "-";
    document.getElementById("det_prod_elim_ubicacion").textContent = sol.detallesProducto?.location || "-";
    document.getElementById("det_prod_elim_usuario").textContent = sol.solicitadoPor;
    document.getElementById("det_prod_elim_fecha").textContent = sol.fecha;

    // Formatear badge de estado
    const estadoEl = document.getElementById("det_prod_elim_estado");
    if (estadoEl) {
        estadoEl.textContent = sol.estado;
        estadoEl.style.padding = "4px 8px";
        estadoEl.style.borderRadius = "6px";
        estadoEl.style.fontSize = "12px";
        estadoEl.style.fontWeight = "bold";
        estadoEl.style.display = "inline-block";
        if (sol.estado === "Aprobada" || sol.estado === "Aprobado") {
            estadoEl.style.background = "#dcfce7";
            estadoEl.style.color = "#16a34a";
        } else if (sol.estado === "Rechazada" || sol.estado === "Rechazado") {
            estadoEl.style.background = "#fee2e2";
            estadoEl.style.color = "#dc2626";
        } else {
            estadoEl.style.background = "#fef3c7";
            estadoEl.style.color = "#d97706";
        }
    }

    // Motivo
    document.getElementById("det_prod_elim_motivo").textContent = sol.motivo;

    // Configurar botones de acción
    const btnAcciones = document.getElementById("det_prod_elim_acciones");
    const btnAprobar = document.getElementById("btn_aprobar_prod_elim_modal");
    const btnRechazar = document.getElementById("btn_rechazar_prod_elim_modal");

    if (btnAcciones && btnAprobar && btnRechazar) {
        if (sol.estado === "Pendiente") {
            btnAcciones.style.display = "flex";

            // Vincular acciones a los botones del modal
            btnAprobar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Aprobada");
                window.closeMostAggProdu();
            };

            btnRechazar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Rechazada");
                window.closeMostAggProdu();
            };
        } else {
            btnAcciones.style.display = "none";
        }
    }

    window.mostrarModal("modal_ver_producto_eliminar");
};

// ==========================================
// MOSTRAR DETALLES DE DESACTIVACIÓN DE PROVEEDOR
// ==========================================
window.mostrarDetallesProveedor = function (solicitudId) {
    const solicitudes = window.listadoSolicitudes || [];
    const sol = solicitudes.find(s => s.id === solicitudId && s.tipo === "Proveedor");
    if (!sol) return;

    // Actualizar campos principales del modal
    document.getElementById("ver_prov_inact_titulo").textContent = `Inactivación: ${sol.detallesProveedor?.name || 'Proveedor'}`;
    document.getElementById("det_prov_inact_id").textContent = sol.detallesProveedor?.id || "-";
    document.getElementById("det_prov_inact_nombre").textContent = sol.detallesProveedor?.name || "-";
    document.getElementById("det_prov_inact_usuario").textContent = sol.solicitadoPor;
    document.getElementById("det_prov_inact_fecha").textContent = sol.fecha;

    // Formatear badge de estado
    const estadoEl = document.getElementById("det_prov_inact_estado");
    if (estadoEl) {
        estadoEl.textContent = sol.estado;
        estadoEl.style.padding = "4px 8px";
        estadoEl.style.borderRadius = "6px";
        estadoEl.style.fontSize = "12px";
        estadoEl.style.fontWeight = "bold";
        estadoEl.style.display = "inline-block";
        if (sol.estado === "Aprobada" || sol.estado === "Aprobado") {
            estadoEl.style.background = "#dcfce7";
            estadoEl.style.color = "#16a34a";
        } else if (sol.estado === "Rechazada" || sol.estado === "Rechazado") {
            estadoEl.style.background = "#fee2e2";
            estadoEl.style.color = "#dc2626";
        } else {
            estadoEl.style.background = "#fef3c7";
            estadoEl.style.color = "#d97706";
        }
    }

    // Motivo
    document.getElementById("det_prov_inact_motivo").textContent = sol.motivo;

    // Configurar botones de acción
    const btnAcciones = document.getElementById("det_prov_inact_acciones");
    const btnAprobar = document.getElementById("btn_aprobar_prov_inact_modal");
    const btnRechazar = document.getElementById("btn_rechazar_prov_inact_modal");

    if (btnAcciones && btnAprobar && btnRechazar) {
        if (sol.estado === "Pendiente") {
            btnAcciones.style.display = "flex";

            // Vincular acciones a los botones del modal
            btnAprobar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Aprobada");
                window.closeMostAggProdu();
            };

            btnRechazar.onclick = () => {
                window.resolverSolicitudAnulacion(sol.id, "Rechazada");
                window.closeMostAggProdu();
            };
        } else {
            btnAcciones.style.display = "none";
        }
    }

    window.mostrarModal("modal_ver_proveedor_inactivar");
};

// ============================================================================
// GESTIÓN DE GASTOS DE CAJA
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    cargarAdministradoresGastos();
    renderGastos();

    let efectivoDisponibleActual = 1000;

    async function actualizarSaldoCajaGastos() {
        const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        try {
            let ventas, gastos;
            let inicial = 1000;

            if (window.arqueoActivo) {
                inicial = parseFloat(window.arqueoActivo.efectivo_inicial) || 0;
                [ventas, gastos] = await Promise.all([
                    apiGet(`/ventas?id_arqueo=${window.arqueoActivo.id_arqueo}`),
                    apiGet(`/gastos?id_arqueo=${window.arqueoActivo.id_arqueo}&estado=Aprobado`)
                ]);
            } else {
                inicial = 0;
                ventas = [];
                gastos = [];
            }

            const ventasEfectivo = ventas
                .filter(v => v.estado !== "Anulada" && v.metodo_pago === "Efectivo" && String(v.sucursal).toLowerCase().trim() === activeSucursalName.toLowerCase().trim())
                .reduce((sum, v) => sum + (parseFloat(v.total) || 0), 0);

            const gastosAprobados = gastos.reduce((sum, g) => sum + (parseFloat(g.monto) || 0), 0);

            efectivoDisponibleActual = inicial + ventasEfectivo - gastosAprobados;
        } catch (err) {
            console.error("Error al obtener saldo de caja para gastos:", err);
        }
    }

    const montoInputEl = document.getElementById("gasto_monto");
    const alertaExcedidoEl = document.getElementById("gasto_alerta_excedido");

    montoInputEl?.addEventListener("focus", async () => {
        await actualizarSaldoCajaGastos();
        validarMontoExcedido();
    });

    montoInputEl?.addEventListener("input", () => {
        validarMontoExcedido();
    });

    function validarMontoExcedido() {
        if (!montoInputEl || !alertaExcedidoEl) return;
        const monto = parseFloat(montoInputEl.value) || 0;
        if (monto > efectivoDisponibleActual) {
            alertaExcedidoEl.style.display = "block";
            montoInputEl.style.borderColor = "#dc2626";
            montoInputEl.style.boxShadow = "0 0 0 3px rgba(220, 38, 38, 0.15)";
        } else {
            alertaExcedidoEl.style.display = "none";
            montoInputEl.style.borderColor = "";
            montoInputEl.style.boxShadow = "";
        }
    }

    // Actualizar datos al hacer clic en el botón de navegación de gastos
    document.querySelector('.nav_button[data-section="gastos"]')?.addEventListener('click', () => {
        cargarAdministradoresGastos();
        renderGastos();
    });

    // Escuchar el formulario de gastos
    document.getElementById("form_solicitar_gasto")?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const montoInput = document.getElementById("gasto_monto");
        const motivoInput = document.getElementById("gasto_motivo");
        const adminSelect = document.getElementById("gasto_admin");

        if (!montoInput || !motivoInput || !adminSelect) return;

        const monto = parseFloat(montoInput.value);
        const motivo = motivoInput.value.trim();
        const adminId = adminSelect.value;

        if (isNaN(monto) || monto <= 0) {
            alert("Por favor, ingrese un monto de retiro válido.");
            return;
        }

        if (!motivo) {
            alert("Por favor, escriba la razón de pago o justificación.");
            return;
        }
        if (!adminId) {
            alert("Por favor, seleccione un administrador asignado.");
            return;
        }

        // Validar si el monto solicitado es mayor al efectivo disponible en la caja
        await actualizarSaldoCajaGastos();
        if (monto > efectivoDisponibleActual) {
            mostrarToast("Excedió al monto de la caja", "danger");
            if (alertaExcedidoEl) {
                alertaExcedidoEl.style.display = "block";
            }
            if (montoInputEl) {
                montoInputEl.style.borderColor = "#dc2626";
                montoInputEl.style.boxShadow = "0 0 0 3px rgba(220, 38, 38, 0.15)";
            }
            return;
        }

        const solicitanteId = window.currentUser?.id_usuario || 1;
        const solicitanteName = window.currentUser?.name || "Carmelo";

        // Buscar el ID de la sucursal actual
        const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        const sucursalObj = (window.sucursalesCache || []).find(s => s.nombre === activeSucursalName);
        const sucursalId = sucursalObj ? sucursalObj.id_sucursal : 1;

        const payload = {
            monto: monto,
            motivo: motivo,
            id_usuario_solicitante: solicitanteId,
            id_usuario_admin: parseInt(adminId),
            id_sucursal: sucursalId
        };

        try {
            const response = await apiPost('/gastos', payload);
            if (response.error) {
                alert("Error al registrar gasto: " + response.error);
                return;
            }

            const adminName = adminSelect.options[adminSelect.selectedIndex].text;
            alert(`Solicitud de salida de efectivo registrada. Requiere la aprobación del administrador asignado (${adminName}) en la pestaña de Anulaciones.`);

            // Restablecer campos
            montoInput.value = "";
            motivoInput.value = "";

            // Re-renderizar tablas
            renderGastos();
            if (typeof window.renderSolicitudes === "function") {
                window.renderSolicitudes();
            }

            // Recalcular caja
            if (typeof window.recalcularVentasEfectivo === "function") {
                window.recalcularVentasEfectivo();
            }
            if (typeof window.calcularCuadre === "function") {
                window.calcularCuadre();
            }
        } catch (err) {
            console.error("Error al guardar gasto:", err);
            alert("Error de conexión al registrar el gasto en el servidor.");
        }
    });
});

// Carga de administradores del sistema
async function cargarAdministradoresGastos() {
    const selectAdmin = document.getElementById("gasto_admin");
    if (!selectAdmin) return;

    selectAdmin.innerHTML = '<option value="">Seleccione un administrador...</option>';

    try {
        const usuarios = await apiGet('/usuarios');
        usuarios.forEach(u => {
            if (u.estado === 'Activo' && (u.rol.toLowerCase().includes("admin") || u.rol.toLowerCase().includes("gerente"))) {
                const opt = document.createElement("option");
                opt.value = u.id_usuario;
                opt.textContent = `${u.nombre_completo} (${u.rol})`;
                selectAdmin.appendChild(opt);
            }
        });
    } catch (err) {
        console.error("Error al cargar administradores para gastos:", err);
    }
}

// Renderizado de las solicitudes locales de gastos
async function renderGastos() {
    const tbody = document.getElementById("tabla_gastos_cuerpo");
    if (!tbody) return;

    try {
        const activeSucursalName = document.getElementById('card_operar_sucursal')?.textContent || 'Central';
        const gastos = await apiGet(`/gastos?sucursal=${activeSucursalName}`);

        if (gastos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: #64748b; padding: 25px; font-weight: 500;">
                        No se han registrado solicitudes de gasto.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = gastos.map(g => {
            let badgeStyle = "background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            if (g.estado === "Aprobado" || g.estado === "Aprobada") {
                badgeStyle = "background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            } else if (g.estado === "Rechazado" || g.estado === "Rechazada") {
                badgeStyle = "background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold;";
            }

            const fechaFormateada = g.fecha ? getCleanLocalDate(g.fecha) : '';

            return `
                <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.15s;">
                    <td style="padding: 12px; font-weight: bold; color: #1e293b;">GAST-${g.id_gasto}</td>
                    <td style="padding: 12px; color: #475569;">${fechaFormateada}</td>
                    <td style="padding: 12px; font-weight: 700; color: #ef4444;">C$ ${parseFloat(g.monto).toFixed(2)}</td>
                    <td style="padding: 12px; color: #475569; font-weight: 500;">${g.solicitante}</td>
                    <td style="padding: 12px; color: #475569; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${g.motivo}">${g.motivo}</td>
                    <td style="padding: 12px;"><span style="${badgeStyle}">${g.estado}</span></td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Error al renderizar gastos:", err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 25px;">Error al cargar gastos desde el servidor.</td></tr>`;
    }
}

// Exponer funciones globalmente
window.cargarAdministradoresGastos = cargarAdministradoresGastos;
window.renderGastos = renderGastos;

// ============================================================================
// ACTUALIZACIÓN EN TIEMPO REAL (POLLING DE LA VISTA ACTIVA)
// ============================================================================
let isPollingActive = false;
async function actualizarDatosEnTiempoReal() {
    if (isPollingActive) return;
    // Si no hay sesión o si la pantalla de login está activa, no hacemos nada
    if (!window.currentUser || document.body.classList.contains('login-active')) return;

    isPollingActive = true;
    try {
        if (typeof verificarArqueoActivo === 'function') {
            await verificarArqueoActivo();
        }
        const activeSection = document.querySelector('.content-section.active');
        const activeSectionId = activeSection ? activeSection.id : '';

        if (!activeSectionId) return;

        // Cargar datos base en memoria (como catálogo de productos y sucursales)
        await cargarDatosIniciales();

        switch (activeSectionId) {
            case 'inicio':
                if (typeof cargarDashboard === 'function') await cargarDashboard();
                break;
            case 'inventario':
                const tabVerInvent = document.getElementById('tab_ver_inventario');
                if (tabVerInvent && tabVerInvent.style.display !== 'none') {
                    if (typeof cargarInventario === 'function') await cargarInventario();
                }
                break;
            case 'productos':
                const buscProd = document.getElementById('buscar_producto_gestion');
                if (typeof cargarProductos === 'function' && (!buscProd || !buscProd.value.trim())) {
                    await cargarProductos();
                }
                break;
            case 'ventas':
                const tabHistorialVentas = document.getElementById('tab_historial_ventas');
                const tabArqueoCaja = document.getElementById('tab_arqueo_caja');
                if (tabHistorialVentas && tabHistorialVentas.style.display !== 'none') {
                    if (typeof cargarVentasRealizadas === 'function') await cargarVentasRealizadas();
                } else if (tabArqueoCaja && tabArqueoCaja.style.display !== 'none') {
                    if (typeof cargarVentasRealizadas === 'function') {
                        await cargarVentasRealizadas();
                        if (typeof cargarGastosAprobados === 'function') await cargarGastosAprobados();
                        if (typeof cargarHistorialArqueos === 'function') await cargarHistorialArqueos();
                    }
                }
                break;
            case 'proveedores':
                if (typeof cargarProveedores === 'function') await cargarProveedores();
                break;
            case 'compras':
                const tabHistorialCompras = document.getElementById('tab_historial_compras');
                if (tabHistorialCompras && tabHistorialCompras.style.display !== 'none') {
                    if (typeof window.cargarComprasRealizadas === 'function') window.cargarComprasRealizadas();
                }
                break;
            case 'anulaciones':
                if (typeof renderSolicitudes === 'function') await renderSolicitudes();
                break;
            case 'gastos':
                if (typeof renderGastos === 'function') await renderGastos();
                break;
            default:
                break;
        }
    } catch (err) {
        console.error("Error en actualizarDatosEnTiempoReal:", err);
    } finally {
        isPollingActive = false;
    }
}
window.actualizarDatosEnTiempoReal = actualizarDatosEnTiempoReal;

console.log('✅ InvVentas Licor - Frontend conectado al backend Node.js + MySQL');

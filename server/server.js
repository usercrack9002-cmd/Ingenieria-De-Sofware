const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 3000;

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'invventas_licor_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, '..', 'nuevo')));

// ============================================================================
// RUTAS API
// ============================================================================
const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const productosRoutes = require('./routes/productos');
const categoriasRoutes = require('./routes/categorias');
const inventarioRoutes = require('./routes/inventario');
const ventasRoutes = require('./routes/ventas');
const proveedoresRoutes = require('./routes/proveedores');
const comprasRoutes = require('./routes/compras');
const gastosRoutes = require('./routes/gastos');
const anulacionesRoutes = require('./routes/anulaciones');
const arqueoRoutes = require('./routes/arqueo');
const reportesRoutes = require('./routes/reportes');

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/gastos', gastosRoutes);
app.use('/api/anulaciones', anulacionesRoutes);
app.use('/api/arqueo', arqueoRoutes);
app.use('/api/reportes', reportesRoutes);

// Ruta raíz: servir el index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'nuevo', 'index.html'));
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================
const os = require('os');
const db = require('./config/db');

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

db.initDatabase()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            const localIP = getLocalIP();
            console.log('═══════════════════════════════════════════════════');
            console.log('  InvVentas Licor - Servidor Backend');
            console.log(`  🌐 Local:   http://localhost:${PORT}`);
            console.log(`  🌐 Red:     http://${localIP}:${PORT}`);
            console.log('  📦 Base de datos: invventas_licor (MySQL)');
            console.log('═══════════════════════════════════════════════════');
        });
    })
    .catch(err => {
        console.error('❌ No se pudo iniciar el servidor debido a fallos en la base de datos.');
        process.exit(1);
    });

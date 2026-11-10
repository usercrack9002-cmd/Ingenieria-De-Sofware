const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { usuario, contrasena } = req.body;
        if (!usuario || !contrasena) {
            return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
        }

        const [rows] = await db.query(`
            SELECT u.id_usuario, u.nombre_completo, u.usuario, u.contrasena, e.nombre AS estado,
                   r.nombre AS rol, s.nombre AS sucursal, u.id_sucursal
            FROM usuarios u
            JOIN roles r ON u.id_rol = r.id_rol
            LEFT JOIN sucursales s ON u.id_sucursal = s.id_sucursal
            LEFT JOIN estados e ON u.id_estado = e.id_estado
            WHERE u.usuario = ? OR u.nombre_completo = ?
        `, [usuario.toLowerCase(), usuario]);

        if (rows.length === 0) {
            return res.status(401).json({ error: 'El usuario ingresado no existe en el sistema.' });
        }

        const user = rows[0];

        if (user.estado === 'Inactivo') {
            return res.status(403).json({ error: 'Este usuario se encuentra inactivo. Contacte al administrador.' });
        }

        const passwordMatch = await bcrypt.compare(contrasena, user.contrasena);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'La contraseña ingresada es incorrecta.' });
        }

        // Actualizar última sesión
        await db.query('UPDATE usuarios SET ultima_sesion = NOW() WHERE id_usuario = ?', [user.id_usuario]);

        // Registrar sesión
        await db.query(
            'INSERT INTO sesiones (id_usuario, id_sucursal) VALUES (?, ?)',
            [user.id_usuario, user.id_sucursal]
        );

        // Mapear rol
        let role = 'vendedor';
        if (user.rol.toLowerCase().includes('gerente')) role = 'gerente';
        else if (user.rol.toLowerCase().includes('admin')) role = 'admin';

        const sessionData = {
            id_usuario: user.id_usuario,
            name: user.nombre_completo,
            username: user.usuario,
            role: role,
            sucursal: user.sucursal || 'Central'
        };

        req.session.user = sessionData;

        res.json({ success: true, user: sessionData });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
    try {
        if (req.session.user) {
            // No permitir salir mientras el usuario tenga una caja abierta
            const [abiertas] = await db.query(`
                SELECT ac.id_arqueo, s.nombre AS sucursal
                FROM arqueos_caja ac
                JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
                WHERE ac.id_usuario = ? AND ac.estado = 'Abierto'
                LIMIT 1
            `, [req.session.user.id_usuario]);
            if (abiertas.length > 0) {
                return res.status(409).json({
                    error: `Tienes la caja abierta en la sucursal ${abiertas[0].sucursal}. Debes cerrarla (realizar el arqueo) antes de cerrar sesión.`
                });
            }

            // Cerrar sesión activa
            await db.query(
                'UPDATE sesiones SET fecha_fin = NOW(), activa = 0 WHERE id_usuario = ? AND activa = 1',
                [req.session.user.id_usuario]
            );
        }
        req.session.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error('Error en logout:', err);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// GET /api/auth/session
router.get('/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// POST /api/auth/init - Crear usuario Carmelo si no existe
router.post('/init', async (req, res) => {
    try {
        const [existing] = await db.query('SELECT id_usuario FROM usuarios WHERE usuario = ?', ['carmelo']);
        if (existing.length > 0) {
            return res.json({ message: 'Usuario Carmelo ya existe.', initialized: false });
        }

        const hashedPassword = await bcrypt.hash('admin', 10);
        await db.query(`
            INSERT INTO usuarios (nombre_completo, usuario, contrasena, id_rol, id_sucursal)
            VALUES (?, ?, ?, ?, NULL)
        `, ['Carmelo', 'carmelo', hashedPassword, 1]); // id_rol = 1 (Gerente), id_sucursal = NULL (todas)

        res.json({ message: 'Usuario Carmelo creado exitosamente.', initialized: true });
    } catch (err) {
        console.error('Error en init:', err);
        res.status(500).json({ error: 'Error al inicializar.' });
    }
});

module.exports = router;

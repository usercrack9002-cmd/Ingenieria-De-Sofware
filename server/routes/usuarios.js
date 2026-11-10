const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// GET /api/usuarios - Listar todos los usuarios
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id_usuario, u.nombre_completo, u.usuario, e.nombre AS estado,
                   r.nombre AS rol, r.id_rol,
                   COALESCE(s.nombre, 'Todas') AS sucursal, u.id_sucursal,
                   u.ultima_sesion, u.fecha_creacion
            FROM usuarios u
            JOIN roles r ON u.id_rol = r.id_rol
            LEFT JOIN sucursales s ON u.id_sucursal = s.id_sucursal
            LEFT JOIN estados e ON u.id_estado = e.id_estado
            ORDER BY u.id_usuario ASC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar usuarios:', err);
        res.status(500).json({ error: 'Error al obtener usuarios.' });
    }
});

// POST /api/usuarios - Crear usuario
router.post('/', async (req, res) => {
    try {
        const { nombre_completo, usuario, contrasena, id_rol, id_sucursal } = req.body;
        if (!nombre_completo || !usuario || !contrasena || !id_rol) {
            return res.status(400).json({ error: 'Campos obligatorios faltantes.' });
        }

        // Verificar si el usuario ya existe
        const [existing] = await db.query('SELECT id_usuario FROM usuarios WHERE usuario = ?', [usuario.toLowerCase()]);
        if (existing.length > 0) {
            return res.status(409).json({ error: 'El nombre de usuario ya existe.' });
        }

        const hashedPassword = await bcrypt.hash(contrasena, 10);
        const sucursal = id_sucursal || null;

        const [result] = await db.query(`
            INSERT INTO usuarios (nombre_completo, usuario, contrasena, id_rol, id_sucursal)
            VALUES (?, ?, ?, ?, ?)
        `, [nombre_completo, usuario.toLowerCase(), hashedPassword, id_rol, sucursal]);

        // Log de operación
        if (req.session && req.session.user) {
            await db.query(`
                INSERT INTO log_operaciones (id_usuario, nombre_usuario, accion, modulo, detalle)
                VALUES (?, ?, ?, 'Usuarios', ?)
            `, [req.session.user.id_usuario, req.session.user.name, 'Creación de usuario', `Usuario "${nombre_completo}" creado`]);
        }

        res.status(201).json({ id_usuario: result.insertId, message: 'Usuario creado exitosamente.' });
    } catch (err) {
        console.error('Error al crear usuario:', err);
        res.status(500).json({ error: 'Error al crear usuario.' });
    }
});

// PUT /api/usuarios/:id - Editar usuario
router.put('/:id', async (req, res) => {
    try {
        const { nombre_completo, usuario, contrasena, id_rol, id_sucursal } = req.body;
        const userId = req.params.id;

        let query, params;
        if (contrasena && contrasena !== '********') {
            const hashedPassword = await bcrypt.hash(contrasena, 10);
            query = `UPDATE usuarios SET nombre_completo = ?, usuario = ?, contrasena = ?, id_rol = ?, id_sucursal = ? WHERE id_usuario = ?`;
            params = [nombre_completo, usuario.toLowerCase(), hashedPassword, id_rol, id_sucursal || null, userId];
        } else {
            query = `UPDATE usuarios SET nombre_completo = ?, usuario = ?, id_rol = ?, id_sucursal = ? WHERE id_usuario = ?`;
            params = [nombre_completo, usuario.toLowerCase(), id_rol, id_sucursal || null, userId];
        }

        await db.query(query, params);
        res.json({ message: 'Usuario actualizado exitosamente.' });
    } catch (err) {
        console.error('Error al actualizar usuario:', err);
        res.status(500).json({ error: 'Error al actualizar usuario.' });
    }
});

// PATCH /api/usuarios/:id/estado - Activar/Desactivar usuario
router.patch('/:id/estado', async (req, res) => {
    try {
        const userId = req.params.id;
        const [rows] = await db.query('SELECT id_estado, nombre_completo FROM usuarios WHERE id_usuario = ?', [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const nuevoEstadoId = rows[0].id_estado === 1 ? 2 : 1;
        await db.query('UPDATE usuarios SET id_estado = ? WHERE id_usuario = ?', [nuevoEstadoId, userId]);
        const nuevoEstadoText = nuevoEstadoId === 1 ? 'Activo' : 'Inactivo';

        res.json({ message: `Usuario ${nuevoEstadoText.toLowerCase()}.`, estado: nuevoEstadoText, nombre: rows[0].nombre_completo });
    } catch (err) {
        console.error('Error al cambiar estado del usuario:', err);
        res.status(500).json({ error: 'Error al cambiar estado.' });
    }
});

// GET /api/usuarios/roles - Listar roles
router.get('/roles', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM roles ORDER BY id_rol');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener roles.' });
    }
});

// GET /api/usuarios/sucursales - Listar sucursales
router.get('/sucursales', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM sucursales WHERE id_estado = 1 ORDER BY id_sucursal");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener sucursales.' });
    }
});

// GET /api/usuarios/stats - Obtener estadísticas de usuarios
router.get('/stats', async (req, res) => {
    try {
        const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM usuarios');
        const [[{ activos }]] = await db.query("SELECT COUNT(*) AS activos FROM usuarios WHERE id_estado = 1");
        const [[{ admins }]] = await db.query('SELECT COUNT(*) AS admins FROM usuarios WHERE id_rol IN (1, 2)');
        const [[{ vendedores }]] = await db.query('SELECT COUNT(*) AS vendedores FROM usuarios WHERE id_rol = 3');

        res.json({
            total,
            activos,
            admins,
            vendedores
        });
    } catch (err) {
        console.error('Error al obtener estadísticas de usuarios:', err);
        res.status(500).json({ error: 'Error al obtener estadísticas.' });
    }
});

module.exports = router;

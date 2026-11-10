const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/gastos
router.get('/', async (req, res) => {
    try {
        const { sucursal, estado, fecha, id_arqueo } = req.query;
        let query = `
            SELECT g.id_gasto, g.fecha, g.monto, g.motivo, g.estado,
                   g.fecha_resolucion,
                   us.nombre_completo AS solicitante,
                   COALESCE(ua.nombre_completo, 'Sin asignar') AS admin,
                   s.nombre AS sucursal
            FROM gastos g
            JOIN usuarios us ON g.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON g.id_usuario_admin = ua.id_usuario
            JOIN sucursales s ON g.id_sucursal = s.id_sucursal
            WHERE 1=1
        `;
        const params = [];

        if (sucursal && sucursal !== 'todas') {
            query += ' AND s.nombre = ?';
            params.push(sucursal);
        }
        if (estado) {
            query += ' AND g.estado = ?';
            params.push(estado);
        }
        if (fecha) {
            query += ' AND DATE(g.fecha) = ?';
            params.push(fecha);
        }
        if (id_arqueo) {
            query += ' AND g.id_arqueo = ?';
            params.push(id_arqueo);
        }

        query += ' ORDER BY g.fecha DESC LIMIT 100';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar gastos:', err);
        res.status(500).json({ error: 'Error al obtener gastos.' });
    }
});

// POST /api/gastos
router.post('/', async (req, res) => {
    try {
        const { monto, motivo, id_usuario_solicitante, id_usuario_admin, id_sucursal } = req.body;
        if (!monto || !motivo || !id_usuario_solicitante || !id_sucursal) {
            return res.status(400).json({ error: 'Datos incompletos.' });
        }

        // Buscar arqueo activo del usuario solicitante en la sucursal
        const [arqueoActivo] = await db.query(`
            SELECT id_arqueo FROM arqueos_caja 
            WHERE id_usuario = ? AND id_sucursal = ? AND estado = 'Abierto'
            LIMIT 1
        `, [id_usuario_solicitante, id_sucursal]);

        let activeArqueoId = null;
        if (arqueoActivo.length > 0) {
            activeArqueoId = arqueoActivo[0].id_arqueo;
        } else {
            return res.status(400).json({ error: 'Debe abrir caja antes de poder registrar gastos.' });
        }

        const [result] = await db.query(`
            INSERT INTO gastos (monto, motivo, id_usuario_solicitante, id_usuario_admin, id_sucursal, id_arqueo)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [monto, motivo, id_usuario_solicitante, id_usuario_admin || null, id_sucursal, activeArqueoId]);

        res.status(201).json({ id_gasto: result.insertId, message: 'Solicitud de gasto registrada.' });
    } catch (err) {
        console.error('Error al crear gasto:', err);
        res.status(500).json({ error: 'Error al registrar gasto.' });
    }
});

// PATCH /api/gastos/:id - Aprobar/Rechazar gasto
router.patch('/:id', async (req, res) => {
    try {
        const { estado, id_usuario_admin } = req.body;
        if (!estado || !['Aprobado', 'Rechazado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const [result] = await db.query(`
            UPDATE gastos SET estado = ?, id_usuario_admin = ?, fecha_resolucion = NOW()
            WHERE id_gasto = ? AND estado = 'Pendiente'
        `, [estado, id_usuario_admin || null, req.params.id]);

        if (result.affectedRows === 0) {
            return res.status(400).json({ error: 'El gasto no existe o ya fue resuelto.' });
        }

        res.json({ message: `Gasto ${estado.toLowerCase()}.` });
    } catch (err) {
        console.error('Error al actualizar gasto:', err);
        res.status(500).json({ error: 'Error al actualizar gasto.' });
    }
});

module.exports = router;

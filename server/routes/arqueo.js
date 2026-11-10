const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/arqueo - Obtener arqueos
router.get('/', async (req, res) => {
    try {
        const { fecha, id_sucursal, id_usuario } = req.query;
        let query = `
            SELECT ac.id_arqueo, ac.fecha, ac.efectivo_inicial,
                   ac.ventas_efectivo, ac.gastos_aprobados,
                   ac.efectivo_esperado, ac.efectivo_contado,
                   ac.diferencia, ac.estado, ac.observaciones,
                   u.nombre_completo AS cajero,
                   s.nombre AS sucursal, ac.id_usuario
            FROM arqueos_caja ac
            JOIN usuarios u ON ac.id_usuario = u.id_usuario
            JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
            WHERE 1=1
        `;
        const params = [];

        if (fecha) {
            query += ' AND ac.fecha = ?';
            params.push(fecha);
        }
        if (id_sucursal) {
            query += ' AND ac.id_sucursal = ?';
            params.push(id_sucursal);
        }
        if (id_usuario) {
            query += ' AND ac.id_usuario = ?';
            params.push(id_usuario);
        }

        query += ' ORDER BY ac.fecha DESC LIMIT 50';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener arqueos:', err);
        res.status(500).json({ error: 'Error al obtener arqueos.' });
    }
});

// POST /api/arqueo - Registrar arqueo de caja
router.post('/', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const {
            fecha, id_usuario, id_sucursal,
            efectivo_inicial, ventas_efectivo, gastos_aprobados,
            efectivo_contado, observaciones, denominaciones,
            estado
        } = req.body;

        if (!fecha || !id_usuario || !id_sucursal) {
            return res.status(400).json({ error: 'Datos incompletos para registrar el arqueo.' });
        }

        if (estado === 'Abierto') {
            // Un usuario solo puede tener una caja abierta a la vez, en cualquier sucursal
            const [abiertos] = await conn.query(`
                SELECT ac.id_arqueo, s.nombre AS sucursal
                FROM arqueos_caja ac
                JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
                WHERE ac.id_usuario = ? AND ac.estado = 'Abierto'
                LIMIT 1
            `, [id_usuario]);
            if (abiertos.length > 0) {
                return res.status(409).json({ error: `Ya tienes una caja abierta en la sucursal ${abiertos[0].sucursal}. Ciérrala antes de abrir otra.` });
            }
        }

        const efectivoEsperado = (parseFloat(efectivo_inicial) || 0) + (parseFloat(ventas_efectivo) || 0) - (parseFloat(gastos_aprobados) || 0);
        const diferencia = (parseFloat(efectivo_contado) || 0) - efectivoEsperado;

        let estadoCuadre = 'Sin Conteo';
        if (estado === 'Abierto') {
            estadoCuadre = 'Abierto';
        } else if (efectivo_contado !== undefined && efectivo_contado !== null) {
            if (Math.abs(diferencia) <= 0.01) estadoCuadre = 'Cuadrada';
            else if (diferencia < 0) estadoCuadre = 'Faltante';
            else estadoCuadre = 'Sobrante';
        }

        const [result] = await conn.query(`
            INSERT INTO arqueos_caja
            (fecha, id_usuario, id_sucursal, efectivo_inicial, ventas_efectivo,
             gastos_aprobados, efectivo_esperado, efectivo_contado, diferencia, estado, observaciones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            fecha, id_usuario, id_sucursal,
            efectivo_inicial || 0, ventas_efectivo || 0, gastos_aprobados || 0,
            efectivoEsperado, efectivo_contado || 0, diferencia,
            estadoCuadre, observaciones || null
        ]);

        const arqueoId = result.insertId;

        // Insertar denominaciones si se proporcionan
        if (denominaciones && Array.isArray(denominaciones)) {
            for (const denom of denominaciones) {
                const subtotal = denom.denominacion * denom.cantidad;
                await conn.query(`
                    INSERT INTO arqueo_denominaciones (id_arqueo, denominacion, cantidad, subtotal)
                    VALUES (?, ?, ?, ?)
                `, [arqueoId, denom.denominacion, denom.cantidad, subtotal]);
            }
        }

        await conn.commit();
        res.status(201).json({
            id_arqueo: arqueoId,
            estado: estadoCuadre,
            diferencia,
            message: 'Arqueo de caja registrado.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Error al registrar arqueo:', err);
        res.status(500).json({ error: 'Error al registrar arqueo.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// GET /api/arqueo/:id/denominaciones - Obtener denominaciones de un arqueo
router.get('/:id/denominaciones', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM arqueo_denominaciones WHERE id_arqueo = ? ORDER BY denominacion DESC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener denominaciones.' });
    }
});

// GET /api/arqueo/activo - Obtener arqueo activo del usuario
// Con id_sucursal busca en esa sucursal; sin él, en cualquiera (para restaurar la caja al volver a entrar)
router.get('/activo', async (req, res) => {
    try {
        const { id_usuario, id_sucursal } = req.query;
        if (!id_usuario) {
            return res.status(400).json({ error: 'Falta el parámetro id_usuario.' });
        }
        let query = `
            SELECT ac.*, s.nombre AS sucursal
            FROM arqueos_caja ac
            JOIN sucursales s ON ac.id_sucursal = s.id_sucursal
            WHERE ac.id_usuario = ? AND ac.estado = 'Abierto'
        `;
        const params = [id_usuario];
        if (id_sucursal) {
            query += ' AND ac.id_sucursal = ?';
            params.push(id_sucursal);
        }
        query += ' ORDER BY ac.id_arqueo DESC LIMIT 1';
        const [rows] = await db.query(query, params);

        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error('Error al obtener arqueo activo:', err);
        res.status(500).json({ error: 'Error al obtener arqueo activo.' });
    }
});

// PATCH /api/arqueo/:id/cerrar - Cerrar arqueo de caja de un turno
router.patch('/:id/cerrar', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { efectivo_contado, observaciones, denominaciones } = req.body;
        const arqueoId = req.params.id;

        // 1. Obtener los datos del arqueo para calcular el cierre
        const [arqueoRows] = await conn.query('SELECT * FROM arqueos_caja WHERE id_arqueo = ?', [arqueoId]);
        if (arqueoRows.length === 0) {
            return res.status(404).json({ error: 'No se encontró el arqueo.' });
        }
        const arq = arqueoRows[0];
        if (arq.estado !== 'Abierto') {
            return res.status(400).json({ error: 'Esta caja ya fue cerrada.' });
        }

        // 2. Recalcular ventas en efectivo y gastos aprobados asociados a este id_arqueo
        // Ventas en efectivo asociadas
        const [ventaRows] = await conn.query(`
            SELECT COALESCE(SUM(total), 0) AS total_ventas 
            FROM ventas 
            WHERE id_arqueo = ? AND estado != 'Anulada' AND metodo_pago = 'Efectivo'
        `, [arqueoId]);
        const ventasEfectivo = parseFloat(ventaRows[0].total_ventas) || 0.00;

        // Gastos aprobados asociados
        const [gastoRows] = await conn.query(`
            SELECT COALESCE(SUM(monto), 0) AS total_gastos 
            FROM gastos 
            WHERE id_arqueo = ? AND estado = 'Aprobado'
        `, [arqueoId]);
        const gastosAprobados = parseFloat(gastoRows[0].total_gastos) || 0.00;

        const inicial = parseFloat(arq.efectivo_inicial) || 0.00;
        const esperado = inicial + ventasEfectivo - gastosAprobados;
        const contado = parseFloat(efectivo_contado) || 0.00;
        const diferencia = contado - esperado;

        let estadoCuadre = 'Cuadrada';
        if (diferencia < -0.01) estadoCuadre = 'Faltante';
        else if (diferencia > 0.01) estadoCuadre = 'Sobrante';

        // 3. Actualizar el arqueo a cerrado
        await conn.query(`
            UPDATE arqueos_caja 
            SET ventas_efectivo = ?, gastos_aprobados = ?, efectivo_esperado = ?, 
                efectivo_contado = ?, diferencia = ?, estado = ?, observaciones = ?
            WHERE id_arqueo = ?
        `, [ventasEfectivo, gastosAprobados, esperado, contado, diferencia, estadoCuadre, observaciones || null, arqueoId]);

        // 4. Registrar denominaciones
        if (denominaciones && Array.isArray(denominaciones)) {
            // Limpiar previas por si acaso
            await conn.query('DELETE FROM arqueo_denominaciones WHERE id_arqueo = ?', [arqueoId]);
            for (const denom of denominaciones) {
                const subtotal = denom.denominacion * denom.cantidad;
                await conn.query(`
                    INSERT INTO arqueo_denominaciones (id_arqueo, denominacion, cantidad, subtotal)
                    VALUES (?, ?, ?, ?)
                `, [arqueoId, denom.denominacion, denom.cantidad, subtotal]);
            }
        }

        await conn.commit();
        res.json({
            id_arqueo: arqueoId,
            estado: estadoCuadre,
            diferencia,
            message: 'Arqueo de caja cerrado exitosamente.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Error al cerrar arqueo:', err);
        res.status(500).json({ error: 'Error al cerrar arqueo.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

module.exports = router;

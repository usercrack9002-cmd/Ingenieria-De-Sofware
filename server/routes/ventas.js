const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/ventas - Listar ventas
router.get('/', async (req, res) => {
    try {
        const { sucursal, vendedor, fecha_inicio, fecha_fin, estado, id_arqueo } = req.query;

        let query = `
            SELECT v.id_venta, v.codigo_venta, v.fecha, v.subtotal, v.total,
                   v.metodo_pago, v.pago_recibido, v.cambio, v.estado,
                   u.nombre_completo AS vendedor, u.id_usuario,
                   s.nombre AS sucursal, s.id_sucursal,
                    (
                        SELECT COALESCE(SUM(vd.cantidad * COALESCE(pa.equivalencia_unidades, 1) * COALESCE(i.precio_costo, p.precio_venta * 0.7, 0)), 0)
                        FROM venta_detalle vd
                        LEFT JOIN inventario i ON vd.id_inventario = i.id_inventario
                        LEFT JOIN productos p ON vd.id_producto = p.id_producto
                        LEFT JOIN producto_agrupaciones pa ON vd.id_producto = pa.id_producto AND vd.id_agrupacion = pa.id_agrupacion
                        WHERE vd.id_venta = v.id_venta AND vd.estado = 'Vendido'
                    ) AS costo
            FROM ventas v
            JOIN usuarios u ON v.id_usuario = u.id_usuario
            JOIN sucursales s ON v.id_sucursal = s.id_sucursal
            WHERE 1=1
        `;
        const params = [];

        if (sucursal && sucursal !== 'todas') {
            query += ' AND s.nombre = ?';
            params.push(sucursal);
        }
        if (vendedor) {
            query += ' AND u.nombre_completo = ?';
            params.push(vendedor);
        }
        if (fecha_inicio) {
            query += ' AND DATE(v.fecha) >= ?';
            params.push(fecha_inicio);
        }
        if (fecha_fin) {
            query += ' AND DATE(v.fecha) <= ?';
            params.push(fecha_fin);
        }
        if (estado) {
            query += ' AND v.estado = ?';
            params.push(estado);
        }
        if (id_arqueo) {
            query += ' AND v.id_arqueo = ?';
            params.push(id_arqueo);
        }

        query += ' ORDER BY v.fecha DESC LIMIT 200';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar ventas:', err);
        res.status(500).json({ error: 'Error al obtener ventas.' });
    }
});

// GET /api/ventas/:id - Detalle de una venta
router.get('/:id', async (req, res) => {
    try {
        const [venta] = await db.query(`
            SELECT v.*, u.nombre_completo AS vendedor, s.nombre AS sucursal
            FROM ventas v
            JOIN usuarios u ON v.id_usuario = u.id_usuario
            JOIN sucursales s ON v.id_sucursal = s.id_sucursal
            WHERE v.id_venta = ?
        `, [req.params.id]);

        if (venta.length === 0) {
            return res.status(404).json({ error: 'Venta no encontrada.' });
        }

        const [detalle] = await db.query(`
            SELECT vd.*, p.nombre AS producto,
                   COALESCE(a.nombre, 'Unidad') AS agrupacion
            FROM venta_detalle vd
            JOIN productos p ON vd.id_producto = p.id_producto
            LEFT JOIN agrupaciones a ON vd.id_agrupacion = a.id_agrupacion
            WHERE vd.id_venta = ?
        `, [req.params.id]);

        res.json({ ...venta[0], detalle });
    } catch (err) {
        console.error('Error al obtener venta:', err);
        res.status(500).json({ error: 'Error al obtener detalle de venta.' });
    }
});

// POST /api/ventas - Registrar nueva venta
router.post('/', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { id_usuario, id_sucursal, metodo_pago, productos, pago_recibido } = req.body;

        if (!id_usuario || !id_sucursal || !productos || productos.length === 0) {
            return res.status(400).json({ error: 'Datos incompletos para registrar la venta.' });
        }

        // Buscar arqueo activo del usuario en la sucursal
        const [arqueoActivo] = await conn.query(`
            SELECT id_arqueo FROM arqueos_caja 
            WHERE id_usuario = ? AND id_sucursal = ? AND estado = 'Abierto'
            LIMIT 1
        `, [id_usuario, id_sucursal]);

        let activeArqueoId = null;
        if (arqueoActivo.length > 0) {
            activeArqueoId = arqueoActivo[0].id_arqueo;
        } else {
            return res.status(400).json({ error: 'Debe abrir caja antes de poder realizar ventas.' });
        }

        // Calcular totales
        let subtotal = 0;
        productos.forEach(p => {
            subtotal += p.precio * p.cantidad;
        });
        const total = subtotal;
        const cambio = pago_recibido ? pago_recibido - total : 0;

        // Generar código de venta
        const [lastVenta] = await conn.query(
            'SELECT codigo_venta FROM ventas ORDER BY id_venta DESC LIMIT 1'
        );
        let nextNum = 1;
        if (lastVenta.length > 0) {
            const match = lastVenta[0].codigo_venta.match(/VTA-0*(\d+)/);
            if (match) nextNum = parseInt(match[1]) + 1;
        }
        const codigoVenta = `VTA-${String(nextNum).padStart(4, '0')}`;

        // Insertar venta
        const [result] = await conn.query(`
            INSERT INTO ventas (codigo_venta, id_usuario, id_sucursal, metodo_pago, subtotal, total, pago_recibido, cambio, id_arqueo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [codigoVenta, id_usuario, id_sucursal, metodo_pago || 'Efectivo', subtotal, total, pago_recibido || total, cambio, activeArqueoId]);

        const ventaId = result.insertId;

        // Insertar detalle de venta y actualizar stock
        for (const prod of productos) {
            // Descontar stock de Mostrador (FIFO por vencimiento, repartido entre lotes)
            const [lotes] = await conn.query(`
                SELECT id_inventario, stock FROM inventario
                WHERE id_producto = ? AND id_sucursal = ? AND ubicacion = 'Mostrador' AND stock > 0
                ORDER BY fecha_vencimiento IS NULL, fecha_vencimiento ASC, id_inventario ASC
                FOR UPDATE
            `, [prod.id_producto, id_sucursal]);

            const cantidadDescontar = parseInt(prod.cantidad_unidades || prod.cantidad, 10) || 0;
            const stockDisponible = lotes.reduce((sum, r) => sum + r.stock, 0);
            if (cantidadDescontar <= 0 || stockDisponible < cantidadDescontar) {
                await conn.rollback();
                const [prodRows] = await conn.query('SELECT nombre FROM productos WHERE id_producto = ?', [prod.id_producto]);
                const nombre = prodRows[0]?.nombre || `ID ${prod.id_producto}`;
                return res.status(400).json({
                    error: `Stock insuficiente en Mostrador para "${nombre}". Disponible: ${stockDisponible} uds, Solicitado: ${cantidadDescontar} uds.`
                });
            }

            // El detalle referencia el primer lote usado (al anular se devuelve ahí)
            const inventarioId = lotes.length > 0 ? lotes[0].id_inventario : null;
            let restante = cantidadDescontar;
            for (const lote of lotes) {
                if (restante <= 0) break;
                const aDescontar = Math.min(lote.stock, restante);
                await conn.query(
                    'UPDATE inventario SET stock = stock - ? WHERE id_inventario = ?',
                    [aDescontar, lote.id_inventario]
                );
                restante -= aDescontar;
            }

            // Insertar detalle con id_inventario, iva y total
            await conn.query(`
                INSERT INTO venta_detalle (id_venta, id_producto, id_inventario, id_agrupacion, cantidad, precio_unitario, subtotal, iva, total)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?)
            `, [ventaId, prod.id_producto, inventarioId, prod.id_agrupacion || null, prod.cantidad, prod.precio, prod.precio * prod.cantidad, prod.precio * prod.cantidad]);
        }

        // Log de operación
        await conn.query(`
            INSERT INTO log_operaciones (id_usuario, nombre_usuario, id_sucursal, accion, modulo, detalle)
            VALUES (?, (SELECT nombre_completo FROM usuarios WHERE id_usuario = ?), ?, 'Venta registrada', 'Ventas', ?)
        `, [id_usuario, id_usuario, id_sucursal, `Venta ${codigoVenta} por C$${total.toFixed(2)}`]);

        await conn.commit();
        res.status(201).json({
            id_venta: ventaId,
            codigo_venta: codigoVenta,
            total,
            cambio,
            message: 'Venta registrada exitosamente.'
        });
    } catch (err) {
        await conn.rollback();
        console.error('Error al registrar venta:', err);
        res.status(500).json({ error: 'Error al registrar venta.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/inventario - Listar inventario con filtros
router.get('/', async (req, res) => {
    try {
        const { sucursal, categoria, ubicacion, busqueda } = req.query;

        let query = `
            SELECT i.id_inventario, i.stock, i.stock_minimo, i.ubicacion, i.lote,
                   i.fecha_vencimiento, i.precio_costo,
                   p.id_producto, p.nombre AS producto, p.precio_venta, e.nombre AS estado_producto,
                   c.nombre AS categoria,
                   s.nombre AS sucursal, s.id_sucursal
            FROM inventario i
            JOIN productos p ON i.id_producto = p.id_producto
            JOIN categorias c ON p.id_categoria = c.id_categoria
            JOIN sucursales s ON i.id_sucursal = s.id_sucursal
            LEFT JOIN estados e ON p.id_estado = e.id_estado
            WHERE p.id_estado = 1
              AND i.stock > 0
        `;
        const params = [];

        if (sucursal && sucursal !== 'todas') {
            query += ' AND s.nombre = ?';
            params.push(sucursal);
        }
        if (categoria) {
            query += ' AND c.nombre = ?';
            params.push(categoria);
        }
        if (ubicacion) {
            query += ' AND i.ubicacion = ?';
            params.push(ubicacion);
        }
        if (busqueda) {
            query += ' AND (p.nombre LIKE ? OR c.nombre LIKE ?)';
            params.push(`%${busqueda}%`, `%${busqueda}%`);
        }

        query += ' ORDER BY p.nombre ASC, s.nombre ASC';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar inventario:', err);
        res.status(500).json({ error: 'Error al obtener inventario.' });
    }
});

// GET /api/inventario/resumen - Stock agrupado por producto y sucursal
router.get('/resumen', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.id_producto, p.nombre AS producto, p.precio_venta,
                   c.nombre AS categoria,
                   s.nombre AS sucursal,
                   SUM(i.stock) AS stock_total,
                   MIN(i.stock_minimo) AS stock_minimo,
                   i.ubicacion, i.lote, i.fecha_vencimiento
            FROM inventario i
            JOIN productos p ON i.id_producto = p.id_producto
            JOIN categorias c ON p.id_categoria = c.id_categoria
            JOIN sucursales s ON i.id_sucursal = s.id_sucursal
            WHERE p.id_estado = 1
            GROUP BY p.id_producto, s.id_sucursal, i.ubicacion, i.lote, i.fecha_vencimiento
            ORDER BY p.nombre, s.nombre
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener resumen de inventario.' });
    }
});

// GET /api/inventario/alertas - Stock bajo y próximos a vencer
router.get('/alertas', async (req, res) => {
    try {
        const [stockBajo] = await db.query(`SELECT * FROM v_stock_bajo`);
        const [proximosVencer] = await db.query(`SELECT * FROM v_proximos_vencer`);

        res.json({
            stockBajo: stockBajo,
            proximosVencer: proximosVencer,
            totalStockBajo: stockBajo.length,
            totalProximosVencer: proximosVencer.length
        });
    } catch (err) {
        console.error('Error al obtener alertas:', err);
        res.status(500).json({ error: 'Error al obtener alertas.' });
    }
});

// POST /api/inventario/movimiento - Transferencia entre sucursales
router.post('/movimiento', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { 
            id_producto, 
            id_producto_destino, 
            id_sucursal_origen, 
            id_sucursal_destino, 
            id_agrupacion, 
            cantidad_agrupacion, 
            cantidad_unidades, 
            id_usuario,
            id_inventario_origen,
            lote,
            fecha_vencimiento,
            precio_costo,
            observaciones
        } = req.body;

        if (!id_producto || !id_sucursal_origen || !id_sucursal_destino || !cantidad_unidades) {
            return res.status(400).json({ error: 'Datos incompletos para la transferencia.' });
        }

        if (id_sucursal_origen === id_sucursal_destino) {
            return res.status(400).json({ error: 'Las sucursales de origen y destino deben ser diferentes.' });
        }

        // Verificar que el producto de origen y la sucursal destino existan y estén activos
        const [prodRows] = await conn.query('SELECT id_estado FROM productos WHERE id_producto = ?', [id_producto]);
        if (prodRows.length === 0 || prodRows[0].id_estado !== 1) {
            return res.status(400).json({ error: 'El producto de origen no existe o está inactivo.' });
        }
        const [sucDestRows] = await conn.query('SELECT id_estado FROM sucursales WHERE id_sucursal = ?', [id_sucursal_destino]);
        if (sucDestRows.length === 0 || sucDestRows[0].id_estado !== 1) {
            return res.status(400).json({ error: 'La sucursal de destino no existe o está inactiva.' });
        }

        // Producto de destino: el mismo de origen (se registra en destino si no existe) o
        // un producto que ya exista en la sucursal destino (puede tener otro nombre allí)
        const targetProductId = id_producto_destino || id_producto;
        if (String(targetProductId) !== String(id_producto)) {
            const [destProdRows] = await conn.query(`
                SELECT p.id_producto
                FROM productos p
                JOIN inventario i ON i.id_producto = p.id_producto
                WHERE p.id_producto = ? AND p.id_estado = 1 AND i.id_sucursal = ? AND i.stock > 0
                LIMIT 1
            `, [targetProductId, id_sucursal_destino]);
            if (destProdRows.length === 0) {
                return res.status(400).json({ error: 'El producto de destino no existe en la sucursal destino.' });
            }
        }

        if (id_inventario_origen) {
            // Deducción de lote específico
            const [origRecord] = await conn.query(`
                SELECT stock, lote, fecha_vencimiento, precio_costo FROM inventario
                WHERE id_inventario = ? AND id_sucursal = ? AND id_producto = ? AND ubicacion = 'Bodega'
            `, [id_inventario_origen, id_sucursal_origen, id_producto]);

            if (origRecord.length === 0 || origRecord[0].stock < cantidad_unidades) {
                return res.status(400).json({
                    error: `Stock insuficiente en el lote seleccionado. Disponible: ${origRecord[0]?.stock || 0} uds, Solicitado: ${cantidad_unidades} uds.`
                });
            }

            // Descontar del lote específico en origen
            await conn.query(
                'UPDATE inventario SET stock = stock - ? WHERE id_inventario = ?',
                [cantidad_unidades, id_inventario_origen]
            );

            // El lote se transfiere intacto: usar los datos guardados en BD (el cliente puede
            // enviar la fecha en formato ISO, que MySQL rechaza en columnas DATE)
            const targetLote = origRecord[0].lote;
            const targetVenc = origRecord[0].fecha_vencimiento;
            const targetCosto = origRecord[0].precio_costo;

            // Buscar si ya existe en destino
            const [rowsDestino] = await conn.query(`
                SELECT id_inventario FROM inventario
                WHERE id_producto = ?
                  AND id_sucursal = ?
                  AND ubicacion = 'Bodega'
                  AND lote <=> ?
                  AND fecha_vencimiento <=> ?
                  AND precio_costo = ?
                LIMIT 1
            `, [targetProductId, id_sucursal_destino, targetLote, targetVenc, targetCosto]);

            if (rowsDestino.length > 0) {
                await conn.query(
                    'UPDATE inventario SET stock = stock + ? WHERE id_inventario = ?',
                    [cantidad_unidades, rowsDestino[0].id_inventario]
                );
            } else {
                await conn.query(`
                    INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo, lote, fecha_vencimiento)
                    VALUES (?, ?, 'Bodega', ?, 5, ?, ?, ?)
                `, [targetProductId, id_sucursal_destino, cantidad_unidades, targetCosto, targetLote, targetVenc]);
            }
        } else {
            // Fallback FIFO si no se especifica lote de origen
            const [rowsBodega] = await conn.query(`
                SELECT id_inventario, stock, lote, fecha_vencimiento, precio_costo FROM inventario
                WHERE id_producto = ? AND id_sucursal = ? AND ubicacion = 'Bodega' AND stock > 0
                ORDER BY fecha_vencimiento ASC, id_inventario ASC
            `, [id_producto, id_sucursal_origen]);

            const stockDisponible = rowsBodega.reduce((sum, r) => sum + r.stock, 0);
            if (stockDisponible < cantidad_unidades) {
                return res.status(400).json({
                    error: `Stock insuficiente en Bodega. Disponible: ${stockDisponible} uds, Solicitado: ${cantidad_unidades} uds.`
                });
            }

            let restante = cantidad_unidades;
            for (const row of rowsBodega) {
                if (restante <= 0) break;
                const aDescontar = Math.min(row.stock, restante);

                await conn.query(
                    'UPDATE inventario SET stock = stock - ? WHERE id_inventario = ?',
                    [aDescontar, row.id_inventario]
                );

                const [rowsDestino] = await conn.query(`
                    SELECT id_inventario FROM inventario
                    WHERE id_producto = ?
                      AND id_sucursal = ?
                      AND ubicacion = 'Bodega'
                      AND lote <=> ?
                      AND fecha_vencimiento <=> ?
                      AND precio_costo = ?
                    LIMIT 1
                `, [targetProductId, id_sucursal_destino, row.lote, row.fecha_vencimiento, row.precio_costo]);

                if (rowsDestino.length > 0) {
                    await conn.query(
                        'UPDATE inventario SET stock = stock + ? WHERE id_inventario = ?',
                        [aDescontar, rowsDestino[0].id_inventario]
                    );
                } else {
                    await conn.query(`
                        INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo, lote, fecha_vencimiento)
                        VALUES (?, ?, 'Bodega', ?, 5, ?, ?, ?)
                    `, [targetProductId, id_sucursal_destino, aDescontar, row.precio_costo, row.lote, row.fecha_vencimiento]);
                }
                restante -= aDescontar;
            }
        }

        // Registrar movimiento
        const userId = id_usuario || (req.session?.user?.id_usuario) || null;
        if (!userId) {
            return res.status(400).json({ error: 'El ID de usuario es requerido para registrar el movimiento (Sesión inválida).' });
        }
        await conn.query(`
            INSERT INTO movimientos_inventario
            (id_producto, id_sucursal_origen, id_sucursal_destino, id_agrupacion, cantidad_agrupacion, cantidad_unidades, id_usuario, observaciones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [id_producto, id_sucursal_origen, id_sucursal_destino, id_agrupacion || null, cantidad_agrupacion || 1, cantidad_unidades, userId, observaciones || null]);

        await conn.commit();
        res.json({ message: 'Transferencia realizada exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error en transferencia:', err);
        res.status(500).json({ error: `Error al realizar transferencia: ${err.message}` });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// GET /api/inventario/movimientos - Historial de transferencias
router.get('/movimientos', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT m.id_movimiento, m.fecha, m.cantidad_agrupacion, m.cantidad_unidades, m.observaciones,
                   p.nombre AS producto,
                   so.nombre AS sucursal_origen,
                   sd.nombre AS sucursal_destino,
                   COALESCE(a.nombre, 'Unidad') AS agrupacion,
                   u.nombre_completo AS usuario
            FROM movimientos_inventario m
            JOIN productos p ON m.id_producto = p.id_producto
            JOIN sucursales so ON m.id_sucursal_origen = so.id_sucursal
            JOIN sucursales sd ON m.id_sucursal_destino = sd.id_sucursal
            LEFT JOIN agrupaciones a ON m.id_agrupacion = a.id_agrupacion
            JOIN usuarios u ON m.id_usuario = u.id_usuario
            ORDER BY m.fecha DESC
            LIMIT 100
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener movimientos:', err);
        res.status(500).json({ error: 'Error al obtener movimientos.' });
    }
});

// GET /api/inventario/stock/:productoId - Stock por producto en cada sucursal (solo Bodega)
router.get('/stock/:productoId', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT s.nombre AS sucursal, s.id_sucursal, COALESCE(SUM(i.stock), 0) AS stock
            FROM sucursales s
            LEFT JOIN inventario i ON i.id_sucursal = s.id_sucursal AND i.id_producto = ? AND i.ubicacion = 'Bodega'
            WHERE s.id_estado = 1
            GROUP BY s.id_sucursal
            ORDER BY s.nombre
        `, [req.params.productoId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener stock.' });
    }
});

// POST /api/inventario/relleno - Relleno de mostrador (mover de bodega a mostrador)
router.post('/relleno', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { id_producto, id_sucursal, cantidad, id_usuario } = req.body;

        if (!id_producto || !id_sucursal || !cantidad || cantidad <= 0) {
            return res.status(400).json({ error: 'Datos de relleno inválidos.' });
        }

        // 1. Obtener stock total disponible en Bodega (incluyendo lote, fecha_vencimiento, precio_costo)
        const [rowsBodega] = await conn.query(`
            SELECT id_inventario, stock, lote, fecha_vencimiento, precio_costo FROM inventario
            WHERE id_producto = ? AND id_sucursal = ? AND ubicacion = 'Bodega' AND stock > 0
            ORDER BY fecha_vencimiento ASC, id_inventario ASC
        `, [id_producto, id_sucursal]);

        const stockDisponible = rowsBodega.reduce((sum, r) => sum + r.stock, 0);

        if (stockDisponible < cantidad) {
            return res.status(400).json({
                error: `Stock insuficiente en Bodega. Disponible: ${stockDisponible} uds, Solicitado: ${cantidad} uds.`
            });
        }

        // 2. Descontar de Bodega y agregar a Mostrador conservando lote y vencimiento
        let restante = cantidad;
        for (const row of rowsBodega) {
            if (restante <= 0) break;
            const aDescontar = Math.min(row.stock, restante);

            // Descontar del lote en Bodega
            await conn.query(
                'UPDATE inventario SET stock = stock - ? WHERE id_inventario = ?',
                [aDescontar, row.id_inventario]
            );

            // Agregar al Mostrador con el mismo lote, vencimiento y precio de costo
            const [rowsMostrador] = await conn.query(`
                SELECT id_inventario FROM inventario
                WHERE id_producto = ?
                  AND id_sucursal = ?
                  AND ubicacion = 'Mostrador'
                  AND lote <=> ?
                  AND fecha_vencimiento <=> ?
                  AND precio_costo = ?
                LIMIT 1
            `, [id_producto, id_sucursal, row.lote, row.fecha_vencimiento, row.precio_costo]);

            if (rowsMostrador.length > 0) {
                await conn.query(
                    'UPDATE inventario SET stock = stock + ? WHERE id_inventario = ?',
                    [aDescontar, rowsMostrador[0].id_inventario]
                );
            } else {
                await conn.query(`
                    INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo, lote, fecha_vencimiento)
                    VALUES (?, ?, 'Mostrador', ?, 5, ?, ?, ?)
                `, [id_producto, id_sucursal, aDescontar, row.precio_costo, row.lote, row.fecha_vencimiento]);
            }

            restante -= aDescontar;
        }

        // 4. Loggear operación
        const userId = id_usuario || null;
        const [prodRows] = await conn.query('SELECT nombre FROM productos WHERE id_producto = ?', [id_producto]);
        const nombreProducto = prodRows[0]?.nombre || `ID ${id_producto}`;

        await conn.query(`
            INSERT INTO log_operaciones (id_usuario, nombre_usuario, id_sucursal, nombre_sucursal, accion, modulo, detalle)
            VALUES (?, (SELECT nombre_completo FROM usuarios WHERE id_usuario = ?), ?, (SELECT nombre FROM sucursales WHERE id_sucursal = ?), 'Relleno de mostrador', 'Inventario', ?)
        `, [userId, userId, id_sucursal, id_sucursal, `Relleno de ${cantidad} unidades del producto "${nombreProducto}" al mostrador.`]);

        await conn.commit();
        res.json({ message: 'Relleno de mostrador realizado exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error en relleno de mostrador:', err);
        res.status(500).json({ error: 'Error al realizar relleno.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

module.exports = router;

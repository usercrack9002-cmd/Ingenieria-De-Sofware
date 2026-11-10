const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/reportes/dashboard - KPIs del panel principal
router.get('/dashboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sucursal = req.query.sucursal || (req.session && req.session.user ? req.session.user.sucursal : 'Central');

        // Ingresos de la caja activa
        const userId = req.session && req.session.user ? req.session.user.id_usuario : null;
        let ingresosHoyVal = 0;

        if (userId) {
            let arqueoQuery = `
                SELECT id_arqueo FROM arqueos_caja 
                WHERE id_usuario = ? AND estado = 'Abierto'
            `;
            const arqueoParams = [userId];

            if (sucursal && sucursal !== 'todas') {
                const [sucRows] = await db.query('SELECT id_sucursal FROM sucursales WHERE nombre = ? LIMIT 1', [sucursal]);
                const sucursalId = sucRows.length > 0 ? sucRows[0].id_sucursal : 1;
                arqueoQuery += ' AND id_sucursal = ?';
                arqueoParams.push(sucursalId);
            }

            arqueoQuery += ' LIMIT 1';
            const [arqueoActivo] = await db.query(arqueoQuery, arqueoParams);

            if (arqueoActivo.length > 0) {
                const [ingresosRow] = await db.query(`
                    SELECT COALESCE(SUM(total), 0) AS total
                    FROM ventas
                    WHERE id_arqueo = ? AND estado = 'Completada'
                `, [arqueoActivo[0].id_arqueo]);
                ingresosHoyVal = ingresosRow[0].total;
            }
        }

        // Total productos activos
        let totalProductosQuery = `
            SELECT COUNT(*) AS total FROM productos WHERE id_estado = 1
        `;
        let totalProductosParams = [];
        if (sucursal && sucursal !== 'todas') {
            totalProductosQuery = `
                SELECT COUNT(DISTINCT i.id_producto) AS total 
                FROM inventario i
                JOIN productos p ON i.id_producto = p.id_producto
                JOIN sucursales s ON i.id_sucursal = s.id_sucursal
                WHERE p.id_estado = 1 AND s.nombre = ? AND i.stock > 0
            `;
            totalProductosParams = [sucursal];
        }
        const [totalProductos] = await db.query(totalProductosQuery, totalProductosParams);

        // Valor del inventory
        let valorInventarioQuery = `
            SELECT COALESCE(SUM(i.stock * p.precio_venta), 0) AS valor
            FROM inventario i
            JOIN productos p ON i.id_producto = p.id_producto
            WHERE p.id_estado = 1
        `;
        let valorInventarioParams = [];
        if (sucursal && sucursal !== 'todas') {
            valorInventarioQuery = `
                SELECT COALESCE(SUM(i.stock * p.precio_venta), 0) AS valor
                FROM inventario i
                JOIN productos p ON i.id_producto = p.id_producto
                JOIN sucursales s ON i.id_sucursal = s.id_sucursal
                WHERE p.id_estado = 1 AND s.nombre = ?
            `;
            valorInventarioParams = [sucursal];
        }
        const [valorInventario] = await db.query(valorInventarioQuery, valorInventarioParams);

        // Stock bajo (exclude depleted stock = 0 records)
        let stockBajoQuery = `
            SELECT COUNT(DISTINCT id_producto) AS total FROM v_stock_bajo WHERE stock > 0
        `;
        let stockBajoParams = [];
        if (sucursal && sucursal !== 'todas') {
            stockBajoQuery = `
                SELECT COUNT(DISTINCT id_producto) AS total FROM v_stock_bajo WHERE stock > 0 AND sucursal = ?
            `;
            stockBajoParams = [sucursal];
        }
        const [stockBajo] = await db.query(stockBajoQuery, stockBajoParams);

        // Ventas de la semana (para el gráfico de barras)
        let ventasSemanaQuery = `
            SELECT DAYOFWEEK(fecha) AS dia, COALESCE(SUM(total), 0) AS total
            FROM ventas
            WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND estado = 'Completada'
            GROUP BY DAYOFWEEK(fecha)
            ORDER BY dia
        `;
        let ventasSemanaParams = [];
        if (sucursal && sucursal !== 'todas') {
            ventasSemanaQuery = `
                SELECT DAYOFWEEK(v.fecha) AS dia, COALESCE(SUM(v.total), 0) AS total
                FROM ventas v
                JOIN sucursales s ON v.id_sucursal = s.id_sucursal
                WHERE v.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) 
                  AND v.estado = 'Completada'
                  AND s.nombre = ?
                GROUP BY DAYOFWEEK(v.fecha)
                ORDER BY dia
            `;
            ventasSemanaParams = [sucursal];
        }
        const [ventasSemana] = await db.query(ventasSemanaQuery, ventasSemanaParams);

        // Productos más vendidos (para el gráfico de dona)
        let masVendidosQuery = `
            SELECT p.nombre, SUM(vd.cantidad * COALESCE(pa.equivalencia_unidades, 1)) AS total_vendido
            FROM venta_detalle vd
            JOIN productos p ON vd.id_producto = p.id_producto
            LEFT JOIN producto_agrupaciones pa ON vd.id_producto = pa.id_producto AND vd.id_agrupacion = pa.id_agrupacion
            WHERE vd.estado = 'Vendido'
            GROUP BY p.id_producto
            ORDER BY total_vendido DESC
            LIMIT 5
        `;
        let masVendidosParams = [];
        if (sucursal && sucursal !== 'todas') {
            masVendidosQuery = `
                SELECT p.nombre, SUM(vd.cantidad * COALESCE(pa.equivalencia_unidades, 1)) AS total_vendido
                FROM venta_detalle vd
                JOIN productos p ON vd.id_producto = p.id_producto
                JOIN ventas v ON vd.id_venta = v.id_venta
                JOIN sucursales s ON v.id_sucursal = s.id_sucursal
                LEFT JOIN producto_agrupaciones pa ON vd.id_producto = pa.id_producto AND vd.id_agrupacion = pa.id_agrupacion
                WHERE vd.estado = 'Vendido' AND s.nombre = ?
                GROUP BY p.id_producto
                ORDER BY total_vendido DESC
                LIMIT 5
            `;
            masVendidosParams = [sucursal];
        }
        const [masVendidos] = await db.query(masVendidosQuery, masVendidosParams);

        res.json({
            ingresosHoy: ingresosHoyVal,
            totalProductos: totalProductos[0].total,
            valorInventario: valorInventario[0].valor,
            stockBajo: stockBajo[0].total,
            ventasSemana,
            masVendidos
        });
    } catch (err) {
        console.error('Error al obtener dashboard:', err);
        res.status(500).json({ error: 'Error al obtener datos del dashboard.' });
    }
});

// GET /api/reportes/ventas - Reporte de ventas
router.get('/ventas', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, sucursal, vendedor } = req.query;

        let query = `
            SELECT v.id_venta, v.codigo_venta, v.fecha, v.total, v.metodo_pago, v.estado,
                   u.nombre_completo AS vendedor,
                   s.nombre AS sucursal
            FROM ventas v
            JOIN usuarios u ON v.id_usuario = u.id_usuario
            JOIN sucursales s ON v.id_sucursal = s.id_sucursal
            WHERE v.estado = 'Completada'
        `;
        const params = [];

        if (fecha_inicio) { query += ' AND DATE(v.fecha) >= ?'; params.push(fecha_inicio); }
        if (fecha_fin) { query += ' AND DATE(v.fecha) <= ?'; params.push(fecha_fin); }
        if (sucursal && sucursal !== 'todas') { query += ' AND s.nombre = ?'; params.push(sucursal); }
        if (vendedor) { query += ' AND u.nombre_completo = ?'; params.push(vendedor); }

        query += ' ORDER BY v.fecha DESC LIMIT 500';

        const [ventas] = await db.query(query, params);

        // Totales
        const totalMonto = ventas.reduce((sum, v) => sum + parseFloat(v.total), 0);
        const totalTransacciones = ventas.length;

        // Desglose por método de pago
        const porMetodo = {};
        ventas.forEach(v => {
            if (!porMetodo[v.metodo_pago]) porMetodo[v.metodo_pago] = { monto: 0, cantidad: 0 };
            porMetodo[v.metodo_pago].monto += parseFloat(v.total);
            porMetodo[v.metodo_pago].cantidad++;
        });

        res.json({
            ventas,
            resumen: {
                totalMonto,
                totalTransacciones,
                porMetodo
            }
        });
    } catch (err) {
        console.error('Error al generar reporte de ventas:', err);
        res.status(500).json({ error: 'Error al generar reporte.' });
    }
});

// GET /api/reportes/logs - Log de operaciones
router.get('/logs', async (req, res) => {
    try {
        const { fecha, busqueda } = req.query;
        let query = `
            SELECT lo.id_log, lo.fecha, lo.nombre_usuario, lo.nombre_sucursal,
                   lo.accion, lo.modulo, lo.detalle
            FROM log_operaciones lo
            WHERE 1=1
        `;
        const params = [];

        if (fecha) { query += ' AND DATE(lo.fecha) = ?'; params.push(fecha); }
        if (busqueda) {
            query += ' AND (lo.accion LIKE ? OR lo.nombre_usuario LIKE ? OR lo.detalle LIKE ?)';
            params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
        }

        query += ' ORDER BY lo.fecha DESC LIMIT 200';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al obtener logs:', err);
        res.status(500).json({ error: 'Error al obtener logs.' });
    }
});

// POST /api/reportes/log - Registrar log de operación
router.post('/log', async (req, res) => {
    try {
        const { id_usuario, nombre_usuario, id_sucursal, nombre_sucursal, accion, modulo, detalle } = req.body;

        await db.query(`
            INSERT INTO log_operaciones
            (id_usuario, nombre_usuario, id_sucursal, nombre_sucursal, accion, modulo, detalle)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id_usuario || null, nombre_usuario || null, id_sucursal || null, nombre_sucursal || null,
            accion, modulo || null, detalle || null]);

        res.json({ message: 'Log registrado.' });
    } catch (err) {
        console.error('Error al registrar log:', err);
        res.status(500).json({ error: 'Error al registrar log.' });
    }
});

// GET /api/reportes/ventas-diarias - Vista de ventas diarias
router.get('/ventas-diarias', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM v_ventas_diarias ORDER BY fecha_dia DESC LIMIT 30');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener ventas diarias.' });
    }
});

module.exports = router;

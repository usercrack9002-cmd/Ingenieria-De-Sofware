const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/anulaciones - Lista unificada de todas las solicitudes (Ventas, Compras, Gastos, Eliminaciones)
router.get('/', async (req, res) => {
    try {
        const { estado } = req.query;
        const query = `
            SELECT 
                CONCAT('ANUL-', an.id_anulacion) COLLATE utf8mb4_unicode_ci AS id,
                COALESCE(v.codigo_venta, c.numero_factura) COLLATE utf8mb4_unicode_ci AS ventaId,
                (CASE WHEN an.id_compra IS NOT NULL THEN 'Compra' ELSE 'Venta' END) COLLATE utf8mb4_unicode_ci AS tipo,
                DATE_FORMAT(an.fecha, '%Y-%m-%d') COLLATE utf8mb4_unicode_ci AS fecha,
                an.motivo COLLATE utf8mb4_unicode_ci AS motivo,
                us.nombre_completo COLLATE utf8mb4_unicode_ci AS solicitadoPor,
                COALESCE(ua.nombre_completo, 'Sin asignar') COLLATE utf8mb4_unicode_ci AS adminAsignado,
                CAST(an.estado AS CHAR) COLLATE utf8mb4_unicode_ci AS estado,
                COALESCE(v.total, c.total) AS monto,
                COALESCE(v.id_venta, c.id_compra) AS id_original,
                NULL AS prod_id, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_name, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_cat, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_loc
            FROM anulaciones an
            LEFT JOIN ventas v ON an.id_venta = v.id_venta
            LEFT JOIN compras c ON an.id_compra = c.id_compra
            JOIN usuarios us ON an.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON an.id_usuario_admin = ua.id_usuario

            UNION ALL

            SELECT 
                CONCAT('GAST-', g.id_gasto) COLLATE utf8mb4_unicode_ci AS id,
                CONCAT('GAST-', g.id_gasto) COLLATE utf8mb4_unicode_ci AS ventaId,
                'Gasto' COLLATE utf8mb4_unicode_ci AS tipo,
                DATE_FORMAT(g.fecha, '%Y-%m-%d') COLLATE utf8mb4_unicode_ci AS fecha,
                g.motivo COLLATE utf8mb4_unicode_ci AS motivo,
                us.nombre_completo COLLATE utf8mb4_unicode_ci AS solicitadoPor,
                COALESCE(ua.nombre_completo, 'Sin asignar') COLLATE utf8mb4_unicode_ci AS adminAsignado,
                (CASE 
                    WHEN g.estado = 'Aprobado' THEN 'Aprobada' 
                    WHEN g.estado = 'Rechazado' THEN 'Rechazada' 
                    ELSE 'Pendiente' 
                END) COLLATE utf8mb4_unicode_ci AS estado,
                g.monto,
                g.id_gasto AS id_original,
                NULL AS prod_id, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_name, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_cat, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_loc
            FROM gastos g
            JOIN usuarios us ON g.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON g.id_usuario_admin = ua.id_usuario

            UNION ALL

            SELECT 
                CONCAT('ELIM-', ep.id_eliminacion) COLLATE utf8mb4_unicode_ci AS id,
                CONCAT(ep.id_producto, '') COLLATE utf8mb4_unicode_ci AS ventaId,
                'Producto' COLLATE utf8mb4_unicode_ci AS tipo,
                DATE_FORMAT(ep.fecha, '%Y-%m-%d') COLLATE utf8mb4_unicode_ci AS fecha,
                ep.motivo COLLATE utf8mb4_unicode_ci AS motivo,
                us.nombre_completo COLLATE utf8mb4_unicode_ci AS solicitadoPor,
                COALESCE(ua.nombre_completo, 'Sin asignar') COLLATE utf8mb4_unicode_ci AS adminAsignado,
                CAST(ep.estado AS CHAR) COLLATE utf8mb4_unicode_ci AS estado,
                0.00 AS monto,
                ep.id_eliminacion AS id_original,
                ep.id_producto AS prod_id, 
                p.nombre COLLATE utf8mb4_unicode_ci AS prod_name, 
                cat.nombre COLLATE utf8mb4_unicode_ci AS prod_cat, 
                COALESCE(inv.ubicacion, 'Bodega') COLLATE utf8mb4_unicode_ci AS prod_loc
            FROM eliminaciones_producto ep
            JOIN productos p ON ep.id_producto = p.id_producto
            JOIN categorias cat ON p.id_categoria = cat.id_categoria
            LEFT JOIN (
                SELECT id_producto, MAX(ubicacion) AS ubicacion 
                FROM inventario 
                GROUP BY id_producto
            ) inv ON ep.id_producto = inv.id_producto
            JOIN usuarios us ON ep.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON ep.id_usuario_admin = ua.id_usuario

            UNION ALL

            SELECT 
                CONCAT('PROV-', dp.id_desactivacion) COLLATE utf8mb4_unicode_ci AS id,
                CONCAT(dp.id_proveedor, '') COLLATE utf8mb4_unicode_ci AS ventaId,
                'Proveedor' COLLATE utf8mb4_unicode_ci AS tipo,
                DATE_FORMAT(dp.fecha, '%Y-%m-%d') COLLATE utf8mb4_unicode_ci AS fecha,
                dp.motivo COLLATE utf8mb4_unicode_ci AS motivo,
                us.nombre_completo COLLATE utf8mb4_unicode_ci AS solicitadoPor,
                COALESCE(ua.nombre_completo, 'Sin asignar') COLLATE utf8mb4_unicode_ci AS adminAsignado,
                CAST(dp.estado AS CHAR) COLLATE utf8mb4_unicode_ci AS estado,
                0.00 AS monto,
                dp.id_desactivacion AS id_original,
                dp.id_proveedor AS prod_id, 
                p.nombre COLLATE utf8mb4_unicode_ci AS prod_name, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_cat, 
                CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS prod_loc
            FROM desactivaciones_proveedor dp
            JOIN proveedores p ON dp.id_proveedor = p.id_proveedor
            JOIN usuarios us ON dp.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON dp.id_usuario_admin = ua.id_usuario
            
            ORDER BY fecha DESC
        `;

        const [rows] = await db.query(query);

        const formattedRows = rows.map(r => {
            const item = {
                id: r.id,
                ventaId: r.ventaId,
                tipo: r.tipo,
                fecha: r.fecha,
                motivo: r.motivo,
                solicitadoPor: r.solicitadoPor,
                adminAsignado: r.adminAsignado,
                estado: r.estado,
                monto: parseFloat(r.monto),
                id_original: r.id_original
            };
            if (r.tipo === 'Producto') {
                item.detallesProducto = {
                    id: r.prod_id,
                    name: r.prod_name,
                    category: r.prod_cat,
                    location: r.prod_loc
                };
            }
            if (r.tipo === 'Proveedor') {
                item.detallesProveedor = {
                    id: r.prod_id,
                    name: r.prod_name
                };
            }
            return item;
        });

        let filtered = formattedRows;
        if (estado) {
            filtered = formattedRows.filter(r => r.estado === estado);
        }
        res.json(filtered);
    } catch (err) {
        console.error('Error al listar anulaciones:', err);
        res.status(500).json({ error: 'Error al obtener anulaciones.' });
    }
});

// GET /api/anulaciones/eliminaciones - Solicitudes de eliminación de productos
router.get('/eliminaciones', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT ep.id_eliminacion, ep.motivo, ep.estado, ep.fecha, ep.fecha_resolucion,
                   p.nombre AS producto, p.id_producto,
                   us.nombre_completo AS solicitante,
                   COALESCE(ua.nombre_completo, 'Sin asignar') AS admin,
                   COALESCE(s.nombre, 'Todas') AS sucursal
            FROM eliminaciones_producto ep
            JOIN productos p ON ep.id_producto = p.id_producto
            JOIN usuarios us ON ep.id_usuario_solicitante = us.id_usuario
            LEFT JOIN usuarios ua ON ep.id_usuario_admin = ua.id_usuario
            LEFT JOIN sucursales s ON ep.id_sucursal = s.id_sucursal
            ORDER BY ep.fecha DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar eliminaciones:', err);
        res.status(500).json({ error: 'Error al obtener eliminaciones.' });
    }
});

// POST /api/anulaciones - Crear solicitud de anulación
router.post('/', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { id_venta, id_compra, motivo, id_usuario_solicitante, id_usuario_admin } = req.body;
        if ((!id_venta && !id_compra) || !id_usuario_solicitante) {
            await conn.rollback();
            return res.status(400).json({ error: 'Datos incompletos.' });
        }

        // Obtener rol y nombre de usuario solicitante
        const [userRows] = await conn.query('SELECT id_rol, nombre_completo FROM usuarios WHERE id_usuario = ?', [id_usuario_solicitante]);
        if (userRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Usuario solicitante no encontrado.' });
        }
        const user = userRows[0];
        const isAutoprivileged = user.id_rol === 1 || user.id_rol === 2; // Gerente or Administrador

        // Verificar que la venta/compra exista y no esté ya anulada
        const [origenRows] = id_venta
            ? await conn.query('SELECT estado FROM ventas WHERE id_venta = ?', [id_venta])
            : await conn.query('SELECT estado FROM compras WHERE id_compra = ?', [id_compra]);
        if (origenRows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: id_venta ? 'Venta no encontrada.' : 'Compra no encontrada.' });
        }
        if (origenRows[0].estado === 'Anulada') {
            await conn.rollback();
            return res.status(400).json({ error: id_venta ? 'La venta ya está anulada.' : 'La compra ya está anulada.' });
        }

        // Evitar solicitudes pendientes duplicadas
        const [pendientes] = await conn.query(
            `SELECT id_anulacion FROM anulaciones WHERE estado = 'Pendiente' AND ${id_venta ? 'id_venta' : 'id_compra'} = ?`,
            [id_venta || id_compra]
        );
        if (pendientes.length > 0) {
            await conn.rollback();
            return res.status(409).json({ error: 'Ya existe una solicitud de anulación pendiente para este registro.' });
        }

        const finalMotivo = (motivo && motivo.trim()) ? motivo.trim() : `Anulación directa por ${user.id_rol === 1 ? 'Gerente' : 'Administrador'}`;

        if (!isAutoprivileged) {
            // Un vendedor siempre necesita especificar un motivo
            if (!motivo || !motivo.trim()) {
                await conn.rollback();
                return res.status(400).json({ error: 'El motivo es obligatorio para registrar la solicitud.' });
            }

            // Insertar solicitud pendiente
            const [result] = await conn.query(`
                INSERT INTO anulaciones (id_venta, id_compra, motivo, id_usuario_solicitante, id_usuario_admin, estado)
                VALUES (?, ?, ?, ?, ?, 'Pendiente')
            `, [id_venta || null, id_compra || null, finalMotivo, id_usuario_solicitante, id_usuario_admin || null]);

            await conn.commit();
            return res.status(201).json({ id_anulacion: result.insertId, status: 'Pendiente', message: 'Solicitud de anulación registrada.' });
        }

        // Caso Gerente/Administrador: Anular inmediatamente (Aprobada)
        const [result] = await conn.query(`
            INSERT INTO anulaciones (id_venta, id_compra, motivo, id_usuario_solicitante, id_usuario_admin, estado, fecha_resolucion)
            VALUES (?, ?, ?, ?, ?, 'Aprobada', NOW())
        `, [id_venta || null, id_compra || null, finalMotivo, id_usuario_solicitante, id_usuario_solicitante]);

        const id_anulacion = result.insertId;

        // Ejecutar lógica de anulación de venta o compra directamente
        if (id_venta) {
            const ventaId = id_venta;

            // 1. Obtener id_sucursal de la venta
            const [ventaRows] = await conn.query('SELECT id_sucursal FROM ventas WHERE id_venta = ?', [ventaId]);
            if (ventaRows.length > 0) {
                const id_sucursal = ventaRows[0].id_sucursal;

                // 2. Obtener detalles de la venta
                const [detalles] = await conn.query(`
                    SELECT 
                        vd.id_producto,
                        vd.id_inventario,
                        (vd.cantidad * COALESCE(pa.equivalencia_unidades, 1)) AS total_unidades
                    FROM venta_detalle vd
                    LEFT JOIN producto_agrupaciones pa 
                      ON vd.id_producto = pa.id_producto AND vd.id_agrupacion = pa.id_agrupacion
                    WHERE vd.id_venta = ?
                `, [ventaId]);

                // 3. Revertir el stock (incrementar en Mostrador)
                for (const det of detalles) {
                    let idInventario = det.id_inventario;

                    if (idInventario) {
                        await conn.query(`
                            UPDATE inventario SET stock = stock + ?
                            WHERE id_inventario = ?
                        `, [det.total_unidades, idInventario]);
                    } else {
                        const [existingInv] = await conn.query(`
                            SELECT id_inventario FROM inventario
                            WHERE id_producto = ? AND id_sucursal = ? AND ubicacion = 'Mostrador'
                            LIMIT 1
                        `, [det.id_producto, id_sucursal]);

                        if (existingInv.length > 0) {
                            await conn.query(`
                                UPDATE inventario SET stock = stock + ?
                                WHERE id_inventario = ?
                            `, [det.total_unidades, existingInv[0].id_inventario]);
                        } else {
                            await conn.query(`
                                INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                                VALUES (?, ?, 'Mostrador', ?, 5, 0)
                            `, [det.id_producto, id_sucursal, det.total_unidades]);
                        }
                    }
                }
            }

            // 4. Marcar la venta como Anulada
            await conn.query("UPDATE ventas SET estado = 'Anulada' WHERE id_venta = ?", [ventaId]);

        } else if (id_compra) {
            const compraId = id_compra;

            // 1. Obtener id_sucursal de la compra
            const [compraRows] = await conn.query('SELECT id_sucursal FROM compras WHERE id_compra = ?', [compraId]);
            if (compraRows.length > 0) {
                const id_sucursal = compraRows[0].id_sucursal || 1;

                // 2. Obtener detalles de la compra (productos, cantidad_unidades, bonificacion, lote, precio_unitario_neto)
                const [detalles] = await conn.query(`
                    SELECT id_producto, cantidad_unidades, bonificacion, lote, precio_unitario_neto
                    FROM compra_detalle
                    WHERE id_compra = ?
                `, [compraId]);

                // 3. Revertir el stock (decrementar en Bodega)
                for (const det of detalles) {
                    const cantAReducir = (det.cantidad_unidades || 0) + (det.bonificacion || 0);
                    const [existingInv] = await conn.query(`
                        SELECT id_inventario, stock FROM inventario
                        WHERE id_producto = ? 
                          AND id_sucursal = ? 
                          AND ubicacion = 'Bodega'
                          AND lote <=> ? 
                          AND precio_costo = ?
                        LIMIT 1
                    `, [det.id_producto, id_sucursal, det.lote || null, det.precio_unitario_neto || 0]);

                    if (existingInv.length > 0) {
                        const nuevoStock = Math.max(0, existingInv[0].stock - cantAReducir);
                        await conn.query(`
                            UPDATE inventario SET stock = ?
                            WHERE id_inventario = ?
                        `, [nuevoStock, existingInv[0].id_inventario]);
                    }
                }
            }

            // 4. Marcar la compra como Anulada
            await conn.query("UPDATE compras SET estado = 'Anulada' WHERE id_compra = ?", [compraId]);
        }

        await conn.commit();
        res.status(201).json({ id_anulacion, status: 'Aprobada', message: 'Anulación directa procesada exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al crear anulación:', err);
        res.status(500).json({ error: 'Error al registrar y procesar anulación.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// PATCH /api/anulaciones/:id - Aprobar/Rechazar anulación
router.patch('/:id', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { estado, id_usuario_admin } = req.body;
        if (!estado || !['Aprobada', 'Rechazada'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const [anulacion] = await conn.query('SELECT id_venta, id_compra, estado FROM anulaciones WHERE id_anulacion = ? FOR UPDATE', [req.params.id]);
        if (anulacion.length === 0) return res.status(404).json({ error: 'Anulación no encontrada.' });
        if (anulacion[0].estado !== 'Pendiente') {
            return res.status(400).json({ error: `Esta solicitud ya fue ${anulacion[0].estado.toLowerCase()}.` });
        }

        // Si el registro original ya fue anulado por otra vía, no revertir el stock de nuevo
        if (estado === 'Aprobada') {
            const [origenRows] = anulacion[0].id_venta
                ? await conn.query('SELECT estado FROM ventas WHERE id_venta = ?', [anulacion[0].id_venta])
                : await conn.query('SELECT estado FROM compras WHERE id_compra = ?', [anulacion[0].id_compra]);
            if (origenRows.length > 0 && origenRows[0].estado === 'Anulada') {
                return res.status(400).json({ error: 'El registro ya se encuentra anulado.' });
            }
        }

        await conn.query(`
            UPDATE anulaciones SET estado = ?, id_usuario_admin = ?, fecha_resolucion = NOW()
            WHERE id_anulacion = ?
        `, [estado, id_usuario_admin || null, req.params.id]);

        // Si se aprueba, anular la venta o la compra correspondientes
        if (estado === 'Aprobada') {
            if (anulacion[0].id_venta) {
                const ventaId = anulacion[0].id_venta;

                // 1. Obtener id_sucursal de la venta
                const [ventaRows] = await conn.query('SELECT id_sucursal FROM ventas WHERE id_venta = ?', [ventaId]);
                if (ventaRows.length > 0) {
                    const id_sucursal = ventaRows[0].id_sucursal;

                    // 2. Obtener detalles de la venta (productos y cantidades vendidas en unidades)
                    const [detalles] = await conn.query(`
                        SELECT 
                            vd.id_producto,
                            vd.id_inventario,
                            (vd.cantidad * COALESCE(pa.equivalencia_unidades, 1)) AS total_unidades
                        FROM venta_detalle vd
                        LEFT JOIN producto_agrupaciones pa 
                          ON vd.id_producto = pa.id_producto AND vd.id_agrupacion = pa.id_agrupacion
                        WHERE vd.id_venta = ?
                    `, [ventaId]);

                    // 3. Revertir el stock (incrementar en Mostrador)
                    for (const det of detalles) {
                        let idInventario = det.id_inventario;

                        if (idInventario) {
                            await conn.query(`
                                UPDATE inventario SET stock = stock + ?
                                WHERE id_inventario = ?
                            `, [det.total_unidades, idInventario]);
                        } else {
                            const [existingInv] = await conn.query(`
                                SELECT id_inventario FROM inventario
                                WHERE id_producto = ? AND id_sucursal = ? AND ubicacion = 'Mostrador'
                                LIMIT 1
                            `, [det.id_producto, id_sucursal]);

                            if (existingInv.length > 0) {
                                await conn.query(`
                                    UPDATE inventario SET stock = stock + ?
                                    WHERE id_inventario = ?
                                `, [det.total_unidades, existingInv[0].id_inventario]);
                            } else {
                                await conn.query(`
                                    INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, precio_costo)
                                    VALUES (?, ?, 'Mostrador', ?, 5, 0)
                                `, [det.id_producto, id_sucursal, det.total_unidades]);
                            }
                        }
                    }
                }

                // 4. Marcar la venta como Anulada
                await conn.query("UPDATE ventas SET estado = 'Anulada' WHERE id_venta = ?", [ventaId]);

            } else if (anulacion[0].id_compra) {
                const compraId = anulacion[0].id_compra;

                // 1. Obtener id_sucursal de la compra
                const [compraRows] = await conn.query('SELECT id_sucursal FROM compras WHERE id_compra = ?', [compraId]);
                if (compraRows.length > 0) {
                    const id_sucursal = compraRows[0].id_sucursal || 1;

                    // 2. Obtener detalles de la compra (productos, cantidad_unidades, bonificacion, lote, precio_unitario_neto)
                    const [detalles] = await conn.query(`
                        SELECT id_producto, cantidad_unidades, bonificacion, lote, precio_unitario_neto
                        FROM compra_detalle
                        WHERE id_compra = ?
                    `, [compraId]);

                    // 3. Revertir el stock (decrementar en Bodega)
                    for (const det of detalles) {
                        const cantAReducir = (det.cantidad_unidades || 0) + (det.bonificacion || 0);
                        const [existingInv] = await conn.query(`
                            SELECT id_inventario, stock FROM inventario
                            WHERE id_producto = ? 
                              AND id_sucursal = ? 
                              AND ubicacion = 'Bodega'
                              AND lote <=> ? 
                              AND precio_costo = ?
                            LIMIT 1
                        `, [det.id_producto, id_sucursal, det.lote || null, det.precio_unitario_neto || 0]);

                        if (existingInv.length > 0) {
                            const nuevoStock = Math.max(0, existingInv[0].stock - cantAReducir);
                            await conn.query(`
                                UPDATE inventario SET stock = ?
                                WHERE id_inventario = ?
                            `, [nuevoStock, existingInv[0].id_inventario]);
                        }
                    }
                }

                // 4. Marcar la compra como Anulada
                await conn.query("UPDATE compras SET estado = 'Anulada' WHERE id_compra = ?", [compraId]);
            }
        }

        await conn.commit();
        res.json({ message: `Anulación ${estado.toLowerCase()}.` });
    } catch (err) {
        await conn.rollback();
        console.error('Error al procesar anulación:', err);
        res.status(500).json({ error: 'Error al procesar anulación.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// POST /api/anulaciones/eliminacion - Solicitar eliminación de producto
router.post('/eliminacion', async (req, res) => {
    try {
        const { id_producto, id_inventario, id_sucursal, motivo, id_usuario_solicitante, id_usuario_admin } = req.body;

        const [result] = await db.query(`
            INSERT INTO eliminaciones_producto
            (id_producto, id_inventario, id_sucursal, motivo, id_usuario_solicitante, id_usuario_admin)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id_producto, id_inventario || null, id_sucursal || null, motivo, id_usuario_solicitante, id_usuario_admin || null]);

        res.status(201).json({ id_eliminacion: result.insertId, message: 'Solicitud de eliminación registrada.' });
    } catch (err) {
        console.error('Error al crear solicitud de eliminación:', err);
        res.status(500).json({ error: 'Error al registrar solicitud.' });
    }
});

// PATCH /api/anulaciones/eliminacion/:id
router.patch('/eliminacion/:id', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { estado } = req.body;
        if (!estado || !['Aprobada', 'Rechazada'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const [elim] = await conn.query('SELECT id_producto, estado FROM eliminaciones_producto WHERE id_eliminacion = ?', [req.params.id]);
        if (elim.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        if (elim[0].estado !== 'Pendiente') {
            return res.status(400).json({ error: `Esta solicitud ya fue ${elim[0].estado.toLowerCase()}.` });
        }

        await conn.query(`
            UPDATE eliminaciones_producto SET estado = ?, fecha_resolucion = NOW()
            WHERE id_eliminacion = ?
        `, [estado, req.params.id]);

        if (estado === 'Aprobada') {
            await conn.query("UPDATE productos SET id_estado = 2 WHERE id_producto = ?", [elim[0].id_producto]);
        }

        await conn.commit();
        res.json({ message: `Solicitud de eliminación ${estado.toLowerCase()}.` });
    } catch (err) {
        await conn.rollback();
        console.error('Error al procesar eliminación:', err);
        res.status(500).json({ error: 'Error al procesar solicitud.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// POST /api/anulaciones/proveedor - Solicitar inactivación de proveedor
router.post('/proveedor', async (req, res) => {
    try {
        const { id_proveedor, motivo, id_usuario_solicitante, id_usuario_admin } = req.body;
        if (!id_proveedor || !motivo || !id_usuario_solicitante) {
            return res.status(400).json({ error: 'Datos incompletos.' });
        }

        const [result] = await db.query(`
            INSERT INTO desactivaciones_proveedor
            (id_proveedor, motivo, id_usuario_solicitante, id_usuario_admin)
            VALUES (?, ?, ?, ?)
        `, [id_proveedor, motivo, id_usuario_solicitante, id_usuario_admin || null]);

        res.status(201).json({ id_desactivacion: result.insertId, message: 'Solicitud de inactivación registrada.' });
    } catch (err) {
        console.error('Error al crear solicitud de inactivación de proveedor:', err);
        res.status(500).json({ error: 'Error al registrar solicitud.' });
    }
});

// PATCH /api/anulaciones/proveedor/:id - Aprobar/Rechazar inactivación de proveedor
router.patch('/proveedor/:id', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { estado, id_usuario_admin } = req.body;
        if (!estado || !['Aprobada', 'Rechazada'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }

        const [desact] = await conn.query('SELECT id_proveedor, estado FROM desactivaciones_proveedor WHERE id_desactivacion = ?', [req.params.id]);
        if (desact.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        if (desact[0].estado !== 'Pendiente') {
            return res.status(400).json({ error: `Esta solicitud ya fue ${desact[0].estado.toLowerCase()}.` });
        }

        await conn.query(`
            UPDATE desactivaciones_proveedor SET estado = ?, id_usuario_admin = ?, fecha_resolucion = NOW()
            WHERE id_desactivacion = ?
        `, [estado, id_usuario_admin || null, req.params.id]);

        if (estado === 'Aprobada') {
            // Inactivar el proveedor (id_estado = 2)
            await conn.query("UPDATE proveedores SET id_estado = 2 WHERE id_proveedor = ?", [desact[0].id_proveedor]);
        }

        await conn.commit();
        res.json({ message: `Solicitud de desactivación de proveedor ${estado.toLowerCase()}.` });
    } catch (err) {
        await conn.rollback();
        console.error('Error al procesar desactivación de proveedor:', err);
        res.status(500).json({ error: 'Error al procesar solicitud.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/compras
// Filtros opcionales: sucursal (nombre), fecha (YYYY-MM-DD), id_usuario, numero_factura
router.get('/', async (req, res) => {
    try {
        const { sucursal, fecha, id_usuario, numero_factura } = req.query;
        let query = `
            SELECT c.id_compra, c.numero_factura, c.fecha, c.metodo_pago,
                   c.subtotal, c.iva_total, c.total, c.estado,
                   p.nombre AS proveedor, p.id_proveedor,
                   u.nombre_completo AS comprador,
                   s.nombre AS sucursal, s.id_sucursal, c.id_usuario
            FROM compras c
            JOIN proveedores p ON c.id_proveedor = p.id_proveedor
            JOIN usuarios u ON c.id_usuario = u.id_usuario
            JOIN sucursales s ON c.id_sucursal = s.id_sucursal
            WHERE 1=1
        `;
        const params = [];
        if (sucursal && sucursal !== 'todas') { query += ' AND s.nombre = ?'; params.push(sucursal); }
        if (fecha) { query += ' AND c.fecha = ?'; params.push(fecha); }
        if (id_usuario) { query += ' AND c.id_usuario = ?'; params.push(id_usuario); }
        if (numero_factura) { query += ' AND c.numero_factura = ?'; params.push(numero_factura); }
        // Sin filtros se mantiene el límite para no traer todo el historial
        query += (sucursal || fecha || id_usuario || numero_factura)
            ? ' ORDER BY c.fecha DESC, c.id_compra DESC'
            : ' ORDER BY c.fecha DESC, c.id_compra DESC LIMIT 100';

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error al listar compras:', err);
        res.status(500).json({ error: 'Error al obtener compras.' });
    }
});

// GET /api/compras/:id - Detalle de compra
router.get('/:id', async (req, res) => {
    try {
        const [compra] = await db.query(`
            SELECT c.*, p.nombre AS proveedor, u.nombre_completo AS comprador
            FROM compras c
            JOIN proveedores p ON c.id_proveedor = p.id_proveedor
            JOIN usuarios u ON c.id_usuario = u.id_usuario
            WHERE c.id_compra = ?
        `, [req.params.id]);

        if (compra.length === 0) return res.status(404).json({ error: 'Compra no encontrada.' });

        const [detalle] = await db.query(`
            SELECT cd.*, pr.nombre AS producto,
                   COALESCE(a.nombre, 'Unidad') AS agrupacion
            FROM compra_detalle cd
            JOIN productos pr ON cd.id_producto = pr.id_producto
            LEFT JOIN agrupaciones a ON cd.id_agrupacion = a.id_agrupacion
            WHERE cd.id_compra = ?
        `, [req.params.id]);

        res.json({ ...compra[0], detalle });
    } catch (err) {
        console.error('Error al obtener compra:', err);
        res.status(500).json({ error: 'Error al obtener compra.' });
    }
});

// POST /api/compras - Registrar compra
router.post('/', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { numero_factura, fecha, id_proveedor, id_usuario, metodo_pago, productos, id_sucursal } = req.body;

        if (!numero_factura || !fecha || !id_proveedor || !id_usuario || !productos || productos.length === 0) {
            return res.status(400).json({ error: 'Datos incompletos.' });
        }

        let subtotal = 0;
        let ivaTotal = 0;

        productos.forEach(p => {
            const subtotalBruto = (p.cantidad_agrupacion || 0) * (p.precio_costo || 0);
            const baseDescuento = subtotalBruto - (p.descuento || 0);
            const ivaPct = p.iva_porcentaje !== undefined ? p.iva_porcentaje : 15;
            const iva = baseDescuento > 0 ? Math.round(baseDescuento * (ivaPct / 100) * 100) / 100 : 0;
            subtotal += Math.round(baseDescuento * 100) / 100;
            ivaTotal += iva;
        });

        const total = Math.max(0, Math.round((subtotal + ivaTotal) * 100) / 100);

        const sucursalDestino = id_sucursal || 1; // Default: Central

        const [result] = await conn.query(`
            INSERT INTO compras (numero_factura, fecha, id_proveedor, id_usuario, metodo_pago, subtotal, iva_total, total, id_sucursal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [numero_factura, fecha, id_proveedor, id_usuario, metodo_pago || 'Efectivo', subtotal, ivaTotal, total, sucursalDestino]);

        const compraId = result.insertId;

        for (const prod of productos) {
            const cantUnidades = prod.cantidad_unidades || prod.cantidad_agrupacion;
            const subtotalBruto = (prod.cantidad_agrupacion || 0) * (prod.precio_costo || 0);
            const baseDescuento = subtotalBruto - (prod.descuento || 0);
            const ivaPct = prod.iva_porcentaje !== undefined ? prod.iva_porcentaje : 15;
            const ivaMonto = baseDescuento > 0 ? Math.round(baseDescuento * (ivaPct / 100) * 100) / 100 : 0;
            const subtNeto = Math.max(0, Math.round((baseDescuento + ivaMonto) * 100) / 100);
            
            const cantTotalRecibida = cantUnidades + (prod.bonificacion || 0);
            let precioUnitNeto = cantTotalRecibida > 0 ? Math.round((subtNeto / cantTotalRecibida) * 100) / 100 : 0;

            const [detResult] = await conn.query(`
                INSERT INTO compra_detalle
                (id_compra, id_producto, id_agrupacion, cantidad_agrupacion, cantidad_unidades,
                 precio_costo, iva_porcentaje, iva_monto, descuento, bonificacion,
                 lote, fecha_entrega, fecha_caducidad, precio_unitario_neto, subtotal_neto,
                 precio_venta_sugerido, margen_ganancia)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                compraId, prod.id_producto, prod.id_agrupacion || null,
                prod.cantidad_agrupacion, cantUnidades, prod.precio_costo,
                ivaPct, ivaMonto, prod.descuento || 0,
                prod.bonificacion || 0, prod.lote || null, prod.fecha_entrega || null,
                prod.fecha_caducidad || null, precioUnitNeto, subtNeto,
                prod.precio_venta_sugerido || null, prod.margen_ganancia || 20.00
            ]);

            // Usar el costo unitario guardado en la BD (el trigger puede recalcularlo) para que
            // la anulación posterior encuentre exactamente el mismo lote de inventario
            const [detRows] = await conn.query(
                'SELECT precio_unitario_neto FROM compra_detalle WHERE id_compra_detalle = ?',
                [detResult.insertId]
            );
            if (detRows.length > 0) precioUnitNeto = parseFloat(detRows[0].precio_unitario_neto);

            // Actualizar inventario con el costo unitario neto (precioUnitNeto) y lote <=> ?
            const [existingInv] = await conn.query(`
                SELECT id_inventario FROM inventario
                WHERE id_producto = ? 
                  AND id_sucursal = ? 
                  AND ubicacion = 'Bodega'
                  AND lote <=> ?
                  AND fecha_vencimiento <=> ?
                  AND precio_costo = ?
                LIMIT 1
            `, [prod.id_producto, sucursalDestino, prod.lote || null, prod.fecha_caducidad || null, precioUnitNeto]);

            if (existingInv.length > 0) {
                await conn.query(`
                    UPDATE inventario SET stock = stock + ?
                    WHERE id_inventario = ?
                `, [cantUnidades + (prod.bonificacion || 0), existingInv[0].id_inventario]);
            } else {
                await conn.query(`
                    INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, precio_costo, lote, fecha_vencimiento)
                    VALUES (?, ?, 'Bodega', ?, ?, ?, ?)
                `, [prod.id_producto, sucursalDestino, cantUnidades + (prod.bonificacion || 0),
                    precioUnitNeto, prod.lote || null, prod.fecha_caducidad || null]);
            }

            // Actualizar el precio_venta del producto en el catálogo maestro
            if (prod.precio_venta_sugerido && prod.precio_venta_sugerido > 0) {
                await conn.query(`
                    UPDATE productos SET precio_venta = ?
                    WHERE id_producto = ?
                `, [prod.precio_venta_sugerido, prod.id_producto]);
            }
        }

        await conn.commit();
        res.status(201).json({ id_compra: compraId, total, message: 'Compra registrada exitosamente.' });
    } catch (err) {
        await conn.rollback();
        console.error('Error al registrar compra:', err);
        res.status(500).json({ error: 'Error al registrar compra.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

// PATCH /api/compras/:id/anular
router.patch('/:id/anular', async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const compraId = req.params.id;

        // Verificar si la compra existe y está Activa
        const [compraRows] = await conn.query('SELECT estado, numero_factura, id_sucursal FROM compras WHERE id_compra = ?', [compraId]);
        if (compraRows.length === 0) {
            return res.status(404).json({ error: 'Compra no encontrada.' });
        }
        if (compraRows[0].estado === 'Anulada') {
            return res.status(400).json({ error: 'La compra ya está anulada.' });
        }

        // Obtener el detalle de la compra para revertir el stock en el inventario
        const [detalles] = await conn.query(`
            SELECT id_producto, cantidad_unidades, bonificacion, lote, precio_unitario_neto
            FROM compra_detalle
            WHERE id_compra = ?
        `, [compraId]);

        const id_sucursal = compraRows[0].id_sucursal || 1;

        for (const det of detalles) {
            const cantAReducir = (det.cantidad_unidades || 0) + (det.bonificacion || 0);
            
            // Buscar registro de inventario con el mismo producto, sucursal, lote, costo y ubicacion = 'Bodega'
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

        // Marcar la compra como Anulada
        await conn.query("UPDATE compras SET estado = 'Anulada' WHERE id_compra = ?", [compraId]);

        await conn.commit();
        res.json({ message: 'Compra anulada exitosamente y stock revertido.', numero_factura: compraRows[0].numero_factura });
    } catch (err) {
        await conn.rollback();
        console.error('Error al anular compra:', err);
        res.status(500).json({ error: 'Error al anular compra.' });
    } finally {
        // Revierte cualquier transacción que haya quedado abierta por un return anticipado
        try { await conn.rollback(); } catch (_) { }
        conn.release();
    }
});

module.exports = router;
